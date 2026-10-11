import { beforeEach, describe, expect, it, vi } from 'vitest';

const seams = vi.hoisted(() => ({ pool: vi.fn(), pools: vi.fn(), connections: vi.fn(), settings: vi.fn(), execute: vi.fn(), update: vi.fn() }));
vi.mock('@/models', () => ({ getProxyPoolById: (...args) => seams.pool(...args) }));
vi.mock('@/lib/localDb', () => ({ getProviderConnections: (...args) => seams.connections(...args), getSettings: (...args) => seams.settings(...args), getProxyPools: (...args) => seams.pools(...args), validateApiKey: vi.fn(), updateProviderConnection: (...args) => seams.update(...args) }));
vi.mock('@/shared/constants/providers.js', () => ({ resolveProviderId: value => value, FREE_PROVIDERS: { 'fixture-public': { noAuth: true } } }));
vi.mock('@/sse/services/antigravityQuota.js', () => ({ getAntigravityQuotaCache: () => new Map() }));
vi.mock('@/sse/utils/logger.js', () => ({ debug() {}, info() {}, warn() {}, error() {} }));
vi.mock('@/lib/usageDb.js', () => ({ trackPendingRequest() {}, appendRequestLog: async () => {}, saveRequestDetail: async () => {} }));
vi.mock('../../open-sse/executors/index.js', () => ({ getExecutor: () => ({ execute: (...args) => seams.execute(...args) }) }));
vi.mock('../../open-sse/utils/requestLogger.js', () => ({ createRequestLogger: async () => ({ logClientRequest() {}, logClientRawRequest() {}, logRawRequest() {}, logSourceRequest() {}, logTargetRequest() {}, logResponse() {}, logError() {} }) }));

const { resolveConnectionProxyConfig } = await import('@/lib/network/connectionProxy.js');
const { getProviderCredentials } = await import('@/sse/services/auth.js');
const { handleChatCore } = await import('../../open-sse/handlers/chatCore.js');
const modes = ['active-strict', 'inactive-strict', 'empty-strict', 'inactive-nonstrict'];
const savedPool = mode => ({ id: 'fixture-pool', type: 'http', isActive: !mode.startsWith('inactive'), proxyUrl: mode === 'empty-strict' ? '' : 'http://pool.invalid:1234', noProxy: 'localhost', strictProxy: mode !== 'inactive-nonstrict' });
beforeEach(() => {
  vi.clearAllMocks();
  seams.settings.mockResolvedValue({ fallbackStrategy: 'fill-first', providerStrategies: { 'fixture-public': { proxyPoolId: 'fixture-pool', rotateStrategy: 'none' } } });
  seams.connections.mockResolvedValue([{ id: 'fixture-connection', isActive: true, authType: 'apikey', apiKey: 'dummy', providerSpecificData: { proxyPoolId: 'fixture-pool', strictProxy: false } }]);
  seams.execute.mockRejectedValue(new Error('Owned executor fixture stop; no upstream network'));
});
describe('normal path keeps resolved pool strict intent across auth and core', () => {
  it.each(modes)('actual resolver -> account credentials: %s', async mode => {
    seams.pool.mockResolvedValue(savedPool(mode));
    const credentials = await getProviderCredentials('openai', null, 'gpt-4.1');
    expect(credentials.connectionId).toBe('fixture-connection');
    expect(credentials.providerSpecificData).toMatchObject({ strictProxy: mode !== 'inactive-nonstrict', connectionProxyPoolId: 'fixture-pool', connectionProxyEnabled: mode === 'active-strict', connectionProxyUrl: mode === 'active-strict' ? 'http://pool.invalid:1234' : '' });
    expect(seams.pool).toHaveBeenCalledExactlyOnceWith('fixture-pool');
    expect(seams.update).not.toHaveBeenCalled();
  });
  it.each(['openai', 'fixture-public'])('unavailable strict pool flag survives actual resolver/auth/core: %s', async provider => {
    seams.pool.mockResolvedValue(savedPool('inactive-strict'));
    const credentials = await getProviderCredentials(provider, null, 'gpt-4.1');
    expect(credentials.providerSpecificData.proxyPoolUnavailable).toBe(true);
    await handleChatCore({ body: { messages: [{ role: 'user', content: 'fixture request' }], stream: false }, modelInfo: { provider: 'openai', model: 'gpt-4.1' }, credentials });
    expect(seams.execute).toHaveBeenCalledTimes(1);
    expect(seams.execute.mock.calls[0][0].proxyOptions).toMatchObject({ proxyPoolId: 'fixture-pool', strictProxy: true, proxyPoolUnavailable: true });
  });
  it.each(['inactive-strict', 'empty-strict', 'active-strict', 'inactive-nonstrict'])('fresh resolver authority overrides conflicting saved flags and isolates requests: %s', async mode => {
    seams.connections.mockResolvedValue([{ id: 'fixture-connection', isActive: true, authType: 'apikey', apiKey: 'dummy', providerSpecificData: { proxyPoolId: 'fixture-pool', strictProxy: false, proxyPoolUnavailable: true, connectionProxyEnabled: true, connectionProxyUrl: 'http://legacy.invalid:1234', vercelRelayUrl: 'https://stale-relay.invalid' } }]);
    seams.pool.mockResolvedValue(savedPool(mode));
    const credentials = await getProviderCredentials('openai', null, 'gpt-4.1');
    const unavailable = ['inactive-strict', 'empty-strict'].includes(mode);
    expect(credentials.providerSpecificData).toMatchObject({ strictProxy: mode !== 'inactive-nonstrict', proxyPoolUnavailable: unavailable, vercelRelayUrl: '' });
    if (unavailable) expect(credentials.providerSpecificData).toMatchObject({ connectionProxyEnabled: false, connectionProxyUrl: '' });
    else expect(credentials.providerSpecificData.connectionProxyUrl).toBe(mode === 'active-strict' ? 'http://pool.invalid:1234' : 'http://legacy.invalid:1234');
    const before = structuredClone(credentials.providerSpecificData);
    seams.pool.mockResolvedValue(savedPool('active-strict'));
    const next = await getProviderCredentials('openai', null, 'gpt-4.1');
    expect(next.providerSpecificData.proxyPoolUnavailable).toBe(false);
    expect(credentials.providerSpecificData).toEqual(before);
    expect(seams.update).not.toHaveBeenCalled();
  });
  it.each(modes)('actual resolver -> no-auth credentials, no rotation: %s', async mode => {
    seams.pool.mockResolvedValue(savedPool(mode));
    const credentials = await getProviderCredentials('fixture-public', null, 'fixture');
    expect(credentials.id).toBe('noauth');
    expect(credentials.providerSpecificData).toMatchObject({ strictProxy: mode !== 'inactive-nonstrict', connectionProxyPoolId: 'fixture-pool', connectionProxyEnabled: mode === 'active-strict' });
    expect(seams.pool).toHaveBeenCalledExactlyOnceWith('fixture-pool');
    expect(seams.connections).not.toHaveBeenCalled();
    expect(seams.update).not.toHaveBeenCalled();
  });
  it.each(['openai', 'fixture-public'].flatMap(provider => ['missing', 'lookup-failed'].map(fault => ({ provider, fault }))))('unproved assigned pool never becomes direct/global/legacy authority: $provider $fault', async ({ provider, fault }) => {
    seams.pool.mockResolvedValue(savedPool('active-strict'));
    const positive = await getProviderCredentials(provider, null, 'gpt-4.1');
    expect(positive.providerSpecificData).toMatchObject({ strictProxy: true, proxyPoolUnavailable: false, connectionProxyEnabled: true, connectionProxyPoolId: 'fixture-pool' });
    const retained = structuredClone(positive.providerSpecificData);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      if (fault === 'missing') seams.pool.mockResolvedValue(null);
      else seams.pool.mockRejectedValue(new Error('Fixture pool lookup unavailable'));
      const credentials = await getProviderCredentials(provider, null, 'gpt-4.1');
      expect(credentials.providerSpecificData).toMatchObject({ strictProxy: true, proxyPoolUnavailable: true, connectionProxyEnabled: false, connectionProxyUrl: '', connectionProxyPoolId: 'fixture-pool', vercelRelayUrl: '' });
      expect(positive.providerSpecificData).toEqual(retained);
      expect(seams.update).not.toHaveBeenCalled();
      await handleChatCore({ body: { messages: [{ role: 'user', content: 'fixture request' }], stream: false }, modelInfo: { provider: 'openai', model: 'gpt-4.1' }, credentials });
      expect(seams.execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ proxyOptions: expect.objectContaining({ strictProxy: true, proxyPoolUnavailable: true, proxyPoolId: 'fixture-pool', connectionProxyEnabled: false, connectionProxyUrl: '' }) }));
    } finally { errorLog.mockRestore(); }
  });
  it.each(['round-robin', 'random'].flatMap(strategy => ['missing', 'lookup-failed'].map(fault => ({ strategy, fault }))))('no-auth $strategy selection stays denied, not repicked, after $fault', async ({ strategy, fault }) => {
    seams.settings.mockResolvedValue({ providerStrategies: { 'fixture-public': { rotateStrategy: strategy } } });
    seams.pools.mockResolvedValue([{ ...savedPool('active-strict'), id: 'fixture-first' }, { ...savedPool('active-strict'), id: 'fixture-second' }]);
    seams.pool.mockImplementation(async id => ({ ...savedPool('active-strict'), id }));
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const positive = await getProviderCredentials('fixture-public', null, 'fixture');
      expect(positive.providerSpecificData).toMatchObject({ connectionProxyPoolId: 'fixture-first', strictProxy: true, proxyPoolUnavailable: false, connectionProxyEnabled: true });
      const retained = structuredClone(positive.providerSpecificData);
      seams.pool.mockClear(); seams.pools.mockClear();
      random.mockReturnValue(0.9);
      seams.pool.mockImplementation(async id => {
        expect(id).toBe('fixture-second');
        if (fault === 'lookup-failed') throw new Error('Fixture rotated lookup unavailable');
        return null;
      });
      const denied = await getProviderCredentials('fixture-public', null, 'fixture');
      expect(denied.providerSpecificData).toMatchObject({ connectionProxyPoolId: 'fixture-second', strictProxy: true, proxyPoolUnavailable: true, connectionProxyEnabled: false, connectionProxyUrl: '' });
      expect(seams.pool).toHaveBeenCalledExactlyOnceWith('fixture-second');
      expect(seams.pools).toHaveBeenCalledExactlyOnceWith({ isActive: true });
      expect(positive.providerSpecificData).toEqual(retained);
      expect(seams.connections).not.toHaveBeenCalled(); expect(seams.update).not.toHaveBeenCalled();
      await handleChatCore({ body: { messages: [{ role: 'user', content: 'fixture request' }], stream: false }, modelInfo: { provider: 'openai', model: 'gpt-4.1' }, credentials: denied });
      expect(seams.execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ proxyOptions: expect.objectContaining({ proxyPoolId: 'fixture-second', strictProxy: true, proxyPoolUnavailable: true }) }));
    } finally { random.mockRestore(); errorLog.mockRestore(); }
  });
  it('pool lookup errors expose only fixed diagnostics, not secret-bearing error objects', async () => {
    seams.pool.mockResolvedValue(savedPool('active-strict'));
    expect((await resolveConnectionProxyConfig({ proxyPoolId: 'fixture-pool' })).strictProxy).toBe(true);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const sentinel = 'fixture-private-proxy-credential';
      seams.pool.mockRejectedValue(new Error(sentinel));
      await resolveConnectionProxyConfig({ proxyPoolId: 'fixture-pool' });
      expect(errorLog.mock.calls.every(call => call.every(value => typeof value === 'string' && !value.includes(sentinel)))).toBe(true);
    } finally { errorLog.mockRestore(); }
  });
  it.each(modes)('actual core -> executor proxy options, accounting OFF: %s', async mode => {
    const active = mode === 'active-strict';
    const policy = { connectionProxyEnabled: active, connectionProxyUrl: active ? 'http://pool.invalid:1234' : '', connectionNoProxy: active ? 'localhost' : '', connectionProxyPoolId: 'fixture-pool', strictProxy: mode !== 'inactive-nonstrict' };
    const result = await handleChatCore({ body: { messages: [{ role: 'user', content: 'fixture request' }], stream: false }, modelInfo: { provider: 'openai', model: 'gpt-4.1' }, credentials: { apiKey: 'dummy', providerSpecificData: policy }, connectionId: 'fixture-connection' });
    expect(result.response.status).toBe(502);
    expect(seams.execute).toHaveBeenCalledTimes(1);
    expect(seams.execute.mock.calls[0][0].accounting).toBeNull();
    expect(seams.execute.mock.calls[0][0].proxyOptions).toMatchObject({ connectionProxyEnabled: active, connectionProxyUrl: policy.connectionProxyUrl, connectionNoProxy: policy.connectionNoProxy, proxyPoolId: 'fixture-pool', strictProxy: policy.strictProxy });
  });
});
