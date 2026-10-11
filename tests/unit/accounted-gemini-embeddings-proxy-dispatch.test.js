import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ acquire: vi.fn() }));
vi.mock('undici', () => ({ ProxyAgent: class { constructor() { fixture.acquire(); } }, Agent: class { constructor() { fixture.acquire(); } } }));
let capture, fetchPost, nativeFetch, config, adapter;
beforeEach(async () => {
  vi.resetModules(); fixture.acquire.mockReset();
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']) vi.stubEnv(key, '');
  nativeFetch = vi.fn(async () => Response.json({ fixture: true })); vi.stubGlobal('fetch', nativeFetch);
  ({ captureGeminiEmbeddingDispatch: capture } = await import('../../open-sse/config/accountedGeminiEmbeddingDispatch.js'));
  config = (await import('../../open-sse/providers/index.js')).PROVIDER_MEDIA.gemini.embeddingConfig;
  adapter = (await import('../../open-sse/handlers/embeddingProviders/gemini.js')).default;
  ({ proxyAwareFetch: fetchPost } = await import('../../open-sse/utils/proxyFetch.js'));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
function prepared(proxyOptions = { persistedGlobalProxy: { url: 'http://fixture-gemini-proxy.invalid:3210', noProxy: '' } }) {
  const model = 'gemini-embedding-001', original = { model, input: ['fixture original'] };
  const credentials = { apiKey: 'fixture-private-key' }, actual = adapter.buildBody(model, original);
  const headers = adapter.buildHeaders(credentials), serialized = JSON.stringify(actual), url = adapter.buildUrl(model, credentials, { input: original.input });
  const evidence = capture({ model, original, actual, mediaConfig: config, credentials, headers, url, serialized, proxyOptions });
  return { url, evidence, proxyOptions, options: { method: 'POST', headers, body: serialized, redirect: 'error', signal: new AbortController().signal } };
}
const execute = p => fetchPost(p.url, p.options, p.proxyOptions, { singlePost: true, geminiEmbeddingTransport: p.evidence });
describe('Gemini embedding strict image at mocked dispatcher boundary, not native socket/own ACK', () => {
  it('retains original image despite caller contract replacement while acquiring', async () => {
    const p = prepared(), contract = { singlePost: true, geminiEmbeddingTransport: p.evidence };
    fixture.acquire.mockImplementation(() => { contract.geminiEmbeddingTransport = { unsupported: true }; });
    expect((await fetchPost(p.url, p.options, p.proxyOptions, contract)).ok).toBe(true);
    expect(nativeFetch).toHaveBeenCalledTimes(1); expect(fixture.acquire).toHaveBeenCalledTimes(1);
  });
  it.each(['body', 'headers', 'proxy'])('post-acquisition %s drift refuses before captured native POST', async fault => {
    expect((await execute(prepared())).ok).toBe(true); expect(nativeFetch).toHaveBeenCalledTimes(1); nativeFetch.mockClear();
    const p = prepared({ persistedGlobalProxy: { url: 'http://fixture-next-gemini-proxy.invalid:3210', noProxy: '' } });
    fixture.acquire.mockImplementation(() => {
      if (fault === 'body') p.options.body = '{}';
      else if (fault === 'headers') p.options.headers.extra = 'fixture-changed';
      else p.proxyOptions.persistedGlobalProxy.url = 'http://fixture-changed.invalid:3210';
    });
    await expect(execute(p)).rejects.toThrow('Gemini embedding dispatch unavailable');
    expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.acquire).toHaveBeenCalledTimes(2);
  });
  it('wrong key-query URL refuses before dispatcher/native fetch without echoing key', async () => {
    expect((await execute(prepared())).ok).toBe(true); nativeFetch.mockClear(); fixture.acquire.mockClear();
    const p = prepared(); p.url += '&key=fixture-private-key';
    await expect(execute(p)).rejects.toThrow('Gemini embedding dispatch unavailable');
    expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.acquire).not.toHaveBeenCalled();
  });
  it.each(['body', 'proxy'])('%s getter is not executed before refusal', async fault => {
    expect((await execute(prepared())).ok).toBe(true); nativeFetch.mockClear(); fixture.acquire.mockClear();
    const p = prepared(); let reads = 0;
    const trap = () => { reads++; throw new Error('fixture-private-key'); };
    if (fault === 'body') Object.defineProperty(p.options, 'body', { enumerable: true, get: trap });
    else Object.defineProperty(p.proxyOptions, 'persistedGlobalProxy', { enumerable: true, get: trap });
    await expect(execute(p)).rejects.toThrow('Gemini embedding dispatch unavailable');
    expect(reads).toBe(0); expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.acquire).not.toHaveBeenCalled();
  });
});
