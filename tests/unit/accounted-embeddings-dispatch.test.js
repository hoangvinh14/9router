import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ headers: null, create: vi.fn() }));
vi.mock('../../open-sse/providers/index.js', async importOriginal => ({ ...(await importOriginal()),
  PROVIDER_MEDIA: { ...(await importOriginal()).PROVIDER_MEDIA, get openai() { return { embeddingConfig: { baseUrl: 'https://api.openai.com/v1/embeddings', authType: 'apikey', authHeader: 'bearer', ...(fixture.headers ? { headers: fixture.headers } : {}) } }; } } }));
vi.mock('undici', () => ({ ProxyAgent: class { constructor(options) { fixture.create(options); } }, Agent: class { constructor(options) { fixture.create(options); } } }));
let nativeFetch, fetchProxy, evidence;
const url = 'https://api.openai.com/v1/embeddings';
const options = () => ({ method: 'POST', redirect: 'error', body: evidence.serializedBody, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer dummy-provider' } });
const saved = () => ({ persistedGlobalProxy: { url: 'http://dummy-proxy.invalid:3210', noProxy: '' } });
beforeEach(async () => {
  vi.resetModules(); fixture.headers = null; fixture.create.mockReset();
  nativeFetch = vi.fn(async () => Response.json({ fixture: true })); vi.stubGlobal('fetch', nativeFetch);
  ({ proxyAwareFetch: fetchProxy } = await import('../../open-sse/utils/proxyFetch.js'));
  const { captureAccountingEmbeddingsConfig } = await import('../../open-sse/config/accountedEmbeddingsDispatch.js');
  evidence = { model: 'fixture-embedding', mediaConfig: captureAccountingEmbeddingsConfig(),
    originalSerializedBody: JSON.stringify({ model: 'fixture-embedding', input: 'fixture' }),
    serializedBody: JSON.stringify({ model: 'fixture-embedding', input: 'fixture', encoding_format: 'float' }) };
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('native embeddings original dispatch authority (mock fetch/dispatcher not socket/OAuth)', () => {
  it('unchanged original text input reaches one strict POST', async () => {
    expect((await fetchProxy(url, options(), saved(), { singlePost: true, embeddingsTransport: evidence })).ok).toBe(true);
    expect(nativeFetch).toHaveBeenCalledTimes(1); expect(fixture.create).toHaveBeenCalledTimes(1);
  });
  it.each(['url', 'body', 'original', 'metadata', 'token-array', 'encoding', 'dimension', 'header', 'registry', 'model'])('invalid %s refuses before dispatcher/POST', async kind => {
    const input = options(); let target = url;
    if (kind === 'url') target = 'https://dummy-upstream.invalid/embeddings';
    if (kind === 'body') input.body = '{}';
    if (kind === 'original') evidence.originalSerializedBody = '{}';
    if (kind === 'metadata') evidence.originalSerializedBody = JSON.stringify({ model: 'fixture-embedding', input: 'fixture', metadata: {} });
    if (kind === 'token-array') evidence.originalSerializedBody = JSON.stringify({ model: 'fixture-embedding', input: [1, 2] });
    if (kind === 'encoding') evidence.originalSerializedBody = JSON.stringify({ model: 'fixture-embedding', input: 'fixture', encoding_format: 'base64' });
    if (kind === 'dimension') evidence.originalSerializedBody = JSON.stringify({ model: 'fixture-embedding', input: 'fixture', dimensions: '10' });
    if (kind === 'header') input.headers['x-foreign'] = 'dummy-foreign';
    if (kind === 'registry') fixture.headers = { Accept: 'application/json' };
    if (kind === 'model') evidence.model = 'foreign';
    await expect(fetchProxy(target, input, saved(), { singlePost: true, embeddingsTransport: evidence })).rejects.toThrow('Accounting embeddings transport unavailable');
    expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
  });
  it('media config drift while acquiring dispatcher refuses without route reselection', async () => {
    fixture.create.mockImplementation(() => { fixture.headers = { Accept: 'application/json' }; });
    await expect(fetchProxy(url, options(), saved(), { singlePost: true, embeddingsTransport: evidence })).rejects.toThrow('Accounting embeddings transport unavailable');
    expect(fixture.create).toHaveBeenCalledTimes(1); expect(nativeFetch).not.toHaveBeenCalled();
  });
  it('actual body drift after dispatcher yield refuses against detached original', async () => {
    const input = options(); fixture.create.mockImplementation(() => { evidence.serializedBody = 'changed'; input.body = 'changed'; });
    await expect(fetchProxy(url, input, saved(), { singlePost: true, embeddingsTransport: evidence })).rejects.toThrow('Accounting embeddings transport unavailable');
    expect(nativeFetch).not.toHaveBeenCalled();
  });
});
