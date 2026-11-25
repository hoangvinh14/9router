import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const now = '2026-11-16T10:00:00.000Z';
const keyId = 'fixture-key';
const presentedSecret = 'fixture-secret';
const limit = '3000000';
const attempt = attemptId => ({
  attemptId, keyId, bindingGeneration: '1', provider: 'fixture', model: 'fixture', startedAt: now,
  price: { currency: 'USD', unit: 'USD/1M tokens', revision: 'fixture', rates: { input: '1', output: '2' } },
});

function run(childStep, dataDir, env, cwd, signal = null) {
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), childStep], {
    cwd, env: { ...env, DATA_DIR: dataDir, BUDGET_PLATFORM_FIXTURE: '1' },
    stdio: 'inherit', timeout: 15000,
  });
  if (result.error) throw result.error;
  assert.equal(result.signal, signal, childStep);
  assert.equal(result.status, signal ? null : 0, childStep);
}

async function exercise(step) {
  const { getAccountingAdapter } = await import('../../../src/lib/db/driver.js');
  const { DATA_DIR } = await import('../../../src/lib/dataDir.js');
  const { DATA_FILE } = await import('../../../src/lib/db/paths.js');
  const { provisionEmptyNodeAccountingSchema } = await import('../../../src/lib/accounting/node-existing-audit.js');
  const { createNodeKeyPolicy } = await import('../../../src/lib/accounting/node-key-policy.js');
  const { createNodeAttemptLedger } = await import('../../../src/lib/accounting/node-attempt-ledger.js');
  const { assertAccountingHealthy } = await import('../../../src/lib/accounting/process-state.js');
  const { EXCLUSIVE_USAGE } = await import('../../../src/lib/accounting/terminal-cost.js');
  const { backupDbLite } = await import('../../../src/lib/db/backup.js');
  assert.equal(DATA_DIR, process.env.DATA_DIR);
  const db = await getAccountingAdapter();
  try {
    assert.equal(db.driver, process.env.BUDGET_EXPECTED_DRIVER);
    if (step === 'write') provisionEmptyNodeAccountingSchema(db);
    const policy = createNodeKeyPolicy(db);
    const ledger = createNodeAttemptLedger(db);
    const context = { presentedSecret, now };
    const evidence = { semantics: EXCLUSIVE_USAGE, components: [{ category: 'input', count: 3000, unit: 'USD/1M tokens' }] };
    let sent = 0;
    if (step === 'image-before-publish' || step === 'image-after-publish') {
      policy.save(keyId, 1, { weekly: null, monthly: '6000000' });
      const original = ledger.prepare(attempt('faulted-terminal'));
      ledger.dispatch(original.ack, context, () => sent++);
      const prepared = ledger.prepare(attempt('prepared-before-fault'));
      const rename = fs.renameSync;
      const sync = fs.fsyncSync;
      let syncs = 0;
      if (step === 'image-before-publish') fs.renameSync = () => { throw new Error('fixture rename failure'); };
      else fs.fsyncSync = fd => {
        if (++syncs === 2) throw new Error('fixture directory fsync failure');
        return sync(fd);
      };
      try { assert.throws(() => original.settle(evidence)); }
      finally { fs.renameSync = rename; fs.fsyncSync = sync; }
      assert.throws(assertAccountingHealthy);
      assert.throws(() => ledger.dispatch(prepared.ack, context, () => sent++));
      assert.equal(sent, 1);
      process.kill(process.pid, 'SIGKILL');
    }
    if (step === 'recover-before-publish' || step === 'recover-after-publish') {
      const committed = step === 'recover-after-publish';
      assert.equal(ledger.totals(keyId, now).monthly, committed ? '6000000' : limit);
      const prepared = ledger.prepare(attempt('after-fault'));
      if (committed) assert.throws(() => ledger.dispatch(prepared.ack, context, () => sent++));
      else ledger.dispatch(prepared.ack, context, () => sent++);
      assert.equal(sent, committed ? 0 : 1);
      return;
    }
    if (step === 'checkpoint-error') {
      policy.save(keyId, 1, { weekly: null, monthly: null });
      const prepared = ledger.prepare(attempt('checkpoint-error'));
      const execute = db.raw.exec;
      db.raw.exec = function (sql) {
        if (sql === 'PRAGMA wal_checkpoint(TRUNCATE)') {
          throw Object.assign(new Error('fixture checkpoint failure'), { code: 'SQLITE_IOERR', errcode: 10 });
        }
        return execute.call(this, sql);
      };
      try { db.checkpoint(); }
      finally { db.raw.exec = execute; }
      assert.throws(assertAccountingHealthy);
      assert.throws(() => ledger.dispatch(prepared.ack, context, () => sent++));
      assert.equal(sent, 0);
      assert.equal(db.get('SELECT amount FROM accounting_terminals_v1').amount, limit);
      return;
    }
    if (step === 'observe-in-flight') {
      assert.deepEqual(ledger.validateExistingAttempts(), { validatedAttempts: 1, validatedTerminals: 0 });
      assert.deepEqual(ledger.prepare(attempt('before-backup')), { replay: true });
      assert.deepEqual(ledger.validateExistingAttempts(), { validatedAttempts: 1, validatedTerminals: 0 });
      return;
    }
    if (step === 'write') {
      db.run('INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES(?,?,1,?)', [keyId, presentedSecret, now]);
      policy.save(keyId, 0, { weekly: null, monthly: limit });
      const original = ledger.prepare(attempt('before-backup'));
      ledger.dispatch(original.ack, context, () => sent++);
      assert.equal(sent, 1);
      if (db.driver !== 'sql.js') run('observe-in-flight', DATA_DIR, process.env, process.cwd());
      original.settle(evidence);
      assert.deepEqual(original.settle(evidence), { recorded: true, replay: true });
      assert.throws(() => original.settle(null), error => error.status === 409);
      const destination = path.join(DATA_DIR, 'backup');
      fs.mkdirSync(destination);
      backupDbLite(db, destination);
    } else {
      assert.equal(policy.inspect(keyId).limits.monthly, limit);
      assert.equal(ledger.totals(keyId, now).monthly, limit);
      assert.deepEqual(ledger.prepare(attempt('before-backup')), { replay: true });
      assert.deepEqual(ledger.validateExistingAttempts(), { validatedAttempts: 1, validatedTerminals: 1 });
      const prepared = ledger.prepare(attempt('after-reopen'));
      assert.throws(() => ledger.dispatch(prepared.ack, context, () => sent++));
      assert.equal(sent, 0);
      if (step === 'source' && db.driver !== 'sql.js') {
        policy.save(keyId, 1, { weekly: null, monthly: null });
        const peer = new db.raw.constructor(DATA_FILE);
        try {
          peer.exec('BEGIN IMMEDIATE');
          db.exec('PRAGMA busy_timeout = 10');
          assert.throws(() => ledger.prepare(attempt('contender')));
          assert.throws(assertAccountingHealthy);
          assert.throws(() => ledger.dispatch(prepared.ack, context, () => sent++));
          assert.equal(sent, 0);
          assert.equal(peer.prepare("SELECT count(*) AS n FROM accounting_attempts_v1 WHERE id = 'contender'").get().n, 0);
        } finally { peer.close(); }
      }
    }
    assert.equal(db.get('PRAGMA integrity_check').integrity_check, 'ok');
  } finally {
    db.close();
    assert.equal(globalThis._dbAdapter.accountingCloseDisposition.closure, 'confirmed');
  }
}

const step = process.argv[2];
if (process.env.BUDGET_PLATFORM_FIXTURE === '1') {
  assert.ok(['write', 'source', 'restored', 'observe-in-flight', 'checkpoint-error',
    'image-before-publish', 'image-after-publish', 'recover-before-publish', 'recover-after-publish'].includes(step));
  await exercise(step);
} else {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '9router-budget-platform-'));
  try {
    const expectedDriver = process.argv[2] ?? (process.versions.bun ? 'bun:sqlite' : 'node:sqlite');
    const env = { BUDGET_EXPECTED_DRIVER: expectedDriver };
    if (expectedDriver === 'sql.js') env.NINEROUTER_SQLJS_ACCOUNTING = '1';
    for (const name of ['SystemRoot', 'WINDIR', 'PATH']) {
      if (process.env[name]) env[name] = process.env[name];
    }
    for (const name of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_DATA_HOME',
      'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'TMPDIR', 'TEMP', 'TMP']) {
      env[name] = path.join(root, name);
      fs.mkdirSync(env[name]);
    }
    const source = path.join(root, 'source');
    run('write', source, env, root);
    run('source', source, env, root);
    const restored = path.join(root, 'restored');
    fs.mkdirSync(path.join(restored, 'db'), { recursive: true });
    if (expectedDriver === 'sql.js') {
      for (const timing of ['before-publish', 'after-publish']) {
        const faultDir = path.join(root, timing);
        fs.mkdirSync(path.join(faultDir, 'db'), { recursive: true });
        fs.copyFileSync(path.join(source, 'backup', 'data.sqlite'), path.join(faultDir, 'db', 'data.sqlite'));
        run('image-' + timing, faultDir, env, root, 'SIGKILL');
        run('recover-' + timing, faultDir, env, root);
      }
    }
    fs.renameSync(path.join(source, 'backup', 'data.sqlite'), path.join(restored, 'db', 'data.sqlite'));
    run('restored', restored, env, root);
    if (expectedDriver !== 'sql.js') run('checkpoint-error', restored, env, root);
    console.log(`SQLite persistence passed on ${expectedDriver} on ${process.platform} ${process.arch} ${process.versions.bun ?? process.version}`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
