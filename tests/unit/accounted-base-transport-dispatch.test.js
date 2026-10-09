import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ baseUrl: 'http://dummy-upstream.invalid/chat', create: vi.fn() }));
vi.mock('../../open-sse/config/providers.js', async importOriginal => ({ ...(await importOriginal()),
  PROVIDERS: { ...(await importOriginal()).PROVIDERS, get openai() { return { baseUrl: fixture.baseUrl }; } } }));
vi.mock('undici', () => ({
  ProxyAgent: class { constructor(options) { fixture.create(options); } },
  Agent: class { constructor(options) { fixture.create(options); } }
}));
let nativeFetch, fetchProxy, original;
beforeEach(async () => {
  vi.resetModules(); fixture.create.mockReset(); fixture.baseUrl = 'http://dummy-upstream.invalid/chat';
  nativeFetch = vi.fn(async () => Response.json({ fixture: true })); vi.stubGlobal('fetch', nativeFetch);
  ({ proxyAwareFetch: fetchProxy } = await import('../../open-sse/utils/proxyFetch.js'));
  const { captureAccountingBaseTransport } = await import('../../open-sse/config/accountedBaseTransport.js');
  const { PROVIDERS } = await import('../../open-sse/config/providers.js');
  original = { provider: 'openai', baseTransport: captureAccountingBaseTransport(PROVIDERS.openai), urlIndex: 0, runtimeTransport: null };
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const options = () => ({ method: 'POST', redirect: 'error', body: 'fixture' });
const saved = () => ({ persistedGlobalProxy: { url: 'http://dummy-proxy.invalid:3210', noProxy: '' } });
describe('original Base registry evidence at single POST dispatch (mock dispatcher/native fetch, not socket proof)', () => {
  it('unchanged registry evidence preserves exactly one POST', async () => {
    const response = await fetchProxy('http://dummy-upstream.invalid/chat', options(), saved(), { singlePost: true, baseTransport: original });
    expect(response.ok).toBe(true); expect(fixture.create).toHaveBeenCalledTimes(1); expect(nativeFetch).toHaveBeenCalledTimes(1);
    expect(nativeFetch.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'error' });
  });
  it('caller mutation during dispatcher acquisition cannot change detached original evidence', async () => {
    fixture.create.mockImplementation(() => { original.baseTransport.baseUrl = 'http://dummy-changed.invalid/chat'; original.provider = 'deepseek'; });
    expect((await fetchProxy('http://dummy-upstream.invalid/chat', options(), saved(), { singlePost: true, baseTransport: original })).ok).toBe(true);
    expect(nativeFetch).toHaveBeenCalledTimes(1);
  });
  it('registry change at entry refuses before dispatcher or native POST', async () => {
    fixture.baseUrl = 'http://dummy-changed.invalid/chat';
    await expect(fetchProxy('http://dummy-upstream.invalid/chat', options(), saved(), { singlePost: true, baseTransport: original })).rejects.toThrow('Accounting Base transport unavailable');
    expect(fixture.create).not.toHaveBeenCalled(); expect(nativeFetch).not.toHaveBeenCalled();
  });
  it('registry change during dispatcher acquisition refuses without native POST/replay', async () => {
    fixture.create.mockImplementation(() => { fixture.baseUrl = 'http://dummy-changed.invalid/chat'; });
    await expect(fetchProxy('http://dummy-upstream.invalid/chat', options(), saved(), { singlePost: true, baseTransport: original })).rejects.toThrow('Accounting Base transport unavailable');
    expect(fixture.create).toHaveBeenCalledTimes(1); expect(nativeFetch).not.toHaveBeenCalled();
  });
});
