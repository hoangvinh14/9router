import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createNodeSqliteAdapter } from '../../../src/lib/db/adapters/nodeSqliteAdapter.js';
import { createNodeKeyPolicy, initializeNodeKeyPolicy } from '../../../src/lib/accounting/node-key-policy.js';
import { createNodeAttemptLedger, initializeNodeAttemptLedger } from '../../../src/lib/accounting/node-attempt-ledger.js';
import { admitNodeAccountingConnection } from '../../../src/lib/accounting/node-connection-admission.js';
import { EXCLUSIVE_USAGE } from '../../../src/lib/accounting/terminal-cost.js';
import { assertAccountingHealthy } from '../../../src/lib/accounting/process-state.js';

assert.equal(process.env.BUDGET_PURE_SANDBOX, '1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'), process.env.BUDGET_OUTER_NET);
const [mode, phase] = process.argv.slice(2);
const checkpoint = phase?.startsWith('checkpoint-');
const db = checkpoint ? (await admitNodeAccountingConnection('ledger.sqlite')).adapter : await createNodeSqliteAdapter('ledger.sqlite');
const now = '2026-11-16T10:00:00.000Z';
try {
  if (mode === 'seed') {
    db.exec('CREATE TABLE apiKeys(id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, isActive INTEGER NOT NULL)');
    db.run("INSERT INTO apiKeys VALUES ('test','fixture',1)");
    initializeNodeKeyPolicy(db);
    initializeNodeAttemptLedger(db);
    createNodeKeyPolicy(db).save('test', 0, { weekly: null, monthly: '9000000' });
  }
  const ledger = createNodeAttemptLedger(db);
  const prepare = id => ledger.prepare({ attemptId: id, keyId: 'test', bindingGeneration: '1',
    provider: 'test', model: 'test', startedAt: now, price: { currency: 'USD', unit: 'USD/1M tokens',
      revision: 'test', rates: { input: '1', output: '2' } } });
  const usage = { semantics: EXCLUSIVE_USAGE, components: [{ category: 'input', count: 3000, unit: 'USD/1M tokens' }] };
  let posts = 0;
  const dispatch = attempt => ledger.dispatch(attempt.ack, { presentedSecret: 'fixture', now }, () => ++posts);
  if (mode === 'seed') {
    const known = prepare('known');
    dispatch(known);
    known.settle(usage);
    db.exec("VACUUM INTO 'baseline.sqlite'");
  } else if (mode === 'verify') {
    assert.equal(ledger.totals('test', now).monthly, checkpoint ? '6000000' : '3000000');
    assert.equal(db.get("SELECT amount FROM accounting_terminals_v1 WHERE attempt_id='known'").amount, '3000000');
    if (checkpoint) assert.equal(db.get("SELECT amount FROM accounting_terminals_v1 WHERE attempt_id='pending'").amount, '3000000');
    assert.equal(db.get('SELECT count(*) AS n FROM accounting_terminals_v1').n, checkpoint ? 2 : 1);
    assert.equal(db.get("SELECT count(*) AS n FROM accounting_attempts_v1 WHERE id='pending'").n, phase === 'terminal' || checkpoint ? 1 : 0);
    assert.equal(db.get('PRAGMA integrity_check').integrity_check, 'ok');
    if (checkpoint) {
      assert.equal(createNodeKeyPolicy(db).inspect('test').limits.monthly, '9000000');
      const resumed = prepare('after-restart');
      dispatch(resumed);
      resumed.settle(usage);
      assert.equal(ledger.totals('test', now).monthly, '9000000');
      assert.throws(() => dispatch(prepare('blocked-at-limit')));
      assert.equal(posts, 1);
    }
  } else if (checkpoint) {
    const next = prepare('next');
    const pending = prepare('pending');
    dispatch(pending);
    pending.settle(usage);
    fs.mkdirSync('sync-start');
    db.checkpoint();
    fs.mkdirSync('sync-end');
    if (mode === 'fault') {
      assert.throws(assertAccountingHealthy);
      assert.throws(() => dispatch(next));
      assert.equal(posts, 1);
      // Leave recovery to the next process, without a clean-close checkpoint.
      process.exit(0);
    } else {
      assertAccountingHealthy();
      dispatch(next);
      assert.equal(posts, 2);
    }
  } else {
    assert.equal(db.get('PRAGMA synchronous').synchronous, 1);
    const next = prepare('next');
    const pending = phase === 'terminal' ? prepare('pending') : null;
    if (pending) dispatch(pending);
    const afterDispatch = posts;
    assert.equal(db.get('PRAGMA wal_checkpoint(TRUNCATE)').busy, 0);
    const operation = pending ? () => pending.settle(usage) : () => dispatch(prepare('pending'));
    fs.mkdirSync('sync-start');
    if (mode === 'fault') {
      assert.throws(operation, e => e.code === 'api_key_accounting_unavailable');
      assert.throws(assertAccountingHealthy);
      assert.throws(() => dispatch(next));
      assert.equal(posts, afterDispatch);
    } else {
      operation();
      assert.equal(posts, 1);
    }
    fs.mkdirSync('sync-end');
  }
} finally { db.close(); }
