import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNodeSqliteAdapter } from '../../src/lib/db/adapters/nodeSqliteAdapter.js';
import { createSqlJsAdapter } from '../../src/lib/db/adapters/sqljsAdapter.js';
import initial from '../../src/lib/db/migrations/001-initial.js';
import foundation, { verifyAccountingSchema, verifyLegacyAccountingSchema } from '../../src/lib/db/migrations/002-accounting-foundation.js';
import policy from '../../src/lib/db/migrations/003-accounting-policy.js';
import recorded from '../../src/lib/db/migrations/004-recorded-spend.js';
import { insertAttemptSync, finalizeAttemptSync } from '../../src/lib/db/repos/api-key-accounting-repo.js';
import { intent, exactUsage } from '../fixtures/accounting/test-database.js';

let db, root;
afterEach(() => { vi.restoreAllMocks(); db?.close(); db = null; if (root) fs.rmSync(root, { recursive: true, force: true }); });
async function legacy(engine) {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'b1-schema-'));
  db = await (engine === 'node' ? createNodeSqliteAdapter : createSqlJsAdapter)(path.join(root, 'data.sqlite'));
  db.ownerInstanceId = 'legacy-dead';
  db.durableTransaction(() => { initial.up(db); foundation.up(db); policy.up(db); });
  verifyLegacyAccountingSchema(db);
  return db;
}
for (const engine of ['node', 'sqljs']) describe(`${engine} B1 migration`, () => {
  it('preserves full ledger/audit/policies while mapping only abandoned rows without contrary evidence', async () => {
    await legacy(engine);
    for (const id of ['known', 'abandoned', 'legacy-interrupted', 'completed-absent', 'audit-contrary', 'persisted-usage']) insertAttemptSync(db, intent(db, id));
    finalizeAttemptSync(db, 'known', { state: 'settled', outcome: 'success', finishedAt: '2026-10-22T00:01:00.000Z', usage: exactUsage() });
    finalizeAttemptSync(db, 'legacy-interrupted', { state: 'unresolved', outcome: 'stream_unknown', finishedAt: '2026-10-22T00:01:00.000Z' });
    finalizeAttemptSync(db, 'completed-absent', { state: 'unresolved', outcome: 'http_200', finishedAt: '2026-10-22T00:01:00.000Z' });
    db.durableTransaction(() => {
      db.run("UPDATE apiKeyAccounting SET state='unresolved',outcome='network_unknown' WHERE attemptId IN ('abandoned','audit-contrary','persisted-usage')");
      db.run("UPDATE apiKeyAccounting SET usageJson=? WHERE attemptId='persisted-usage'", [JSON.stringify(exactUsage())]);
      db.run("INSERT INTO apiKeyAccountingAudit(id,attemptId,operationId,actor,reason,action,beforeJson,afterJson,createdAt) VALUES('audit','audit-contrary','write-failed','fixture','Known write failure','failure','{}','{}','2026-10-22T00:00:00.000Z')");
    });
    const before = db.all('SELECT * FROM apiKeyAccounting ORDER BY attemptId'), audit = db.all('SELECT * FROM apiKeyAccountingAudit'), policies = db.all('SELECT * FROM apiKeyBudgetPolicies');
    db.durableTransaction(() => recorded.up(db));
    verifyAccountingSchema(db);
    expect(db.all('SELECT * FROM apiKeyAccounting ORDER BY attemptId')).toEqual(before.map(row => ['abandoned','legacy-interrupted'].includes(row.attemptId) ? { ...row, state: 'unrecorded', resolutionVersion: row.resolutionVersion + 1 } : row));
    expect(db.all('SELECT * FROM apiKeyAccountingAudit')).toEqual(audit);
    expect(db.all('SELECT * FROM apiKeyBudgetPolicies')).toEqual(policies);
    expect(() => db.run("DELETE FROM apiKeyAccountingAudit")).toThrow(/append-only/);
    db.durableTransaction(() => recorded.up(db));
    expect(db.get("SELECT resolutionVersion FROM apiKeyAccounting WHERE attemptId='abandoned'").resolutionVersion).toBe(1);
    // Preserve historical terminal JSON without resurrecting recovery work on
    // replay; exact late evidence can still settle the original attempt once.
    const replay={state:'unresolved',outcome:'stream_unknown',finishedAt:'2026-10-22T00:01:00.000Z'};
    expect(finalizeAttemptSync(db,'legacy-interrupted',replay).state).toBe('unrecorded');
    const late={state:'settled',outcome:'late_usage',finishedAt:'2026-11-10T00:00:00.000Z',usage:exactUsage()};
    finalizeAttemptSync(db,'legacy-interrupted',late);finalizeAttemptSync(db,'legacy-interrupted',late);
    expect(db.get("SELECT state,costNanoUsd,startedAt FROM apiKeyAccounting WHERE attemptId='legacy-interrupted'")).toMatchObject({state:'settled',costNanoUsd:1200000,startedAt:'2026-10-22T00:00:00.000Z'});
  });
  it('rolls back the complete rebuild on a fault and permits a clean retry', async () => {
    await legacy(engine); insertAttemptSync(db, intent(db));
    const rows = db.all('SELECT * FROM apiKeyAccounting'), schema = db.all('SELECT type,name,sql FROM sqlite_master ORDER BY name');
    const original = db.exec.bind(db);
    const fault = vi.spyOn(db, 'exec').mockImplementation(sql => { if (sql === 'DROP TABLE accounting_b1_copy') throw new Error('rebuild fault'); return original(sql); });
    expect(() => db.durableTransaction(() => recorded.up(db))).toThrow('rebuild fault');
    expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual(rows);
    expect(db.all('SELECT type,name,sql FROM sqlite_master ORDER BY name')).toEqual(schema);
    fault.mockRestore(); db.durableTransaction(() => recorded.up(db)); verifyAccountingSchema(db);
  });
  it('replays the stamped historical chain and reaches a strict current schema', async () => {
    await legacy(engine);
    db.durableTransaction(() => db.run("INSERT INTO _meta(key,value) VALUES('schemaVersion','3')"));
    const { MIGRATIONS } = await import('../../src/lib/db/migrations/index.js');
    db.durableTransaction(() => {
      for (const migration of MIGRATIONS.filter(item => item.version > 3)) {
        migration.up(db);
        db.run("UPDATE _meta SET value=? WHERE key='schemaVersion'", [String(migration.version)]);
      }
    });
    expect(db.get("SELECT value FROM _meta WHERE key='schemaVersion'").value).toBe('4');
    verifyAccountingSchema(db);
  });
  it.each(['legacy','current'])('adopts only complete unstamped %s accounting images through the historical chain', async image => {
    await legacy(engine);
    insertAttemptSync(db, intent(db));
    if (image === 'current') db.durableTransaction(() => recorded.up(db));
    const original = db.all('SELECT * FROM apiKeyAccounting');
    const { MIGRATIONS } = await import('../../src/lib/db/migrations/index.js');
    db.durableTransaction(() => {
      for (const migration of MIGRATIONS) migration.up(db);
    });
    verifyAccountingSchema(db);
    expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual(original);
  });
  it('does not admit a hybrid accounting schema', async () => {
    await legacy(engine); db.durableTransaction(() => db.exec('DROP INDEX idx_accounting_key_state'));
    expect(() => db.durableTransaction(() => recorded.up(db))).toThrow(/index/);
  });
});
