import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

let db, directory, createAccounting;
const old = process.env.DATA_DIR;
const meta = { provider: 'fixture', model: 'fixture', endpoint: 'chat', connectionId: 'fixture-connection' };
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-queued-request-')); process.env.DATA_DIR = directory; delete global._dbAdapter; vi.resetModules();
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'key-a', key: 'dummy-queued-key' }], settings: { requireApiKey: true },
    providerConnections: [{ id: 'fixture-connection', provider: 'fixture', authType: 'apikey', isActive: true, apiKey: 'dummy-provider-key' }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','fixture',?)", [JSON.stringify({ fixture: { input: '1', output: '2' } })]);
  });
  createAccounting = options => import('@/lib/apiKeyBudget/requestAccounting.js').then(m => m.createRequestAccounting(new Request('http://localhost/v1/chat/completions', {
    headers: { Authorization: 'Bearer dummy-queued-key' }, signal: options?.signal }), { adapter: async () => db, queued: true }));
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true }); if (old === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = old; });

describe('request-local queued caller/config authority candidate (not upstream transport proof)', () => {
  it('opt-in request path batches intents and returns only after own ACK', async () => {
    const first = await createAccounting(), second = await createAccounting(), durable = vi.spyOn(db, 'durableTransaction');
    const a = first.beforeAttempt(meta, true), b = second.beforeAttempt(meta, true);
    expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
    const attempts = await Promise.all([a, b]); expect(attempts[0].requestId).not.toBe(attempts[1].requestId); expect(durable).toHaveBeenCalledTimes(1);
  });
  it('credential rotation during wait refuses instead of reusing stable ID as caller authority', async () => {
    const context = await createAccounting(), work = context.beforeAttempt(meta, true);
    db.durableTransaction(() => db.run("UPDATE apiKeys SET key='dummy-replaced' WHERE id='key-a'"));
    await expect(work).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' }); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
  });
  it('settings mutation during wait refuses stale config without manufacturing exemption', async () => {
    const context = await createAccounting(), work = context.beforeAttempt(meta, true);
    db.durableTransaction(() => db.run("UPDATE settings SET data=? WHERE id=1", [JSON.stringify({ requireApiKey: false })]));
    await expect(work).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' }); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
  });
  it.each(['disable', 'credentials', 'delete'])('connection %s during wait refuses original detached wire authority', async change => {
    const context = await createAccounting(), work = context.beforeAttempt(meta, true);
    db.durableTransaction(() => {
      if (change === 'disable') db.run("UPDATE providerConnections SET isActive=0 WHERE id='fixture-connection'");
      if (change === 'delete') db.run("DELETE FROM providerConnections WHERE id='fixture-connection'");
      if (change === 'credentials') db.run("UPDATE providerConnections SET data=? WHERE id='fixture-connection'", [JSON.stringify({ apiKey: 'dummy-rotated' })]);
    });
    await expect(work).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' }); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
  });
  it.each(['binding-delete', 'binding-retire', 'key-disable', 'ledger-change'])('%s during wait refuses without unlimited gap permission', async change => {
    const context = await createAccounting(), work = context.beforeAttempt(meta, true);
    db.durableTransaction(() => {
      if (change === 'binding-delete') db.run("DELETE FROM apiKeyBindings WHERE apiKeyId='key-a'");
      if (change === 'binding-retire') db.run("UPDATE apiKeyBindings SET retiredAt='2026-10-03T01:00:00.000Z' WHERE apiKeyId='key-a'");
      if (change === 'key-disable') db.run("UPDATE apiKeys SET isActive=0 WHERE id='key-a'");
      if (change === 'ledger-change') db.run("UPDATE _meta SET value='2026-10-03T01:00:00.000Z' WHERE key='ledgerStartedAt'");
    });
    await expect(work).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('key-a').gaps).toHaveLength(0);
  });
  it.each(['change', 'delete'])('selected proxy pool %s during wait refuses, never chooses direct fallback', async change => {
    db.durableTransaction(() => {
      db.run("INSERT INTO proxyPools(id,isActive,data,createdAt,updatedAt) VALUES('p',1,'{}','2026-10-03T00:00:00.000Z','2026-10-03T00:00:00.000Z')");
      db.run("UPDATE providerConnections SET data=? WHERE id='fixture-connection'", [JSON.stringify({ apiKey: 'dummy-provider-key', providerSpecificData: { proxyPoolId: 'p' } })]);
    });
    const context = await createAccounting(), work = context.beforeAttempt(meta, true);
    db.durableTransaction(() => {
      if (change === 'change') db.run("UPDATE proxyPools SET data=? WHERE id='p'", [JSON.stringify({ proxyUrl: 'http://dummy.invalid' })]);
      else db.run("DELETE FROM proxyPools WHERE id='p'");
    });
    await expect(work).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('key-a').gaps).toHaveLength(0);
  });
  it('request signal abort before dequeue removes work and preserves primitive false reason', async () => {
    const ctrl = new AbortController(), context = await createAccounting({ signal: ctrl.signal }), work = context.beforeAttempt(meta, true);
    ctrl.abort(false); await expect(work).rejects.toBe(false); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
  });
  it('terminal is still debited from original snapshot when connection/config changes after dispatch', async () => {
    const context = await createAccounting(), attempt = await context.beforeAttempt(meta, true);
    db.durableTransaction(() => { db.run("DELETE FROM providerConnections WHERE id='fixture-connection'"); db.run("UPDATE settings SET data='{}' WHERE id=1"); });
    const result = await context.completeAttempt(attempt, { usage: { exact: true, input: 1000000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, reasoningIncludedInOutput: true } });
    expect(result).toMatchObject({ state: 'settled', costNanoUsd: '1000000000' });
  });
});
