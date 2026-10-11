import { beforeAll, describe, expect, it } from 'vitest';
import { PROVIDERS } from 'open-sse/config/providers.js';
import { captureAccountingCommandCodeConfig } from 'open-sse/config/accountedCommandCodeDispatch.js';
import { captureCommandCodeChatConversion } from 'open-sse/config/accountedCommandCodeChatCapture.js';
let validate;
beforeAll(async () => {
  ({ validateAccountingCommandCodeChatPost: validate } = await import('open-sse/config/accountedCommandCodeChatDispatch.js'));
});
const model = 'deepseek/deepseek-v4-pro', url = 'https://api.commandcode.ai/alpha/generate';
const sessionId = '22222222-2222-4222-8222-222222222222';
function evidence() {
  const runtime = { workingDir: '/fixture/work', date: '2026-10-10', environment: 'linux' };
  const input = { body: { model, stream: true, max_tokens: 100, temperature: 0.3, messages: [{ role: 'user', content: 'fixture prompt' }] },
    model, stream: true, credentials: { apiKey: 'dummy-api-key', connectionId: 'c', providerSpecificData: {} }, config: structuredClone(PROVIDERS.commandcode),
    runtime, providerOverrides: null, proxyOptions: null };
  const captured = captureCommandCodeChatConversion(input, () => ({ threadId: '11111111-1111-4111-8111-111111111111', memory: '',
    config: { ...runtime, structure: [], isGitRepo: false, currentBranch: '', mainBranch: '', gitStatus: '', recentCommits: [] },
    params: { model, stream: true, max_tokens: 100, temperature: 0.3, messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture prompt' }] }] } }));
  return { capture: captured, nativeTransport: { model, mode: 'native-commandcode-ndjson', sessionId,
    commandCodeConfig: captureAccountingCommandCodeConfig(PROVIDERS.commandcode), serializedBody: JSON.stringify(captured.actual) } };
}
const options = value => ({ method: 'POST', redirect: 'error', body: value.nativeTransport.serializedBody,
  headers: { ...PROVIDERS.commandcode.headers, 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: 'Bearer dummy-api-key', 'x-session-id': sessionId } });

describe('chat CommandCode complete captured dispatch equality (not persisted queue/fetch)', () => {
  it('accepts full original/actual/identity/config plus exact native POST without mutating evidence', () => {
    const value = evidence(), init = options(value);
    const result = validate(value, url, init);
    expect(result).toEqual(value); expect(result).not.toBe(value); expect(Object.isFrozen(result.capture.original.credentials)).toBe(true);
  });
  it.each(['original', 'identity', 'runtime', 'full-config', 'actual', 'serialized', 'token', 'unknown-envelope'])('refuses %s drift after valid captured positive', kind => {
    const positive = evidence(); expect(validate(positive, url, options(positive))).toEqual(positive);
    const value = structuredClone(positive), init = options(value);
    if (kind === 'original') value.capture.original.body.messages[0].content = 'changed original';
    if (kind === 'identity') value.capture.identity.threadId = '33333333-3333-4333-8333-333333333333';
    if (kind === 'runtime') value.capture.original.runtime.workingDir = '/changed/runtime';
    if (kind === 'full-config') value.capture.original.config.unbound = true;
    if (kind === 'actual') value.capture.actual.params.messages[0].content[0].text = 'changed actual';
    if (kind === 'serialized') {
      const body = JSON.parse(value.nativeTransport.serializedBody); body.params.temperature = 0.4;
      value.nativeTransport.serializedBody = init.body = JSON.stringify(body);
    }
    if (kind === 'token') init.headers.Authorization = 'Bearer dummy-changed';
    if (kind === 'unknown-envelope') value.unknown = true;
    expect(() => validate(value, url, init)).toThrow();
  });
  it('guards the entire capture before programmable original or identity reads', () => {
    const value = structuredClone(evidence()); let hits = 0;
    Object.defineProperty(value.capture.original.credentials, 'apiKey', { enumerable: true, get() { hits++; throw new Error('fixture getter'); } });
    expect(() => validate(value, url, options(value))).toThrow(); expect(hits).toBe(0);
  });
});
