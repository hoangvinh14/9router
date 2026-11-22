import fs from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

assert.equal(process.env.BUDGET_PURE_SANDBOX, '1');
assert.equal(process.version, 'v24.21.0');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'), process.env.BUDGET_OUTER_NET);
assert.equal(process.env.TMPDIR, '/sandbox/tmp');
for (const hidden of ['/home/gmo', '/app/.env', '/app/.git', '/app/node_modules', '/app/src/lib/db/driver.js']) {
  assert.equal(fs.existsSync(hidden), false);
}
const mounts = fs.readFileSync('/proc/self/mountinfo', 'utf8').trim().split('\n').map(line => {
  const fields = line.split(' '); return { path: fields[4], options: fields[5].split(',') };
});
for (const target of ['/', '/app/src/lib/accounting/sql-operation-scope.js', '/app/tests/unit/budget-operation-scope.test.mjs']) {
  const covering = mounts.filter(m => target === m.path || target.startsWith(`${m.path.replace(/\/$/, '')}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  assert.ok(covering?.options.includes('ro'));
}
const { createSqlOperationScope: factory } = await import('../../src/lib/accounting/sql-operation-scope.js');
const { createNodeSqliteAdapter } = await import('../../src/lib/db/adapters/nodeSqliteAdapter.js');
const unavailable = error => error.code === 'api_key_accounting_unavailable' && error.status === 503;
const definitions = {
  put: { method: 'run', sql: 'INSERT INTO scoped_fixture VALUES (?,?)' },
  get: { method: 'get', sql: 'SELECT * FROM scoped_fixture WHERE id = ?' },
  list: { method: 'all', sql: 'SELECT * FROM scoped_fixture ORDER BY id' },
};
// One disposable connection, closed in finally. Other prior fixture connections
// still expose the existing listener accumulation; no warning suppression.
test('fixed SQL operation scope on existing Node adapter', async t => {
  const db = await createNodeSqliteAdapter('/tmp/operation-scope.sqlite');
  try {
    db.exec('CREATE TABLE scoped_fixture (id TEXT PRIMARY KEY, amount TEXT NOT NULL)');
    const execute = factory(db, definitions);
    const run = callback => db.transaction(() => execute(callback));
    await t.test('fixed operations, detached JSON results, sequential calls and missing get', () => {
      const result = run(scope => {
        assert.equal(Object.getPrototypeOf(scope), null);
        assert.ok(Object.isFrozen(scope));
        assert.deepEqual(Object.keys(scope).sort(), ['get', 'list', 'put']);
        assert.equal(scope.get(['missing']), null);
        scope.put(['first', '1200000']);
        const row = scope.get(['first']); row.amount = 'changed-detached-copy';
        assert.equal(scope.get(['first']).amount, '1200000');
        return scope.list();
      });
      assert.deepEqual(result, [{ id: 'first', amount: '1200000' }]);
    });
    await t.test('retained scope and destructured methods revoke after return and throw', () => {
      let saved;
      assert.equal(run(scope => { saved = scope.put; }), null);
      assert.throws(() => saved(['late-return', '1']), unavailable);
      assert.throws(() => run(scope => { saved = scope.put; throw new Error('private cause'); }), unavailable);
      assert.throws(() => saved(['late-throw', '1']), unavailable);
      assert.equal(db.get('SELECT COUNT(*) AS count FROM scoped_fixture').count, 1);
    });
    await t.test('async callback prefix rolls back and delayed scope write cannot autocommit', async () => {
      let resume; let continuation;
      const wait = new Promise(resolve => { resume = resolve; });
      assert.throws(() => run(scope => {
        continuation = (async () => {
          scope.put(['async-prefix', '2']);
          await wait;
          assert.throws(() => scope.put(['async-late', '3']), unavailable);
        })();
        return continuation;
      }), unavailable);
      resume(); await continuation;
      assert.equal(db.get('SELECT COUNT(*) AS count FROM scoped_fixture').count, 1);
    });
    await t.test('rejected async continuation is observed without granting post-callback authority', async () => {
      let reached = false;
      assert.throws(() => run(async scope => {
        await Promise.resolve(); reached = true; scope.put(['reject-late', '1']);
      }), unavailable);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(reached, true);
      assert.equal(db.get('SELECT COUNT(*) AS count FROM scoped_fixture').count, 1);
    });
    await t.test('thenable assimilation and return Proxy traps happen only after revocation', async () => {
      let thenCalled = false; let trapCalled = false;
      assert.throws(() => run(scope => ({ then(resolve) {
        thenCalled = true;
        assert.throws(() => scope.put(['then-late', '1']), unavailable); resolve(true);
      } })), unavailable);
      assert.throws(() => run(scope => new Proxy({}, { get(target, key) {
        if (key === 'then') {
          trapCalled = true;
          assert.throws(() => scope.put(['trap-late', '1']), unavailable);
        }
        return Reflect.get(target, key);
      } })), unavailable);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(thenCalled, true); assert.equal(trapCalled, true);
      assert.equal(db.get('SELECT COUNT(*) AS count FROM scoped_fixture').count, 1);
    });
    await t.test('nested execution across factories and module copies poisons outer scope even if caught', async () => {
      const copy = await import('../../src/lib/accounting/sql-operation-scope.js?hmr=scope-fixture');
      const second = copy.createSqlOperationScope(db, definitions);
      assert.throws(() => run(scope => {
        scope.put(['nested-prefix', '1']);
        assert.throws(() => second(() => null), unavailable);
      }), unavailable);
      assert.equal(db.get('SELECT COUNT(*) AS count FROM scoped_fixture').count, 1);
      assert.equal(run(scope => scope.get(['missing'])), null);
    });
    await t.test('parameter validation reentry is refused before adapter invocation', () => {
      assert.throws(() => run(scope => {
        const params = new Proxy(['never', '1'], { getPrototypeOf(target) {
          assert.throws(() => scope.put(['nested-param', '1']), unavailable);
          return Reflect.getPrototypeOf(target);
        } });
        assert.throws(() => scope.put(params), unavailable);
      }), unavailable);
      assert.equal(db.get('SELECT COUNT(*) AS count FROM scoped_fixture').count, 1);
    });
    await t.test('operation errors caught by callback still roll back prefix writes', () => {
      assert.throws(() => run(scope => {
        scope.put(['caught-prefix', '1']);
        assert.throws(() => scope.put(['first', 'duplicate']), unavailable);
      }), unavailable);
      assert.equal(db.get('SELECT COUNT(*) AS count FROM scoped_fixture').count, 1);
    });
    await t.test('unsupported binder input refuses rather than coercing or accepting client SQL', () => {
      for (const params of [[true], [1.5], [1n], [new Uint8Array([1])], ['bad\0id', '1'], [{ sql: 'COMMIT' }]]) {
        assert.throws(() => run(scope => scope.put(params)), unavailable);
      }
      assert.throws(() => factory(db, { arbitrary: { method: 'exec', sql: 'COMMIT' } }), unavailable);
      assert.equal(db.get('SELECT COUNT(*) AS count FROM scoped_fixture').count, 1);
    });
    await t.test('catching scope rejection INSIDE transaction is still unsafe and is not hidden', () => {
      db.transaction(() => {
        assert.throws(() => execute(scope => {
          scope.put(['bad-caller-caught', '5']); throw new Error('fixture rejection');
        }), unavailable);
      });
      assert.equal(db.get('SELECT amount FROM scoped_fixture WHERE id = ?', ['bad-caller-caught']).amount, '5');
      db.run('DELETE FROM scoped_fixture WHERE id = ?', ['bad-caller-caught']);
    });
  } finally { db.close(); }
});

test('operation results cannot export handles, promises, accessors or unsafe numbers', async () => {
  for (const result of [() => 1, { raw: () => 1 }, { amount: Number.MAX_SAFE_INTEGER + 1 }, 1n,
    Object.defineProperty({}, 'raw', { enumerable: true, get() { assert.fail('accessor executed'); } }),
    Promise.reject(new Error('fake async adapter'))]) {
    const execute = factory({ get: () => result }, { read: { method: 'get', sql: 'fixed trusted fixture' } });
    assert.throws(() => execute(scope => scope.read()), unavailable);
  }
  await new Promise(resolve => setImmediate(resolve));
});
