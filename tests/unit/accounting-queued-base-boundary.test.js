import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { BaseExecutor } from '../../open-sse/executors/base.js';
const network = vi.hoisted(() => vi.fn());
// Test-only registry replacement; production never permits arbitrary fixture URLs.
vi.mock('../../open-sse/config/providers.js', async importOriginal => ({ ...(await importOriginal()),
  PROVIDERS: { ...(await importOriginal()).PROVIDERS, openai: { baseUrl: 'http://fixture.invalid/chat' } } }));
vi.mock('../../open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => network(...args) }));
let db, directory, createAccounting;
const old = process.env.DATA_DIR;
beforeEach(async () => {
  network.mockReset(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-queued-base-')); process.env.DATA_DIR = directory; delete global._dbAdapter; vi.resetModules();
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }, { id: 'b', key: 'dummy-key-b' }], settings: { requireApiKey: true },
    providerConnections: [{ id: 'c', provider: 'openai', authType: 'apikey', apiKey: 'dummy-provider', isActive: true }] });
  db.durableTransaction(() => {
    // Explicit disposable fixture activation only; no production activation API.
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','openai',?)", [JSON.stringify({ 'fixture-chat': { input: '1', output: '2' } })]);
  });
  createAccounting = (id = 'a', signal) => import('@/lib/apiKeyBudget/requestAccounting.js').then(m => m.createRequestAccounting(new Request('http://localhost/v1/chat/completions', {
    headers: { Authorization: `Bearer dummy-key-${id}` }, signal }), { adapter: async () => db, queued: true }));
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true }); if (old === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = old; });
const executor = () => new BaseExecutor('openai', { baseUrl: 'http://fixture.invalid/chat', retry: { 502: { attempts: 0, delayMs: 0 } } });
const args = (accounting, signal) => ({ model: 'fixture-chat', body: { messages: [{ role: 'user', content: 'fixture' }] }, stream: false,
  credentials: { apiKey: 'dummy-provider' }, connectionId: 'c', accounting, signal });
const response = () => Response.json({ choices: [{ message: { role: 'assistant', content: 'fixture' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } });
describe('opt-in queued actual Base POST seam (mock transport, not socket/other-provider proof)', { timeout: 20000 }, () => {
  it('two keys sharing executor have own persisted intent before POST and own settlement before success', async () => {
    const a = await createAccounting('a'), b = await createAccounting('b'), ex = executor();
    network.mockImplementation(async () => {
      expect(db.all("SELECT state FROM apiKeyAccounting WHERE state='pending'")).toHaveLength(2);
      return response();
    });
    const results = await Promise.all([ex.execute(args(a)), ex.execute(args(b))]);
    expect(network).toHaveBeenCalledTimes(2); expect(results.every(result => result.accountingOwned && result.response.ok)).toBe(true);
    const rows = db.all('SELECT apiKeyId,requestId,state,costNanoUsd FROM apiKeyAccounting ORDER BY apiKeyId');
    expect(rows.map(row => [row.apiKeyId, row.state, row.costNanoUsd])).toEqual([['a', 'settled', 200000], ['b', 'settled', 200000]]);
    expect(rows[0].requestId).not.toBe(rows[1].requestId);
  });
  it('canonical DefaultExecutor without runtime injection retains registry URL and own ACKs (mock POST only)', async () => {
    const accounting = await createAccounting();
    const { DefaultExecutor } = await import('../../open-sse/executors/default.js');
    const { PROVIDERS } = await import('../../open-sse/config/providers.js');
    const ex = new DefaultExecutor('openai');
    network.mockImplementation(async (url, options) => {
      expect(url).toBe(PROVIDERS.openai.baseUrl);
      expect(options.headers.Authorization).toBe('Bearer dummy-provider');
      expect(db.get('SELECT state FROM apiKeyAccounting').state).toBe('pending');
      return response();
    });
    expect((await ex.execute(args(accounting))).response.ok).toBe(true);
    expect(network).toHaveBeenCalledTimes(1);
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: 200000 });
  });
  it.each(['baseUrl', 'headers'])('unbound DefaultExecutor %s config cannot borrow canonical no-runtime evidence', async field => {
    const accounting = await createAccounting();
    const { DefaultExecutor } = await import('../../open-sse/executors/default.js');
    const ex = new DefaultExecutor('openai');
    // Do not mutate the shared registry; drift only this request fixture's config.
    ex.config = { ...ex.config, [field]: field === 'baseUrl' ? 'http://dummy-unbound.invalid/chat'
      : { ...ex.config.headers, 'x-unbound-fixture': 'dummy-header' } };
    network.mockImplementation(async () => response());
    await expect(ex.execute(args(accounting))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('unbound built headers cannot borrow matching registry config and authorization', async () => {
    const accounting = await createAccounting();
    const { DefaultExecutor } = await import('../../open-sse/executors/default.js');
    const ex = new DefaultExecutor('openai'), build = ex.buildHeaders.bind(ex);
    ex.buildHeaders = (...input) => ({ ...build(...input), 'x-unbound-fixture': 'dummy-header' });
    network.mockImplementation(async () => response());
    await expect(ex.execute(args(accounting))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('unbound runtime endpoint cannot borrow fresh connection authority for a different original URL', async () => {
    const accounting = await createAccounting();
    const { DefaultExecutor } = await import('../../open-sse/executors/default.js');
    const ex = new DefaultExecutor('openai');
    network.mockImplementation(async () => response());
    const input = args(accounting);
    input.credentials.runtimeTransport = { format: 'openai', baseUrl: 'http://dummy-unbound.invalid/chat',
      headers: { 'x-unbound-fixture': 'dummy-header' } };
    await expect(ex.execute(input)).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('queued prepared Base POST uses singlePost transport contract and redirect refusal', async () => {
    const accounting = await createAccounting();
    network.mockImplementation(async (_url, options, _proxyOptions, contract) => {
      expect(contract.singlePost).toBe(true); expect(Object.isFrozen(contract.proxyEnvironment)).toBe(true);
      expect(contract.proxyEnvironment).toEqual((await import('../../open-sse/config/accountedProxyEnvironment.js')).captureAccountingProxyEnvironment());
      expect(options.redirect).toBe('error'); return response();
    });
    expect((await executor().execute(args(accounting))).response.ok).toBe(true);
    expect(network).toHaveBeenCalledTimes(1); expect(db.get('SELECT state FROM apiKeyAccounting').state).toBe('settled');
  });
  it('mutation of exposed prepared headers during queue wait cannot replace original actual POST headers', async () => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      const work = context.beforeAttempt(meta, supported, wire);
      try { wire.headers.Authorization = 'Bearer dummy-changed'; } catch { /* frozen original acceptable */ }
      return work;
    } };
    network.mockImplementation(async (_url, options) => {
      expect(options.headers.Authorization).toBe('Bearer dummy-provider');
      expect(db.get('SELECT state FROM apiKeyAccounting').state).toBe('pending');
      return response();
    });
    expect((await executor().execute(args(accounting))).response.ok).toBe(true);
    expect(network).toHaveBeenCalledTimes(1);
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: 200000 });
  });
  it('connection mutation while owner awaits admission refuses before any actual POST or intent', async () => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      const work = context.beforeAttempt(meta, supported, wire);
      db.durableTransaction(() => db.run("UPDATE providerConnections SET isActive=0 WHERE id='c'"));
      return work;
    } };
    await expect(executor().execute(args(accounting))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
  });
  it('persisted credentials changed before enqueue cannot authorize already-built stale wire', async () => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      expect(wire).toMatchObject({ credentials: { apiKey: 'dummy-provider' }, headers: { Authorization: 'Bearer dummy-provider' } });
      // Headers were built with dummy-provider before this call. Capturing a
      // newer row here must not authorize those stale prepared credentials.
      db.durableTransaction(() => db.run("UPDATE providerConnections SET data=? WHERE id='c'", [JSON.stringify({ apiKey: 'dummy-rotated-provider' })]));
      return context.beforeAttempt(meta, supported, wire);
    } };
    network.mockResolvedValue(response());
    await expect(executor().execute(args(accounting))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
  });
  it('persisted header override changed before enqueue cannot authorize old prepared config', async () => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      expect(wire.providerOverrides).toBeNull();
      db.durableTransaction(() => db.run("UPDATE settings SET data=? WHERE id=1", [JSON.stringify({ requireApiKey: true, providerOverrides: { openai: { headers: { 'x-fixture': 'changed' } } } })]));
      return context.beforeAttempt(meta, supported, wire);
    } };
    await expect(executor().execute(args(accounting))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
  });
  it('already ACKed refreshed token matches prepared headers and still settles original attempt', async () => {
    db.durableTransaction(() => db.run("UPDATE providerConnections SET data=? WHERE id='c'", [JSON.stringify({ apiKey: 'dummy-provider', accessToken: 'dummy-refreshed' })]));
    const accounting = await createAccounting();
    network.mockImplementation(async (_url, options) => { expect(options.headers.Authorization).toBe('Bearer dummy-refreshed'); return response(); });
    const result = await executor().execute({ ...args(accounting), credentials: { apiKey: 'dummy-provider', accessToken: 'dummy-refreshed' } });
    expect(result.response.ok).toBe(true); expect(network).toHaveBeenCalledTimes(1); expect(db.get('SELECT state FROM apiKeyAccounting').state).toBe('settled');
  });
  it('selected pool changed before enqueue cannot authorize previously resolved proxy wire', async () => {
    db.durableTransaction(() => {
      db.run("INSERT INTO proxyPools(id,isActive,data,createdAt,updatedAt) VALUES('p',1,?,'2026-10-03T00:00:00.000Z','2026-10-03T00:00:00.000Z')", [JSON.stringify({ proxyUrl: 'http://dummy-old.invalid', strictProxy: true, type: 'http' })]);
      db.run("UPDATE providerConnections SET data=? WHERE id='c'", [JSON.stringify({ apiKey: 'dummy-provider', providerSpecificData: { proxyPoolId: 'p' } })]);
    });
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      db.durableTransaction(() => db.run("UPDATE proxyPools SET data=? WHERE id='p'", [JSON.stringify({ proxyUrl: 'http://dummy-new.invalid', strictProxy: true, type: 'http' })]));
      return context.beforeAttempt(meta, supported, wire);
    } };
    network.mockResolvedValue(response());
    await expect(executor().execute({ ...args(accounting), proxyOptions: { connectionProxyEnabled: true, connectionProxyUrl: 'http://dummy-old.invalid',
      connectionNoProxy: '', strictProxy: true, proxyPoolId: 'p' } })).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
  });
  it('matching selected pool route is detached from original proxyOptions during wait', async () => {
    db.durableTransaction(() => {
      db.run("INSERT INTO proxyPools(id,isActive,data,createdAt,updatedAt) VALUES('p',1,?,'2026-10-03T00:00:00.000Z','2026-10-03T00:00:00.000Z')", [JSON.stringify({ proxyUrl: 'http://dummy-pool.invalid', noProxy: '', strictProxy: true, type: 'http' })]);
      db.run("UPDATE providerConnections SET data=? WHERE id='c'", [JSON.stringify({ apiKey: 'dummy-provider', providerSpecificData: { proxyPoolId: 'p' } })]);
    });
    const context = await createAccounting();
    const proxyOptions = { connectionProxyEnabled: true, connectionProxyUrl: 'http://dummy-pool.invalid', connectionNoProxy: '', strictProxy: true, proxyPoolId: 'p' };
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      expect(wire.proxyOptions).toEqual(proxyOptions);
      const work = context.beforeAttempt(meta, supported, wire);
      proxyOptions.connectionProxyUrl = 'http://changed-original.invalid'; return work;
    } };
    network.mockImplementation(async (_url, _options, actualProxy) => {
      expect(actualProxy).not.toBe(proxyOptions); expect(actualProxy.connectionProxyUrl).toBe('http://dummy-pool.invalid'); return response();
    });
    expect((await executor().execute({ ...args(accounting), proxyOptions })).response.ok).toBe(true);
    expect(network).toHaveBeenCalledTimes(1); expect(db.get('SELECT state FROM apiKeyAccounting').state).toBe('settled');
  });
  it('selected pool changed during queue wait refuses after original resolved equality', async () => {
    db.durableTransaction(() => {
      db.run("INSERT INTO proxyPools(id,isActive,data,createdAt,updatedAt) VALUES('p',1,?,'2026-10-03T00:00:00.000Z','2026-10-03T00:00:00.000Z')", [JSON.stringify({ proxyUrl: 'http://dummy-pool.invalid', noProxy: '', strictProxy: true, type: 'http' })]);
      db.run("UPDATE providerConnections SET data=? WHERE id='c'", [JSON.stringify({ apiKey: 'dummy-provider', providerSpecificData: { proxyPoolId: 'p' } })]);
    });
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      const work = context.beforeAttempt(meta, supported, wire);
      db.durableTransaction(() => db.run("UPDATE proxyPools SET data=? WHERE id='p'", [JSON.stringify({ proxyUrl: 'http://changed.invalid', noProxy: '', strictProxy: true, type: 'http' })]));
      return work;
    } };
    await expect(executor().execute({ ...args(accounting), proxyOptions: { connectionProxyEnabled: true, connectionProxyUrl: 'http://dummy-pool.invalid',
      connectionNoProxy: '', strictProxy: true, proxyPoolId: 'p' } })).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('missing prepared wire cannot bypass the queued Base equality guard', async () => {
    const context = await createAccounting();
    await expect(context.beforeAttempt({ provider: 'openai', model: 'fixture-chat', endpoint: 'chat', connectionId: 'c' }, true)).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
  });
  it('request abort during queue wait preserves exact false reason and zero POST', async () => {
    const ctrl = new AbortController(), context = await createAccounting('a', ctrl.signal);
    const accounting = { ...context, beforeAttempt(meta, supported, wire) { const work = context.beforeAttempt(meta, supported, wire); ctrl.abort(false); return work; } };
    await expect(executor().execute(args(accounting, ctrl.signal))).rejects.toBe(false);
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
  });
  it('held queued settlement ACK cannot release successful native response', async () => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, async completeAttempt(attempt, terminal) { enter(); await held; return context.completeAttempt(attempt, terminal); } };
    network.mockResolvedValue(response()); let finished = false;
    const work = executor().execute(args(accounting)).then(result => { finished = true; return result; });
    await entered; expect(finished).toBe(false); expect(db.get('SELECT state FROM apiKeyAccounting').state).toBe('pending');
    release(); expect((await work).response.ok).toBe(true); expect(db.get('SELECT state FROM apiKeyAccounting').state).toBe('settled');
  });
});
