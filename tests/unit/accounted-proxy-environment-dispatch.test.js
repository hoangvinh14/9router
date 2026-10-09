import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dispatcher = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('undici', () => ({
  ProxyAgent: class { constructor(options) { dispatcher.create(options); } },
  Agent: class { constructor(options) { dispatcher.create(options); } }
}));
let nativeFetch, fetchProxy, capture;
beforeEach(async () => {
  vi.resetModules(); dispatcher.create.mockReset();
  nativeFetch = vi.fn(async () => Response.json({ fixture: true })); vi.stubGlobal('fetch', nativeFetch);
  ({ proxyAwareFetch: fetchProxy } = await import('../../open-sse/utils/proxyFetch.js'));
  ({ captureAccountingProxyEnvironment: capture } = await import('../../open-sse/config/accountedProxyEnvironment.js'));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const options = () => ({ method: 'POST', redirect: 'error', body: 'fixture' });
const saved = () => ({ persistedGlobalProxy: { url: 'http://dummy-proxy.invalid:3210', noProxy: '' } });

describe('singlePost original environment across dispatcher acquisition (mock dispatcher/native POST, not socket proof)', () => {
  it('unchanged original environment makes exactly one native POST with secure dispatcher', async () => {
    const evidence = capture();
    expect((await fetchProxy('http://dummy-upstream.invalid/chat', options(), saved(), { singlePost: true, proxyEnvironment: evidence })).ok).toBe(true);
    expect(dispatcher.create).toHaveBeenCalledExactlyOnceWith({ uri: 'http://dummy-proxy.invalid:3210/' });
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    expect(nativeFetch.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(capture()).toEqual(evidence);
  });
  it.each(['HTTP_PROXY', 'NO_PROXY'])('%s mutation during dispatcher acquisition refuses native POST without replay', async variable => {
    const evidence = capture();
    dispatcher.create.mockImplementation(() => { vi.stubEnv(variable, variable === 'HTTP_PROXY' ? 'http://dummy-changed.invalid:3211' : 'dummy-changed.invalid'); });
    await expect(fetchProxy('http://dummy-upstream.invalid/chat', options(), saved(), { singlePost: true, proxyEnvironment: evidence })).rejects.toThrow('Accounting proxy environment unavailable');
    expect(dispatcher.create).toHaveBeenCalledTimes(1); expect(nativeFetch).not.toHaveBeenCalled();
  });
  it('changed evidence at entry refuses before dispatcher creation or POST', async () => {
    const evidence = capture(); vi.stubEnv('NO_PROXY', 'dummy-changed.invalid');
    await expect(fetchProxy('http://dummy-upstream.invalid/chat', options(), saved(), { singlePost: true, proxyEnvironment: evidence })).rejects.toThrow('Accounting proxy environment unavailable');
    expect(dispatcher.create).not.toHaveBeenCalled(); expect(nativeFetch).not.toHaveBeenCalled();
  });
});
