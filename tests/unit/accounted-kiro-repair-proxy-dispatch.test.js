import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('undici', () => ({ ProxyAgent: class { constructor(value) { fixture.create(value); } }, Agent: class { constructor(value) { fixture.create(value); } } }));
let fetchProxy, nativeFetch, evidence;
const model = 'claude-sonnet-4.5', url = 'https://q.us-east-1.amazonaws.com/generateAssistantResponse';
const proxy = () => ({ persistedGlobalProxy: { url: 'http://dummy-proxy.invalid:3210', noProxy: '' } });
const options = () => ({ method: 'POST', redirect: 'error', body: evidence.kiroTransport.serializedBody, headers: structuredClone(evidence.headers) });
beforeEach(async () => {
  vi.resetModules(); fixture.create.mockReset(); nativeFetch = vi.fn(async () => Response.json({ fixture: true })); vi.stubGlobal('fetch', nativeFetch);
  ({ proxyAwareFetch: fetchProxy } = await import('open-sse/utils/proxyFetch.js'));
  const { PROVIDERS } = await import('open-sse/config/providers.js');
  const { captureAccountingKiroConfig } = await import('open-sse/config/accountedKiroDispatch.js');
  const { captureAccountingProxyEnvironment } = await import('open-sse/config/accountedProxyEnvironment.js');
  const { captureKiroEllipsisRepairConversion } = await import('open-sse/config/accountedKiroRepairConversion.js');
  const original = { conversationState: { chatTriggerType: 'MANUAL', conversationId: '12345678-1234-4123-8123-123456789abc',
    currentMessage: { userInputMessage: { content: 'fixture prompt', modelId: model, origin: 'AI_EDITOR' } }, history: [] },
    inferenceConfig: { maxTokens: 100, temperature: 0.5, topP: 1 } };
  const actual = structuredClone(original);
  actual.conversationState.currentMessage.userInputMessage.content += '\n\nRetry the previous response because it ended with only an ellipsis. Return the complete final answer, not only ... or ….';
  const invocationId = '22222222-2222-4222-8222-222222222222', headers = new Headers(PROVIDERS.kiro.headers);
  for (const [key, value] of Object.entries({ 'Amz-Sdk-Request': 'attempt=1; max=3', 'Amz-Sdk-Invocation-Id': invocationId,
    Authorization: 'Bearer dummy-api-key', TokenType: 'API_KEY', 'x-amz-sso-bearer': 'dummy-api-key',
    'x-amzn-kiro-agent-mode': 'spec', 'x-amzn-codewhisperer-machine-id': 'kiro-desktop' })) headers.set(key, value);
  evidence = { protocol: 'native-kiro', url, headers: Object.fromEntries(headers),
    credentials: { apiKey: null, accessToken: 'dummy-api-key', connectionId: 'c', providerSpecificData: { authMethod: 'api_key', region: 'us-east-1' } },
    providerOverrides: null, proxyOptions: proxy(), proxyEnvironment: captureAccountingProxyEnvironment(),
    kiroTransport: { model, mode: 'native-kiro-eventstream', kiroConfig: captureAccountingKiroConfig(PROVIDERS.kiro), invocationId, serializedBody: JSON.stringify(actual) },
    kiroRepairCapture: structuredClone(captureKiroEllipsisRepairConversion({ model, original, actual })) };
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('Kiro repair single POST entry/post-dispatcher retained evidence (mock fetch, no route/retry/ACK grant)', () => {
  it('accepted full repair wire dispatches exactly once without transport rebuilding', async () => {
    const input = options();
    expect((await fetchProxy(url, input, proxy(), { singlePost: true, kiroRepairTransport: evidence })).ok).toBe(true);
    expect(nativeFetch).toHaveBeenCalledTimes(1); expect(fixture.create).toHaveBeenCalledTimes(1);
    expect(nativeFetch.mock.calls[0][1].body).toBe(input.body);
  });
  it('genuine native AbortSignal survives guarded POST projection unchanged', async () => {
    const input = options(), controller = new AbortController(); input.signal = controller.signal;
    expect((await fetchProxy(url, input, proxy(), { singlePost: true, kiroRepairTransport: evidence })).ok).toBe(true);
    expect(nativeFetch).toHaveBeenCalledTimes(1); expect(nativeFetch.mock.calls[0][1].signal).toBe(controller.signal);
  });
  it.each(['entry', 'post-await'])('original token mismatch at %s refuses before native fetch', async stage => {
    const input = options(), mutate = () => { input.headers.authorization = 'Bearer dummy-other'; input.headers['x-amz-sso-bearer'] = 'dummy-other'; };
    if (stage === 'entry') mutate(); else fixture.create.mockImplementation(mutate);
    await expect(fetchProxy(url, input, proxy(), { singlePost: true, kiroRepairTransport: evidence })).rejects.toThrow();
    expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).toHaveBeenCalledTimes(stage === 'entry' ? 0 : 1);
  });
  it('coherent credential+headers mutation after dispatcher cannot replace retained original token', async () => {
    const input = options(); fixture.create.mockImplementation(() => {
      evidence.credentials.accessToken = 'dummy-other';
      for (const headers of [input.headers, evidence.headers]) { headers.authorization = 'Bearer dummy-other'; headers['x-amz-sso-bearer'] = 'dummy-other'; }
    });
    await expect(fetchProxy(url, input, proxy(), { singlePost: true, kiroRepairTransport: evidence })).rejects.toThrow('Accounting Kiro repair transport changed');
    expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).toHaveBeenCalledTimes(1);
  });
  it.each(['entry', 'post-await'])('selected proxy drift at %s refuses before native fetch', async stage => {
    const input = options(), selected = proxy(), mutate = () => { selected.persistedGlobalProxy.url = 'http://dummy-other.invalid:3211'; };
    if (stage === 'entry') mutate(); else fixture.create.mockImplementation(mutate);
    await expect(fetchProxy(url, input, selected, { singlePost: true, kiroRepairTransport: evidence })).rejects.toThrow();
    expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).toHaveBeenCalledTimes(stage === 'entry' ? 0 : 1);
  });
  it.each(['post-getter', 'proxy-getter', 'capture-proxy', 'fake-signal', 'duplicate-header'])('%s refuses before programmable reads/dispatcher/native fetch', async kind => {
    const input = options(), selected = proxy(); let reads = 0;
    const trap = () => { reads++; throw new Error('fixture repair programmable read'); };
    if (kind === 'post-getter') Object.defineProperty(input, 'body', { enumerable: true, get: trap });
    if (kind === 'proxy-getter') Object.defineProperty(selected, 'strictProxy', { enumerable: true, get: trap });
    if (kind === 'capture-proxy') evidence.kiroRepairCapture = new Proxy(evidence.kiroRepairCapture, { get: trap, ownKeys: trap, getPrototypeOf: trap });
    if (kind === 'fake-signal') input.signal = { get aborted() { return trap(); }, throwIfAborted: trap, addEventListener: trap };
    if (kind === 'duplicate-header') { input.headers.Authorization = input.headers.authorization; evidence.headers.Authorization = evidence.headers.authorization; }
    await expect(fetchProxy(url, input, selected, { singlePost: true, kiroRepairTransport: evidence })).rejects.toThrow();
    expect(reads).toBe(0); expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
  });
  it.each(['entry', 'post-await'])('full original/actual mismatch at %s refuses before native fetch', async stage => {
    const input = options(), mutate = () => { evidence.kiroRepairCapture.original.inferenceConfig.maxTokens = 101; };
    if (stage === 'entry') mutate(); else fixture.create.mockImplementation(mutate);
    await expect(fetchProxy(url, input, proxy(), { singlePost: true, kiroRepairTransport: evidence })).rejects.toThrow();
    expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).toHaveBeenCalledTimes(stage === 'entry' ? 0 : 1);
  });
  it.each(['entry', 'post-await'])('serialized POST capture mismatch at %s refuses native fetch', async stage => {
    const input = options(), mutate = () => { input.body = JSON.stringify(evidence.kiroRepairCapture.original); };
    if (stage === 'entry') mutate(); else fixture.create.mockImplementation(mutate);
    await expect(fetchProxy(url, input, proxy(), { singlePost: true, kiroRepairTransport: evidence })).rejects.toThrow();
    expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).toHaveBeenCalledTimes(stage === 'entry' ? 0 : 1);
  });
});
