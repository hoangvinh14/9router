import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { acquireWriterOwnership } from '@/lib/db/writerOwnership.js';
import { createNodeSqliteAdapter } from '@/lib/db/adapters/nodeSqliteAdapter.js';
import { createSqlJsAdapter } from '@/lib/db/adapters/sqljsAdapter.js';
import { openAccountingCoverage } from '@/lib/db/accountingCoverage.js';
import { initializePoliciesOffline, POLICY_INTENT_FILE } from '@/lib/db/offlinePolicyInitialization.js';
import { backupDbLite } from '@/lib/db/backup.js';
import { prepareManagedRestore, applyManagedRestore } from '@/lib/db/managedRestore.js';
import { createBudgetContext } from '@/lib/apiKeyBudget/service.js';
import { ApiKeyBudgetError } from '@/lib/apiKeyBudget/errors.js';
import { BUDGET_ERROR } from '../../open-sse/config/apiKeyBudgetConstants.js';
const inspection = vi.hoisted(() => ({ hook: null }));
vi.mock('sql.js', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, default: async (...args) => { if (inspection.hook) await inspection.hook(); return actual.default(...args); } };
});
let directory, db, owner, beforeInitialization;
const original = process.env.DATA_DIR;
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-retained-intent-restore-'));
  process.env.DATA_DIR = directory; delete global._dbAdapter; vi.resetModules();
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'restore-key', key: 'disposable-restore-key' }] });
  const destination = path.join(directory, 'before-initialization'); fs.mkdirSync(destination);
  beforeInitialization = backupDbLite(db, destination); db.close(); db = null;
});
afterEach(() => {
  inspection.hook = null; vi.restoreAllMocks(); db?.close(); owner?.release(); delete global._dbAdapter;
  fs.rmSync(directory, { recursive: true, force: true });
  if (original === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = original;
});
async function open(engine) {
  owner = acquireWriterOwnership(directory);
  db = await (engine === 'sql.js' ? createSqlJsAdapter : createNodeSqliteAdapter)(path.join(directory, 'db', 'data.sqlite'), owner);
  db.coverage = openAccountingCoverage(db, owner); db.ownerInstanceId = owner.instanceId;
  // This fixture has no pending attempts. Model the supported stop-writer
  // lifecycle: close the adapter first, then release the quiescent owner.
  const close = db.close.bind(db), currentOwner = owner;
  db.close = () => { close(); currentOwner.release(); };
  return db;
}
describe('same-directory managed restore preserves real retained intent; bundle transfer remains untested', () => {
  it.each(['node:sqlite', 'sql.js'])('%s prepared bundle archives retained intent without adopting it as live authority', async engine => {
    await initializePoliciesOffline({ directory, engine, actor: 'fixture-operator', reason: 'archive prerequisite' });
    const intentFile = path.join(directory, POLICY_INTENT_FILE), liveIntent = fs.readFileSync(intentFile);
    await open(engine);
    const backupRoot = path.join(directory, 'managed-bundles');
    const prepared = prepareManagedRestore(db, backupRoot, 'fixture intent archival'); db = null;
    expect(prepared.version).toBe(2);
    expect(prepared.policyInitializationIntent).toMatchObject({ present: true, sha256: createHash('sha256').update(liveIntent).digest('hex') });
    const archived = prepared.policyInitializationIntent.backup;
    expect(path.relative(backupRoot, archived)).not.toMatch(/^\.\./);
    expect(path.isAbsolute(path.relative(backupRoot, archived))).toBe(false);
    expect(fs.readFileSync(archived).equals(liveIntent)).toBe(true);
    expect(fs.statSync(archived).mode & 0o077).toBe(0);
    const bundle = JSON.parse(fs.readFileSync(prepared.bundleManifest, 'utf8'));
    expect(bundle).toMatchObject({ version: 1, databaseHash: prepared.databaseBackupHash, coverageHash: prepared.coverageBackupHash, policyInitializationIntent: { present: true, sha256: prepared.policyInitializationIntent.sha256 } });
    expect(fs.readFileSync(intentFile).equals(liveIntent)).toBe(true);
    const file = path.join(directory, 'db', 'data.sqlite'), coverageFile = path.join(directory, '.accounting-coverage.json');
    const before = fs.readFileSync(file), coverage = fs.readFileSync(coverageFile);
    // Preserve the missing artifact as quarantined evidence, never repair or
    // adopt an archive into live initialization state.
    fs.renameSync(archived, archived + '.fixture-quarantine');
    await expect(applyManagedRestore(directory, prepared.databaseBackup)).rejects.toThrow('Managed restore recovery artifacts mismatched; remain in maintenance');
    expect(fs.readFileSync(file).equals(before)).toBe(true);
    expect(fs.readFileSync(coverageFile).equals(coverage)).toBe(true);
    expect(fs.readFileSync(intentFile).equals(liveIntent)).toBe(true);
    expect(JSON.parse(coverage).maintenance).not.toBeNull();
  }, 20000);
  it.each(['node:sqlite', 'sql.js'].flatMap(engine => ['disappeared', 'changed', 'legacy', 'marker-missing', 'wrong-operation', 'unsafe-generation', 'symlink-archive'].map(kind => [engine, kind])))('%s %s bundle refuses before replacement with live evidence unchanged', async (engine, kind) => {
    await initializePoliciesOffline({ directory, engine, actor: 'fixture-operator', reason: 'integrity prerequisite' });
    await open(engine);
    const prepared = prepareManagedRestore(db, path.join(directory, 'integrity-bundles'), 'fixture integrity review'); db = null;
    const intentFile = path.join(directory, POLICY_INTENT_FILE), originalIntent = fs.readFileSync(intentFile);
    const manifestFile = path.join(directory, '.accounting-restore.json');
    if (kind === 'disappeared') fs.renameSync(intentFile, intentFile + '.fixture-quarantine');
    if (kind === 'changed') fs.appendFileSync(intentFile, '\n');
    if (kind === 'legacy') { const legacy = JSON.parse(fs.readFileSync(manifestFile)); legacy.version = 1; fs.writeFileSync(manifestFile, JSON.stringify(legacy)); }
    if (kind === 'marker-missing') fs.renameSync(prepared.bundleManifest, prepared.bundleManifest + '.fixture-quarantine');
    if (kind === 'wrong-operation') { const altered = JSON.parse(fs.readFileSync(manifestFile)); altered.operationId = 'foreign-operation'; fs.writeFileSync(manifestFile, JSON.stringify(altered)); }
    if (kind === 'unsafe-generation') fs.chmodSync(path.dirname(prepared.bundleManifest), 0o777);
    if (kind === 'symlink-archive') { fs.renameSync(prepared.policyInitializationIntent.backup, prepared.policyInitializationIntent.backup + '.fixture-quarantine'); fs.symlinkSync(intentFile, prepared.policyInitializationIntent.backup); }
    const file = path.join(directory, 'db', 'data.sqlite'), coverageFile = path.join(directory, '.accounting-coverage.json');
    const before = fs.readFileSync(file), coverage = fs.readFileSync(coverageFile), currentIntent = fs.existsSync(intentFile) ? fs.readFileSync(intentFile) : null;
    await expect(applyManagedRestore(directory, prepared.databaseBackup)).rejects.toThrow('Managed restore recovery artifacts mismatched; remain in maintenance');
    expect(fs.readFileSync(file).equals(before)).toBe(true); expect(fs.readFileSync(coverageFile).equals(coverage)).toBe(true);
    if (currentIntent) expect(fs.readFileSync(intentFile).equals(currentIntent)).toBe(true);
    else { expect(fs.existsSync(intentFile)).toBe(false); expect(fs.readFileSync(intentFile + '.fixture-quarantine').equals(originalIntent)).toBe(true); }
  }, 20000);
  it.each(['node:sqlite', 'sql.js'])('%s absence is explicit; newly appeared intent denies and old intent-free manifest remains supported', async engine => {
    await open(engine);
    const prepared = prepareManagedRestore(db, path.join(directory, 'absent-bundles'), 'fixture absent intent'); db = null;
    expect(prepared.policyInitializationIntent).toEqual({ present: false });
    const intentFile = path.join(directory, POLICY_INTENT_FILE), file = path.join(directory, 'db', 'data.sqlite');
    fs.writeFileSync(intentFile, 'fixture-unrelated-intent', { mode: 0o600 });
    const before = fs.readFileSync(file), coverageFile = path.join(directory, '.accounting-coverage.json'), coverage = fs.readFileSync(coverageFile);
    await expect(applyManagedRestore(directory, prepared.databaseBackup)).rejects.toThrow('Managed restore recovery artifacts mismatched; remain in maintenance');
    expect(fs.readFileSync(file).equals(before)).toBe(true); expect(fs.readFileSync(coverageFile).equals(coverage)).toBe(true);
    fs.renameSync(intentFile, intentFile + '.fixture-quarantine');
    const manifestFile = path.join(directory, '.accounting-restore.json'), legacy = JSON.parse(fs.readFileSync(manifestFile));
    legacy.version = 1; delete legacy.policyInitializationIntent; delete legacy.bundleManifest; delete legacy.bundleManifestHash;
    fs.writeFileSync(manifestFile, JSON.stringify(legacy));
    expect(await applyManagedRestore(directory, prepared.databaseBackup)).toMatchObject({ maintenanceRequired: true, reconciliationRequired: true });
    expect(fs.existsSync(intentFile)).toBe(false); expect(fs.readFileSync(coverageFile).equals(coverage)).toBe(true);
  }, 20000);
  it.each(['node:sqlite', 'sql.js'])('%s reserved live destinations deny before maintenance or file writes', async engine => {
    await open(engine); const coverage = fs.readFileSync(db.coverage.file);
    for (const destination of [directory, path.join(directory, 'db'), path.join(directory, 'db', 'nested')]) {
      expect(() => prepareManagedRestore(db, destination, 'invalid destination')).toThrow('Managed restore recovery artifacts mismatched; remain in maintenance');
      expect(fs.readFileSync(db.coverage.file).equals(coverage)).toBe(true);
    }
    const link = path.join(directory, 'symlink-root'); fs.symlinkSync(path.join(directory, 'before-initialization'), link);
    expect(() => prepareManagedRestore(db, path.join(link, 'nested'), 'invalid symlink')).toThrow('Managed restore recovery artifacts mismatched; remain in maintenance');
    expect(fs.readFileSync(db.coverage.file).equals(coverage)).toBe(true);
  }, 20000);
  it.each(['node:sqlite', 'sql.js'].flatMap(engine => ['intent-rename', 'marker-rename', 'marker-directory'].map(stage => [engine, stage])))('%s interrupted publication %s leaves maintenance and no acknowledged restore manifest', async (engine, stage) => {
    await initializePoliciesOffline({ directory, engine, actor: 'fixture-operator', reason: 'fault prerequisite' }); await open(engine);
    const retained = fs.readFileSync(path.join(directory, POLICY_INTENT_FILE)), root = path.join(directory, 'fault-bundles');
    const rename = fs.renameSync, sync = fs.fsyncSync; let armed = false;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      const archivedIntent = path.basename(to) === POLICY_INTENT_FILE && to.startsWith(root + path.sep), marker = path.basename(to) === '.accounting-backup-bundle.json';
      if (stage === 'intent-rename' && archivedIntent || stage === 'marker-rename' && marker) throw new Error('fixture bundle publication');
      const result = rename(from, to); if (marker) armed = true; return result;
    });
    vi.spyOn(fs, 'fsyncSync').mockImplementation(fd => { if (stage === 'marker-directory' && armed && fs.fstatSync(fd).isDirectory()) throw new Error('fixture bundle publication'); return sync(fd); });
    expect(() => prepareManagedRestore(db, root, 'fixture interrupted bundle')).toThrow('fixture bundle publication'); vi.restoreAllMocks();
    expect(db.coverage.status().maintenance).not.toBeNull(); expect(fs.readFileSync(path.join(directory, POLICY_INTENT_FILE)).equals(retained)).toBe(true);
    expect(fs.existsSync(path.join(directory, '.accounting-restore.json'))).toBe(false);
    const partial = fs.readdirSync(root); expect(partial).toHaveLength(1);
    const marker = path.join(root, partial[0], '.accounting-backup-bundle.json');
    expect(fs.existsSync(marker)).toBe(stage === 'marker-directory');
    // Installed marker after lost directory ACK is uncertainty, not success;
    // no outer operation authority was published. Preserve this generation.
    const retry = prepareManagedRestore(db, root, 'fixture explicit retry'); db = null;
    expect(fs.readdirSync(root)).toHaveLength(2); expect(path.dirname(retry.bundleManifest)).not.toBe(path.join(root, partial[0]));
  }, 20000);
  it.each(['node:sqlite', 'sql.js'].flatMap(engine => ['live-intent', 'database', 'coverage'].map(kind => [engine, kind])))('%s awaited inspection rechecks changed %s without replacement', async (engine, kind) => {
    await initializePoliciesOffline({ directory, engine, actor: 'fixture', reason: 'async mutation prerequisite' }); await open(engine);
    const prepared = prepareManagedRestore(db, path.join(directory, 'async-bundles'), 'fixture async recheck'); db = null;
    const file = path.join(directory, 'db', 'data.sqlite'), coverageFile = path.join(directory, '.accounting-coverage.json'), intentFile = path.join(directory, POLICY_INTENT_FILE);
    let enter, release; const entered = new Promise(resolve => { enter = resolve; }), hold = new Promise(resolve => { release = resolve; });
    inspection.hook = () => { enter(); return hold; };
    const work = applyManagedRestore(directory, prepared.databaseBackup);
    try {
      await entered;
      fs.appendFileSync(kind === 'live-intent' ? intentFile : kind === 'database' ? file : coverageFile, '\n');
      const current = [file, coverageFile, intentFile].map(f => fs.readFileSync(f)); release();
      await expect(work).rejects.toThrow(kind === 'live-intent' ? 'Managed restore recovery artifacts mismatched; remain in maintenance' : 'Writer changed after restore preparation; remain in maintenance');
      for (const [i, f] of [file, coverageFile, intentFile].entries()) expect(fs.readFileSync(f).equals(current[i])).toBe(true);
    } finally { release(); inspection.hook = null; await work.catch(() => {}); }
  }, 20000);
  it.each(['node:sqlite', 'sql.js'])('%s install consumes pinned snapshot bytes rather than reopening changed path', async engine => {
    await initializePoliciesOffline({ directory, engine, actor: 'fixture', reason: 'pinned image prerequisite' }); await open(engine);
    const olderRoot = path.join(directory, 'pinned-snapshot'); fs.mkdirSync(olderRoot);
    const older = backupDbLite(db, olderRoot), originalImage = fs.readFileSync(older);
    const prepared = prepareManagedRestore(db, path.join(directory, 'pinned-bundles'), 'fixture pinned image'); db = null;
    let enter, release; const entered = new Promise(resolve => { enter = resolve; }), hold = new Promise(resolve => { release = resolve; });
    inspection.hook = () => { enter(); return hold; };
    const work = applyManagedRestore(directory, older);
    try {
      await entered; fs.appendFileSync(older, 'fixture path changed after read'); release();
      expect(await work).toMatchObject({ operationId: prepared.operationId, maintenanceRequired: true });
      expect(fs.readFileSync(path.join(directory, 'db', 'data.sqlite')).equals(originalImage)).toBe(true);
      expect(fs.readFileSync(older).equals(originalImage)).toBe(false);
    } finally { release(); inspection.hook = null; await work.catch(() => {}); }
  }, 20000);
  it.each(['node:sqlite', 'sql.js'])('%s mixed marker generation denies even with caller-matched marker hash', async engine => {
    await initializePoliciesOffline({ directory, engine, actor: 'fixture', reason: 'mixed generation prerequisite' }); await open(engine);
    const first = prepareManagedRestore(db, path.join(directory, 'mix-bundles'), 'first operation'); db = null;
    await open(engine); const second = prepareManagedRestore(db, path.join(directory, 'mix-bundles'), 'second operation'); db = null;
    const marker = fs.readFileSync(first.bundleManifest); fs.writeFileSync(second.bundleManifest, marker);
    const manifestFile = path.join(directory, '.accounting-restore.json'), altered = JSON.parse(fs.readFileSync(manifestFile));
    altered.bundleManifestHash = createHash('sha256').update(marker).digest('hex'); fs.writeFileSync(manifestFile, JSON.stringify(altered));
    const file = path.join(directory, 'db', 'data.sqlite'), before = fs.readFileSync(file), coverage = fs.readFileSync(path.join(directory, '.accounting-coverage.json'));
    await expect(applyManagedRestore(directory, second.databaseBackup)).rejects.toThrow('Managed restore recovery artifacts mismatched; remain in maintenance');
    expect(fs.readFileSync(file).equals(before)).toBe(true); expect(fs.readFileSync(path.join(directory, '.accounting-coverage.json')).equals(coverage)).toBe(true);
  }, 20000);
  it.each(['node:sqlite', 'sql.js'].flatMap(engine => ['version1', 'version2'].map(version => [engine, version])))('%s %s absence rejects dangling archived intent entry', async (engine, version) => {
    await open(engine); const prepared = prepareManagedRestore(db, path.join(directory, 'dangling-bundles'), 'fixture ambiguity'); db = null;
    const absentArchive = path.join(path.dirname(prepared.databaseBackup), POLICY_INTENT_FILE); fs.symlinkSync(path.join(directory, 'nonexistent-intent'), absentArchive);
    if (version === 'version1') { const f = path.join(directory, '.accounting-restore.json'), legacy = JSON.parse(fs.readFileSync(f)); legacy.version = 1; fs.writeFileSync(f, JSON.stringify(legacy)); }
    const file = path.join(directory, 'db', 'data.sqlite'), before = fs.readFileSync(file);
    await expect(applyManagedRestore(directory, prepared.databaseBackup)).rejects.toThrow('Managed restore recovery artifacts mismatched; remain in maintenance');
    expect(fs.readFileSync(file).equals(before)).toBe(true); expect(fs.lstatSync(absentArchive).isSymbolicLink()).toBe(true);
  }, 20000);
  it.each(['node:sqlite', 'sql.js'])('%s restores an older post-init DB without adopting old intent as current readiness', async engine => {
    const initialized = await initializePoliciesOffline({ directory, engine, actor: 'fixture-operator', reason: 'restore prerequisite' });
    const intentFile = path.join(directory, POLICY_INTENT_FILE), intent = fs.readFileSync(intentFile), intentStat = fs.statSync(intentFile);
    expect(intentStat.mode & 0o077).toBe(0); expect(intentStat.uid).toBe(process.geteuid());
    await open(engine); expect(db.driver).toBe(engine);
    expect(db.get('SELECT COUNT(*) AS n FROM apiKeyAccountingAudit WHERE operationId=?', [initialized.operationId]).n).toBe(1);
    const destination = path.join(directory, 'after-initialization'); fs.mkdirSync(destination);
    const older = backupDbLite(db, destination);
    // Current backup does NOT archive the intent; same-directory retention is
    // deliberately narrower than self-contained backup/new-directory recovery.
    expect(fs.existsSync(path.join(destination, POLICY_INTENT_FILE))).toBe(false);
    db.durableTransaction(() => db.run("UPDATE apiKeys SET name='after-snapshot-mutation' WHERE id='restore-key'"));
    expect(db.get("SELECT name FROM apiKeys WHERE id='restore-key'").name).toBe('after-snapshot-mutation');
    prepareManagedRestore(db, path.join(directory, 'restore-current'), 'fixture all-scope restore review'); db = null;
    const coverageFile = path.join(directory, '.accounting-coverage.json'), coverage = fs.readFileSync(coverageFile), advanced = JSON.parse(coverage);
    expect(advanced.maintenance).not.toBeNull(); expect(advanced.gaps.some(g => g.apiKeyId === null && !g.resolvedAt)).toBe(true);
    const file = path.join(directory, 'db', 'data.sqlite'), before = fs.readFileSync(file);
    // Valid pre-init snapshot is incompatible with retained policy format.
    await expect(applyManagedRestore(directory, beforeInitialization)).rejects.toThrow('Accounting coverage artifacts unavailable or mismatched; operator recovery required');
    expect(fs.readFileSync(file).equals(before)).toBe(true); expect(fs.readFileSync(coverageFile).equals(coverage)).toBe(true); expect(fs.readFileSync(intentFile).equals(intent)).toBe(true);
    expect(await applyManagedRestore(directory, older)).toMatchObject({ maintenanceRequired: true, reconciliationRequired: true });
    expect(fs.readFileSync(coverageFile).equals(coverage)).toBe(true); expect(fs.readFileSync(intentFile).equals(intent)).toBe(true);
    expect(fs.statSync(intentFile).mode).toBe(intentStat.mode);
    await open(engine);
    expect(db.get("SELECT name FROM apiKeys WHERE id='restore-key'").name).not.toBe('after-snapshot-mutation');
    expect(db.get("SELECT * FROM apiKeyBudgetPolicies WHERE apiKeyId='restore-key'")).toMatchObject({ weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null, version: 0 });
    expect(db.get('SELECT COUNT(*) AS n FROM apiKeyAccountingAudit').n).toBe(1);
    expect(db.get('SELECT operationId FROM apiKeyAccountingAudit').operationId).toBe(initialized.operationId);
    expect(db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined();
    expect(db.coverage.status().maintenance).toEqual(advanced.maintenance);
    const context = await createBudgetContext('restore-key', { adapter: async () => db });
    for (const operation of [() => context.gate(), () => context.beginAttempt({ provider: 'openai', model: 'fixture', endpoint: 'chat' })]) {
      let error; try { operation(); } catch (caught) { error = caught; }
      expect(error).toBeInstanceOf(ApiKeyBudgetError);
      expect(error).toMatchObject({ code: BUDGET_ERROR.UNAVAILABLE, status: 503, requestId: context.requestId, message: 'API key accounting storage unavailable' });
    }
    db.close(); db = null;
    const installed = fs.readFileSync(file), retainedCoverage = fs.readFileSync(coverageFile);
    await expect(initializePoliciesOffline({ directory, engine, recover: true })).rejects.toThrow('Offline policy initialization unavailable; retain artifacts for operator inspection');
    expect(fs.readFileSync(file).equals(installed)).toBe(true); expect(fs.readFileSync(coverageFile).equals(retainedCoverage)).toBe(true); expect(fs.readFileSync(intentFile).equals(intent)).toBe(true);
  }, 20000);
});
