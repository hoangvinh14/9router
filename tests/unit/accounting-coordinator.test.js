import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openFixture, addKey, exactUsage } from '../fixtures/accounting/test-database.js';
import { createAccountingService } from '../../src/lib/accounting/service.js';
import { getAttemptSync } from '../../src/lib/db/repos/api-key-accounting-repo.js';
import { getWriteCoordinator, WRITE_LIMITS } from '../../src/lib/accounting/write-coordinator.js';
import { DatabaseSync } from 'node:sqlite';
import initSqlJs from 'sql.js';

let fixture;
afterEach(() => { vi.restoreAllMocks(); if (fixture) { try { fixture.db.close(); } catch {} fs.rmSync(fixture.root, { recursive: true, force: true }); fixture = null; } });
async function setup(engine) {
  fixture = await openFixture(engine); const { db } = fixture; addKey(db);
  db.durableTransaction(() => db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','openai',?)", [JSON.stringify({ fixture: { input: '1', output: '2' } })]));
  const service = createAccountingService(db);
  const context = service.createContext({ apiKeyId: 'key-one', validateAuthoritySync: () => true });
  return { db, service, context, candidate: { provider: 'openai', model: 'fixture', endpoint: 'chat' } };
}
for (const engine of ['node', 'sqljs']) describe(`${engine} fresh application and own ACK`, () => {
  it.each([
    ['activation', db => db.run("UPDATE apiKeys SET isActive=0 WHERE id='key-one'")],
    ['identity binding', db => db.run("UPDATE apiKeyBindings SET fingerprint=? WHERE apiKeyId='key-one'", ['f'.repeat(64)])],
    ['missing binding', db => db.run("DELETE FROM apiKeyBindings WHERE apiKeyId='key-one'")],
    ['ACL', db => db.run("UPDATE apiKeys SET accessRestricted=1 WHERE id='key-one'")],
    ['configuration', db => db.run("INSERT INTO settings(id,data) VALUES(1,'{}') ON CONFLICT(id) DO UPDATE SET data='{}'")],
    ['price', db => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='openai'", [JSON.stringify({ fixture: { input: '9', output: '2' } })])],
    ['coverage', db => db.coverage.enterMaintenance('restore')],
  ])('rechecks %s after queue await before intent mutation', async (_name, change) => {
    const { db, service, context, candidate } = await setup(engine);
    const pending = service.beginAttempt(context, candidate);
    expect(getWriteCoordinator(db).status().queued).toBe(1);
    db.durableTransaction(() => change(db));
    await expect(pending).rejects.toThrow(/authority|inactive|conflict|binding/);
    expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
  it('owns receipts, consumes dispatch once and keeps terminal sink after config changes', async () => {
    const { db, service, context, candidate } = await setup(engine);
    const receipt = await service.beginAttempt(context, candidate);
    expect(() => service.assertDispatchAuthority({ ...receipt }, context)).toThrow(/ACK/);
    expect(service.assertDispatchAuthority(receipt, context)).toBe(true);
    expect(() => service.assertDispatchAuthority(receipt, context)).toThrow(/consumed/);
    db.durableTransaction(() => db.run("UPDATE apiKeys SET isActive=0 WHERE id='key-one'"));
    const result = await service.completeAttempt(receipt, { state: 'settled', outcome: 'success', finishedAt: new Date().toISOString(), usage: exactUsage() });
    expect(result.kind).toBe('terminal'); expect(getAttemptSync(db, receipt.attemptId).costNanoUsd).toBe('1200000');
    await expect(service.completeAttempt({ ...receipt }, { state: 'unresolved' })).rejects.toThrow(/ACK/);
  });
  it('preserves cancellation reason, refuses own ACK on lost group return, and never authorizes from a visible row', async () => {
    const { db, service, context, candidate } = await setup(engine);
    const controller = new AbortController(), reason = new Error('client chose to cancel');
    const pending = service.beginAttempt(context, candidate, { signal: controller.signal }); controller.abort(reason);
    await expect(pending).rejects.toBe(reason); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
    const durable = db.durableTransaction;
    vi.spyOn(db, 'durableTransaction').mockImplementationOnce(fn => { durable(fn); throw new Error('own ACK lost'); });
    await expect(service.beginAttempt(context, candidate)).rejects.toThrow('own ACK lost');
    const row = db.get('SELECT attemptId FROM apiKeyAccounting'); expect(row).toBeTruthy();
    expect(() => service.assertDispatchAuthority({ attemptId: row.attemptId, kind: 'intent' }, context)).toThrow(/ACK/);
    await expect(service.beginAttempt(context, candidate)).rejects.toThrow(/unavailable/);
  });
  it('records estimated or missing usage as unresolved with null cost', async () => {
    const { db, service, context, candidate } = await setup(engine);
    const receipt = await service.beginAttempt(context, candidate);
    const result = await service.completeAttempt(receipt, { state: 'settled', outcome: 'unknown_usage', finishedAt: new Date().toISOString(), usage: { exact: false, input: 1000 } });
    expect(result.state).toBe('unresolved'); expect(getAttemptSync(db, receipt.attemptId).costNanoUsd).toBeNull();
  });
  it('refuses stale post-ACK dispatch and applies interleaved keys with independent authority', async () => {
    const { db, service, context, candidate } = await setup(engine);
    addKey(db, 'key-two', 'other-secret');
    const other = service.createContext({ apiKeyId: 'key-two', validateAuthoritySync: () => true });
    const first = service.beginAttempt(context, candidate), second = service.beginAttempt(other, candidate);
    db.durableTransaction(() => db.run("UPDATE apiKeys SET isActive=0 WHERE id='key-one'"));
    await expect(first).rejects.toThrow(/inactive/);
    const receipt = await second;
    expect(db.all('SELECT apiKeyId FROM apiKeyAccounting')).toEqual([{ apiKeyId: 'key-two' }]);
    db.durableTransaction(() => db.run("UPDATE apiKeys SET accessRestricted=1 WHERE id='key-two'"));
    expect(() => service.assertDispatchAuthority(receipt, other)).toThrow(/authority/);
  });
  it('does not erase recorded intent when cancellation happens during application', async () => {
    const { db, service, context, candidate } = await setup(engine);
    const controller = new AbortController();
    const run = db.run;
    vi.spyOn(db, 'run').mockImplementation((sql, params) => {
      const result = run(sql, params);
      if (sql.startsWith('INSERT INTO apiKeyAccounting(')) controller.abort(new Error('abort during application'));
      return result;
    });
    const receipt = await service.beginAttempt(context, candidate, { signal: controller.signal });
    expect(controller.signal.aborted).toBe(true);
    expect(getAttemptSync(db, receipt.attemptId).state).toBe('pending');
  });
  it('poisons every accounting member on actual inner RELEASE uncertainty', async () => {
    const { db, service, context, candidate } = await setup(engine);
    const prototype = engine === 'node' ? DatabaseSync.prototype : (await initSqlJs()).Database.prototype;
    const exec = prototype.exec;
    let injected = false;
    vi.spyOn(prototype, 'exec').mockImplementation(function (sql, ...args) {
      const result = exec.call(this, sql, ...args);
      if (!injected && sql.startsWith('RELEASE sp_1_')) { injected = true; throw new Error('inner RELEASE ACK uncertain'); }
      return result;
    });
    const results = await Promise.allSettled([service.beginAttempt(context, candidate), service.beginAttempt(context, candidate)]);
    expect(injected).toBe(true); expect(results.every(result => result.status === 'rejected')).toBe(true);
    expect(db.health().healthy).toBe(false); expect(getWriteCoordinator(db).status().poisoned).toBe(true);
    expect(() => db.get('SELECT * FROM apiKeyAccounting')).toThrow();
    expect(() => db.close()).toThrow(/Uncertain/);
    expect(fs.existsSync(`${fixture.root}/.gateway-writer.lock`)).toBe(true);
    // Fixture-only disposal after proving production close retains exclusion.
    vi.restoreAllMocks(); db.beforeClose = undefined; db.close();
  });
});
describe('bounded coordinator', () => {
  it('enforces count and operation bytes, yields bounded groups and stops without network waits', async () => {
    fixture = await openFixture('node'); const { db } = fixture;
    const groups = [];
    const writer = getWriteCoordinator(db, commands => { groups.push(commands.length); return commands.map(() => ({ ok: true, value: 'ack' })); });
    const pending = Array.from({ length: WRITE_LIMITS.queueCount }, (_, i) => writer.enqueue({ i }));
    await expect(writer.enqueue({ overflow: true })).rejects.toThrow(/capacity/);
    await expect(writer.enqueue({ bytes: 'x'.repeat(20000) })).rejects.toThrow(/capacity/);
    await Promise.all(pending); expect(Math.max(...groups)).toBeLessThanOrEqual(WRITE_LIMITS.groupCount);
    const queued = writer.enqueue({ last: true }); await writer.stop(); await expect(queued).rejects.toThrow(/closing/);
    expect(writer.status()).toMatchObject({ queued: 0, bytes: 0, stopped: true });
  });
  it('bounds retained queue/group bytes and detaches caller data', async () => {
    fixture = await openFixture('node'); const groups = [];
    const writer = getWriteCoordinator(fixture.db, commands => { groups.push(commands); return commands.map(() => ({ ok: true })); });
    const input = { payload: 'x'.repeat(15000) }, pending = [];
    while (writer.status().bytes + 31000 <= WRITE_LIMITS.queueBytes) pending.push(writer.enqueue(input));
    expect(writer.status().queued).toBeLessThan(WRITE_LIMITS.queueCount);
    await expect(writer.enqueue({ payload: 'x'.repeat(16000) })).rejects.toThrow(/capacity/);
    input.payload = 'mutated'; await Promise.all(pending);
    expect(groups.flat().every(command => command.payload.length === 15000)).toBe(true);
    expect(groups.every(commands => commands.reduce((sum, command) => sum + Buffer.byteLength(JSON.stringify(command)) * 2, 0) <= WRITE_LIMITS.groupBytes)).toBe(true);
  });
  it.each([undefined, [], [{ ok: 'yes' }]])('refuses all ACKs from malformed group result %j', async result => {
    fixture = await openFixture('node');
    const writer = getWriteCoordinator(fixture.db, () => result);
    await expect(writer.enqueue({ operation: 'one' })).rejects.toThrow(/Malformed/);
    expect(writer.status()).toMatchObject({ poisoned: true, stopped: true });
    await expect(writer.enqueue({ operation: 'two' })).rejects.toThrow(/unavailable/);
  });
});
