import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import initSqlJs from 'sql.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openFixture, addKey, intent, backupFixture } from '../fixtures/accounting/test-database.js';
import { insertAttemptSync } from '../../src/lib/db/repos/api-key-accounting-repo.js';
import { readAccountingPolicy } from '../../src/lib/db/helpers/accounting-policy.js';
import { verifyAccountingSchema } from '../../src/lib/db/migrations/002-accounting-foundation.js';
import { verifyAccountingPolicySchema } from '../../src/lib/db/helpers/accounting-policy.js';

let fixture;
afterEach(() => {
  vi.restoreAllMocks();
  if (fixture) {
    // Fixture disposal only, after proving the production close remains strict.
    fixture.db.beforeClose = undefined; fixture.db.close();
    fs.rmSync(fixture.root, { recursive: true, force: true }); fixture = null;
  }
});
function publicationFault(engine, after) {
  let injected = false;
  if (engine === 'sqljs') {
    const rename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (!injected && destination === fixture.file) {
        injected = true; if (after) rename(source, destination);
        throw new Error('recording publication lost ACK');
      }
      return rename(source, destination);
    });
  } else {
    const exec = DatabaseSync.prototype.exec;
    vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (sql, ...args) {
      if (!injected && sql.startsWith('RELEASE sp_0_')) {
        injected = true; if (after) exec.call(this, sql, ...args);
        throw new Error('recording publication lost ACK');
      }
      return exec.call(this, sql, ...args);
    });
  }
  return () => expect(injected).toBe(true);
}
for (const engine of ['node', 'sqljs']) describe(`${engine} private persisted accounting authority`, () => {
  it.each(['table', 'index', 'update trigger', 'delete trigger', 'policy'])('rejects a missing %s in a fresh schema proof', async kind => {
    fixture = await openFixture(engine); const { db } = fixture; addKey(db); backupFixture(db, fixture.file);
    expect(() => { verifyAccountingSchema(db); verifyAccountingPolicySchema(db); }).not.toThrow();
    const index = db.get("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='apiKeyAccounting' AND sql IS NOT NULL ORDER BY name LIMIT 1").name;
    const sql = { table: 'DROP TABLE apiKeyAccounting', index: `DROP INDEX ${index}`,
      'update trigger': 'DROP TRIGGER accounting_audit_no_update', 'delete trigger': 'DROP TRIGGER accounting_audit_no_delete',
      policy: 'DROP TABLE apiKeyBudgetPolicies' }[kind];
    db.durableTransaction(() => db.exec(sql));
    expect(() => { verifyAccountingSchema(db); verifyAccountingPolicySchema(db); }).toThrow();
    expect(() => db.withPersistedAccountingAuthority(() => true)).toThrow();
  });
  it('denies persisted proof after an escaped thenable transaction', async () => {
    fixture = await openFixture(engine); const { db } = fixture; addKey(db); backupFixture(db, fixture.file);
    expect(() => db.durableTransaction(() => Promise.resolve(true))).toThrow(/synchronous/);
    expect(() => db.withPersistedAccountingAuthority(() => true)).toThrow();
    expect(db.health().healthy).toBe(false);
  });
  it.each([false, true])('proves unchanged authority after recording publication failure after=%s without resurrecting its ACK', async after => {
    fixture = await openFixture(engine); const { db } = fixture; addKey(db); backupFixture(db, fixture.file);
    const injected = publicationFault(engine, after);
    expect(() => insertAttemptSync(db, intent(db))).toThrow('lost ACK'); injected();
    expect(db.health().healthy).toBe(false);
    expect(() => db.get('SELECT * FROM apiKeys')).toThrow();
    const before = fs.readFileSync(fixture.file);
    const result = db.withPersistedAccountingAuthority(reader => ({ key: reader.get("SELECT id FROM apiKeys WHERE id='key-one'").id, unlimited: readAccountingPolicy(reader, 'key-one').unlimited }));
    expect(result).toEqual({ key: 'key-one', unlimited: true });
    expect(fs.readFileSync(fixture.file).equals(before)).toBe(true);
    expect(db.coverage.latchGap('key-one', 'recording failure').gaps).toHaveLength(1);
    expect(() => db.close()).toThrow(/Uncertain/);
  });
  it('denies a failed publication that contains a new credential or policy', async () => {
    fixture = await openFixture(engine); const { db } = fixture; addKey(db); backupFixture(db, fixture.file);
    const injected = publicationFault(engine, true);
    expect(() => db.durableTransaction(() => db.run("UPDATE apiKeyBudgetPolicies SET weeklyLimitNanoUsd=0 WHERE apiKeyId='key-one'"))).toThrow('lost ACK'); injected();
    expect(() => db.withPersistedAccountingAuthority(() => true)).toThrow(/authority/);
  });
  it('invalidates persisted proof if engine close fails', async () => {
    fixture = await openFixture(engine); const { db } = fixture; addKey(db); backupFixture(db, fixture.file);
    const injected = publicationFault(engine, false);
    expect(() => insertAttemptSync(db, intent(db))).toThrow('lost ACK'); injected();
    expect(db.withPersistedAccountingAuthority(() => true)).toBe(true);
    expect(() => db.close()).toThrow(/Uncertain/);
    // Exercise the adapter-only close boundary after proving lifecycle refusal.
    db.beforeClose = undefined;
    const prototype = engine === 'node' ? DatabaseSync.prototype : (await initSqlJs()).Database.prototype;
    vi.spyOn(prototype, 'close').mockImplementationOnce(() => { throw new Error('engine close failed'); });
    expect(() => db.close()).toThrow('engine close failed');
    expect(db.health()).toMatchObject({ healthy: false, closed: false, owned: true });
    expect(() => db.withPersistedAccountingAuthority(() => true)).toThrow(/authority/);
    expect(() => db.get('SELECT * FROM apiKeys')).toThrow();
    expect(fs.existsSync(`${fixture.root}/.gateway-writer.lock`)).toBe(true);
  });
  it('opens a fresh snapshot for each proof and never exposes a writable reader', async () => {
    fixture = await openFixture(engine); const { db } = fixture; addKey(db); backupFixture(db, fixture.file);
    expect(db.withPersistedAccountingAuthority(reader => readAccountingPolicy(reader, 'key-one').unlimited)).toBe(true);
    expect(() => db.withPersistedAccountingAuthority(reader => reader.get('DELETE FROM apiKeys'))).toThrow();
    db.durableTransaction(() => db.run("UPDATE apiKeyBudgetPolicies SET monthlyLimitNanoUsd=0 WHERE apiKeyId='key-one'"));
    expect(db.withPersistedAccountingAuthority(reader => readAccountingPolicy(reader, 'key-one').unlimited)).toBe(false);
    expect(() => db.withPersistedAccountingAuthority(async () => true)).toThrow(/synchronous/);
  });
});
it('SQL.js rejects newer dirty authority rather than approving the older file', async () => {
  fixture = await openFixture('sqljs'); const { db } = fixture; addKey(db); backupFixture(db, fixture.file);
  db.run("INSERT INTO settings(id,data) VALUES(1,'{\"changed\":true}')");
  expect(() => db.withPersistedAccountingAuthority(() => true)).toThrow(/stale/);
  publicationFault('sqljs', false);
  expect(() => insertAttemptSync(db, intent(db))).toThrow();
  expect(() => db.withPersistedAccountingAuthority(() => true)).toThrow(/authority/);
});
it('Node persisted authority reads committed WAL changes absent from the main file', async () => {
  fixture = await openFixture('node'); const { db } = fixture; addKey(db); backupFixture(db, fixture.file);
  const before = fs.readFileSync(fixture.file);
  db.durableTransaction(() => db.run("UPDATE apiKeyBudgetPolicies SET weeklyLimitNanoUsd=9 WHERE apiKeyId='key-one'"));
  expect(fs.readFileSync(fixture.file).equals(before)).toBe(true);
  expect(db.withPersistedAccountingAuthority(reader => readAccountingPolicy(reader, 'key-one').weeklyLimitNanoUsd)).toBe(9);
});
it('Node denies authority while failed RELEASE and rollback leave a transaction open', async () => {
  fixture = await openFixture('node'); const { db } = fixture; addKey(db); backupFixture(db, fixture.file);
  const exec = DatabaseSync.prototype.exec;
  vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (sql, ...args) {
    if (sql.startsWith('RELEASE sp_0_') || sql.startsWith('ROLLBACK TO sp_0_')) throw new Error('transaction boundary unavailable');
    return exec.call(this, sql, ...args);
  });
  expect(() => insertAttemptSync(db, intent(db))).toThrow('transaction boundary unavailable');
  expect(() => db.withPersistedAccountingAuthority(() => true)).toThrow(/quiescent/);
});
