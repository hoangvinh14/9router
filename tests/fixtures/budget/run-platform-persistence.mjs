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

function run(childStep, dataDir, env, cwd) {
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), childStep], {
    cwd, env: { ...env, DATA_DIR: dataDir, BUDGET_PLATFORM_FIXTURE: '1' },
    stdio: 'inherit', timeout: 15000,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, childStep);
}

async function exercise(step) {
  const { getAccountingAdapter } = await import('../../../src/lib/db/driver.js');
  const { DATA_DIR } = await import('../../../src/lib/dataDir.js');
  const { DATA_FILE } = await import('../../../src/lib/db/paths.js');
  const { provisionEmptyNodeAccountingSchema } = await import('../../../src/lib/accounting/node-existing-audit.js');
  const { createNodeKeyPolicy } = await import('../../../src/lib/accounting/node-key-policy.js');
  const { createNodeAttemptLedger } = await import('../../../src/lib/accounting/node-attempt-ledger.js');
  const { EXCLUSIVE_USAGE } = await import('../../../src/lib/accounting/terminal-cost.js');
  const { backupDbLite } = await import('../../../src/lib/db/backup.js');
  const { DatabaseSync } = await import('node:sqlite');
  assert.equal(DATA_DIR, process.env.DATA_DIR);
  const db = await getAccountingAdapter();
  try {
    assert.equal(db.driver, 'node:sqlite');
    if (step === 'write') provisionEmptyNodeAccountingSchema(db);
    const policy = createNodeKeyPolicy(db);
    const ledger = createNodeAttemptLedger(db);
    const context = { presentedSecret, now };
    let sent = 0;
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
      run('observe-in-flight', DATA_DIR, process.env, process.cwd());
      const evidence = { semantics: EXCLUSIVE_USAGE, components: [{ category: 'input', count: 3000, unit: 'USD/1M tokens' }] };
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
      if (step === 'source') {
        const peer = new DatabaseSync(DATA_FILE);
        try {
          peer.exec('BEGIN IMMEDIATE');
          db.exec('PRAGMA busy_timeout = 10');
          assert.throws(() => ledger.prepare(attempt('contender')));
          assert.throws(() => ledger.dispatch(prepared.ack, context, () => sent++));
          assert.equal(sent, 0);
          assert.equal(peer.prepare("SELECT count(*) AS n FROM accounting_attempts_v1 WHERE id = 'contender'").get().n, 0);
        } finally { peer.close(); }
      }
    }
    assert.equal(db.get('PRAGMA integrity_check').integrity_check, 'ok');
  } finally { db.close(); }
}

const step = process.argv[2];
if (step) {
  assert.ok(['write', 'source', 'restored', 'observe-in-flight'].includes(step));
  assert.equal(process.env.BUDGET_PLATFORM_FIXTURE, '1');
  await exercise(step);
} else {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '9router-budget-platform-'));
  try {
    const env = {};
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
    fs.renameSync(path.join(source, 'backup', 'data.sqlite'), path.join(restored, 'db', 'data.sqlite'));
    run('restored', restored, env, root);
    console.log(`SQLite persistence passed on ${process.platform} ${process.arch} ${process.version}`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
