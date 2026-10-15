import { retainKeyBindings } from '../../../src/lib/db/helpers/apiKeyBindings.js';

// Monetary recovery fixture only; not configuration import/restore coverage.
// Preserve ordinary INSERTs, fresh-empty proof and real durable key bindings.
export function seedRecoveryAccountingFixture(db, signal = null) {
  signal?.throwIfAborted();
  const timestamp = '2026-10-01T00:00:00.000Z';
  const keys = [{ id: 'key-a', key: 'recovery-secret', createdAt: timestamp }];
  db.durableTransaction(() => {
    signal?.throwIfAborted();
    if (db.get('SELECT id FROM apiKeys') || db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'") ||
        db.get("SELECT key FROM kv WHERE scope='pricing'") || db.get('SELECT attemptId FROM apiKeyAccounting')) throw new Error('Recovery fixture requires fresh disposable DB');
    db.run('INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES(?,?,1,?)', [keys[0].id, keys[0].key, timestamp]);
    retainKeyBindings(db, db.coverage, keys);
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt',?)", [timestamp]);
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','fixture',?)", [JSON.stringify({ fixture: { input: '1', output: '2' } })]);
  });
  signal?.throwIfAborted();
}
