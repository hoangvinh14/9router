import { afterEach, describe, expect, it, vi } from 'vitest';
const pool = vi.hoisted(() => vi.fn());
vi.mock('@/models', () => ({ getProxyPoolById: (...args) => pool(...args) }));
const keys = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'];
const old = Object.fromEntries(keys.map(k => [k, process.env[k]]));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); for (const k of keys) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } });
const legacy = { proxyPoolId: 'fixture-pool', connectionProxyEnabled: true, connectionProxyUrl: 'http://127.0.0.1:1234', connectionNoProxy: '' };
const row = (mode, strict) => ({ id: 'fixture-pool', type: 'http', isActive: mode !== 'inactive', proxyUrl: mode === 'empty' ? '' : 'http://127.0.0.1:5678', strictProxy: strict });
describe('required unavailable strict pool cannot downgrade to other proxy authority', () => {
  it.each(['inactive', 'empty'])('resolver %s strict pool cannot select conflicting legacy', async mode => {
    pool.mockResolvedValue(row(mode, true));
    const { resolveConnectionProxyConfig } = await import('@/lib/network/connectionProxy.js');
    expect(await resolveConnectionProxyConfig(legacy)).toMatchObject({ proxyPoolId: 'fixture-pool', strictProxy: true, proxyPoolUnavailable: true, connectionProxyEnabled: false, connectionProxyUrl: '' });
  });
  it.each(['row-url', 'row-no-proxy', 'legacy-url'])('normalization failure %s cannot erase already selected pool intent', async fault => {
    const { resolveConnectionProxyConfig } = await import('@/lib/network/connectionProxy.js');
    pool.mockResolvedValue(row('active', true));
    expect(await resolveConnectionProxyConfig(legacy)).toMatchObject({ source: 'pool', proxyPoolId: 'fixture-pool', strictProxy: true, connectionProxyEnabled: true });
    // Plain JSON can disable both ordinary coercion methods without getters or
    // executable code. This is not a programmable-input sandbox assertion.
    const invalidString = JSON.parse('{"toString":0,"valueOf":0}');
    const saved = row('active', true);
    const input = { ...legacy };
    if (fault === 'row-url') saved.proxyUrl = invalidString;
    else if (fault === 'row-no-proxy') saved.noProxy = invalidString;
    else input.connectionProxyUrl = invalidString;
    pool.mockResolvedValue(saved);
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const denied = await resolveConnectionProxyConfig(input);
      expect(denied).toMatchObject({ proxyPoolId: 'fixture-pool', strictProxy: true, proxyPoolUnavailable: true, connectionProxyEnabled: false, connectionProxyUrl: '', connectionNoProxy: '' });
      expect(logger.mock.calls.every(call => call.every(value => typeof value === 'string'))).toBe(true);
    } finally { logger.mockRestore(); }
  });
  it.each(['inactive', 'empty'])('resolver %s nonstrict pool keeps existing legacy fallback', async mode => {
    pool.mockResolvedValue(row(mode, false));
    const { resolveConnectionProxyConfig } = await import('@/lib/network/connectionProxy.js');
    expect(await resolveConnectionProxyConfig(legacy)).toMatchObject({ source: 'legacy', strictProxy: false, connectionProxyEnabled: true, connectionProxyUrl: legacy.connectionProxyUrl });
  });
  it.each(['normal', 'singlePost'])('%s unavailable strict pool cannot use environment or legacy', async mode => {
    for (const k of keys) delete process.env[k];
    const fetch = vi.fn(async () => new Response('fixture'));
    vi.stubGlobal('fetch', fetch); vi.resetModules();
    const { proxyAwareFetch } = await import('../../open-sse/utils/proxyFetch.js');
    const { ProxyPoolUnavailableError } = await import('../../open-sse/utils/proxyPolicyError.js');
    process.env.HTTPS_PROXY = 'http://127.0.0.1:9012';
    await expect(proxyAwareFetch('https://api.openai.com/v1/chat/completions', { method: 'POST', redirect: 'error', body: '{}' }, { ...legacy, strictProxy: true, proxyPoolUnavailable: true }, mode === 'singlePost' ? { singlePost: true } : null)).rejects.toBeInstanceOf(ProxyPoolUnavailableError);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('singlePost unavailable strict pool cannot use saved global authority', async () => {
    for (const k of keys) delete process.env[k];
    const fetch = vi.fn(async () => new Response('fixture')); vi.stubGlobal('fetch', fetch); vi.resetModules();
    const { proxyAwareFetch } = await import('../../open-sse/utils/proxyFetch.js');
    await expect(proxyAwareFetch('https://api.openai.com/v1/responses', { method: 'POST', redirect: 'error', body: '{}' }, { proxyPoolId: 'fixture-pool', strictProxy: true, proxyPoolUnavailable: true, persistedGlobalProxy: { url: 'http://127.0.0.1:9012', noProxy: '' } }, { singlePost: true })).rejects.toThrow(/strictProxy/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['api.openai.com', 'generativelanguage.googleapis.com', 'api.github.com', 'api.anthropic.com', 'chatgpt.com', 'fixture.invalid'].flatMap(host => ['normal', 'singlePost'].map(mode => ({ host, mode }))))('unavailable strict pool denies $mode $host before relay/DNS/global bypass', async ({ host, mode }) => {
    for (const k of keys) delete process.env[k];
    const fetch = vi.fn(async () => new Response('must not escape'));
    vi.stubGlobal('fetch', fetch); vi.resetModules();
    const { proxyAwareFetch } = await import('../../open-sse/utils/proxyFetch.js');
    process.env.HTTPS_PROXY = 'http://127.0.0.1:9012'; process.env.NO_PROXY = '*';
    const policy = { ...legacy, strictProxy: true, proxyPoolUnavailable: true, vercelRelayUrl: 'https://relay.invalid', persistedGlobalProxy: { url: 'http://127.0.0.1:9012', noProxy: '*' } };
    const before = structuredClone(policy);
    await expect(proxyAwareFetch(`https://${host}/fixture`, { method: 'POST', redirect: 'error', body: '{}' }, policy, mode === 'singlePost' ? { singlePost: true } : null)).rejects.toThrow('Proxy required pool unavailable (strictProxy=true)');
    expect(fetch).not.toHaveBeenCalled(); expect(policy).toEqual(before);
  });
  it('explicit __none__ keeps existing legacy choice and ignores unrelated pool', async () => {
    pool.mockClear();
    const { resolveConnectionProxyConfig } = await import('@/lib/network/connectionProxy.js');
    expect(await resolveConnectionProxyConfig({ ...legacy, proxyPoolId: '__none__' })).toMatchObject({ source: 'legacy', proxyPoolId: null, strictProxy: false, connectionProxyUrl: legacy.connectionProxyUrl });
    expect(pool).not.toHaveBeenCalled();
  });
});
