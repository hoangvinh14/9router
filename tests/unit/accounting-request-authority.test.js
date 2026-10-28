import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openFixture, addKey, backupFixture, intent } from '../fixtures/accounting/test-database.js';
import { insertAttemptSync } from '../../src/lib/db/repos/api-key-accounting-repo.js';
import { createPersistedRequestAuthority } from '../../src/lib/accounting/persisted-request-authority.js';

let fixture;
afterEach(() => {
  vi.restoreAllMocks();
  if (fixture) { fixture.db.beforeClose = undefined; fixture.db.close(); fs.rmSync(fixture.root, { recursive: true, force: true }); fixture = null; }
});
const input = { credential: 'fixture-secret', provider: 'openai', model: 'fixture', connectionId: 'connection-one' };
async function setup(engine) {
  fixture = await openFixture(engine); const { db } = fixture;
  addKey(db); backupFixture(db, fixture.file);
  db.durableTransaction(() => db.run('INSERT INTO providerConnections(id,provider,authType,data,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    ['connection-one', 'openai', 'apikey', JSON.stringify({ apiKey: 'provider-secret' }), '2026-10-27T00:00:00.000Z', '2026-10-27T00:00:00.000Z']));
  backupFixture(db, fixture.file);
  return { db, authority: createPersistedRequestAuthority(db) };
}
function failRecording(engine) {
  let failed = false;
  if (engine === 'node') {
    const exec = DatabaseSync.prototype.exec;
    vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (sql, ...args) {
      if (!failed && sql.startsWith('RELEASE sp_0_')) { failed = true; throw new Error('recording failed'); }
      return exec.call(this, sql, ...args);
    });
  } else {
    const rename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
      if (!failed && target === fixture.file) { failed = true; throw new Error('recording failed'); }
      return rename(source, target);
    });
  }
  expect(() => insertAttemptSync(fixture.db, intent(fixture.db))).toThrow('recording failed');
  expect(failed).toBe(true);
}
for (const engine of ['node', 'sqljs']) describe(`${engine} persisted request identity and selection`, () => {
  it('exposes only the initialized driver capability while ordinary poisoned getters stay strict', async () => {
    const previous = global._dbAdapter;
    const state = global._dbAdapter = { instance: null, initPromise: null, logged: false };
    vi.resetModules();
    try {
      const driver = await import('../../src/lib/db/driver.js');
      expect(() => driver.getPersistedRequestAuthority()).toThrow(/not initialized/);
      const { db } = await setup(engine);
      state.instance = db;
      failRecording(engine);
      expect(driver.getPersistedRequestAuthority().prove(input).apiKeyId).toBe('key-one');
      expect(() => driver.getAdapterSync()).toThrow(/unavailable/);
      await expect(driver.getAdapter()).rejects.toThrow(/unavailable/);
      expect(state.instance).toBe(db);
      expect(state.initPromise).toBeNull();
    } finally { global._dbAdapter = previous; vi.resetModules(); }
  });
  it('proves a fresh degraded request without exposing secrets or adapter methods', async () => {
    const { db, authority } = await setup(engine);
    failRecording(engine);
    const proof = authority.prove(input);
    expect(proof).toMatchObject({ apiKeyId: 'key-one', unlimited: true, connectionId: 'connection-one' });
    expect(JSON.stringify(proof)).not.toMatch(/fixture-secret|provider-secret/);
    expect(Object.isFrozen(proof)).toBe(true);
    expect(Object.keys(authority)).toEqual(['prove', 'assertCurrent', 'assertCredentials']);
    expect(() => db.get('SELECT * FROM apiKeys')).toThrow();
    expect(authority.assertCurrent(proof).apiKeyId).toBe('key-one');
    expect(() => authority.assertCurrent({ ...proof })).toThrow(/Unknown/);
    expect(authority.assertCredentials(proof, { connectionId: 'connection-one', apiKey: 'provider-secret' })).toBe(true);
    expect(() => authority.assertCredentials(proof, { connectionId: 'connection-one', apiKey: 'stale-secret' })).toThrow(/credentials changed/);
  });
  it('does not classify a zero or finite limit as an unlimited failure exception', async () => {
    const { db, authority } = await setup(engine);
    db.durableTransaction(() => db.run("UPDATE apiKeyBudgetPolicies SET weeklyLimitNanoUsd=0 WHERE apiKeyId='key-one'"));
    expect(authority.prove(input).unlimited).toBe(false);
    failRecording(engine);
    expect(() => authority.prove(input)).toThrow(/explicit unlimited/);
  });
  it.each([
    ["key", "UPDATE apiKeys SET isActive=0 WHERE id='key-one'"],
    ["binding", "UPDATE apiKeyBindings SET retiredAt='2026-10-27T00:00:00.000Z' WHERE apiKeyId='key-one'"],
    ["policy", "UPDATE apiKeyBudgetPolicies SET monthlyLimitNanoUsd=1 WHERE apiKeyId='key-one'"],
    ["connection", "UPDATE providerConnections SET data='{\"apiKey\":\"changed\"}' WHERE id='connection-one'"],
    ["settings", "INSERT INTO settings(id,data) VALUES(1,'{\"requireApiKey\":false}')"],
    ["routing", "INSERT INTO kv(scope,key,value) VALUES('modelAliases','alias','\"openai/other\"')"],
    ["disabled models", "INSERT INTO kv(scope,key,value) VALUES('disabledModels','openai','[\"fixture\"]')"],
    ["combos", "INSERT INTO combos(id,name,models,createdAt,updatedAt) VALUES('combo-one','fixture','[\"openai/fixture\"]','2026-10-27T00:00:00.000Z','2026-10-27T00:00:00.000Z')"],
  ])('rejects %s changes across an await', async (_label, sql) => {
    const { db, authority } = await setup(engine), proof = authority.prove(input);
    await Promise.resolve();
    db.durableTransaction(() => db.run(sql));
    expect(() => authority.assertCurrent(proof)).toThrow();
  });
  it('requires a current sidecar, explicit gap generation and no maintenance', async () => {
    const { db, authority } = await setup(engine), proof = authority.prove(input);
    const gap = db.coverage.latchGap('key-one', 'fixture recording gap');
    expect(() => authority.assertCurrent(proof)).toThrow(/changed/);
    expect(authority.assertCurrent(proof, gap.generation).coverageGeneration).toBe(gap.generation);
    db.coverage.enterMaintenance('fixture maintenance');
    expect(() => authority.prove(input)).toThrow(/coverage unavailable/);
    expect(() => authority.assertCurrent(proof, gap.generation)).toThrow();
  });
  it('refuses missing installation markers and a missing policy instead of defaulting', async () => {
    const { db, authority } = await setup(engine);
    db.durableTransaction(() => db.run("DELETE FROM apiKeyBudgetPolicies WHERE apiKeyId='key-one'"));
    expect(() => authority.prove(input)).toThrow(/unavailable/);
    db.durableTransaction(() => db.run("DELETE FROM _meta WHERE key='accountingPoliciesInitialized'"));
    expect(() => authority.prove(input)).toThrow(/unavailable/);
  });
  it('refuses unavailable pools and detects node and pool drift', async () => {
    const { db, authority } = await setup(engine), provider = 'openai-compatible-chat-fixture';
    db.durableTransaction(() => {
      db.run('INSERT INTO providerNodes(id,type,data,createdAt,updatedAt) VALUES(?,?,?,?,?)', [provider, 'openai-compatible', '{"baseUrl":"http://localhost:21234"}', '2026-10-27T00:00:00.000Z', '2026-10-27T00:00:00.000Z']);
      db.run('INSERT INTO proxyPools(id,data,createdAt,updatedAt) VALUES(?,?,?,?)', ['pool-one', '{"proxyUrl":"http://localhost:21235"}', '2026-10-27T00:00:00.000Z', '2026-10-27T00:00:00.000Z']);
      db.run("UPDATE providerConnections SET provider=?,data=? WHERE id='connection-one'", [provider, '{"apiKey":"provider-secret","providerSpecificData":{"proxyPoolId":"pool-one"}}']);
    });
    const custom = { ...input, provider }, proof = authority.prove(custom);
    db.durableTransaction(() => db.run("UPDATE providerNodes SET data='{\"baseUrl\":\"http://localhost:21236\"}' WHERE id=?", [provider]));
    expect(() => authority.assertCurrent(proof)).toThrow(/changed/);
    const next = authority.prove(custom);
    db.durableTransaction(() => db.run("UPDATE proxyPools SET isActive=0 WHERE id='pool-one'"));
    expect(() => authority.assertCurrent(next)).toThrow(/pool unavailable/);
  });
  it('refuses lost ownership and corrupt sidecar material without opening another writer', async () => {
    const { authority } = await setup(engine), proof = authority.prove(input);
    const lock = `${fixture.root}/.gateway-writer.lock`, held = `${lock}.held`;
    fs.renameSync(lock, held);
    try { expect(() => authority.assertCurrent(proof)).toThrow(); }
    finally { fs.renameSync(held, lock); }
    const sidecar = `${fixture.root}/.accounting-coverage.json`, before = fs.readFileSync(sidecar);
    fs.writeFileSync(sidecar, '{}');
    try { expect(() => authority.prove(input)).toThrow(); }
    finally { fs.writeFileSync(sidecar, before); }
    expect(authority.assertCurrent(proof).apiKeyId).toBe('key-one');
  });
  it('requires the installed schema and binding fingerprint to remain verifiable', async () => {
    const { db, authority } = await setup(engine);
    db.durableTransaction(() => db.run("UPDATE apiKeyBindings SET fingerprint=? WHERE apiKeyId='key-one'", ['a'.repeat(64)]));
    expect(() => authority.prove(input)).toThrow(/identity/);
    db.durableTransaction(() => db.exec('DROP TRIGGER accounting_audit_no_update'));
    expect(() => authority.prove(input)).toThrow(/authority/);
  });
});
