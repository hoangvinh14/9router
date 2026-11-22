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

test('inner transaction return is provisional until the outer transaction commits', async () => {
  await fixture('nested', db => {
    let innerReturn;
    assert.throws(() => db.transaction(() => {
      innerReturn = db.transaction(() => {
        insert(db);
        return 'inner-return';
      });
      assert.equal(innerReturn, 'inner-return');
      assert.equal(db.get('SELECT COUNT(*) AS count FROM fixture_attempts').count, 1);
      throw new Error('outer rollback after inner return');
    }), /outer rollback after inner return/);
    assert.equal(innerReturn, 'inner-return');
    assert.deepEqual(db.all('SELECT * FROM fixture_attempts'), []);
    // The same nesting succeeds when the outer transaction actually returns.
    assert.equal(db.transaction(() => db.transaction(() => {
      insert(db);
      return 'outer-return';
    })), 'outer-return');
    assert.equal(db.get('SELECT COUNT(*) AS count FROM fixture_attempts').count, 1);
  });
});

test('peer row visibility cannot distinguish a delivered application return from a dropped one', async () => {
  await fixture('return-loss', async (writer, file) => {
    const observer = await createNodeSqliteAdapter(file);
    try {
      const rows = [
        ['delivered', 'key-a', original[2], original[3], original[4]],
        ['dropped', 'key-a', original[2], original[3], original[4]],
      ];
      const adapterReturns = [];
      const callerReturns = new Map();
      function persistThenReturn(row, dropReturn) {
        const value = writer.transaction(() => {
          insert(writer, row);
          return { attemptId: row[0] };
        });
        adapterReturns.push(value.attemptId);
        // Application-level return loss only: no injected SQLite commit error,
        // fsync fault, process death or production own-ACK implementation.
        if (dropReturn) throw new Error('fixture application return dropped');
        return value;
      }
      callerReturns.set('delivered', persistThenReturn(rows[0], false));
      assert.throws(() => {
        callerReturns.set('dropped', persistThenReturn(rows[1], true));
      }, /fixture application return dropped/);
      assert.deepEqual(adapterReturns, ['delivered', 'dropped']);
      assert.deepEqual(callerReturns.get('delivered'), { attemptId: 'delivered' });
      assert.equal(callerReturns.has('dropped'), false);
      const visible = observer.all('SELECT * FROM fixture_attempts ORDER BY attemptId');
      assert.equal(visible.length, 2);
      for (const row of visible) {
        assert.equal(row.apiKeyId, original[1]);
        assert.equal(row.startedAt, original[2]);
        assert.equal(row.priceJson, original[3]);
        assert.equal(row.costNanoUsd, original[4]);
      }
      assert.deepEqual(visible.map(row => row.attemptId), ['delivered', 'dropped']);
    } finally { observer.close(); }
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

test('explicit outer WAL/FULL commit returns only after transaction ends; ordinary setting can be restored', async () => {
  await fixture('outer-full', async (db, file) => {
    const observer = await createNodeSqliteAdapter(file);
    try {
      assert.equal(db.raw.isTransaction, false);
      assert.equal(db.get('PRAGMA journal_mode').journal_mode, 'wal');
      const previous = db.get('PRAGMA synchronous').synchronous;
      assert.equal(previous, 1);
      db.exec('PRAGMA synchronous = FULL');
      assert.equal(db.get('PRAGMA synchronous').synchronous, 2);
      db.exec('BEGIN IMMEDIATE');
      assert.equal(db.raw.isTransaction, true);
      insert(db);
      assert.equal(observer.get('SELECT COUNT(*) AS count FROM fixture_attempts').count, 0);
      db.exec('COMMIT');
      assert.equal(db.raw.isTransaction, false);
      assert.equal(observer.get('SELECT COUNT(*) AS count FROM fixture_attempts').count, 1);
      db.exec('PRAGMA synchronous = NORMAL');
      assert.equal(db.get('PRAGMA synchronous').synchronous, previous);
      // Observed COMMIT/visibility only; no fsync/power-loss fault injection.
    } finally {
      if (db.raw.isTransaction) db.exec('ROLLBACK');
      db.exec('PRAGMA synchronous = NORMAL');
      observer.close();
    }
  });
});

test('outer rollback restores absent rows; nesting or changing synchronous inside transaction is refused', async () => {
  await fixture('outer-rollback', db => {
    db.exec('PRAGMA synchronous = FULL');
    try {
      db.exec('BEGIN IMMEDIATE');
      insert(db);
      assert.throws(() => db.exec('BEGIN IMMEDIATE'), /transaction/i);
      assert.throws(() => db.exec('PRAGMA synchronous = NORMAL'), /transaction/i);
      assert.equal(db.raw.isTransaction, true);
      assert.equal(db.get('PRAGMA synchronous').synchronous, 2);
      db.exec('ROLLBACK');
      assert.equal(db.raw.isTransaction, false);
      assert.deepEqual(db.all('SELECT * FROM fixture_attempts'), []);
    } finally {
      if (db.raw.isTransaction) db.exec('ROLLBACK');
      db.exec('PRAGMA synchronous = NORMAL');
    }
    db.transaction(() => {
      assert.equal(db.raw.isTransaction, true);
      assert.throws(() => db.exec('BEGIN IMMEDIATE'), /transaction/i);
      assert.equal(db.get('PRAGMA synchronous').synchronous, 1);
    });
    assert.equal(db.raw.isTransaction, false);
  });
});

test('ordinary adapter releases before an async callback continues; promise detection alone does not revoke raw writes', async () => {
  await fixture('async-escape', async db => {
    let resume;
    const wait = new Promise(resolve => { resume = resolve; });
    const pending = db.transaction(async () => {
      assert.equal(db.raw.isTransaction, true);
      await wait;
      assert.equal(db.raw.isTransaction, false);
      insert(db); // Autocommit AFTER the adapter transaction already returned.
    });
    assert.ok(pending instanceof Promise);
    assert.equal(db.raw.isTransaction, false);
    assert.deepEqual(db.all('SELECT * FROM fixture_attempts'), []);
    resume();
    await pending;
    assert.equal(db.get('SELECT COUNT(*) AS count FROM fixture_attempts').count, 1);
    // This is a characterized admission gap, not an accounting success ACK.
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
