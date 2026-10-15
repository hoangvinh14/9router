import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { retainKeyBindings } from '@/lib/db/helpers/apiKeyBindings.js';
import { getAccountingWriteCoordinator } from '@/lib/apiKeyBudget/accountingWriteCoordinator.js';
const network = vi.hoisted(() => vi.fn());
vi.mock('../../open-sse/config/providers.js', async importOriginal => ({ ...(await importOriginal()),
  PROVIDERS: { ...(await importOriginal()).PROVIDERS, openai: { baseUrl: 'http://fixture.invalid/chat' } } }));
vi.mock('../../open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => network(...args) }));
let db, directory, BaseExecutor, context;
const previousData = process.env.DATA_DIR;
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-unselected-proxy-')); process.env.DATA_DIR = directory; delete global._dbAdapter; vi.resetModules(); network.mockReset();
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  // Fresh disposable fixture only: saved-proxy equality is not config import/
  // export acceptance. Keep actual durable SQL, key binding and coordinator.
  const timestamp = '2026-10-03T00:00:00.000Z';
  const keys = [{ id: 'a', key: 'dummy-key', createdAt: timestamp }];
  db.durableTransaction(() => {
    if (db.get('SELECT id FROM apiKeys') || db.get('SELECT id FROM providerConnections') || db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")) throw new Error('Proxy fixture requires fresh disposable DB');
    db.run('INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES(?,?,1,?)', ['a', 'dummy-key', timestamp]);
    retainKeyBindings(db, db.coverage, keys);
    db.run('INSERT INTO settings(id,data) VALUES(1,?)', [JSON.stringify({ requireApiKey: true })]);
    db.run('INSERT INTO providerConnections(id,provider,authType,isActive,data,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)', ['c', 'openai', 'apikey', 1, JSON.stringify({ apiKey: 'dummy-provider' }), timestamp, timestamp]);
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt',?)", [timestamp]);
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','openai',?)", [JSON.stringify({ 'fixture-chat': { input: '1', output: '2' } })]);
  });
  ({ BaseExecutor } = await import('../../open-sse/executors/base.js'));
  const requestOwner = await import('@/lib/apiKeyBudget/requestAccounting.js');
  context = await requestOwner.createRequestAccounting(new Request('http://localhost/v1/chat/completions', {
    headers: { Authorization: 'Bearer dummy-key' } }), { adapter: async () => db, queued: true });
  network.mockImplementation(async () => Response.json({ choices: [{ message: { role: 'assistant', content: 'fixture' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }));
});
afterEach(async () => { vi.restoreAllMocks(); if (db) await getAccountingWriteCoordinator(db).stop(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true }); if (previousData === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previousData; });
const execute = (accounting, proxyOptions) => new BaseExecutor('openai', { baseUrl: 'http://fixture.invalid/chat', retry: { 502: { attempts: 0, delayMs: 0 } } }).execute({
  accounting, proxyOptions, connectionId: 'c', model: 'fixture-chat', stream: false, credentials: { apiKey: 'dummy-provider' }, body: { messages: [{ role: 'user', content: 'fixture' }] }
});
describe('queued original saved global/legacy proxy equality gaps (mock POST, not env/socket proof)', () => {
  it.each(['legacy', 'global'])('matching saved %s route survives detachment and settles own exact debit', async mode => {
    let options;
    db.durableTransaction(() => {
      if (mode === 'legacy') {
        db.run("UPDATE providerConnections SET data=? WHERE id='c'", [JSON.stringify({ apiKey: 'dummy-provider', providerSpecificData: { connectionProxyEnabled: true, connectionProxyUrl: 'http://dummy-saved.invalid', connectionNoProxy: '' } })]);
        options = { connectionProxyEnabled: true, connectionProxyUrl: 'http://dummy-saved.invalid', connectionNoProxy: '', strictProxy: false, proxyPoolId: null };
      } else {
        db.run("UPDATE settings SET data=? WHERE id=1", [JSON.stringify({ requireApiKey: true, outboundProxyEnabled: true, outboundProxyUrl: 'http://dummy-saved.invalid', outboundNoProxy: '' })]);
        options = { persistedGlobalProxy: { url: 'http://dummy-saved.invalid', noProxy: '' } };
      }
    });
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      const work = context.beforeAttempt(meta, supported, wire);
      if (mode === 'legacy') options.connectionProxyUrl = 'http://mutated-input.invalid';
      else options.persistedGlobalProxy.url = 'http://mutated-input.invalid';
      return work;
    } };
    const result = await execute(accounting, options);
    expect(result.response.ok).toBe(true); expect(network).toHaveBeenCalledTimes(1);
    const posted = network.mock.calls[0][2];
    expect(mode === 'legacy' ? posted.connectionProxyUrl : posted.persistedGlobalProxy.url).toBe('http://dummy-saved.invalid');
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: 200000 });
  });
  it.each(['legacy', 'global'])('saved %s route change during queue wait refuses zero POST and gap', async mode => {
    let options;
    const set = url => db.durableTransaction(() => {
      if (mode === 'legacy') db.run("UPDATE providerConnections SET data=? WHERE id='c'", [JSON.stringify({ apiKey: 'dummy-provider', providerSpecificData: { connectionProxyEnabled: true, connectionProxyUrl: url, connectionNoProxy: '' } })]);
      else db.run("UPDATE settings SET data=? WHERE id=1", [JSON.stringify({ requireApiKey: true, outboundProxyEnabled: true, outboundProxyUrl: url, outboundNoProxy: '' })]);
    });
    set('http://dummy-old.invalid');
    options = mode === 'legacy' ? { connectionProxyEnabled: true, connectionProxyUrl: 'http://dummy-old.invalid', connectionNoProxy: '', strictProxy: false, proxyPoolId: null }
      : { persistedGlobalProxy: { url: 'http://dummy-old.invalid', noProxy: '' } };
    const accounting = { ...context, beforeAttempt(meta, supported, wire) { const work = context.beforeAttempt(meta, supported, wire); set('http://dummy-new.invalid'); return work; } };
    await expect(execute(accounting, options)).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('saved legacy connection proxy changed before enqueue cannot authorize old resolved route', async () => {
    db.durableTransaction(() => db.run("UPDATE providerConnections SET data=? WHERE id='c'", [JSON.stringify({ apiKey: 'dummy-provider', providerSpecificData: { connectionProxyEnabled: true, connectionProxyUrl: 'http://dummy-old.invalid', connectionNoProxy: '' } })]));
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      db.durableTransaction(() => db.run("UPDATE providerConnections SET data=? WHERE id='c'", [JSON.stringify({ apiKey: 'dummy-provider', providerSpecificData: { connectionProxyEnabled: true, connectionProxyUrl: 'http://dummy-new.invalid', connectionNoProxy: '' } })]));
      return context.beforeAttempt(meta, supported, wire);
    } };
    await expect(execute(accounting, { connectionProxyEnabled: true, connectionProxyUrl: 'http://dummy-old.invalid', connectionNoProxy: '', strictProxy: false, proxyPoolId: null })).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('saved global proxy changed before enqueue cannot authorize old prepared saved policy', async () => {
    db.durableTransaction(() => db.run("UPDATE settings SET data=? WHERE id=1", [JSON.stringify({ requireApiKey: true, outboundProxyEnabled: true, outboundProxyUrl: 'http://dummy-old.invalid', outboundNoProxy: '' })]));
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      db.durableTransaction(() => db.run("UPDATE settings SET data=? WHERE id=1", [JSON.stringify({ requireApiKey: true, outboundProxyEnabled: true, outboundProxyUrl: 'http://dummy-new.invalid', outboundNoProxy: '' })]));
      return context.beforeAttempt(meta, supported, wire);
    } };
    await expect(execute(accounting, { persistedGlobalProxy: { url: 'http://dummy-old.invalid', noProxy: '' } })).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
});
