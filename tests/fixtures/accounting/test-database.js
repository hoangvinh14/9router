import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { acquireWriterOwnership } from '../../../src/lib/db/writerOwnership.js';
import { createNodeSqliteAdapter } from '../../../src/lib/db/adapters/nodeSqliteAdapter.js';
import { createSqlJsAdapter } from '../../../src/lib/db/adapters/sqljsAdapter.js';
import initial from '../../../src/lib/db/migrations/001-initial.js';
import accounting from '../../../src/lib/db/migrations/002-accounting-foundation.js';
import policy from '../../../src/lib/db/migrations/003-accounting-policy.js';
import { openAccountingCoverage } from '../../../src/lib/db/accounting-coverage.js';
import { initializeKeyBindings } from '../../../src/lib/db/helpers/api-key-bindings.js';
import { installAccountingLifecycle } from '../../../src/lib/db/accounting-lifecycle.js';
import { installPricingRevision } from '../../../src/lib/db/pricingRevision.js';

export async function openFixture(engine, file) {
  file ??= path.join(fs.mkdtempSync(path.join(os.tmpdir(), '9router-accounting-')), 'data.sqlite');
  const owner = acquireWriterOwnership(file);
  const db = await (engine === 'node' ? createNodeSqliteAdapter : createSqlJsAdapter)(file, owner);
  if (!db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='_meta'")) {
    db.durableTransaction(() => { initial.up(db); accounting.up(db); policy.up(db); });
  }
  installPricingRevision(db);
  db.coverage = openAccountingCoverage(db, owner);
  db.ownerInstanceId = owner.instanceId;
  db.durableTransaction(() => initializeKeyBindings(db, db.coverage));
  installAccountingLifecycle(db);
  backupFixture(db, file);
  return { db, file, root: path.dirname(file), owner };
}
export function backupFixture(db, file) {
  db.durableTransaction(() => {}); db.checkpoint?.();
  const backup = path.join(path.dirname(file), 'pre-change'); fs.mkdirSync(backup, { recursive: true });
  for (const name of ['data.sqlite', '.accounting-coverage.json']) {
    const source = path.join(path.dirname(file), name);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(backup, name));
  }
}
export function addKey(db, id = 'key-one', secret = 'fixture-secret') {
  const createdAt = new Date().toISOString();
  db.durableTransaction(() => {
    db.run('INSERT INTO apiKeys(id,key,createdAt) VALUES(?,?,?)', [id, secret, createdAt]);
    db.run('INSERT INTO apiKeyBindings(apiKeyId,fingerprint,createdAt) VALUES(?,?,?)', [id, db.coverage.fingerprint(secret), createdAt]);
    db.run('INSERT INTO apiKeyBudgetPolicies(apiKeyId,weeklyLimitNanoUsd,monthlyLimitNanoUsd,version,updatedAt) VALUES(?,NULL,NULL,1,?)', [id, createdAt]);
  });
  return { id, key: secret, createdAt };
}
export function priceSnapshot(rates = { input: '1', output: '2' }) {
  return { provider: 'openai', model: 'fixture', endpoint: 'chat', currency: 'USD', unit: 'USD/1M tokens', rates, revision: 'fixture-original' };
}
export function intent(db, id = 'attempt-one', rates) {
  return { attemptId: id, requestId: 'request-one', apiKeyId: 'key-one', ownerInstanceId: db.ownerInstanceId,
    provider: 'openai', model: 'fixture', endpoint: 'chat', startedAt: '2026-10-22T00:00:00.000Z', priceSnapshot: priceSnapshot(rates) };
}
export function exactUsage(input = 1000, output = 100) {
  return { exact: true, input, output, cacheRead: 0, cacheWrite: 0, reasoning: 0, reasoningIncludedInOutput: true };
}
