import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = '/tmp/9router-db-safety-bun-r4-6NqeKj';
const result = { status: 'failed', runtime: process.versions.bun, cases: [], cleanupErrors: [], kind: 'actual Bun engine with explicitly injected JS prepare/close faults' };
const engines = new Set();
const adapters = new Set();
let prototype, originalPrepare, originalClose;
async function check(name, fn) {
  const item = { name, status: 'failed' }; result.cases.push(item);
  try { await fn(item); item.status = 'passed'; }
  catch (error) { item.error = { name: error.name, message: error.message }; throw error; }
}
try {
  assert.equal(process.versions.bun, '1.4.3');
  assert.equal(fs.realpathSync(process.execPath), path.join(root, 'bin/bun'));
  assert.equal(fs.realpathSync(process.env.DB_SAFETY_FIXTURE_ROOT), root);
  assert.throws(() => globalThis.fetch('https://invalid.example'), /network disabled/);
  const { Database } = await import('bun:sqlite');
  const { createBunSqliteAdapter: create } = await import('../mirror/src/lib/db/adapters/bunSqliteAdapter.js');
  prototype = Database.prototype;
  originalPrepare = Object.getOwnPropertyDescriptor(prototype, 'prepare');
  originalClose = Object.getOwnPropertyDescriptor(prototype, 'close');
  assert.equal(typeof originalPrepare?.value, 'function'); assert.equal(typeof originalClose?.value, 'function');
  function restore() {
    Object.defineProperty(prototype, 'prepare', originalPrepare);
    Object.defineProperty(prototype, 'close', originalClose);
  }
  function instrument({ initFault, closeFault }) {
    const held = [], closeCalls = [];
    Object.defineProperty(prototype, 'prepare', { ...originalPrepare, value: function (...args) {
      engines.add(this);
      const statement = Reflect.apply(originalPrepare.value, this, args);
      held.push(statement);
      if (initFault && args[0] === 'PRAGMA journal_mode') throw new Error('injected init after native prepare');
      return statement;
    } });
    Object.defineProperty(prototype, 'close', { ...originalClose, value: function (...args) {
      engines.add(this); closeCalls.push(args);
      if (closeFault.value) throw new Error('injected strict close failure');
      return Reflect.apply(originalClose.value, this, args);
    } });
    return { held, closeCalls };
  }
  await check('initialization failure after real prepare strictly finalizes before release', async item => {
    const file = path.join(root, 'fixtures/data/fault-init-ok/data.sqlite');
    const observed = instrument({ initFault: true, closeFault: { value: false } });
    await assert.rejects(create(file), /injected init after native prepare/);
    assert.ok(observed.held.length > 0);
    for (const stmt of observed.held) assert.throws(() => stmt.get(), /closed/);
    assert.deepEqual(observed.closeCalls, [[true]]);
    restore();
    const next = await create(file); adapters.add(next); next.close(); adapters.delete(next);
    item.strictCalls = observed.closeCalls;
  });
  await check('real-engine close fault poisons and retains owner until strict retry; committed data persists', async item => {
    const file = path.join(root, 'fixtures/data/fault-close/data.sqlite');
    const fault = { value: false };
    const observed = instrument({ initFault: false, closeFault: fault });
    const db = await create(file); adapters.add(db);
    db.exec('CREATE TABLE fixture(value TEXT)');
    db.durableTransaction(() => db.run("INSERT INTO fixture VALUES('committed')"));
    const beforeRollback = db.get('SELECT count(*) AS c FROM fixture').c; assert.equal(beforeRollback, 1);
    assert.throws(() => db.transaction(() => { db.run("INSERT INTO fixture VALUES('rollback')"); throw new Error('abort'); }), /abort/);
    fault.value = true;
    assert.throws(() => db.close(), /injected strict close failure/);
    assert.equal(db.health().poisoned, true); assert.equal(db.health().closed, false);
    assert.throws(() => db.get('SELECT 1'));
    await assert.rejects(create(file), /already active|in progress/);
    fault.value = false; db.close(); db.close(); adapters.delete(db);
    for (const stmt of observed.held) assert.throws(() => stmt.get(), /closed/);
    assert.deepEqual(observed.closeCalls, [[true], [true]]);
    restore();
    const next = await create(file); adapters.add(next);
    assert.deepEqual(next.all('SELECT value FROM fixture'), [{ value: 'committed' }]);
    next.close(); adapters.delete(next); item.strictCalls = observed.closeCalls;
  });
  await check('initialization plus strict-close failure retains exclusion; raw fixture cleanup never implies ACK', async item => {
    const file = path.join(root, 'fixtures/data/fault-init-uncertain/data.sqlite');
    const observed = instrument({ initFault: true, closeFault: { value: true } });
    await assert.rejects(create(file), /injected strict close failure/);
    restore();
    await assert.rejects(create(file), /already active|in progress/);
    assert.deepEqual(observed.closeCalls, [[true]]);
    // No adapter escaped failed construction. Only fixture teardown owns these raw references.
    for (const engine of engines) Reflect.apply(originalClose.value, engine, [true]);
    for (const stmt of observed.held) assert.throws(() => stmt.get(), /closed/);
    item.retainedLock = fs.existsSync(path.join(path.dirname(file), '.gateway-writer.lock'));
    assert.equal(item.retainedLock, true);
    item.recovery = 'left fixture lock intact; no automatic release/ACK inferred after raw teardown';
  });
  result.status = 'passed';
} catch (error) {
  result.error = { name: error.name, code: error.code ?? null, message: error.message }; process.exitCode = 1;
} finally {
  if (prototype && originalPrepare && originalClose) {
    Object.defineProperty(prototype, 'prepare', originalPrepare);
    Object.defineProperty(prototype, 'close', originalClose);
  }
  for (const db of adapters) { try { db.close(); } catch (error) { result.cleanupErrors.push(error.message); } }
  for (const engine of engines) { try { Reflect.apply(originalClose.value, engine, [true]); } catch (error) { result.cleanupErrors.push(error.message); } }
  if (result.cleanupErrors.length) { result.status = 'failed'; process.exitCode = 1; }
  result.passed = result.cases.filter(item => item.status === 'passed').length;
  fs.writeFileSync(path.join(root, 'evidence/close-fault-result.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
}
