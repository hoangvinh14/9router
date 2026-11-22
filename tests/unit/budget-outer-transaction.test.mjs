import fs from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';

assert.equal(process.env.BUDGET_PURE_SANDBOX, '1');
assert.equal(process.version, 'v24.21.0');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'), process.env.BUDGET_OUTER_NET);
for (const hidden of ['/home/gmo', '/app/.env', '/app/.git', '/app/node_modules', '/app/src/lib/db/driver.js']) {
  assert.equal(fs.existsSync(hidden), false);
}
const mounts = fs.readFileSync('/proc/self/mountinfo', 'utf8').trim().split('\n').map(line => {
  const fields = line.split(' '); return { path: fields[4], options: fields[5].split(',') };
});
for (const target of ['/', '/app/src/lib/accounting/node-outer-transaction.js', '/app/tests/unit/budget-outer-transaction.test.mjs']) {
  const covering = mounts.filter(m => target === m.path || target.startsWith(`${m.path.replace(/\/$/, '')}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  assert.ok(covering?.options.includes('ro'));
}
let sequence = 0;
function child(body) {
  const prelude = `
    import assert from 'node:assert/strict';
    const { createNodeSqliteAdapter } = await import('/app/src/lib/db/adapters/nodeSqliteAdapter.js');
    const { createNodeOuterTransaction: factory } = await import('/app/src/lib/accounting/node-outer-transaction.js');
    const { assertAccountingHealthy: healthy, faultAccounting: fault,
      finalAccountingDispatch: dispatch } = await import('/app/src/lib/accounting/process-state.js');
    const file = '/tmp/outer-fixture-${++sequence}.sqlite';
    const db = await createNodeSqliteAdapter(file);
    db.exec('CREATE TABLE outer_fixture (id TEXT PRIMARY KEY, amount TEXT NOT NULL)');
    const defs = { put: { method: 'run', sql: 'INSERT INTO outer_fixture VALUES (?,?)' },
      read: { method: 'get', sql: 'SELECT * FROM outer_fixture WHERE id = ?' } };
    const count = () => db.get('SELECT COUNT(*) AS count FROM outer_fixture').count;
    const refused = outcome => error => error.code === 'api_key_accounting_unavailable' &&
      error.message === 'Accounting storage unavailable' && error.transactionOutcome === outcome;
    const stops = () => {
      assert.throws(healthy);
      assert.throws(() => dispatch(() => true, () => assert.fail('POST')));
      assert.throws(() => factory(db, defs)(() => assert.fail('reused connection')));
    };
    try {
  `;
  const result = spawnSync('/runtime/node', ['--unhandled-rejections=strict', '--input-type=module', '--eval', prelude + body + `
    } finally { if (db.raw.isOpen === true && db.raw.isTransaction) db.exec('ROLLBACK'); db.close(); }
  `], { env: process.env, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr + result.stdout);
}

test('retained terminal writes original evidence after process fault but never restores dispatch', () => child(`
  const transact = factory(db, defs);
  const record = transact.retainTerminal(scope => { scope.put(['original', '7']); return scope.read(['original']); });
  fault();
  assert.deepEqual(record(), { transactionOutcome: 'commit_observed', value: { id: 'original', amount: '7' } });
  assert.equal(count(), 1);
  assert.throws(record); assert.throws(() => transact.retainTerminal(() => null));
  stops(); assert.equal(count(), 1);
`));

test('retained terminal cannot reuse quarantined raw identity across wrapper or HMR', () => child(`
  const transact = factory(db, defs);
  const record = transact.retainTerminal(scope => scope.put(['terminal', '2']));
  const exec = db.exec.bind(db);
  const broken = factory({ ...db, exec(sql) { if (sql === 'COMMIT') throw new Error('private'); return exec(sql); } }, defs);
  assert.throws(() => broken(scope => scope.put(['prefix', '1'])), refused('rolled_back'));
  const copy = await import('/app/src/lib/accounting/node-outer-transaction.js?retained=quarantine');
  assert.throws(record, refused('not_started'));
  assert.throws(() => copy.createNodeOuterTransaction(db, defs).retainTerminal(() => null));
  assert.equal(count(), 0); stops();
`));

test('retained terminal storage failure quarantines immediately and consumes both success and failed authorities', () => child(`
  const transact = factory(db, defs);
  const fail = transact.retainTerminal(scope => {
    scope.put(['same', '1']);
    try { scope.put(['same', '2']); } catch {}
    assert.throws(healthy);
    assert.throws(() => dispatch(() => true, () => assert.fail('POST')));
  });
  const other = transact.retainTerminal(scope => scope.put(['other', '3']));
  fault();
  assert.throws(fail, refused('rolled_back')); assert.throws(fail);
  assert.throws(other, refused('not_started'));
  assert.equal(count(), 0); stops();
`));

test('retained terminal callback and async rejection roll back without allowing late writes', () => child(`
  const transact = factory(db, defs);
  let resume; let pending;
  const wait = new Promise(resolve => { resume = resolve; });
  const record = transact.retainTerminal(scope => {
    pending = (async () => { scope.put(['prefix', '1']); await wait;
      assert.throws(() => scope.put(['late', '2'])); })();
    return pending;
  });
  fault(); assert.throws(record, refused('rolled_back')); resume(); await pending;
  assert.equal(count(), 0); assert.throws(record); stops();
`));

test('retained terminal may not take over an ordinary transaction or survive a closed connection', () => child(`
  const transact = factory(db, defs);
  db.transaction(() => assert.throws(() => transact.retainTerminal(() => null)));
  // Conservative refusal for an unavailable retention boundary latches fault.
  assert.throws(healthy);
  const record = (() => { try { return transact.retainTerminal(() => null); } catch { return null; } })();
  assert.equal(record, null); assert.equal(count(), 0);
`));

test('already retained terminal on closed connection fails without opening a replacement', () => child(`
  const transact = factory(db, defs);
  let callbacks = 0;
  const record = transact.retainTerminal(scope => { callbacks++; scope.put(['closed', '1']); });
  db.close(); assert.equal(db.raw.isOpen, false); fault();
  assert.throws(record, refused('not_started')); assert.throws(record); stops();
  assert.equal(callbacks, 0); assert.equal(db.raw.isOpen, false);
`));

test('outer candidate observes commit with WAL/FULL and restores NORMAL without changing ordinary API', () => child(`
  const wrapped = { ...db, run(sql, params) {
    assert.equal(db.raw.isTransaction, true);
    assert.equal(db.get('PRAGMA synchronous').synchronous, 2);
    return db.run(sql, params);
  } };
  const transact = factory(wrapped, defs);
  assert.deepEqual(transact(scope => { scope.put(['a', '1200000']); return scope.read(['a']); }),
    { transactionOutcome: 'commit_observed', value: { id: 'a', amount: '1200000' } });
  assert.equal(count(), 1); assert.equal(db.raw.isTransaction, false);
  assert.equal(db.get('PRAGMA synchronous').synchronous, 1); healthy();
  db.transaction(() => assert.equal(db.raw.isTransaction, true));
`));

test('callback rejection rolls back prefix and revokes async scope without poisoning healthy connection', () => child(`
  const transact = factory(db, defs);
  assert.throws(() => transact(scope => { scope.put(['prefix', '1']); throw new Error('private cause'); }), refused('rolled_back'));
  let resume; let pending;
  const wait = new Promise(resolve => { resume = resolve; });
  assert.throws(() => transact(scope => {
    pending = (async () => { scope.put(['async-prefix', '2']); await wait;
      assert.throws(() => scope.put(['late', '3'])); })();
    return pending;
  }), refused('rolled_back'));
  resume(); await pending;
  assert.equal(count(), 0); healthy();
  assert.equal(transact(scope => scope.put(['next', '4'])).transactionOutcome, 'commit_observed');
`));

test('ordinary active transaction and unsupported configuration refuse without taking ownership or faulting', () => child(`
  const transact = factory(db, defs);
  db.transaction(() => {
    db.run('INSERT INTO outer_fixture VALUES (?,?)', ['ordinary', '1']);
    assert.throws(() => transact(() => assert.fail('callback')), refused('not_started'));
    assert.equal(db.raw.isTransaction, true);
    assert.equal(db.get('PRAGMA synchronous').synchronous, 1);
  });
  assert.equal(count(), 1); healthy();
  db.exec('PRAGMA synchronous = OFF');
  assert.throws(() => transact(() => null), refused('not_started'));
  assert.equal(db.get('PRAGMA synchronous').synchronous, 0); healthy();
  db.exec('PRAGMA synchronous = NORMAL');
`));

test('same raw identity reentry across wrappers/HMR poisons outer even when caught', () => child(`
  const copy = await import('/app/src/lib/accounting/node-outer-transaction.js?hmr=outer');
  const first = factory(db, defs); const second = copy.createNodeOuterTransaction({ ...db }, defs);
  assert.throws(() => first(scope => {
    scope.put(['prefix', '1']);
    assert.throws(() => second(() => null), refused('not_started'));
  }), refused('rolled_back'));
  assert.equal(count(), 0); stops();
`));

test('BEGIN failures before/after execution issue no success and stop subsequent accounting', () => {
  for (const after of [false, true]) child(`
    const wrapped = { ...db, exec(sql) {
      if (sql === 'BEGIN IMMEDIATE') {
        ${after ? 'db.exec(sql);' : ''} throw new Error('fake begin fault');
      } return db.exec(sql);
    } };
    assert.throws(() => factory(wrapped, defs)(scope => scope.put(['a', '1'])), refused('${after ? 'rolled_back' : 'not_started'}'));
    assert.equal(count(), 0); assert.equal(db.raw.isTransaction, false);
    assert.equal(db.get('PRAGMA synchronous').synchronous, 1); stops();
  `);
});

test('COMMIT fault before execution rolls back; after-execution thrown result stays unknown, not observed commit', () => {
  for (const after of [false, true]) child(`
    const wrapped = { ...db, exec(sql) {
      if (sql === 'COMMIT') {
        ${after ? 'db.exec(sql);' : ''} throw new Error('fake commit fault');
      } return db.exec(sql);
    } };
    assert.throws(() => factory(wrapped, defs)(scope => scope.put(['a', '1'])), refused('${after ? 'unknown' : 'rolled_back'}'));
    assert.equal(count(), ${after ? 1 : 0}); assert.equal(db.raw.isTransaction, false);
    assert.equal(db.get('PRAGMA synchronous').synchronous, 1); stops();
  `);
});

test('rollback failures before/after execution remain unknown and quarantined', () => {
  for (const after of [false, true]) child(`
    const wrapped = { ...db, exec(sql) {
      if (sql === 'ROLLBACK') {
        ${after ? 'db.exec(sql);' : ''} throw new Error('fake rollback fault');
      } return db.exec(sql);
    } };
    assert.throws(() => factory(wrapped, defs)(scope => { scope.put(['a', '1']); throw new Error('reject'); }), refused('unknown'));
    assert.equal(db.raw.isTransaction, ${after ? 'false' : 'true'});
    if (db.raw.isTransaction) { assert.equal(db.get('PRAGMA synchronous').synchronous, 2); db.exec('ROLLBACK'); }
    assert.equal(count(), 0); stops();
  `);
});

test('post-commit restoration failure preserves observed commit but denies success', () => {
  for (const after of [false, true]) child(`
    const wrapped = { ...db, exec(sql) {
      if (sql === 'PRAGMA synchronous = NORMAL') {
        ${after ? 'db.exec(sql);' : ''} throw new Error('fake restore fault');
      } return db.exec(sql);
    } };
    assert.throws(() => factory(wrapped, defs)(scope => scope.put(['a', '1'])), refused('commit_observed'));
    assert.equal(count(), 1); assert.equal(db.raw.isTransaction, false); stops();
  `);
});

test('PRAGMA/readback/state verification faults quarantine rather than guessing success', () => {
  for (const stage of ['mode', 'full-readback', 'restore-readback', 'state-after-commit']) child(`
    let syncReads = 0; let committed = false;
    const stage = '${stage}';
    const wrapped = { ...db,
      raw: stage === 'state-after-commit' ? { get isTransaction() {
        if (committed) throw new Error('fake state verification fault');
        return db.raw.isTransaction;
      } } : db.raw,
      exec(sql) { const result = db.exec(sql); if (sql === 'COMMIT') committed = true; return result; },
      get(sql, params) {
        if (sql === 'PRAGMA journal_mode' && stage === 'mode') throw new Error('fake mode read');
        if (sql === 'PRAGMA synchronous') {
          syncReads++;
          if (stage === 'full-readback' && syncReads === 2 || stage === 'restore-readback' && syncReads === 3) throw new Error('fake readback');
        }
        return db.get(sql, params);
      }
    };
    assert.throws(() => factory(wrapped, defs)(scope => scope.put(['a', '1'])),
      refused(stage === 'restore-readback' ? 'commit_observed' : stage === 'state-after-commit' ? 'unknown' : 'not_started'));
    assert.equal(count(), stage === 'restore-readback' || stage === 'state-after-commit' ? 1 : 0); stops();
  `);
});

test('fault during callback prevents COMMIT; fault during restoration suppresses post-commit success', () => {
  child(`
    assert.throws(() => factory(db, defs)(scope => { scope.put(['a', '1']); fault(); }), refused('rolled_back'));
    assert.equal(count(), 0); stops();
  `);
  child(`
    const wrapped = { ...db, exec(sql) {
      const value = db.exec(sql); if (sql === 'PRAGMA synchronous = NORMAL') fault(); return value;
    } };
    assert.throws(() => factory(wrapped, defs)(scope => scope.put(['a', '1'])), refused('commit_observed'));
    assert.equal(count(), 1); stops();
  `);
});

test('caught scope/SQL errors cannot authorize COMMIT or mask a storage fault', () => child(`
  const transact = factory(db, defs);
  assert.throws(() => transact(scope => {
    scope.put(['prefix', '1']); assert.throws(() => scope.put([true]));
  }), refused('rolled_back'));
  assert.equal(count(), 0); healthy();
  assert.throws(() => transact(scope => {
    scope.put(['duplicate', '1']); assert.throws(() => scope.put(['duplicate', '2']));
  }), refused('rolled_back'));
  assert.equal(count(), 0); stops();
`));

test('caught SQL fault latches before callback can dispatch or reach another adapter operation', () => {
  for (const injected of [false, true]) child(`
    let calls = 0; const commands = [];
    const wrapped = { ...db,
      run(sql, params) {
        calls++;
        if (${injected} && calls === 2) throw new Error('injected SQL recording failure');
        return db.run(sql, params);
      },
      exec(sql) { commands.push(sql); return db.exec(sql); }
    };
    assert.throws(() => factory(wrapped, defs)(scope => {
      scope.put(['duplicate', '1']);
      assert.throws(() => scope.put(['duplicate', '2']));
      assert.throws(healthy); // BEFORE callback returns to outer catch/finally.
      let posts = 0;
      assert.throws(() => dispatch(() => true, () => { posts++; }));
      assert.equal(posts, 0);
      assert.throws(() => scope.put(['after-fault', '3']));
      assert.equal(calls, 2);
    }), refused('rolled_back'));
    assert.equal(count(), 0);
    assert.equal(commands.includes('COMMIT'), false);
    assert.equal(commands.includes('ROLLBACK'), true); stops();
  `);
});

test('fault during parameter processing prevents the next actual SQL invocation', () => child(`
  let calls = 0;
  const wrapped = { ...db, run(sql, params) { calls++; return db.run(sql, params); } };
  assert.throws(() => factory(wrapped, defs)(scope => {
    const params = new Proxy(['never', '1'], { getPrototypeOf(target) {
      fault(); return Reflect.getPrototypeOf(target);
    } });
    assert.throws(() => scope.put(params));
  }), refused('rolled_back'));
  assert.equal(calls, 0); assert.equal(count(), 0); stops();
`));

test('reentry during restoration remains guarded and cannot erase commit outcome', () => child(`
  let second;
  const wrapped = { ...db, exec(sql) {
    const value = db.exec(sql);
    if (sql === 'PRAGMA synchronous = NORMAL') assert.throws(() => second(() => null), refused('not_started'));
    return value;
  } };
  const first = factory(wrapped, defs); second = factory(db, defs);
  assert.throws(() => first(scope => scope.put(['a', '1'])), refused('commit_observed'));
  assert.equal(count(), 1); stops();
`));
