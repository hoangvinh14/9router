import { afterEach, describe, expect, it, vi } from 'vitest';

const dispatchers = vi.hoisted(() => ({ created: [] }));
vi.mock('undici', () => ({
  ProxyAgent: class { constructor(options) { dispatchers.created.push(options); } },
  Agent: class { constructor(options) { dispatchers.created.push(options); } }
}));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); dispatchers.created.length = 0; });

describe('proxyFetch module re-evaluation must not wrap previous proxy policy as native fetch (mock boundary only)', () => {
  it('singlePost after reload rejects first TLS error with one native call and no insecure dispatcher', async () => {
    const error = new TypeError('fixture TLS failure'); error.cause = { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' };
    const native = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(Response.json({ fixture: true }));
    vi.stubGlobal('fetch', native); vi.resetModules();
    await import('../../open-sse/utils/proxyFetch.js');
    // Keep the published global wrapper, like module re-evaluation/HMR. Do not
    // restore native between imports: that would hide nested fallback/replay.
    vi.resetModules();
    const { proxyAwareFetch } = await import('../../open-sse/utils/proxyFetch.js');
    await expect(proxyAwareFetch('https://dummy-upstream.invalid/chat', { method: 'POST', redirect: 'error', body: 'fixture' },
      { persistedGlobalProxy: { url: 'http://dummy-proxy.invalid:3210', noProxy: '' } }, { singlePost: true })).rejects.toBe(error);
    expect(native).toHaveBeenCalledTimes(1);
    expect(dispatchers.created).toHaveLength(1);
    expect(dispatchers.created[0]).toEqual({ uri: 'http://dummy-proxy.invalid:3210/' });
  });
  it('multiple reloads preserve one unchanged native POST and the current secure dispatcher', async () => {
    const native = vi.fn(async () => Response.json({ fixture: true }));
    vi.stubGlobal('fetch', native); vi.resetModules();
    let latest;
    for (let i = 0; i < 4; i++) { latest = await import('../../open-sse/utils/proxyFetch.js'); vi.resetModules(); }
    const options = { method: 'POST', redirect: 'error', body: 'fixture', headers: { 'x-fixture': 'original' } };
    expect((await latest.proxyAwareFetch('https://dummy-upstream.invalid/chat', options,
      { persistedGlobalProxy: { url: 'http://dummy-proxy.invalid:3210', noProxy: '' } }, { singlePost: true })).ok).toBe(true);
    expect(native).toHaveBeenCalledTimes(1); expect(dispatchers.created).toHaveLength(1);
    expect(native.mock.calls[0][1]).toMatchObject(options);
    expect(native.mock.calls[0][1].dispatcher).toBeDefined();
  });
  it('a new external transport replacement is captured, not confused with an owned wrapper', async () => {
    const first = vi.fn(async () => Response.json({ fixture: 'first' }));
    vi.stubGlobal('fetch', first); vi.resetModules(); await import('../../open-sse/utils/proxyFetch.js');
    const replacement = vi.fn(async () => Response.json({ fixture: 'replacement' }));
    vi.stubGlobal('fetch', replacement); vi.resetModules();
    const { proxyAwareFetch } = await import('../../open-sse/utils/proxyFetch.js');
    expect((await proxyAwareFetch('https://dummy-upstream.invalid/chat', { method: 'POST', redirect: 'error' },
      { persistedGlobalProxy: { url: 'http://dummy-proxy.invalid:3210', noProxy: '' } }, { singlePost: true })).ok).toBe(true);
    expect(first).not.toHaveBeenCalled(); expect(replacement).toHaveBeenCalledTimes(1);
  });
});
