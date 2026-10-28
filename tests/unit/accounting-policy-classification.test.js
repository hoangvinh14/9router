import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openFixture, addKey, backupFixture } from '../fixtures/accounting/test-database.js';
import { initializeAccountingPolicy, readAccountingPolicy } from '../../src/lib/db/helpers/accounting-policy.js';
import { retainKeyBindings, retireKeyBindings } from '../../src/lib/db/helpers/api-key-bindings.js';
import { createNodeSqliteAdapter } from '../../src/lib/db/adapters/nodeSqliteAdapter.js';
import { createSqlJsAdapter } from '../../src/lib/db/adapters/sqljsAdapter.js';
import policyMigration from '../../src/lib/db/migrations/003-accounting-policy.js';
import { openAccountingCoverage } from '../../src/lib/db/accounting-coverage.js';

let fixture;
afterEach(() => { vi.restoreAllMocks(); if (fixture) { fixture.db.close(); fs.rmSync(fixture.root, { recursive: true, force: true }); fixture = null; } });
for (const engine of ['node', 'sqljs']) describe(`${engine} explicit accounting policy`, () => {
  it('backfills legacy active and retired identities explicitly without changing their binding', async () => {
    fixture = await openFixture(engine); const { db } = fixture;
    const key = addKey(db); backupFixture(db, fixture.file);
    db.durableTransaction(() => { retireKeyBindings(db, db.coverage, [key]); db.run('DELETE FROM apiKeys WHERE id=?', [key.id]); });
    const bindings = db.all('SELECT * FROM apiKeyBindings');
    db.durableTransaction(() => { db.exec('DROP TABLE apiKeyBudgetPolicies'); db.run("DELETE FROM _meta WHERE key='accountingPoliciesInitialized'"); });
    db.durableTransaction(() => policyMigration.up(db));
    expect(readAccountingPolicy(db, key.id).unlimited).toBe(true);
    expect(db.all('SELECT * FROM apiKeyBindings')).toEqual(bindings);
    expect(db.get("SELECT value FROM _meta WHERE key='accountingPoliciesInitialized'").value).toBe('1');
  });
  it.each([false, true])('safely resumes interrupted sidecar policy upgrade after publication=%s', async after => {
    fixture = await openFixture(engine); const { db, owner, root } = fixture;
    const key = addKey(db); backupFixture(db, fixture.file);
    db.coverage.latchGap(key.id, 'retained recording gap');
    db.durableTransaction(() => retireKeyBindings(db, db.coverage, [key]));
    const file = `${root}/.accounting-coverage.json`, old = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete old.policyVersion; fs.writeFileSync(file, JSON.stringify(old));
    const rename = fs.renameSync; let injected = false;
    vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (!injected && destination === file) { injected = true; if (after) rename(source, destination); throw new Error('upgrade ACK unavailable'); }
      return rename(source, destination);
    });
    expect(() => openAccountingCoverage(db, owner)).toThrow('upgrade ACK unavailable');
    expect(injected).toBe(true); vi.restoreAllMocks();
    db.coverage = openAccountingCoverage(db, owner);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ ...old, policyVersion: 1 });
    expect(db.coverage.status(key.id).gaps).toHaveLength(1);
    expect(db.coverage.retiredBindings()).toEqual(old.retiredBindings);
  });
  it('classifies null limits independently of ACL, preserves zero and survives reopen', async () => {
    fixture = await openFixture(engine); let { db } = fixture;
    addKey(db); backupFixture(db, fixture.file);
    db.durableTransaction(() => db.run("UPDATE apiKeys SET accessRestricted=1 WHERE id='key-one'"));
    expect(readAccountingPolicy(db, 'key-one').unlimited).toBe(true);
    db.durableTransaction(() => db.run("UPDATE apiKeyBudgetPolicies SET weeklyLimitNanoUsd=0,version=2 WHERE apiKeyId='key-one'"));
    expect(readAccountingPolicy(db, 'key-one')).toMatchObject({ weeklyLimitNanoUsd: 0, monthlyLimitNanoUsd: null, unlimited: false, version: 2 });
    db.close(); fixture = await openFixture(engine, fixture.file); db = fixture.db;
    expect(readAccountingPolicy(db, 'key-one').weeklyLimitNanoUsd).toBe(0);
    expect(db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined();
  });
  it('keeps policy on identity replay/retirement and refuses missing initialized policy', async () => {
    fixture = await openFixture(engine); const { db } = fixture, key = addKey(db); backupFixture(db, fixture.file);
    db.durableTransaction(() => db.run("UPDATE apiKeyBudgetPolicies SET monthlyLimitNanoUsd=100 WHERE apiKeyId='key-one'"));
    db.durableTransaction(() => retainKeyBindings(db, db.coverage, [key]));
    expect(readAccountingPolicy(db, key.id).monthlyLimitNanoUsd).toBe(100);
    db.durableTransaction(() => retireKeyBindings(db, db.coverage, [key]));
    expect(readAccountingPolicy(db, key.id).monthlyLimitNanoUsd).toBe(100);
    expect(() => readAccountingPolicy(db, 'missing')).toThrow(/unavailable/);
    db.durableTransaction(() => db.run("DELETE FROM apiKeyBudgetPolicies WHERE apiKeyId='key-one'"));
    expect(() => readAccountingPolicy(db, key.id)).toThrow(/unavailable/);
    expect(() => db.durableTransaction(() => retainKeyBindings(db, db.coverage, [key]))).toThrow();
  });
  it('creates a policy for a new identity without replacing an existing limit', async () => {
    fixture = await openFixture(engine); const { db } = fixture; backupFixture(db, fixture.file);
    db.durableTransaction(() => initializeAccountingPolicy(db, 'new-key'));
    db.durableTransaction(() => db.run("UPDATE apiKeyBudgetPolicies SET weeklyLimitNanoUsd=5 WHERE apiKeyId='new-key'"));
    db.durableTransaction(() => initializeAccountingPolicy(db, 'new-key'));
    expect(readAccountingPolicy(db, 'new-key').weeklyLimitNanoUsd).toBe(5);
    expect(() => db.durableTransaction(() => db.run("UPDATE apiKeyBudgetPolicies SET weeklyLimitNanoUsd=-1 WHERE apiKeyId='new-key'"))).toThrow();
  });
  it('refuses rollback to an older policy schema before any database mutation', async () => {
    fixture = await openFixture(engine); const { db, file } = fixture; backupFixture(db, file);
    db.durableTransaction(() => db.run("DELETE FROM _meta WHERE key='accountingPoliciesInitialized'")); db.close();
    const before = fs.readFileSync(file);
    await expect((engine === 'node' ? createNodeSqliteAdapter : createSqlJsAdapter)(file)).rejects.toThrow(/policy installation/);
    expect(fs.readFileSync(file).equals(before)).toBe(true);
  });
});
