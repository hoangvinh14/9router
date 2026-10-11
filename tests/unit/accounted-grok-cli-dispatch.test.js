import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ config: null, create: vi.fn() }));
vi.mock('../../open-sse/config/providers.js', async importOriginal => {
  const original = await importOriginal();
  return { ...original, PROVIDERS: { ...original.PROVIDERS, get ['grok-cli']() { return fixture.config; } } };
});
vi.mock('undici', () => ({ ProxyAgent: class { constructor(options) { fixture.create(options); } }, Agent: class { constructor(options) { fixture.create(options); } } }));
let nativeFetch, fetchProxy, evidence, buildHeaders;
const url = 'https://cli-chat-proxy.grok.com/v1/responses';
const originalBody = () => ({ model: 'grok-build', stream: true, store: false, input: [{ type: 'message', role: 'user', content: 'fixture' }] });
const options = () => ({ method: 'POST', redirect: 'error', body: evidence.serializedBody, headers: buildHeaders(
  { accessToken: 'dummy-oauth', providerSpecificData: { deviceId: 'dummy-device', email: 'fixture@example.invalid', userId: 'dummy-user' } }, evidence.grokConfig, evidence.identity) });
const saved = () => ({ persistedGlobalProxy: { url: 'http://dummy-proxy.invalid:3210', noProxy: '' } });
beforeEach(async () => {
  vi.resetModules(); fixture.create.mockReset(); const original = await vi.importActual('../../open-sse/config/providers.js'); fixture.config = structuredClone(original.PROVIDERS['grok-cli']);
  nativeFetch = vi.fn(async () => Response.json({ fixture: true })); vi.stubGlobal('fetch', nativeFetch);
  ({ proxyAwareFetch: fetchProxy } = await import('../../open-sse/utils/proxyFetch.js'));
  const { captureAccountingGrokCliConfig } = await import('../../open-sse/config/accountedGrokCliDispatch.js');
  const { grokCliAccountingBody, grokCliAccountingHeaders } = await import('../../open-sse/config/accountedGrokCliCandidate.js'); buildHeaders = grokCliAccountingHeaders;
  evidence = { model: 'grok-build', mode: 'native-grok-cli-responses-sse', grokConfig: captureAccountingGrokCliConfig(fixture.config), identity: { sessionId: 'fixture-session', requestId: 'fixture-request', turn: 1 },
    originalSerializedBody: JSON.stringify(originalBody()), serializedBody: JSON.stringify(grokCliAccountingBody(originalBody())) };
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('Grok Build strict dispatch entry/post-yield (mock fetch/dispatcher, not native acceptance)', () => {
  it('unchanged original+actual native SSE reaches exactly one strict POST', async () => {
    expect((await fetchProxy(url, options(), saved(), { singlePost: true, grokCliTransport: evidence })).ok).toBe(true);
    expect(nativeFetch).toHaveBeenCalledTimes(1); expect(fixture.create).toHaveBeenCalledTimes(1);
  });
  it.each(['url', 'actual', 'original', 'mode', 'include', 'reasoning', 'model', 'session', 'request', 'turn', 'token', 'device', 'header', 'client', 'registry'])('%s refuses before dispatcher/POST', async kind => {
    const input = options(); let target = url;
    if (kind === 'url') target = 'https://fixture.invalid/responses';
    if (kind === 'actual') input.body = 'changed';
    if (kind === 'original') { const value = JSON.parse(evidence.originalSerializedBody); value.tools = []; evidence.originalSerializedBody = JSON.stringify(value); }
    if (kind === 'mode') evidence.mode = 'native-responses-sse';
    if (['include', 'reasoning', 'model'].includes(kind)) {
      const value = JSON.parse(evidence.serializedBody);
      if (kind === 'include') delete value.include;
      if (kind === 'reasoning') value.reasoning.summary = 'auto';
      if (kind === 'model') evidence.model = value.model = 'grok-4.5-high';
      input.body = evidence.serializedBody = JSON.stringify(value);
    }
    if (kind === 'session') input.headers['x-grok-conv-id'] = 'changed';
    if (kind === 'request') input.headers['x-grok-req-id'] = 'changed';
    if (kind === 'turn') input.headers['x-grok-turn-idx'] = '2';
    if (kind === 'token') input.headers.Authorization = 'Bearer ';
    if (kind === 'device') delete input.headers['x-grok-agent-id'];
    if (kind === 'header') input.headers['OpenAI-Beta'] = 'fixture';
    if (kind === 'client') input.headers['x-grok-client-version'] = 'changed';
    if (kind === 'registry') fixture.config.clientVersion = 'changed';
    await expect(fetchProxy(target, input, saved(), { singlePost: true, grokCliTransport: evidence })).rejects.toThrow('Accounting Grok CLI transport unavailable');
    expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
  });
  it('client config drift through dispatcher yield refuses POST', async () => {
    fixture.create.mockImplementation(() => { fixture.config.clientVersion = 'changed'; });
    await expect(fetchProxy(url, options(), saved(), { singlePost: true, grokCliTransport: evidence })).rejects.toThrow('Accounting Grok CLI transport unavailable');
    expect(fixture.create).toHaveBeenCalledTimes(1); expect(nativeFetch).not.toHaveBeenCalled();
  });
  it('actual reasoning/include drift through dispatcher yield refuses POST', async () => {
    const input = options(); fixture.create.mockImplementation(() => { input.body = JSON.stringify({ ...JSON.parse(input.body), include: [] }); });
    await expect(fetchProxy(url, input, saved(), { singlePost: true, grokCliTransport: evidence })).rejects.toThrow('Accounting Grok CLI transport unavailable');
    expect(fixture.create).toHaveBeenCalledTimes(1); expect(nativeFetch).not.toHaveBeenCalled();
  });
});
