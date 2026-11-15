import fs from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

// Separate bounded SQLite capability fixture, not a production budget ledger.
// Check isolation before the adapter import; no app driver/startup/data paths.
assert.equal(process.env.BUDGET_PURE_SANDBOX, '1');
assert.equal(process.version, 'v24.21.0');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'), process.env.BUDGET_OUTER_NET);
assert.equal(process.env.DATA_DIR, '/sandbox/data');
assert.deepEqual(fs.readdirSync(process.env.DATA_DIR), []);
for (const hidden of ['/home/gmo', '/app/.env', '/app/.git', '/app/node_modules', '/app/src/lib/db/driver.js']) {
  assert.equal(fs.existsSync(hidden), false);
}
const mounts = fs.readFileSync('/proc/self/mountinfo', 'utf8').trim().split('\n').map(line => {
  const fields = line.split(' '); return { path: fields[4], options: fields[5].split(',') };
});
const covering = target => mounts.filter(m => target === m.path || target.startsWith(`${m.path.replace(/\/$/, '')}/`))
  .sort((a, b) => b.path.length - a.path.length)[0];
for (const target of ['/', '/app', '/app/src/lib/db', '/app/src/lib/db/schema.js', '/app/src/lib/db/adapters/nodeSqliteAdapter.js']) {
  assert.ok(covering(target)?.options.includes('ro'));
}
assert.ok(covering('/sandbox/data')?.options.includes('rw'));
const { createNodeSqliteAdapter } = await import('../../src/lib/db/adapters/nodeSqliteAdapter.js');

// Temporary rows only. This schema deliberately has no production import path.
const schema = `CREATE TABLE fixture_attempts (
  attemptId TEXT PRIMARY KEY, apiKeyId TEXT NOT NULL,
  startedAt TEXT NOT NULL, priceJson TEXT NOT NULL, costNanoUsd TEXT NOT NULL
); CREATE TABLE fixture_audit (attemptId TEXT PRIMARY KEY, action TEXT NOT NULL)`;
const original = ['attempt-a', 'key-a', '2026-10-25T16:59:59.999Z', '{"input":"1","output":"2"}', '1200000'];
const insert = (db, row = original) => db.run('INSERT INTO fixture_attempts VALUES (?,?,?,?,?)', row);
async function fixture(name, run) {
  const file = `/sandbox/data/${name}.sqlite`;
  let db = await createNodeSqliteAdapter(file);
  try { db.exec(schema); await run(db, file); }
  finally { db.close(); }
}

test('existing adapter transaction commits both rows or rolls back all writes and throws', async () => {
  await fixture('rollback', db => {
    assert.throws(() => db.transaction(() => {
      insert(db);
      db.run('INSERT INTO fixture_audit VALUES (?,?)', ['attempt-a', 'recorded']);
      throw new Error('fixture interruption');
    }), /fixture interruption/);
    assert.deepEqual(db.all('SELECT * FROM fixture_attempts'), []);
    assert.deepEqual(db.all('SELECT * FROM fixture_audit'), []);
    db.transaction(() => {
      insert(db);
      db.run('INSERT INTO fixture_audit VALUES (?,?)', ['attempt-a', 'recorded']);
    });
    assert.equal(db.get('SELECT COUNT(*) AS count FROM fixture_attempts').count, 1);
    assert.equal(db.get('SELECT COUNT(*) AS count FROM fixture_audit').count, 1);
  });
});

test('single attempt identity rejects identical and conflicting inserts without an extra charge', async () => {
  await fixture('unique', db => {
    db.transaction(() => insert(db));
    // Constraint rejection is not successful idempotent replay acknowledgment.
    assert.throws(() => db.transaction(() => insert(db)), /UNIQUE/);
    const conflict = [...original]; conflict[1] = 'key-b'; conflict[4] = '9900000';
    assert.throws(() => db.transaction(() => insert(db, conflict)), /UNIQUE/);
    const rows = db.all('SELECT * FROM fixture_attempts');
    assert.equal(rows.length, 1);
    assert.equal(rows.reduce((sum, row) => sum + BigInt(row.costNanoUsd), 0n), 1200000n);
    assert.equal(rows[0].apiKeyId, 'key-a');
    assert.equal(rows[0].startedAt, original[2]);
    assert.equal(rows[0].priceJson, original[3]);
  });
});

test('closed fixture rows reopen unchanged; effective WAL/NORMAL is not a crash durability proof', async () => {
  const file = '/sandbox/data/reopen.sqlite';
  let db = await createNodeSqliteAdapter(file);
  try {
    db.exec(schema);
    assert.equal(db.get('PRAGMA journal_mode').journal_mode, 'wal');
    assert.equal(db.get('PRAGMA synchronous').synchronous, 1);
    db.transaction(() => insert(db));
    db.close(); db = await createNodeSqliteAdapter(file);
    assert.equal(db.get('PRAGMA journal_mode').journal_mode, 'wal');
    assert.equal(db.get('PRAGMA synchronous').synchronous, 1);
    assert.deepEqual({ ...db.get('SELECT * FROM fixture_attempts') }, {
      attemptId: original[0], apiKeyId: original[1], startedAt: original[2], priceJson: original[3], costNanoUsd: original[4],
    });
  } finally { db.close(); }
});
