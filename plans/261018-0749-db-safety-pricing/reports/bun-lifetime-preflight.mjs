import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = '/tmp/9router-db-safety-bun-RuROb8';
const result = { status: 'failed', cases: [], cleanupErrors: [], runtime: process.versions.bun ?? null };
const databases = new Set();
const statements = new Set();
function check(name, fn) {
  const entry = { name, status: 'failed' }; result.cases.push(entry);
  try { fn(entry); entry.status = 'passed'; }
  catch (error) { entry.error = { name: error.name, message: error.message }; throw error; }
}
function observe(fn) {
  try { return { returned: fn() }; }
  catch (error) { return { error: { name: error.name, message: error.message } }; }
}
try {
  assert.equal(fs.realpathSync(process.env.DB_SAFETY_FIXTURE_ROOT), root);
  assert.equal(fs.realpathSync(root), root);
  assert.equal(fs.statSync(root).uid, process.getuid());
  assert.equal(fs.statSync(root).mode & 0o077, 0);
  for (const key of ['HOME', 'DATA_DIR', 'TMPDIR', 'XDG_CACHE_HOME']) assert.equal(path.dirname(fs.realpathSync(process.env[key])), path.join(root, 'fixtures'));
  assert.equal(process.versions.bun, '1.4.3');
  assert.equal(fs.realpathSync(process.execPath), path.join(root, 'bin/bun'));
  result.revision = Bun.revision;
  assert.equal(typeof result.revision, 'string'); assert.ok(result.revision.length > 0);
  assert.throws(() => globalThis.fetch('https://invalid.example'), /network disabled/);
  const { Database } = await import('bun:sqlite');
  const open = name => {
    const file = path.join(process.env.DATA_DIR, name + '.sqlite');
    assert.equal(fs.existsSync(file), false);
    const db = new Database(file, { create: true }); databases.add(db); return { db, file };
  };
  const prepare = (db, sql) => { const statement = db.prepare(sql); statements.add(statement); return statement; };
  check('default close retained prepare statement lifetime (observational)', entry => {
    const { db } = open('default-close');
    const statement = prepare(db, 'SELECT 1 AS value');
    assert.equal(statement.get().value, 1);
    db.close(); entry.afterDefaultClose = observe(() => statement.get());
    // No GC/sleep assumption: enforce final closure explicitly for fixture cleanup.
    db.close(true);
    assert.throws(() => statement.get()); databases.delete(db);
  });
  check('strict close finalizes retained prepare statements and repeated close is safe', () => {
    const { db } = open('strict-close');
    const statement = prepare(db, 'SELECT 2 AS value');
    assert.equal(statement.get().value, 2);
    db.close(true); assert.throws(() => statement.get()); db.close(true); databases.delete(db);
  });
  check('strict close with active transaction does not publish uncommitted value', entry => {
    const { db, file } = open('strict-transaction');
    db.exec('CREATE TABLE fixture(value TEXT); BEGIN;');
    const statement = prepare(db, 'INSERT INTO fixture VALUES(?)'); statement.run('not-ACK');
    db.close(true); databases.delete(db); assert.throws(() => statement.run('late-write'));
    const reopened = new Database(file); databases.add(reopened);
    entry.reopenedRows = reopened.prepare('SELECT count(*) AS c FROM fixture').get().c;
    assert.equal(entry.reopenedRows, 0);
    reopened.close(true); databases.delete(reopened);
  });
  check('default close transaction statement reachability (observational) then strict cleanup', entry => {
    const { db, file } = open('default-transaction');
    db.exec('CREATE TABLE fixture(value TEXT); BEGIN;');
    const statement = prepare(db, 'INSERT INTO fixture VALUES(?)'); statement.run('not-ACK');
    db.close(); entry.afterDefaultClose = observe(() => statement.run('after-default-close'));
    db.close(true); databases.delete(db); assert.throws(() => statement.run('late-write'));
    const reopened = new Database(file); databases.add(reopened);
    entry.reopenedRows = reopened.prepare('SELECT count(*) AS c FROM fixture').get().c;
    assert.equal(entry.reopenedRows, 0);
    reopened.close(true); databases.delete(reopened);
  });
  assert.equal(result.cases.length, 4);
  result.status = 'passed';
} catch (error) {
  result.error = { name: error.name, code: error.code ?? null, message: error.message }; process.exitCode = 1;
} finally {
  for (const statement of statements) {
    try { statement.finalize(); } catch (error) { result.cleanupErrors.push(error.message); }
  }
  for (const db of databases) {
    try { db.close(true); } catch (error) { result.cleanupErrors.push(error.message); }
  }
  if (result.cleanupErrors.length) { result.status = 'failed'; process.exitCode = 1; }
  result.passed = result.cases.filter(entry => entry.status === 'passed').length;
  fs.writeFileSync(path.join(root, 'evidence/lifetime-preflight-result.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
}
