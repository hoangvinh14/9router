import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { openFixture, addKey, intent } from '../fixtures/accounting/test-database.js';
import { insertAttemptSync } from '../../src/lib/db/repos/api-key-accounting-repo.js';
import { validateKeyBindings, retainKeyBindings, retireKeyBindings, initializeKeyBindings } from '../../src/lib/db/helpers/api-key-bindings.js';

let fixture;
afterEach(() => { if (fixture) { fixture.db.close(); fs.rmSync(fixture.root, { recursive: true, force: true }); fixture = null; } });
for (const engine of ['node', 'sqljs']) describe(`${engine} stable identity`, () => {
  it('refuses rebinding and duplicate identities without changing stored bindings', async () => {
    fixture = await openFixture(engine); const { db } = fixture, key = addKey(db);
    const before = db.all('SELECT * FROM apiKeyBindings');
    expect(() => validateKeyBindings(db, db.coverage, [{ ...key, key: 'different' }])).toThrow(/conflict/);
    expect(() => validateKeyBindings(db, db.coverage, [{ ...key, id: 'different' }])).toThrow(/conflict/);
    expect(() => validateKeyBindings(db, db.coverage, [key, key])).toThrow(/conflict/);
    expect(() => validateKeyBindings(db, db.coverage, [key])).not.toThrow();
    expect(db.all('SELECT * FROM apiKeyBindings')).toEqual(before);
    expect(JSON.stringify(before)).not.toContain(key.key);
  });
  it('retirement survives an older database and never transfers a deleted identity', async () => {
    fixture = await openFixture(engine); const { db } = fixture, key = addKey(db);
    db.durableTransaction(() => retireKeyBindings(db, db.coverage, [key]));
    expect(() => validateKeyBindings(db, db.coverage, [key])).toThrow(/conflict/);
    expect(() => validateKeyBindings(db, db.coverage, [{ ...key, id: 'new' }])).toThrow(/conflict/);
    db.durableTransaction(() => initializeKeyBindings(db, db.coverage));
    expect(db.get('SELECT isActive FROM apiKeys WHERE id=?', [key.id]).isActive).toBe(0);
    expect(db.get('SELECT retiredAt FROM apiKeyBindings').retiredAt).toBeTruthy();
  });
  it('refuses missing retained binding or initialization marker instead of regenerating history', async () => {
    fixture = await openFixture(engine); const { db } = fixture, key = addKey(db);
    db.durableTransaction(() => db.run("DELETE FROM _meta WHERE key='accountingBindingsInitialized'"));
    expect(() => db.durableTransaction(() => initializeKeyBindings(db, db.coverage))).toThrow(/marker missing/);
    db.durableTransaction(() => {
      db.run("INSERT INTO _meta(key,value) VALUES('accountingBindingsInitialized','1')");
      db.run('DELETE FROM apiKeyBindings WHERE apiKeyId=?', [key.id]);
    });
    expect(() => db.durableTransaction(() => initializeKeyBindings(db, db.coverage))).toThrow(/binding missing/);
    expect(() => retainKeyBindings(db, db.coverage, [key])).toThrow(/binding missing/);
    expect(db.all('SELECT * FROM apiKeyBindings')).toEqual([]);
  });
  it('refuses lost initialization material when accounting history remains', async () => {
    fixture = await openFixture(engine); const { db } = fixture; addKey(db);
    insertAttemptSync(db, intent(db));
    db.durableTransaction(() => {
      db.run("DELETE FROM _meta WHERE key='accountingBindingsInitialized'");
      db.run('DELETE FROM apiKeyBindings');
    });
    expect(() => db.durableTransaction(() => initializeKeyBindings(db, db.coverage))).toThrow(/marker missing/);
    expect(db.all('SELECT * FROM apiKeyBindings')).toEqual([]);
    expect(db.get('SELECT state FROM apiKeyAccounting').state).toBe('pending');
  });
});
