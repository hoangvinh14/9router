import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireWriterOwnership } from '@/lib/db/writerOwnership.js';
import { createNodeSqliteAdapter } from '@/lib/db/adapters/nodeSqliteAdapter.js';
import { createSqlJsAdapter } from '@/lib/db/adapters/sqljsAdapter.js';
import { runMigrationOnce } from '@/lib/db/migrate.js';
import { openAccountingCoverage } from '@/lib/db/accountingCoverage.js';
import { retainKeyBindings } from '@/lib/db/helpers/apiKeyBindings.js';
import { createBudgetContext } from '@/lib/apiKeyBudget/service.js';
import { getAccountingWriteCoordinator } from '@/lib/apiKeyBudget/accountingWriteCoordinator.js';

let directory, file, owner, db, coordinator;
const timestamp = '2026-10-03T00:00:00.000Z';
const candidate = { provider: 'fixture', model: 'fixture' };
const usage = { exact: true, input: 1000000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, reasoningIncludedInOutput: true };
const open = engine => engine === 'node:sqlite' ? createNodeSqliteAdapter(file, owner) : createSqlJsAdapter(file, owner);
async function setup(engine, budgeted = true) {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-queued-durable-')); fs.mkdirSync(path.join(directory, 'db')); file = path.join(directory, 'db/data.sqlite');
  owner = acquireWriterOwnership(directory); db = await open(engine); await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner); db.ownerInstanceId = owner.instanceId;
  db.durableTransaction(() => {
    const keys = ['a', 'b'].map(id => ({ id, key: `dummy-${id}` }));
    for (const key of keys) db.run('INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES(?,?,1,?)', [key.id, key.key, timestamp]);
    retainKeyBindings(db, db.coverage, keys);
    // Explicit disposable fixture activation only, no production API introduced.
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt',?)", [timestamp]);
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','fixture',?)", [JSON.stringify({ fixture: { input: '1', output: '2' } })]);
  });
  coordinator = getAccountingWriteCoordinator(db);
  const project = vi.fn();
  const a = await createBudgetContext('a', { adapter: async () => db, clock: () => timestamp, project });
  const b = await createBudgetContext('b', { adapter: async () => db, clock: () => timestamp, project });
  if (budgeted) for (const context of [a, b]) context.updatePolicy({ weeklyLimitUsd: '2', monthlyLimitUsd: null, expectedVersion: 0 });
  return { a, b, project };
}
afterEach(async () => { vi.restoreAllMocks(); await coordinator?.stop(); db?.close(); owner?.release(); if (directory) fs.rmSync(directory, { recursive: true, force: true }); });
function inject(engine, installed) {
  if (engine === 'node:sqlite') {
    const original = DatabaseSync.prototype.exec; let count = 0;
    vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function(sql) {
      if (sql.startsWith('RELEASE') && ++count === 3) { if (installed) original.call(this, sql); throw new Error('queued outer ACK fixture'); }
      return original.call(this, sql);
    });
  } else if (!installed) {
    const rename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (to === file) throw new Error('queued image ACK fixture'); return rename(from, to); });
  } else {
    const rename = fs.renameSync, sync = fs.fsyncSync; let renamed = false;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { const result = rename(from, to); if (to === file) renamed = true; return result; });
    vi.spyOn(fs, 'fsyncSync').mockImplementation(fd => { if (renamed && fs.fstatSync(fd).isDirectory()) throw new Error('queued directory ACK fixture'); return sync(fd); });
  }
}
describe('queued monetary service owned adapter ACK (not caller/config/transport proof)', { timeout: 20000 }, () => {
  it.each(['node:sqlite', 'sql.js'])('%s two-key original-snapshot settlements ACK before projection and one persist each group', async engine => {
    const { a, b, project } = await setup(engine), durable = vi.spyOn(db, 'durableTransaction'), rename = vi.spyOn(fs, 'renameSync');
    const [aa, bb] = await Promise.all([a.beginAttemptQueued(candidate), b.beginAttemptQueued(candidate)]);
    expect(durable).toHaveBeenCalledTimes(1); if (engine === 'sql.js') expect(rename.mock.calls.filter(([, to]) => to === file)).toHaveLength(1);
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='fixture'", [JSON.stringify({ fixture: { input: '99', output: '99' } })]));
    durable.mockClear(); rename.mockClear();
    project.mockImplementation((adapter, attemptId) => { expect(adapter).toBe(db); expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [attemptId]).state).toBe('settled'); });
    const [sa, sb] = await Promise.all([a.completeAttemptQueued(aa, { usage }), b.completeAttemptQueued(bb, { usage })]);
    expect([sa.costNanoUsd, sb.costNanoUsd]).toEqual(['1000000000', '1000000000']); expect(project).toHaveBeenCalledTimes(2); expect(durable).toHaveBeenCalledTimes(1);
    if (engine === 'sql.js') expect(rename.mock.calls.filter(([, to]) => to === file)).toHaveLength(1);
  });
  it.each(['node:sqlite', 'sql.js'])('%s fresh policy change while queued denies only affected key', async engine => {
    const { a, b } = await setup(engine);
    const pending = a.beginAttemptQueued(candidate); a.updatePolicy({ weeklyLimitUsd: '0', monthlyLimitUsd: null, expectedVersion: 1 });
    const neighbor = b.beginAttemptQueued(candidate);
    await expect(pending).rejects.toMatchObject({ code: 'api_key_budget_exceeded' }); await expect(neighbor).resolves.toMatchObject({ apiKeyId: 'b' });
    expect(db.all('SELECT apiKeyId FROM apiKeyAccounting')).toEqual([{ apiKeyId: 'b' }]);
  });
  it.each(['intent', 'settlement'].flatMap(stage => ['node:sqlite', 'sql.js'].flatMap(engine => [false, true].map(installed => [stage, engine, installed]))))('%s %s installed=%s budgeted uncertainty withholds every handle/terminal and projection', async (stage, engine, installed) => {
    const { a, b, project } = await setup(engine);
    const attempts = stage === 'settlement' ? await Promise.all([a.beginAttemptQueued(candidate), b.beginAttemptQueued(candidate)]) : null;
    inject(engine, installed);
    const results = await Promise.allSettled(stage === 'intent' ? [a.beginAttemptQueued(candidate), b.beginAttemptQueued(candidate)] : [a.completeAttemptQueued(attempts[0], { usage }), b.completeAttemptQueued(attempts[1], { usage })]);
    expect(results.every(result => result.status === 'rejected' && result.reason.code === 'api_key_accounting_unavailable')).toBe(true); expect(project).not.toHaveBeenCalled();
    expect(db.health()).toMatchObject({ healthy: false, poisoned: true });
    vi.restoreAllMocks(); await coordinator.stop(); db.close(); db = await open(engine);
    // Same live owner installed inspection, not restart recovery or past ACK.
    const rows = db.all('SELECT state,costNanoUsd FROM apiKeyAccounting');
    if (stage === 'intent') expect(rows).toEqual(installed ? [{ state: 'pending', costNanoUsd: null }, { state: 'pending', costNanoUsd: null }] : []);
    else expect(rows).toEqual(installed ? [{ state: 'settled', costNanoUsd: 1000000000 }, { state: 'settled', costNanoUsd: 1000000000 }] : [{ state: 'pending', costNanoUsd: null }, { state: 'pending', costNanoUsd: null }]);
    expect(owner.recoveredOwnerInstanceId).toBeFalsy();
  });
  it.each(['node:sqlite', 'sql.js'])('%s unlimited failed grouped intent requires separate durable per-key gap before unrecorded handle', async engine => {
    const { a, b, project } = await setup(engine, false); inject(engine, false);
    const attempts = await Promise.all([a.beginAttemptQueued(candidate), b.beginAttemptQueued(candidate)]);
    expect(attempts.every(attempt => attempt.unrecorded)).toBe(true); expect(project).not.toHaveBeenCalled();
    for (const key of ['a', 'b']) expect(db.coverage.status(key).gaps.some(gap => !gap.resolvedAt)).toBe(true);
  });
  it.each(['node:sqlite', 'sql.js'])('%s unlimited failed group plus failed gap ACK denies every handle', async engine => {
    const { a, b } = await setup(engine, false); inject(engine, false); vi.spyOn(db.coverage, 'latchGap').mockImplementation(() => { throw new Error('gap ACK fixture'); });
    const results = await Promise.allSettled([a.beginAttemptQueued(candidate), b.beginAttemptQueued(candidate)]);
    expect(results.every(result => result.status === 'rejected' && result.reason.code === 'api_key_accounting_unavailable')).toBe(true);
  });
});
