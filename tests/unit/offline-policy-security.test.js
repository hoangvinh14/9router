import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initializePoliciesOffline, POLICY_INTENT_FILE } from '@/lib/db/offlinePolicyInitialization.js';
let dir, db;
const old = process.env.DATA_DIR, root = path.resolve(import.meta.dirname, '../..');
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-security-')); process.env.DATA_DIR = dir; delete global._dbAdapter; vi.resetModules();
  db = await (await import('@/lib/db/driver.js')).getAdapter(); await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'fixture-key', key: 'not-for-cli-output-secret' }] }); db.close(); db = null;
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(dir, { recursive: true, force: true }); if (old === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = old; });
const file = () => path.join(dir, 'db/data.sqlite'), coverageFile = () => path.join(dir, '.accounting-coverage.json'), intentFile = () => path.join(dir, POLICY_INTENT_FILE);
const initialize = engine => initializePoliciesOffline({ directory: dir, engine, actor: 'operator', reason: 'explicit initialization' });
const recover = engine => initializePoliciesOffline({ directory: dir, engine, recover: true });
function snapshot() { return [fs.readFileSync(file()), fs.readFileSync(coverageFile())]; }
function unchanged(before) { expect(snapshot()).toEqual(before); }
function cli(engine, mode) { return spawnSync(process.execPath, [path.join(root, 'scripts/api-key-policy-init.mjs'), mode, dir, engine, ...(mode === 'initialize' ? ['operator', 'explicit initialization'] : [])], { cwd: root, encoding: 'utf8', timeout: 15000, env: { ...process.env, HOME: dir } }); }
describe('offline policy operator security and CLI', { timeout: 20000 }, () => {
  it.each(['node:sqlite', 'sql.js'])('real %s CLI initializes/replays with protected intent and sanitized denial', engine => {
    const result = cli(engine, 'initialize'); expect(result.error).toBeUndefined(); expect(result.status).toBe(0); const output = JSON.parse(result.stdout); expect(output).toMatchObject({ enforcementActive: false, inserted: 1 });
    expect(fs.statSync(intentFile()).mode & 0o777).toBe(0o600); const intent = JSON.parse(fs.readFileSync(intentFile()));
    const replay = cli(engine, 'recover'); expect(replay.status).toBe(0); expect(JSON.parse(replay.stdout).operationId).toBe(output.operationId);
    const rejected = cli(engine, 'initialize'); expect(rejected.status).toBe(1); expect(rejected.stdout).toBe('');
    for (const run of [result, replay, rejected]) { expect(run.stdout + run.stderr).not.toContain('not-for-cli-output-secret'); expect(run.stdout + run.stderr).not.toContain(JSON.parse(intent.coveragePre).bindingKey); expect(run.stderr).not.toContain(dir); }
  });
  it.each(['node:sqlite', 'sql.js'])('%s canonical pricing triggers permit initialization/recovery without repricing or activation', async engine => {
    const edit = new DatabaseSync(file());
    try { edit.prepare("INSERT INTO kv(scope,key,value) VALUES('pricing','openai',?)").run(JSON.stringify({ 'gpt-5': { input: '1.000000001', output: '0' } })); } finally { edit.close(); }
    const inspect = () => {
      const read = new DatabaseSync(file());
      try { return { price: read.prepare("SELECT value FROM kv WHERE scope='pricing' AND key='openai'").get().value,
        revision: read.prepare("SELECT value FROM _meta WHERE key='referencePricingRevision'").get().value,
        activation: read.prepare("SELECT value FROM _meta WHERE key='ledgerStartedAt'").get(), attempts: read.prepare('SELECT COUNT(*) AS n FROM apiKeyAccounting').get().n }; }
      finally { read.close(); }
    };
    const before = inspect(); expect(before.revision).toBe('1');
    expect(await initialize(engine)).toMatchObject({ inserted: 1, enforcementActive: false });
    expect(inspect()).toEqual(before);
    expect(await recover(engine)).toMatchObject({ inserted: 1, recovered: true, enforcementActive: false });
    expect(inspect()).toEqual(before);
  });
  it.each(['node:sqlite', 'sql.js'].flatMap(engine => ['missing', 'changed', 'extra'].map(kind => [engine, kind])))('%s %s pricing trigger denies without schema repair, intent or data mutation', async (engine, kind) => {
    const edit = new DatabaseSync(file());
    try {
      if (kind !== 'extra') edit.exec('DROP TRIGGER pricing_revision_insert');
      if (kind === 'changed') edit.exec("CREATE TRIGGER pricing_revision_insert AFTER INSERT ON kv BEGIN UPDATE apiKeys SET isActive=0; END");
      if (kind === 'extra') edit.exec("CREATE TRIGGER unexpected_policy_writer AFTER INSERT ON apiKeyBudgetPolicies BEGIN UPDATE apiKeys SET isActive=0; END");
    } finally { edit.close(); }
    const before = snapshot(); await expect(initialize(engine)).rejects.toThrow(); unchanged(before);
    expect(fs.existsSync(intentFile())).toBe(false);
  });
  it.each(['node:sqlite', 'sql.js'])('%s exposed coverage permissions deny before intent or policy changes', async engine => {
    fs.chmodSync(coverageFile(), 0o644); const before = snapshot(); await expect(initialize(engine)).rejects.toThrow(); unchanged(before); expect(fs.existsSync(intentFile())).toBe(false);
  });
  it.each(['permission', 'symlink', 'oversize', 'payload', 'prehash', 'engine'])('invalid retained intent %s refuses without data mutation', async kind => {
    await initialize('sql.js');
    if (kind === 'permission') fs.chmodSync(intentFile(), 0o644);
    if (kind === 'symlink') { fs.renameSync(intentFile(), intentFile() + '.original'); fs.symlinkSync(intentFile() + '.original', intentFile()); }
    if (kind === 'oversize') { const fd = fs.openSync(intentFile(), 'w'); fs.ftruncateSync(fd, 9 * 1024 * 1024 + 1); fs.closeSync(fd); }
    if (['payload', 'prehash', 'engine'].includes(kind)) { const intent = JSON.parse(fs.readFileSync(intentFile())); if (kind === 'payload') intent.payload.actor = 'tampered'; if (kind === 'prehash') intent.preHash = '0'.repeat(64); if (kind === 'engine') intent.engine = 'node:sqlite'; fs.writeFileSync(intentFile(), JSON.stringify(intent)); }
    const before = snapshot(); await expect(recover('sql.js')).rejects.toThrow(); unchanged(before);
  });
  it.each(['activation', 'binding', 'schema', 'coverage', 'actor'])('ineligible %s denies initialization without publishing intent', async kind => {
    if (kind === 'coverage') { const coverage = JSON.parse(fs.readFileSync(coverageFile())); coverage.generation = 1; fs.writeFileSync(coverageFile(), JSON.stringify(coverage)); }
    else if (kind !== 'actor') { const edit = new DatabaseSync(file()); try { if (kind === 'activation') edit.exec("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')"); if (kind === 'binding') edit.exec("UPDATE apiKeyBindings SET fingerprint='invalid'"); if (kind === 'schema') edit.exec("ALTER TABLE apiKeyBudgetPolicies ADD COLUMN unexpected TEXT DEFAULT 'value'"); } finally { edit.close(); } }
    const before = snapshot(); await expect(initializePoliciesOffline({ directory: dir, engine: 'sql.js', actor: kind === 'actor' ? '' : 'operator', reason: 'explicit' })).rejects.toThrow(); unchanged(before); expect(fs.existsSync(intentFile())).toBe(false);
  });
});
