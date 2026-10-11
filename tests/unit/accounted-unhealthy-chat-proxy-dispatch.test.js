import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ acquire: vi.fn() }));
vi.mock('undici', () => ({ ProxyAgent: class { constructor() { fixture.acquire(); } }, Agent: class { constructor() { fixture.acquire(); } } }));
let capture, fetchPost, nativeFetch, providers;
beforeEach(async () => {
  vi.resetModules(); fixture.acquire.mockReset();
  nativeFetch = vi.fn(async () => Response.json({ fixture: true })); vi.stubGlobal('fetch', nativeFetch);
  ({ PROVIDERS: providers } = await import('../../open-sse/config/providers.js'));
  ({ captureUnhealthyChatDispatch: capture } = await import('../../open-sse/config/accountedUnhealthyChatDispatch.js'));
  ({ proxyAwareFetch: fetchPost } = await import('../../open-sse/utils/proxyFetch.js'));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
function prepared() {
  const body = { model: 'fixture-model', stream: false, messages: [{ role: 'user', content: 'fixture original' }] };
  const proxyOptions = { persistedGlobalProxy: { url: 'http://fixture-proxy.invalid:3210', noProxy: '' } };
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-key' };
  const evidence = capture({ provider: 'openai', model: body.model, body, credentials: { apiKey: 'fixture-key', accessToken: null },
    config: structuredClone(providers.openai), proxyOptions, providerOverrides: null, headers,
    url: providers.openai.baseUrl, serialized: JSON.stringify(body) });
  return { evidence, proxyOptions, options: { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: new AbortController().signal } };
}
describe('strict Chat transport evidence around mocked dispatcher await (not socket/selection/ACK)', () => {
  it('permits one canonical POST with signal and retains original evidence across contract replacement', async () => {
    const p = prepared(), contract = { singlePost: true, unhealthyChatTransport: p.evidence };
    fixture.acquire.mockImplementation(() => { contract.unhealthyChatTransport = { unsupported: true }; });
    const result = await fetchPost(providers.openai.baseUrl, p.options, p.proxyOptions, contract);
    expect(result.ok).toBe(true); expect(nativeFetch).toHaveBeenCalledTimes(1); expect(fixture.acquire).toHaveBeenCalledTimes(1);
  });
  it.each(['body', 'token', 'proxy'])('refuses %s drift after acquisition before the one native POST', async mode => {
    const positive = prepared(); await fetchPost(providers.openai.baseUrl, positive.options, positive.proxyOptions,
      { singlePost: true, unhealthyChatTransport: positive.evidence });
    expect(nativeFetch).toHaveBeenCalledTimes(1); nativeFetch.mockClear();
    const p = prepared(); fixture.acquire.mockImplementation(() => {
      if (mode === 'body') p.options.body = JSON.stringify({ ...p.evidence.body, model: 'other' });
      if (mode === 'token') p.options.headers.Authorization = 'Bearer other';
      if (mode === 'proxy') p.proxyOptions.persistedGlobalProxy.url = 'http://other-fixture.invalid:3210';
    });
    // Separate proxy origin prevents the positive's cached dispatcher from
    // hiding the awaited acquisition boundary under test.
    p.proxyOptions.persistedGlobalProxy.url = 'http://fixture-next.invalid:3210';
    p.evidence = capture({ ...p.evidence, proxyOptions: p.proxyOptions });
    await expect(fetchPost(providers.openai.baseUrl, p.options, p.proxyOptions,
      { singlePost: true, unhealthyChatTransport: p.evidence })).rejects.toThrow('Unhealthy Chat dispatch unavailable');
    expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.acquire).toHaveBeenCalledTimes(2);
  });
  it('retains the full core proxy envelope when saved global policy is disabled, ignoring ambient proxy', async () => {
    const p = prepared();
    p.proxyOptions = { connectionProxyEnabled: false, connectionProxyUrl: '', connectionNoProxy: '',
      strictProxy: false, proxyPoolUnavailable: false, proxyPoolId: null, vercelRelayUrl: '', persistedGlobalProxy: null };
    p.evidence = capture({ ...p.evidence, proxyOptions: p.proxyOptions });
    for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) vi.stubEnv(name, 'http://ambient-fixture.invalid:3210');
    vi.stubEnv('NO_PROXY', ''); vi.stubEnv('no_proxy', '');
    const response = await fetchPost(providers.openai.baseUrl, p.options, p.proxyOptions,
      { singlePost: true, unhealthyChatTransport: p.evidence });
    expect(response.ok).toBe(true); expect(nativeFetch).toHaveBeenCalledTimes(1); expect(fixture.acquire).not.toHaveBeenCalled();
    expect(nativeFetch.mock.calls[0][1]).not.toHaveProperty('dispatcher');
  });
  it('accepts a complete independently supplied saved pool envelope, not environment substitution', async () => {
    const p = prepared(); const pool = { id: 'fixture-pool', url: 'http://fixture-pool.invalid:3210/', noProxy: '', strictProxy: true, type: 'http', isActive: true };
    p.proxyOptions = { connectionProxyEnabled: true, connectionProxyUrl: pool.url, connectionNoProxy: pool.noProxy,
      strictProxy: true, proxyPoolUnavailable: false, proxyPoolId: pool.id, vercelRelayUrl: '', persistedGlobalProxy: null, persistedPoolProxy: pool };
    p.evidence = capture({ ...p.evidence, proxyOptions: p.proxyOptions });
    const response = await fetchPost(providers.openai.baseUrl, p.options, p.proxyOptions, { singlePost: true, unhealthyChatTransport: p.evidence });
    expect(response.ok).toBe(true); expect(nativeFetch).toHaveBeenCalledTimes(1); expect(fixture.acquire).toHaveBeenCalledTimes(1);
  });
  it.each(['relay', 'connection-url', 'pool-id', 'unknown'])('refuses unsupported complete proxy envelope %s without dropping fields', mode => {
    const p = prepared(), pool = { id: 'fixture-pool', url: 'http://fixture-pool.invalid:3210/', noProxy: '', strictProxy: true, type: 'http', isActive: true };
    const proxyOptions = { connectionProxyEnabled: true, connectionProxyUrl: pool.url, connectionNoProxy: pool.noProxy,
      strictProxy: true, proxyPoolUnavailable: false, proxyPoolId: pool.id, vercelRelayUrl: '', persistedGlobalProxy: null, persistedPoolProxy: pool };
    expect(() => capture({ ...p.evidence, proxyOptions })).not.toThrow();
    if (mode === 'relay') proxyOptions.vercelRelayUrl = 'https://fixture.invalid';
    if (mode === 'connection-url') proxyOptions.connectionProxyUrl = 'http://other-fixture.invalid:3210';
    if (mode === 'pool-id') proxyOptions.proxyPoolId = 'unproved-pool';
    if (mode === 'unknown') proxyOptions.unknown = true;
    expect(() => capture({ ...p.evidence, proxyOptions })).toThrow();
    expect(fixture.acquire).not.toHaveBeenCalled(); expect(nativeFetch).not.toHaveBeenCalled();
  });
  it.each(['body', 'proxy'])('refuses programmable %s before dispatcher/native exposure', async mode => {
    const p = prepared(); let reads = 0;
    if (mode === 'body') Object.defineProperty(p.options, 'body', { enumerable: true, get() { reads++; return p.evidence.serialized; } });
    else Object.defineProperty(p.proxyOptions, 'persistedGlobalProxy', { enumerable: true, get() { reads++; return {}; } });
    await expect(fetchPost(providers.openai.baseUrl, p.options, p.proxyOptions,
      { singlePost: true, unhealthyChatTransport: p.evidence })).rejects.toThrow();
    expect(reads).toBe(0); expect(fixture.acquire).not.toHaveBeenCalled(); expect(nativeFetch).not.toHaveBeenCalled();
  });
});
