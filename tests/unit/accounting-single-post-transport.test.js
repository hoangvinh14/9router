import { afterEach, describe, expect, it, vi } from 'vitest';

const envKeys = ['HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy', 'STRICT_SSL'];
const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
afterEach(() => {
  vi.unstubAllGlobals(); vi.resetModules();
  for (const key of envKeys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
});
async function transport(fetch) {
  for (const key of envKeys) delete process.env[key];
  vi.stubGlobal('fetch', fetch); vi.resetModules();
  return (await import('open-sse/utils/proxyFetch.js')).proxyAwareFetch;
}
const url = 'https://api.anthropic.com/v1/messages';
const options = { method: 'POST', body: '{}', redirect: 'error' };
describe('accounting single-POST transport, not provider approval', () => {
  it('direct failure is one invocation and preserves original error', async () => {
    const error = new Error('transport failed'), fetch = vi.fn(() => Promise.reject(error));
    const send = await transport(fetch);
    await expect(send(url, options, null, { singlePost: true })).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('TLS certificate failure never downgrades or retries, even without STRICT_SSL', async () => {
    const error = Object.assign(new Error('TLS refusal'), { cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' } });
    const fetch = vi.fn(() => Promise.reject(error)), send = await transport(fetch);
    await expect(send(url, options, null, { singlePost: true })).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][1].dispatcher).toBeUndefined();
  });
  it('configured connection proxy failure cannot replay over direct transport', async () => {
    const error = new Error('proxy failed'), fetch = vi.fn(() => Promise.reject(error)), send = await transport(fetch);
    await expect(send(url, options, { connectionProxyEnabled: true, connectionProxyUrl: 'http://127.0.0.1:1' }, { singlePost: true })).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][1].dispatcher).toBeDefined();
  });
  it('environment proxy certificate error cannot replay insecure or direct', async () => {
    const error = Object.assign(new Error('TLS refusal'), { cause: { code: 'CERT_HAS_EXPIRED' } });
    const fetch = vi.fn(() => Promise.reject(error)), send = await transport(fetch); process.env.HTTPS_PROXY = 'http://127.0.0.1:1';
    await expect(send(url, options, null, { singlePost: true })).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][1].dispatcher).toBeDefined();
  });
  it('relay destination change is rejected before any fetch', async () => {
    const fetch = vi.fn(async () => new Response('fixture')), send = await transport(fetch);
    await expect(send(url, options, { vercelRelayUrl: 'https://relay.invalid' }, { singlePost: true })).rejects.toThrow('Accounting single-POST relay unsupported');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('successful strict transport preserves pinned URL, redirect policy and caller options', async () => {
    const response = new Response('fixture'), fetch = vi.fn(async () => response), send = await transport(fetch);
    const before = { ...options };
    expect(await send(url, options, null, { singlePost: true })).toBe(response);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(url, options); expect(options).toEqual(before);
  });
  it.each(['method', 'redirect'])('strict %s policy refuses before fetch', async mode => {
    const fetch = vi.fn(async () => new Response('fixture')), send = await transport(fetch);
    await expect(send(url, { ...options, ...(mode === 'method' ? { method: 'GET' } : { redirect: 'follow' }) }, null, { singlePost: true }))
      .rejects.toThrow('Accounting single-POST request policy required');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('already aborted strict transport preserves false reason with no fetch', async () => {
    const fetch = vi.fn(async () => new Response('fixture')), send = await transport(fetch), caller = new AbortController(); caller.abort(false);
    await expect(send(url, { ...options, signal: caller.signal }, null, { singlePost: true })).rejects.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('strict proxy intent without resolved endpoint cannot silently leave directly', async () => {
    const fetch = vi.fn(async () => new Response('fixture')), send = await transport(fetch);
    await expect(send(url, options, { connectionProxyEnabled: true, strictProxy: true }, { singlePost: true }))
      .rejects.toThrow('Proxy required but none resolved');
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['proxy', 'bypass'])('persisted global %s authority ignores conflicting mutable environment without fallback', async mode => {
    const response = new Response('fixture'), fetch = vi.fn(async () => response), send = await transport(fetch);
    process.env.HTTPS_PROXY = 'http://stale.invalid:invalid'; process.env.NO_PROXY = mode === 'proxy' ? '*' : '';
    const proxy = { persistedGlobalProxy: { url: 'http://127.0.0.1:2/', noProxy: mode === 'bypass' ? 'api.anthropic.com' : '' } };
    expect(await send(url, options, proxy, { singlePost: true })).toBe(response);
    expect(fetch).toHaveBeenCalledTimes(1); expect(!!fetch.mock.calls[0][1].dispatcher).toBe(mode === 'proxy');
  });
  it('persisted global proxy failure never falls back to conflicting environment or direct', async () => {
    const error = new Error('saved proxy failure'), fetch = vi.fn(() => Promise.reject(error)), send = await transport(fetch);
    process.env.HTTPS_PROXY = 'http://stale.invalid:invalid';
    await expect(send(url, options, { persistedGlobalProxy: { url: 'http://127.0.0.1:2/', noProxy: '' } }, { singlePost: true })).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][1].dispatcher).toBeDefined();
  });
  it.each(['', 'socks5://127.0.0.1:2', 'https://proxy.invalid/#fragment', 'http://proxy.invalid/path'])('invalid persisted global proxy %s denies before any fetch', async saved => {
    const fetch = vi.fn(async () => new Response('fixture')), send = await transport(fetch);
    await expect(send(url, options, { persistedGlobalProxy: { url: saved, noProxy: '' } }, { singlePost: true })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('persisted connection bypass uses saved global fallback, never environment', async () => {
    const fetch = vi.fn(async () => new Response('fixture')), send = await transport(fetch); process.env.HTTPS_PROXY = 'http://stale.invalid:invalid';
    await send(url, options, { connectionProxyEnabled: true, connectionProxyUrl: 'http://127.0.0.1:3', connectionNoProxy: 'api.anthropic.com', persistedGlobalProxy: { url: 'http://127.0.0.1:2/', noProxy: '' } }, { singlePost: true });
    expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][1].dispatcher).toBeDefined();
  });
  it.each([
    { url: 'http://proxy.invalid/private/..', noProxy: '' },
    { url: 'http://proxy.invalid/?', noProxy: '' },
    { url: 'http://proxy.invalid/#', noProxy: '' },
    { url: 'http://proxy.invalid/\n', noProxy: '' },
    { url: 'http://proxy.invalid/', noProxy: 42 },
    { url: 'http://proxy.invalid/', noProxy: 'api.anthropic.com\r\n' },
    { url: 'http://proxy.invalid/', noProxy: '', foreign: true },
    null,
  ])('ambiguous or malformed saved authority %# denies rather than URL-normalizing into eligibility', async authority => {
    const fetch = vi.fn(async () => new Response('fixture')), send = await transport(fetch);
    await expect(send(url, options, { persistedGlobalProxy: authority }, { singlePost: true })).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
  it('credential-bearing saved proxy stays request-local and acquires a dispatcher', async () => {
    const fetch = vi.fn(async () => new Response('fixture')), send = await transport(fetch);
    const proxy = { persistedGlobalProxy: { url: 'http://fixture-user:fixture-password@127.0.0.1:2/', noProxy: '' } }, before = structuredClone(proxy);
    await send(url, options, proxy, { singlePost: true }); expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][1].dispatcher).toBeDefined(); expect(proxy).toEqual(before);
    expect(new Headers(fetch.mock.calls[0][1].headers).has('proxy-authorization')).toBe(false);
  });
  it('valid legacy connection proxy retains precedence over saved global policy', async () => {
    const fetch = vi.fn(async () => new Response('fixture')), send = await transport(fetch), legacy = { connectionProxyEnabled: true, connectionProxyUrl: 'http://127.0.0.1:3/' };
    await send(url, options, legacy, { singlePost: true }); const expected = fetch.mock.calls[0][1].dispatcher;
    await send(url, options, { ...legacy, persistedGlobalProxy: { url: 'http://127.0.0.1:2/', noProxy: '' } }, { singlePost: true });
    expect(fetch).toHaveBeenCalledTimes(2); expect(fetch.mock.calls[1][1].dispatcher).toBe(expected);
  });
  it('saved proxy preparation preserves false cancellation with zero actual POST', async () => {
    const fetch = vi.fn(async () => new Response('fixture')), send = await transport(fetch), caller = new AbortController(); caller.abort(false);
    await expect(send(url, { ...options, signal: caller.signal }, { persistedGlobalProxy: { url: 'http://127.0.0.1:2/', noProxy: '' } }, { singlePost: true })).rejects.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  const pool = (extra = {}) => ({ id: 'fixture-pool', url: 'http://127.0.0.1:4/', noProxy: '', strictProxy: true, type: 'http', isActive: true, ...extra });
  it('persisted pool dispatcher has priority over legacy, saved global and conflicting environment', async () => {
    const fetch = vi.fn(async () => new Response('fixture')), send = await transport(fetch);
    await send(url, options, { connectionProxyEnabled: true, connectionProxyUrl: 'http://127.0.0.1:4/' }, { singlePost: true }); const expected = fetch.mock.calls[0][1].dispatcher;
    process.env.HTTPS_PROXY = 'http://stale.invalid:invalid'; process.env.NO_PROXY = '*';
    await send(url, options, { persistedPoolProxy: pool(), connectionProxyEnabled: true, connectionProxyUrl: 'http://127.0.0.1:3/', persistedGlobalProxy: { url: 'http://127.0.0.1:2/', noProxy: '' } }, { singlePost: true });
    expect(fetch).toHaveBeenCalledTimes(2); expect(fetch.mock.calls[1][1].dispatcher).toBe(expected);
  });
  it('strict pool bypass without saved global refuses zero fetch, even if environment supplies proxy', async () => {
    const fetch = vi.fn(async () => new Response('fixture')), send = await transport(fetch); process.env.HTTPS_PROXY = 'http://127.0.0.1:2/';
    await expect(send(url, options, { persistedPoolProxy: pool({ noProxy: 'api.anthropic.com' }) }, { singlePost: true })).rejects.toThrow('Proxy required but none resolved'); expect(fetch).not.toHaveBeenCalled();
  });
  it('strict pool and saved-global bypass refuse zero fetch', async () => {
    const fetch = vi.fn(async () => new Response('fixture')), send = await transport(fetch);
    await expect(send(url, options, { persistedPoolProxy: pool({ noProxy: '*' }), persistedGlobalProxy: { url: 'http://127.0.0.1:2/', noProxy: '*' } }, { singlePost: true })).rejects.toThrow('Proxy required but none resolved'); expect(fetch).not.toHaveBeenCalled();
  });
  it('non-strict pool intentional bypass does not acquire conflicting environment dispatcher', async () => {
    const fetch = vi.fn(async () => new Response('fixture')), send = await transport(fetch); process.env.HTTPS_PROXY = 'http://stale.invalid:invalid';
    await send(url, options, { persistedPoolProxy: pool({ strictProxy: false, noProxy: '*' }) }, { singlePost: true }); expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][1].dispatcher).toBeUndefined();
  });
  it('pool bypass uses only independently saved global dispatcher, not legacy or environment', async () => {
    const fetch = vi.fn(async () => new Response('fixture')), send = await transport(fetch);
    const global = { url: 'http://127.0.0.1:2/', noProxy: '' }; await send(url, options, { persistedGlobalProxy: global }, { singlePost: true }); const expected = fetch.mock.calls[0][1].dispatcher;
    process.env.HTTPS_PROXY = 'http://stale.invalid:invalid';
    await send(url, options, { persistedPoolProxy: pool({ noProxy: '*' }), persistedGlobalProxy: global, connectionProxyEnabled: true, connectionProxyUrl: 'http://127.0.0.1:3/' }, { singlePost: true }); expect(fetch).toHaveBeenCalledTimes(2); expect(fetch.mock.calls[1][1].dispatcher).toBe(expected);
  });
  it.each([true, false])('pool strict=%s TLS failure never replays insecure, legacy, global or direct', async strict => {
    const error = Object.assign(new Error('pool TLS refusal'), { cause: { code: 'CERT_HAS_EXPIRED' } }), fetch = vi.fn(() => Promise.reject(error)), send = await transport(fetch);
    await expect(send(url, options, { persistedPoolProxy: pool({ strictProxy: strict }), persistedGlobalProxy: { url: 'http://127.0.0.1:2/', noProxy: '' } }, { singlePost: true })).rejects.toBe(error); expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][1].dispatcher).toBeDefined();
  });
  it('persisted pool dispatcher acquisition preserves false cancellation without POST', async () => {
    const fetch = vi.fn(async () => new Response('fixture')), send = await transport(fetch), caller = new AbortController(); caller.abort(false);
    await expect(send(url, { ...options, signal: caller.signal }, { persistedPoolProxy: pool() }, { singlePost: true })).rejects.toBe(false); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([{ isActive: false }, { strictProxy: 'true' }, { type: 'vercel' }, { url: '' }])('invalid persisted pool authority %# denies instead of global fallback', async extra => {
    const fetch = vi.fn(async () => new Response('fixture')), send = await transport(fetch);
    await expect(send(url, options, { persistedPoolProxy: pool(extra), persistedGlobalProxy: { url: 'http://127.0.0.1:2/', noProxy: '' } }, { singlePost: true })).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
  it('OFF helper retains existing relay behavior without strict contract', async () => {
    const fetch = vi.fn(async () => new Response('fixture')), send = await transport(fetch);
    await send(url, options, { vercelRelayUrl: 'https://relay.invalid' });
    expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][0]).toBe('https://relay.invalid');
  });
});
