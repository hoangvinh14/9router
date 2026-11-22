import fs from 'node:fs';
import path from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { canonical, timestamp } from '../src/lib/accounting/attempt-payload.js';
import { costFromExactUsageSnapshot, nanoUsd, validatePriceSnapshot } from '../src/lib/accounting/exact-money.js';
import { readAccountingMarkers } from '../src/lib/accounting/mutation-barrier.js';

const donorTables = ['apiKeyBindings', 'apiKeyAccounting', 'apiKeyAccountingAudit'];
const policyTable = 'apiKeyBudgetPolicies';
const states = ['pending', 'settled', 'unresolved', 'not_dispatched', 'waived', 'unrecorded'];
const invalid = () => { throw new Error('Invalid legacy accounting snapshot'); };

function recordedAmount(row, price, audit) {
  if (!Number.isSafeInteger(row.costNanoUsd)) invalid();
  const amount = nanoUsd(String(row.costNanoUsd));
  if (row.manuallyResolved === 0 && row.state === 'settled') {
    if (costFromExactUsageSnapshot(JSON.parse(row.usageJson), price) !== amount) invalid();
    return amount;
  }
  if (row.manuallyResolved !== 1) invalid();
  if (!audit || audit.apiKeyId !== row.apiKeyId) invalid();
  const resolution = JSON.parse(audit.afterJson);
  if (resolution?.action !== audit.action || resolution.operationId !== audit.operationId ||
      !Number.isSafeInteger(resolution.expectedVersion) || resolution.expectedVersion < 0 ||
      resolution.expectedVersion + 1 !== row.resolutionVersion) invalid();
  if (row.state === 'waived') {
    if (audit.action !== 'waive' || amount !== '0') invalid();
  } else if (audit.action === 'cost_correction') {
    if (nanoUsd(resolution.costNanoUsd) !== amount) invalid();
  } else if (audit.action === 'exact_usage') {
    if (costFromExactUsageSnapshot(resolution.usage, price) !== amount ||
        canonical(resolution.usage) !== canonical(JSON.parse(row.usageJson))) invalid();
  } else {
    invalid();
  }
  return amount;
}

function inspect(db, collect) {
  const markers = readAccountingMarkers({ all: (sql, args) => db.prepare(sql).all(...args) });
  const names = new Set(markers.map(marker => marker.name));
  if (markers.some(marker => marker.type !== 'table' || ![...donorTables, policyTable].includes(marker.name)) ||
      donorTables.some(name => !names.has(name))) invalid();
  if (db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') invalid();

  const resolutions = new Map();
  for (const audit of db.prepare(`SELECT attemptId, apiKeyId, operationId, action, afterJson
    FROM apiKeyAccountingAudit WHERE action IN ('waive','exact_usage','cost_correction')`).iterate()) {
    if (!audit.attemptId || resolutions.has(audit.attemptId)) invalid();
    resolutions.set(audit.attemptId, audit);
  }
  const knownBindings = db.prepare('SELECT 1 FROM apiKeyBindings WHERE apiKeyId = ?');
  const attempts = Object.fromEntries(states.map(state => [state, 0]));
  let amount = 0n;
  for (const row of db.prepare('SELECT * FROM apiKeyAccounting').iterate()) {
    if (!Object.hasOwn(attempts, row.state) || !row.attemptId || !knownBindings.get(row.apiKeyId)) invalid();
    timestamp(row.startedAt);
    const price = validatePriceSnapshot(JSON.parse(row.priceSnapshotJson));
    attempts[row.state]++;
    let recorded = null;
    if (row.state === 'settled' || row.state === 'waived') {
      const audit = resolutions.get(row.attemptId);
      recorded = recordedAmount(row, price, audit);
      amount += BigInt(recorded);
      if (row.manuallyResolved === 1) resolutions.delete(row.attemptId);
    } else if (row.costNanoUsd !== null) {
      invalid();
    }
    collect?.(row, price, recorded);
  }
  if (resolutions.size) invalid();
  return { attempts, recordedNanoUsd: amount.toString() };
}

function requireStandalone(snapshot) {
  if (!path.isAbsolute(snapshot ?? '') ||
      fs.realpathSync(snapshot) !== snapshot || !fs.lstatSync(snapshot).isFile()) invalid();
  for (const suffix of ['-wal', '-shm', '-journal']) {
    if (fs.lstatSync(snapshot + suffix, { throwIfNoEntry: false })) invalid();
  }
}

function openStandalone(snapshot) {
  requireStandalone(snapshot);
  // The input is a standalone, quiescent backup. Immutable mode never creates SQLite sidecars.
  const uri = pathToFileURL(snapshot);
  uri.searchParams.set('immutable', '1');
  return new DatabaseSync(uri.href, { readOnly: true, defensive: true });
}

function verifyBindings(source, target, bindingKey) {
  const sourceKey = source.prepare('SELECT key, isActive FROM apiKeys WHERE id = ?');
  const targetKey = target.prepare(`SELECT k.key, k.isActive, p.retired, p.weekly, p.monthly
    FROM apiKeys k JOIN accounting_key_policy_v1 p ON p.key_id = k.id WHERE k.id = ?`);
  const hasPolicies = source.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(policyTable);
  const sourcePolicy = hasPolicies && source.prepare('SELECT * FROM apiKeyBudgetPolicies WHERE apiKeyId = ?');
  for (const row of source.prepare('SELECT * FROM apiKeyBindings').iterate()) {
    const stored = targetKey.get(row.apiKeyId);
    if (!stored || typeof stored.key !== 'string' ||
        createHmac('sha256', bindingKey).update(stored.key).digest('hex') !== row.fingerprint) invalid();
    const prior = sourceKey.get(row.apiKeyId);
    if (row.retiredAt === null) {
      if (!prior || prior.key !== stored.key || prior.isActive !== stored.isActive || stored.retired !== 0) invalid();
    } else {
      timestamp(row.retiredAt);
      if (stored.retired !== 1 || stored.isActive !== 0 || (prior && (prior.isActive !== 0 || prior.key !== stored.key))) invalid();
    }
    if (sourcePolicy) {
      const policy = sourcePolicy.get(row.apiKeyId);
      if (!policy || !Number.isSafeInteger(policy.version) || policy.version < 1) invalid();
      timestamp(policy.updatedAt);
      for (const [value, storedLimit] of [[policy.weeklyLimitNanoUsd, stored.weekly], [policy.monthlyLimitNanoUsd, stored.monthly]]) {
        if (value === null ? storedLimit !== null : !Number.isSafeInteger(value) || nanoUsd(String(value)) !== storedLimit) invalid();
      }
    }
  }
}

async function migrate(sourcePath, targetPath, output) {
  requireStandalone(sourcePath);
  requireStandalone(targetPath);
  if (!path.isAbsolute(output ?? '') || path.normalize(output) !== output || output.endsWith('/') ||
      fs.realpathSync(path.dirname(output)) !== path.dirname(output)) invalid();
  let bindingInput = '';
  for await (const chunk of process.stdin) {
    if (bindingInput.length + chunk.length > 66) invalid();
    bindingInput += chunk.toString('utf8');
  }
  bindingInput = bindingInput.trim();
  if (!/^[a-f0-9]{64}$/.test(bindingInput)) invalid();
  const bindingKey = Buffer.from(bindingInput, 'hex');
  bindingInput = '';
  const { openNodeSqliteAttempt } = await import('../src/lib/db/adapters/nodeSqliteAdapter.js');
  const { auditMarkedNodeStartup } = await import('../src/lib/accounting/node-existing-audit.js');
  const { writeLegacyNodeAttempts } = await import('../src/lib/accounting/node-attempt-ledger.js');
  fs.mkdirSync(output, { mode: 0o700 });
  const pending = path.join(output, 'pending.sqlite');
  const archive = path.join(output, 'legacy-source.sqlite');
  fs.copyFileSync(sourcePath, archive, fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(targetPath, pending, fs.constants.COPYFILE_EXCL);
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(archive)) hash.update(chunk);
  const sourceDigest = hash.digest('hex');
  const source = openStandalone(archive);
  let summary;
  try {
    const opened = await openNodeSqliteAttempt(pending);
    if (!opened.ok) invalid();
    try {
      auditMarkedNodeStartup(opened.adapter);
      verifyBindings(source, opened.adapter.raw, bindingKey);
      const entries = [];
      summary = inspect(source, (row, price, amount) => entries.push({
        attemptId: row.attemptId, keyId: row.apiKeyId, bindingGeneration: 'legacy',
        provider: row.provider, model: row.model, startedAt: row.startedAt, price,
        legacy: { amount, sourceDigest, state: row.state },
      }));
      writeLegacyNodeAttempts(opened.adapter, entries);
      auditMarkedNodeStartup(opened.adapter);
    } finally {
      const disposition = opened.closeStrict();
      if (disposition.closure !== 'confirmed' || disposition.checkpoint !== 'confirmed') invalid();
    }
  } finally {
    source.close();
    bindingKey.fill(0);
  }
  const destination = path.join(output, 'data.sqlite');
  for (const filename of [archive, pending]) {
    const fd = fs.openSync(filename, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  fs.renameSync(pending, destination);
  const dir = fs.openSync(output, 'r');
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  const parent = fs.openSync(path.dirname(output), 'r');
  try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
  return summary;
}

try {
  const args = process.argv.slice(2);
  if (args[0] === '--migrate' && args.length === 4) {
    console.log(JSON.stringify(await migrate(...args.slice(1))));
  } else if (args.length === 1) {
    const db = openStandalone(args[0]);
    try { console.log(JSON.stringify(inspect(db))); } finally { db.close(); }
  } else {
    invalid();
  }
} catch {
  console.error('Legacy accounting operation refused. Check standalone inputs and keep failed output offline.');
  process.exitCode = 1;
}
