import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ acquire: vi.fn() }));
vi.mock('undici', () => ({ ProxyAgent: class { constructor() { fixture.acquire(); } }, Agent: class { constructor() { fixture.acquire(); } } }));
let capture, fetchPost, nativeFetch, config, url;
beforeEach(async () => {
  vi.resetModules(); fixture.acquire.mockReset(); nativeFetch = vi.fn(async () => Response.json({ fixture: true })); vi.stubGlobal('fetch', nativeFetch);
  ({ captureUnhealthyEmbeddingsDispatch: capture } = await import('../../open-sse/config/accountedUnhealthyEmbeddingsDispatch.js'));
  config = (await import('../../open-sse/config/accountedEmbeddingsDispatch.js')).captureAccountingEmbeddingsConfig();
  url = (await import('../../open-sse/config/accountedEmbeddingsCandidate.js')).ACCOUNTED_EMBEDDINGS_URL;
  ({ proxyAwareFetch: fetchPost } = await import('../../open-sse/utils/proxyFetch.js'));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
function prepared(proxyOptions = { persistedGlobalProxy: { url: 'http://fixture-embedding-proxy.invalid:3210', noProxy: '' } }) {
  const body = { model: 'fixture-embedding', input: ['fixture original'] }, actual = { ...body, encoding_format: 'float' };
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-upstream' }, serialized = JSON.stringify(actual);
  const evidence = capture({ model: body.model, body, actual, mediaConfig: config, credentials: { apiKey: 'fixture-upstream', accessToken: null }, headers, url, serialized, proxyOptions });
  return { evidence, proxyOptions, options: { method: 'POST', headers, body: serialized, redirect: 'error', signal: new AbortController().signal } };
}
describe('unhealthy embeddings strict captured transport at mocked dispatcher await, not socket/proof/ACK', () => {
  it('permits one original float POST and retains evidence across caller contract replacement', async () => {
    const p = prepared(), contract = { singlePost: true, unhealthyEmbeddingsTransport: p.evidence };
    fixture.acquire.mockImplementation(() => { contract.unhealthyEmbeddingsTransport = { unsupported: true }; });
    expect((await fetchPost(url, p.options, p.proxyOptions, contract)).ok).toBe(true);
    expect(nativeFetch).toHaveBeenCalledTimes(1); expect(fixture.acquire).toHaveBeenCalledTimes(1);
  });
  it.each(['body', 'token', 'proxy'])('refuses %s drift after dispatcher acquisition before native POST', async mode => {
    const positive = prepared(); await fetchPost(url, positive.options, positive.proxyOptions, { singlePost: true, unhealthyEmbeddingsTransport: positive.evidence });
    expect(nativeFetch).toHaveBeenCalledTimes(1); nativeFetch.mockClear();
    const p = prepared({ persistedGlobalProxy: { url: 'http://fixture-embedding-next.invalid:3210', noProxy: '' } });
    fixture.acquire.mockImplementation(() => {
      if (mode === 'body') p.options.body = '{}';
      if (mode === 'token') p.options.headers.Authorization = 'Bearer other';
      if (mode === 'proxy') p.proxyOptions.persistedGlobalProxy.url = 'http://foreign-fixture.invalid:3210';
    });
    await expect(fetchPost(url, p.options, p.proxyOptions, { singlePost: true, unhealthyEmbeddingsTransport: p.evidence })).rejects.toThrow('Unhealthy embeddings dispatch unavailable');
    expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.acquire).toHaveBeenCalledTimes(2);
  });
  it.each(['body', 'proxy'])('rejects programmable %s before dispatcher reads', async mode => {
    const p = prepared(); let reads = 0;
    if (mode === 'body') Object.defineProperty(p.options, 'body', { enumerable: true, get() { reads++; return p.evidence.serialized; } });
    else Object.defineProperty(p.proxyOptions, 'persistedGlobalProxy', { enumerable: true, get() { reads++; return {}; } });
    await expect(fetchPost(url, p.options, p.proxyOptions, { singlePost: true, unhealthyEmbeddingsTransport: p.evidence })).rejects.toThrow();
    expect(reads).toBe(0); expect(fixture.acquire).not.toHaveBeenCalled(); expect(nativeFetch).not.toHaveBeenCalled();
  });
  it('saved disabled policy is direct despite ambient proxy without changing other contracts', async () => {
    const p = prepared({ persistedGlobalProxy: null });
    for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) vi.stubEnv(name, 'http://ambient-fixture.invalid:3210');
    vi.stubEnv('NO_PROXY', ''); vi.stubEnv('no_proxy', '');
    expect((await fetchPost(url, p.options, p.proxyOptions, { singlePost: true, unhealthyEmbeddingsTransport: p.evidence })).ok).toBe(true);
    expect(fixture.acquire).not.toHaveBeenCalled(); expect(nativeFetch).toHaveBeenCalledTimes(1); expect(nativeFetch.mock.calls[0][1]).not.toHaveProperty('dispatcher');
  });
});
