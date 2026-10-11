import { describe, expect, it } from 'vitest';
import { PROVIDERS } from 'open-sse/config/providers.js';
import { captureAccountingKiroConfig } from 'open-sse/config/accountedKiroDispatch.js';
import { captureAccountingProxyEnvironment } from 'open-sse/config/accountedProxyEnvironment.js';
import { captureKiroEllipsisRepairConversion } from 'open-sse/config/accountedKiroRepairConversion.js';
import { validateQueuedKiroWire } from '@/lib/apiKeyBudget/queuedKiroWire.js';
const model = 'claude-sonnet-4.5', invocationId = '22222222-2222-4222-8222-222222222222';
const instruction = 'Retry the previous response because it ended with only an ellipsis. Return the complete final answer, not only ... or ….';
const original = () => ({ conversationState: { chatTriggerType: 'MANUAL', conversationId: '12345678-1234-4123-8123-123456789abc',
  currentMessage: { userInputMessage: { content: 'fixture prompt', modelId: model, origin: 'AI_EDITOR' } }, history: [] },
  inferenceConfig: { maxTokens: 100, temperature: 0.5, topP: 1 } });
const credentials = () => ({ apiKey: null, accessToken: 'dummy-api-key', connectionId: 'c', providerSpecificData: { authMethod: 'api_key', region: 'us-east-1' } });
const authority = () => ({ provider: 'kiro', model, connection: { id: 'c', authType: 'apikey', data: JSON.stringify({ apiKey: null, accessToken: 'dummy-api-key', providerSpecificData: credentials().providerSpecificData }) }, settings: '{}' });
function wire() {
  const body = original(), actual = structuredClone(body);
  actual.conversationState.currentMessage.userInputMessage.content += '\n\n' + instruction;
  const headers = new Headers(PROVIDERS.kiro.headers);
  for (const [key, value] of Object.entries({ 'Amz-Sdk-Request': 'attempt=1; max=3', 'Amz-Sdk-Invocation-Id': invocationId,
    Authorization: 'Bearer dummy-api-key', TokenType: 'API_KEY', 'x-amz-sso-bearer': 'dummy-api-key',
    'x-amzn-kiro-agent-mode': 'spec', 'x-amzn-codewhisperer-machine-id': 'kiro-desktop' })) headers.set(key, value);
  return { protocol: 'native-kiro', url: 'https://q.us-east-1.amazonaws.com/generateAssistantResponse',
    headers: Object.fromEntries(headers), credentials: credentials(), providerOverrides: null, proxyOptions: null, proxyEnvironment: captureAccountingProxyEnvironment(),
    kiroTransport: { model, mode: 'native-kiro-eventstream', kiroConfig: captureAccountingKiroConfig(PROVIDERS.kiro), invocationId, serializedBody: JSON.stringify(actual) },
    kiroRepairCapture: captureKiroEllipsisRepairConversion({ model, original: body, actual }) };
}
describe('optional queued Kiro complete repair capture (equality prerequisite, not generation/route/ACK grant)', () => {
  it('accepts complete repair capture and freezes it without changing native eight-field envelope contract', () => {
    const input = wire(), result = validateQueuedKiroWire(authority(), input);
    expect(result).toEqual(input); expect(Object.isFrozen(result.kiroRepairCapture.actual.conversationState)).toBe(true);
    const native = structuredClone(input); delete native.kiroRepairCapture; native.kiroTransport.serializedBody = JSON.stringify(original());
    expect(validateQueuedKiroWire(authority(), native)).toEqual(native);
    expect(result.kiroRepairCapture.actual).toEqual(JSON.parse(result.kiroTransport.serializedBody));
  });
  it.each(['original', 'actual', 'serialized-body', 'model'])('accepted positive then %s drift refuses without rebuild/pruning', kind => {
    const input = structuredClone(wire()); expect(validateQueuedKiroWire(authority(), input)).toEqual(input);
    if (kind === 'original') input.kiroRepairCapture.original.conversationState.currentMessage.userInputMessage.content = 'changed';
    if (kind === 'actual') input.kiroRepairCapture.actual.inferenceConfig.maxTokens = 101;
    if (kind === 'serialized-body') input.kiroTransport.serializedBody = JSON.stringify(original());
    if (kind === 'model') input.kiroRepairCapture.model = 'claude-sonnet-4';
    expect(() => validateQueuedKiroWire(authority(), input)).toThrow();
  });
  it.each(['getter', 'proxy'])('accepted positive then whole capture %s refuses before programmable reads', kind => {
    const input = structuredClone(wire()); expect(validateQueuedKiroWire(authority(), input)).toEqual(input); let reads = 0;
    const trap = () => { reads++; throw new Error('fixture repair wire programmable read'); };
    if (kind === 'getter') Object.defineProperty(input.kiroRepairCapture, 'actual', { enumerable: true, get: trap });
    else input.kiroRepairCapture = new Proxy(input.kiroRepairCapture, { ownKeys: trap, get: trap, getPrototypeOf: trap });
    expect(() => validateQueuedKiroWire(authority(), input)).toThrow(); expect(reads).toBe(0);
  });
});
