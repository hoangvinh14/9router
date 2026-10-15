import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { createSqlJsAdapter } from '@/lib/db/adapters/sqljsAdapter.js';
import { acquireWriterOwnership } from '@/lib/db/writerOwnership.js';
import { openAccountingCoverage } from '@/lib/db/accountingCoverage.js';
import { runMigrationOnce } from '@/lib/db/migrate.js';
import { seedRecoveryAccountingFixture } from './fixtures/accounting-recovery-db.js';
let dir, db, owner;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), '9router-recovery-seed-'));
  owner = acquireWriterOwnership(dir); db = await createSqlJsAdapter(path.join(dir, 'data.sqlite'), owner);
  await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner); db.ownerInstanceId = owner.instanceId;
  expect(db.driver).toBe('sql.js');
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); owner?.release(); fs.rmSync(dir, { recursive: true, force: true }); });
describe('test-only recovery fresh fixture, actual SQL.js not managed import/restore', () => {
  it('retains exact durable identity/rates and refuses duplicate seed without replacing rows', () => {
    seedRecoveryAccountingFixture(db);
    const before = { keys: db.all('SELECT * FROM apiKeys'), bindings: db.all('SELECT * FROM apiKeyBindings'), meta: db.all('SELECT * FROM _meta'), rates: db.all('SELECT * FROM kv') };
    expect(before.keys).toMatchObject([{ id: 'key-a', key: 'recovery-secret', isActive: 1 }]);
    expect(before.bindings).toHaveLength(1); expect(before.bindings[0].apiKeyId).toBe('key-a');
    expect(db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'").value).toBe('2026-10-01T00:00:00.000Z');
    expect(JSON.parse(db.get("SELECT value FROM kv WHERE scope='pricing' AND key='fixture'").value)).toEqual({ fixture: { input: '1', output: '2' } });
    expect(() => seedRecoveryAccountingFixture(db)).toThrow('Recovery fixture requires fresh disposable DB');
    expect({ keys: db.all('SELECT * FROM apiKeys'), bindings: db.all('SELECT * FROM apiKeyBindings'), meta: db.all('SELECT * FROM _meta'), rates: db.all('SELECT * FROM kv') }).toEqual(before);
  });
  it('pre-aborted setup never enters durable seed or writes keys', () => {
    const controller = new AbortController(), failure = new Error('fixture cancellation'); controller.abort(failure);
    const durable = vi.spyOn(db, 'durableTransaction');
    expect(() => seedRecoveryAccountingFixture(db, controller.signal)).toThrow(failure);
    expect(durable).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeys')).toEqual([]);
  });
  it('abort at durable boundary refuses before first INSERT and preserves fresh seed availability', () => {
    const controller = new AbortController(), failure = new Error('fixture boundary cancellation');
    const durable = db.durableTransaction.bind(db);
    const spy = vi.spyOn(db, 'durableTransaction').mockImplementation(callback => { controller.abort(failure); return durable(callback); });
    expect(() => seedRecoveryAccountingFixture(db, controller.signal)).toThrow(failure);
    expect(spy).toHaveBeenCalledTimes(1); expect(db.all('SELECT * FROM apiKeys')).toEqual([]);
    expect(db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined();
    spy.mockRestore(); seedRecoveryAccountingFixture(db); expect(db.all('SELECT * FROM apiKeyBindings')).toHaveLength(1);
  });
});
