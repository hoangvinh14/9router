import fs from 'node:fs';
import path from 'node:path';
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

function inspect(db) {
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
    if (row.state === 'settled' || row.state === 'waived') {
      const audit = resolutions.get(row.attemptId);
      amount += BigInt(recordedAmount(row, price, audit));
      if (row.manuallyResolved === 1) resolutions.delete(row.attemptId);
    } else if (row.costNanoUsd !== null) {
      invalid();
    }
  }
  if (resolutions.size) invalid();
  return { attempts, recordedNanoUsd: amount.toString() };
}

try {
  const [snapshot] = process.argv.slice(2);
  if (process.argv.length !== 3 || !path.isAbsolute(snapshot ?? '') ||
      fs.realpathSync(snapshot) !== snapshot || !fs.lstatSync(snapshot).isFile()) invalid();
  for (const suffix of ['-wal', '-shm', '-journal']) {
    if (fs.lstatSync(snapshot + suffix, { throwIfNoEntry: false })) invalid();
  }
  // The input is a standalone, quiescent backup. Immutable mode never creates SQLite sidecars.
  const uri = pathToFileURL(snapshot);
  uri.searchParams.set('immutable', '1');
  const db = new DatabaseSync(uri.href, { readOnly: true, defensive: true });
  try {
    console.log(JSON.stringify(inspect(db)));
  } finally {
    db.close();
  }
} catch {
  console.error('Legacy accounting inspection refused. Supply a standalone backup by absolute path.');
  process.exitCode = 1;
}
