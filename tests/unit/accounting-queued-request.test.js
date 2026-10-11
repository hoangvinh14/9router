import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

let db, directory, createAccounting, previousCatalogSource;
const old = process.env.DATA_DIR;
const meta = { provider: 'fixture', model: 'fixture', endpoint: 'chat', connectionId: 'fixture-connection' };
beforeEach(async () => {
  previousCatalogSource = globalThis.__9rCatalogSource;
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
afterEach(() => { if (previousCatalogSource === undefined) delete globalThis.__9rCatalogSource;
  else globalThis.__9rCatalogSource = previousCatalogSource;
  vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true }); if (old === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = old; });

describe('request-local queued caller/config authority candidate (not upstream transport proof)', () => {
  const routingLeaf = async token => ({ id: token, kind: 'leaf', provider: 'fixture', model: 'fixture', evidence: {} });
  it('captured routing material permits unchanged own queued intent ACK', async () => {
    const context = await createAccounting();
    expect((await context.captureRoutingGraph('fixture', routingLeaf)).count).toBe(1);
    const attempt = await context.beforeAttempt(meta, true);
    expect(attempt.requestId).toBe(context.requestId);
    expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [attempt.attemptId])).toEqual({ state: 'pending' });
    await expect(context.captureRoutingGraph('fixture', routingLeaf)).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
  });
  it('concrete target absent from captured graph refuses before intent even with unchanged DB', async () => {
    const context = await createAccounting(); await context.captureRoutingGraph('fixture', routingLeaf);
    await expect(context.beforeAttempt({ ...meta, model: 'not-captured' }, true)).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('key-a').gaps).toHaveLength(0);
  });
  it.each(['combo', 'alias', 'provider-node'])('routing %s drift while queued refuses at dequeue with no intent/gap', async change => {
    await (await import('@/lib/db/repos/combosRepo.js')).createCombo({ name: 'routing-combo', models: ['fixture'] });
    await (await import('@/lib/db/repos/nodesRepo.js')).createProviderNode({ id: 'routing-node', type: 'openai-compatible', name: 'fixture node', prefix: 'fixture-node', baseUrl: 'http://fixture.invalid/chat' });
    const context = await createAccounting(); await context.captureRoutingGraph('fixture', routingLeaf);
    const work = context.beforeAttempt(meta, true);
    // Synchronous edit after enqueue, before its microtask-owned transaction.
    db.durableTransaction(() => {
      if (change === 'combo') db.run('UPDATE combos SET models=? WHERE name=?', ['["new-fixture"]', 'routing-combo']);
      if (change === 'alias') db.run("INSERT INTO kv(scope,key,value) VALUES('modelAliases','routing-alias','\"fixture/new\"')");
      if (change === 'provider-node') db.run('UPDATE providerNodes SET data=? WHERE id=?', ['{"prefix":"changed"}', 'routing-node']);
    });
    await expect(work).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('key-a').gaps).toHaveLength(0);
  });
  it('installed catalog edit after enqueue refuses at dequeue without intent or gap', async () => {
    const catalog = await import('../../open-sse/providers/catalogOverride.js');
    fs.writeFileSync(catalog.CATALOG_FILE, JSON.stringify({ models: {}, providers: {} }));
    await catalog.installCatalogSource();
    const context = await createAccounting(); await context.captureRoutingGraph('fixture', routingLeaf);
    const work = context.beforeAttempt(meta, true);
    fs.writeFileSync(catalog.CATALOG_FILE, JSON.stringify({ models: { 'fixture:fixture': { vision: true } }, providers: {} }));
    await expect(work).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
    expect(db.coverage.status('key-a').gaps).toHaveLength(0);
  });
  it('capacity policy edit after enqueue refuses at dequeue without intent or gap', async () => {
    const settings = await import('@/lib/db/repos/settingsRepo.js');
    await settings.updateSettings({ capacityAdapter: { vision: { enabled: true, models: ['openai/vision-model'] } } });
    const { createAccountingRoutingResolver } = await import('../../src/sse/services/accountingRoutingResolver.js');
    const original = { model: 'fixture/fixture', stream: false, messages: [{ role: 'user', content: 'original text' }] };
    const context = await createAccounting();
    await context.captureRoutingGraph(original.model, createAccountingRoutingResolver(original));
    const work = context.beforeAttempt(meta, true);
    // The member is queued but has not begun its microtask-owned transaction.
    db.durableTransaction(() => db.run('UPDATE settings SET data=? WHERE id=1', [JSON.stringify({ requireApiKey: true,
      capacityAdapter: { vision: { enabled: false, models: ['openai/vision-model'] } } })]));
    await expect(work).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
    expect(db.coverage.status('key-a').gaps).toHaveLength(0);
  });
  it('capacity drift after admission preserves original money and blocks fresh successor', async () => {
    const settings = await import('@/lib/db/repos/settingsRepo.js');
    await settings.updateSettings({ capacityAdapter: { vision: { enabled: true, models: ['openai/vision-model'] } } });
    const { createAccountingRoutingResolver } = await import('../../src/sse/services/accountingRoutingResolver.js');
    const original = { model: 'fixture/fixture', stream: false, messages: [{ role: 'user', content: 'original text' }] };
    const context = await createAccounting();
    await context.captureRoutingGraph(original.model, createAccountingRoutingResolver(original));
    const attempt = await context.beforeAttempt(meta, true);
    expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [attempt.attemptId]).state).toBe('pending');
    await settings.updateSettings({ capacityAdapter: { vision: { enabled: true, models: ['openai/another-vision-model'] } } });
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='fixture'",
      [JSON.stringify({ fixture: { input: '9', output: '9' } })]));
    const terminal = await context.completeAttempt(attempt, { usage: { exact: true, input: 1000000, output: 0,
      cacheRead: 0, cacheWrite: 0, reasoning: 0, reasoningIncludedInOutput: true } });
    expect(terminal).toMatchObject({ state: 'settled', costNanoUsd: '1000000000' });
    await expect(context.beforeAttempt(meta, true)).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(db.all('SELECT attemptId,state,costNanoUsd FROM apiKeyAccounting')).toEqual([
      { attemptId: attempt.attemptId, state: 'settled', costNanoUsd: 1000000000 } ]);
    expect(db.coverage.status('key-a').gaps).toHaveLength(0);
  });
  it('routing drift after admission retains original completion but refuses fresh successor', async () => {
    const context = await createAccounting(); await context.captureRoutingGraph('fixture', routingLeaf);
    const attempt = await context.beforeAttempt(meta, true);
    db.durableTransaction(() => db.run("INSERT INTO kv(scope,key,value) VALUES('modelAliases','new-alias','\"fixture/new\"')"));
    expect(await context.completeAttempt(attempt, { usage: { exact: true, input: 1000000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, reasoningIncludedInOutput: true } }))
      .toMatchObject({ state: 'settled', costNanoUsd: '1000000000' });
    await expect(context.beforeAttempt(meta, true)).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(1);
  });
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
