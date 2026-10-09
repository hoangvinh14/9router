import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import initSqlJs from 'sql.js';
import { DatabaseSync } from 'node:sqlite';
import { POLICY_INTENT_FILE } from '@/lib/db/offlinePolicyInitialization.js';
let dir, adapter;
const previous = process.env.DATA_DIR;
const root = path.resolve(import.meta.dirname, '../..');
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-crash-')); process.env.DATA_DIR = dir; delete global._dbAdapter; vi.resetModules();
  adapter = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'crash-key', key: 'crash-fixture-secret' }, { id: 'restricted', key: 'restricted-fixture-secret' }] });
  adapter.durableTransaction(() => adapter.run("INSERT INTO apiKeyBudgetPolicies(apiKeyId,weeklyLimitNanoUsd,version,updatedAt) VALUES('restricted',17,1,'2026-10-03T00:00:00.000Z')")); adapter.close(); adapter = null;
});
afterEach(() => { adapter?.close(); delete global._dbAdapter; fs.rmSync(dir, { recursive: true, force: true }); if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous; });
function child(engine, mode, boundary = 'none') {
  return spawnSync(process.execPath, [path.join(root, 'tests/fixtures/offline-policy-crash-child.mjs'), dir, engine, mode, boundary], { cwd: root, encoding: 'utf8', timeout: 15000, env: { ...process.env, HOME: dir, DATA_DIR: dir } });
}
function killed(run, boundary) { expect(run.error).toBeUndefined(); expect(run.signal).toBe('SIGKILL'); expect(run.stdout).toContain('BOUNDARY:' + boundary); expect(run.stdout).not.toContain('RESULT:'); }
function acknowledged(run) { expect(run.error).toBeUndefined(); expect(run.signal).toBeNull(); expect(run.status).toBe(0); const line = run.stdout.split('\n').find(row => row.startsWith('RESULT:')); expect(line).toBeTruthy(); return JSON.parse(line.slice(7)); }
async function assertPost(engine, op) {
  const file = path.join(dir, 'db/data.sqlite'); const SQL = engine === 'sql.js' ? await initSqlJs() : null;
  const db = SQL ? new SQL.Database(fs.readFileSync(file)) : new DatabaseSync(file, { readOnly: true });
  function get(sql) { if (!SQL) return db.prepare(sql).get(); const s = db.prepare(sql); try { return s.step() ? s.getAsObject() : undefined; } finally { s.free(); } }
  try {
    expect(get("SELECT * FROM apiKeyBudgetPolicies WHERE apiKeyId='crash-key'")).toMatchObject({ version: 0, weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null });
    expect(get("SELECT weeklyLimitNanoUsd FROM apiKeyBudgetPolicies WHERE apiKeyId='restricted'").weeklyLimitNanoUsd).toBe(17);
    expect(get('SELECT COUNT(*) AS n FROM apiKeyAccountingAudit').n).toBe(1);
    expect(get('SELECT operationId FROM apiKeyAccountingAudit').operationId).toBe(op);
    expect(get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined();
    expect(get('SELECT COUNT(*) AS n FROM apiKeyAccounting').n).toBe(0);
  } finally { db.close(); }
  expect(JSON.parse(fs.readFileSync(path.join(dir, '.accounting-coverage.json')))).toMatchObject({ generation: 1, policyFormat: '1' });
  expect(fs.existsSync(path.join(dir, '.gateway-writer.lock'))).toBe(false);
}
describe('real SIGKILL offline policy transition recovery', { timeout: 20000 }, () => {
  it.each(['node:sqlite', 'sql.js'].flatMap(engine => ['intent-installed', 'intent-directory-ack', 'sidecar-installed', 'db-published', 'success-ack'].map(boundary => [engine, boundary])))('%s resumes after %s without resetting restriction or duplicate audit', async (engine, boundary) => {
    killed(child(engine, 'initialize', boundary), boundary);
    expect(fs.existsSync(path.join(dir, POLICY_INTENT_FILE))).toBe(true);
    const intent = fs.readFileSync(path.join(dir, POLICY_INTENT_FILE));
    const result = acknowledged(child(engine, 'recover')); expect(result).toMatchObject({ recovered: true, enforcementActive: false, inserted: 1 });
    const replay = acknowledged(child(engine, 'recover')); expect(replay.operationId).toBe(result.operationId); expect(fs.readFileSync(path.join(dir, POLICY_INTENT_FILE))).toEqual(intent);
    await assertPost(engine, result.operationId);
  });
  it.each(['node:sqlite', 'sql.js'])('%s never retrofits intent when killed before intent installation', engine => {
    const before = fs.readFileSync(path.join(dir, 'db/data.sqlite')), coverage = fs.readFileSync(path.join(dir, '.accounting-coverage.json'));
    killed(child(engine, 'initialize', 'before-intent-install'), 'before-intent-install');
    const denied = child(engine, 'recover'); expect(denied.error).toBeUndefined(); expect(denied.status).toBe(2); expect(denied.stdout).toContain('DENIED');
    expect(fs.existsSync(path.join(dir, POLICY_INTENT_FILE))).toBe(false); expect(fs.readFileSync(path.join(dir, 'db/data.sqlite'))).toEqual(before); expect(fs.readFileSync(path.join(dir, '.accounting-coverage.json'))).toEqual(coverage);
  });
  it.each(['node:sqlite', 'sql.js'])('%s uncertain cleanup denies competing live owner; death permits bound recovery', async engine => {
    const run = child(engine, 'initialize', 'cleanup-uncertain'); killed(run, 'cleanup-uncertain'); expect(run.stdout).toContain('LIVE_OWNER_DENIED');
    const result = acknowledged(child(engine, 'recover')); await assertPost(engine, result.operationId);
  });
  it.each(['node:sqlite', 'sql.js'])('%s repeated recovery crashes retain one recorded operation', async engine => {
    killed(child(engine, 'initialize', 'intent-directory-ack'), 'intent-directory-ack');
    killed(child(engine, 'recover', 'sidecar-installed'), 'sidecar-installed');
    killed(child(engine, 'recover', 'db-published'), 'db-published');
    const result = acknowledged(child(engine, 'recover')); await assertPost(engine, result.operationId);
  });
});
