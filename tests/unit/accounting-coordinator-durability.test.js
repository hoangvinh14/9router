import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireWriterOwnership } from '@/lib/db/writerOwnership.js';
import { createNodeSqliteAdapter } from '@/lib/db/adapters/nodeSqliteAdapter.js';
import { createSqlJsAdapter } from '@/lib/db/adapters/sqljsAdapter.js';
import { runMigrationOnce } from '@/lib/db/migrate.js';
import { getAccountingWriteCoordinator } from '@/lib/apiKeyBudget/accountingWriteCoordinator.js';
import { costFromExactUsage } from '@/lib/pricing/money.js';

let directory, file, owner, db, coordinator;
const timestamp = '2026-10-03T00:00:00.000Z';
const usage = { exact: true, input: 500000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, reasoningIncludedInOutput: true };
const priceSnapshot = { rates: { input: '0.000000001', output: '0' } };
const input = id => ({ attemptId: id, requestId: `request-${id}`, apiKeyId: `key-${id}`, ownerInstanceId: owner.instanceId, provider: 'fixture', model: 'fixture', endpoint: 'chat', startedAt: timestamp, priceSnapshot });
const insert = id => ({ type: 'insert', input: input(id) });
const open = engine => engine === 'node:sqlite' ? createNodeSqliteAdapter(file, owner) : createSqlJsAdapter(file, owner);
async function setup(engine) {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-coordinator-durable-')); fs.mkdirSync(path.join(directory, 'db')); file = path.join(directory, 'db/data.sqlite');
  owner = acquireWriterOwnership(directory); db = await open(engine); await runMigrationOnce(db); coordinator = getAccountingWriteCoordinator(db);
}
afterEach(async () => { vi.restoreAllMocks(); await coordinator?.stop(); db?.close(); owner?.release(); fs.rmSync(directory, { recursive: true, force: true }); });
function inject(engine, installed) {
  if (engine === 'node:sqlite') {
    const original = DatabaseSync.prototype.exec; let releases = 0;
    vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function(sql) {
      // Two member savepoint releases precede the outer durability boundary.
      if (sql.startsWith('RELEASE') && ++releases === 3) { if (installed) original.call(this, sql); throw new Error('group outer RELEASE ACK fixture'); }
      return original.call(this, sql);
    });
  } else if (!installed) {
    const rename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (to === file) throw new Error('group rename fixture'); return rename(from, to); });
  } else {
    const rename = fs.renameSync, sync = fs.fsyncSync; let renamed = false;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { const result = rename(from, to); if (to === file) renamed = true; return result; });
    vi.spyOn(fs, 'fsyncSync').mockImplementation(fd => { if (renamed && fs.fstatSync(fd).isDirectory()) throw new Error('group directory ACK fixture'); return sync(fd); });
  }
}
describe('actual owned Node/SQL.js queue→group ACK (not inference admission)', { timeout: 20000 }, () => {
  it.each(['node:sqlite', 'sql.js'])('%s coalesces intents/settlements, retains original rates and per-attempt rounding after reopen', async engine => {
    await setup(engine); const durable = vi.spyOn(db, 'durableTransaction'), rename = vi.spyOn(fs, 'renameSync');
    let ack = false;
    const a = coordinator.enqueue(insert('a')).then(value => { ack = true; return value; }); const b = coordinator.enqueue(insert('b'));
    expect(ack).toBe(false); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
    const attempts = await Promise.all([a, b]); expect(durable).toHaveBeenCalledTimes(1);
    if (engine === 'sql.js') expect(rename.mock.calls.filter(([, to]) => to === file)).toHaveLength(1);
    db.durableTransaction(() => db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','fixture',?)", [JSON.stringify({ fixture: { input: '99', output: '99' } })]));
    durable.mockClear(); rename.mockClear();
    const results = await Promise.all(attempts.map(attempt => coordinator.enqueue({ type: 'finalize', attemptId: attempt.attemptId,
      terminal: { state: 'settled', outcome: 'success', finishedAt: timestamp, usage, costNanoUsd: costFromExactUsage(usage, attempt.priceSnapshot.rates) } })));
    expect(results.map(row => row.costNanoUsd)).toEqual(['1', '1']); expect(durable).toHaveBeenCalledTimes(1);
    if (engine === 'sql.js') expect(rename.mock.calls.filter(([, to]) => to === file)).toHaveLength(1);
    vi.restoreAllMocks(); await coordinator.stop(); db.close(); db = await open(engine);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting ORDER BY attemptId')).toEqual([{ state: 'settled', costNanoUsd: 1 }, { state: 'settled', costNanoUsd: 1 }]);
    expect(getAccountingWriteCoordinator(db)).not.toBe(coordinator); expect(db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined();
  });
  it.each([['node:sqlite', false], ['node:sqlite', true], ['sql.js', false], ['sql.js', true]])('%s installed=%s outer uncertainty rejects every member and does not retry', async (engine, installed) => {
    await setup(engine); inject(engine, installed);
    const results = await Promise.allSettled([coordinator.enqueue(insert('a')), coordinator.enqueue(insert('b'))]);
    expect(results.every(result => result.status === 'rejected')).toBe(true); expect(db.health()).toMatchObject({ healthy: false, poisoned: true });
    vi.restoreAllMocks(); await coordinator.stop(); db.close(); db = await open(engine);
    // Same live owner installed inspection, not proof of prior ACK or dead-owner recovery.
    expect(db.all('SELECT attemptId,state FROM apiKeyAccounting ORDER BY attemptId')).toEqual(installed ? [{ attemptId: 'a', state: 'pending' }, { attemptId: 'b', state: 'pending' }] : []);
    expect(owner.recoveredOwnerInstanceId).toBeFalsy(); expect(db.all('SELECT * FROM usageHistory')).toHaveLength(0);
  });
});
