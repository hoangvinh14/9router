import { describe, expect, it } from 'vitest';
import { PROVIDERS } from 'open-sse/config/providers.js';
import { captureAccountingCommandCodeConfig } from 'open-sse/config/accountedCommandCodeDispatch.js';
import { captureCommandCodeChatConversion } from 'open-sse/config/accountedCommandCodeChatCapture.js';
import { captureAccountingProxyEnvironment } from 'open-sse/config/accountedProxyEnvironment.js';
import { validateQueuedCommandCodeWire } from '@/lib/apiKeyBudget/queuedCommandCodeWire.js';
const model = 'deepseek/deepseek-v4-pro', sessionId = '22222222-2222-4222-8222-222222222222';
function fixture() {
  const credentials = { apiKey: 'dummy-api-key', accessToken: null, connectionId: 'c', providerSpecificData: {} };
  const runtime = { workingDir: '/fixture/work', date: '2026-10-10', environment: 'linux' };
  const original = { body: { model, stream: true, max_tokens: 100, temperature: 0.3, messages: [{ role: 'user', content: 'fixture prompt' }] }, model, stream: true,
    credentials, runtime, config: structuredClone(PROVIDERS.commandcode), proxyOptions: null, providerOverrides: null };
  const capture = captureCommandCodeChatConversion(original, () => ({ threadId: '11111111-1111-4111-8111-111111111111', memory: '',
    config: { ...runtime, structure: [], isGitRepo: false, currentBranch: '', mainBranch: '', gitStatus: '', recentCommits: [] },
    params: { model, stream: true, max_tokens: 100, temperature: 0.3, messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture prompt' }] }] } }));
  const wire = { protocol: 'native-commandcode', url: 'https://api.commandcode.ai/alpha/generate',
    headers: { ...PROVIDERS.commandcode.headers, 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: 'Bearer dummy-api-key', 'x-session-id': sessionId },
    credentials, providerOverrides: null, proxyOptions: null, proxyEnvironment: captureAccountingProxyEnvironment(),
    commandCodeTransport: { model, mode: 'native-commandcode-ndjson', commandCodeConfig: captureAccountingCommandCodeConfig(PROVIDERS.commandcode), sessionId, serializedBody: JSON.stringify(capture.actual) },
    commandCodeChatCapture: structuredClone(capture) };
  const authority = { provider: 'commandcode', model, connection: { id: 'c', authType: 'apikey', data: JSON.stringify({ apiKey: 'dummy-api-key', providerSpecificData: {} }) }, settings: '{}' };
  return { wire, authority };
}
describe('queued captured Chat CommandCode binding (not service admission/executor retry)', () => {
  it('binds full capture to native persisted wire and freezes detached aggregate', () => {
    const { wire, authority } = fixture(), result = validateQueuedCommandCodeWire(authority, wire);
    expect(result).toEqual(wire); expect(result).not.toBe(wire); expect(Object.isFrozen(result.commandCodeChatCapture.original.credentials.providerSpecificData)).toBe(true);
    wire.commandCodeChatCapture.original.body.messages[0].content = 'changed';
    expect(result.commandCodeChatCapture.original.body.messages[0].content).toBe('fixture prompt');
  });
  it.each(['credential', 'proxy', 'config', 'original', 'runtime', 'actual'])('%s capture drift refuses after accepted original', kind => {
    const { wire, authority } = fixture(); expect(validateQueuedCommandCodeWire(authority, wire)).toEqual(wire);
    const capture = wire.commandCodeChatCapture;
    if (kind === 'credential') capture.original.credentials.providerSpecificData.extra = 'changed';
    if (kind === 'proxy') capture.original.proxyOptions = { persistedGlobalProxy: { url: 'http://dummy-other.invalid:3211', noProxy: '' } };
    if (kind === 'config') capture.original.config.timeoutMs++;
    if (kind === 'original') capture.original.body.messages[0].content = 'changed';
    if (kind === 'runtime') capture.original.runtime.workingDir = '/different';
    if (kind === 'actual') capture.actual.params.messages[0].content[0].text = 'changed';
    expect(() => validateQueuedCommandCodeWire(authority, wire)).toThrow();
  });
  it('whole capture guard refuses accessor without evaluating it after accepted positive', () => {
    const { wire, authority } = fixture(); expect(validateQueuedCommandCodeWire(authority, wire)).toEqual(wire); let reads = 0;
    Object.defineProperty(wire.commandCodeChatCapture, 'original', { enumerable: true, get() { reads++; throw new Error('fixture getter'); } });
    expect(() => validateQueuedCommandCodeWire(authority, wire)).toThrow(); expect(reads).toBe(0);
  });
});
