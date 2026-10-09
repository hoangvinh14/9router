// Disposable process-death fixture; no network or production fault switches.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const [directory, engine, mode, boundary] = process.argv.slice(2);
if (!path.isAbsolute(directory || '') || !['node:sqlite', 'sql.js'].includes(engine) || !['crash', 'recover'].includes(mode) || !['before-marker', 'marker-installed', 'manifest-installed', 'database-installed'].includes(boundary)) throw new Error('Invalid bundle crash fixture');
process.env.DATA_DIR = directory;
const { createServer } = await import('../node_modules/vite/dist/node/index.js');
const server = await createServer({ configFile: false, root: path.resolve(import.meta.dirname, '../..'), server: { middlewareMode: true, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, resolve: { alias: { '@': path.resolve(import.meta.dirname, '../../src'), 'open-sse': path.resolve(import.meta.dirname, '../../open-sse') } } });
const load = p => server.ssrLoadModule(p);
const { acquireWriterOwnership } = await load('/src/lib/db/writerOwnership.js');
const { createNodeSqliteAdapter } = await load('/src/lib/db/adapters/nodeSqliteAdapter.js');
const { createSqlJsAdapter } = await load('/src/lib/db/adapters/sqljsAdapter.js');
const { openAccountingCoverage } = await load('/src/lib/db/accountingCoverage.js');
const { prepareManagedRestore, applyManagedRestore } = await load('/src/lib/db/managedRestore.js');
const file = path.join(directory, 'db', 'data.sqlite'), root = path.join(directory, 'bundles'), markerName = '.accounting-backup-bundle.json', manifestFile = path.join(directory, '.accounting-restore.json'), intentFile = path.join(directory, '.accounting-policy-init-intent.json');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
let owner, db;
async function open(initialize = false) {
  owner = acquireWriterOwnership(directory);
  db = await (engine === 'sql.js' ? createSqlJsAdapter : createNodeSqliteAdapter)(file, owner);
  if (initialize) await (await load('/src/lib/db/migrate.js')).runMigrationOnce(db);
  db.coverage = openAccountingCoverage(db, owner); db.ownerInstanceId = owner.instanceId;
  const close = db.close.bind(db), lease = owner;
  db.close = () => { close(); lease.release(); };
}
try {
  if (mode === 'crash') {
    fs.mkdirSync(path.dirname(file), { recursive: true }); await open(true);
    const { retainKeyBindings } = await load('/src/lib/db/helpers/apiKeyBindings.js');
    db.durableTransaction(() => { db.run("INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES('restore-crash-key','disposable-crash-secret',1,'2026-10-03T00:00:00.000Z')"); retainKeyBindings(db, db.coverage, [{ id: 'restore-crash-key', key: 'disposable-crash-secret' }]); });
    db.close(); db = null;
    await (await load('/src/lib/db/offlinePolicyInitialization.js')).initializePoliciesOffline({ directory, engine, actor: 'fixture', reason: 'bundle death prerequisite' }); await open();
    const beforeIntent = hash(intentFile);
    const rename = fs.renameSync;
    function kill() {
      const lock = JSON.parse(fs.readFileSync(path.join(directory, '.gateway-writer.lock')));
      fs.writeSync(1, 'BOUNDARY:' + JSON.stringify({ boundary, owner: lock.instanceId, intentHash: beforeIntent, manifestPresent: fs.existsSync(manifestFile) }) + '\n');
      process.kill(process.pid, 'SIGKILL');
    }
    fs.renameSync = (from, to) => {
      if (path.basename(to) === markerName && boundary === 'before-marker') kill();
      const result = rename(from, to);
      if (path.basename(to) === markerName && boundary === 'marker-installed' || to === manifestFile && boundary === 'manifest-installed' || to === file && boundary === 'database-installed') kill();
      return result;
    };
    const prepared = prepareManagedRestore(db, root, 'fixture death review'); db = null;
    await applyManagedRestore(directory, prepared.databaseBackup);
    throw new Error('Expected process death was not reached');
  }
  const beforeIntent = hash(intentFile), beforeCoverage = hash(path.join(directory, '.accounting-coverage.json'));
  // Offline retry precedes writable adapter startup. Native startup PRAGMA WAL
  // can change a restored backup's DB header; that must remain a writer-change
  // denial, not be mistaken for pure inspection or bypassed in production.
  owner = acquireWriterOwnership(directory); const recoveredOwner = owner.recoveredOwnerInstanceId;
  const beforeDatabase = hash(file), coverageFile = path.join(directory, '.accounting-coverage.json');
  const coverage = JSON.parse(fs.readFileSync(coverageFile));
  if (!recoveredOwner || !coverage.maintenance || !coverage.gaps.some(g => g.apiKeyId === null && !g.resolvedAt)) throw new Error('Dead owner/maintenance evidence missing');
  const { default: initSqlJs } = await import('sql.js');
  const SQL = await initSqlJs(), reader = new SQL.Database(fs.readFileSync(file));
  try {
    if (reader.exec("SELECT value FROM _meta WHERE key='ledgerStartedAt'").length || reader.exec('SELECT COUNT(*) FROM apiKeyAccountingAudit')[0].values[0][0] !== 1) throw new Error('Unexpected activation/audit');
  } finally { reader.close(); }
  owner.assertOwned();
  if (hash(file) !== beforeDatabase || hash(coverageFile) !== beforeCoverage || hash(intentFile) !== beforeIntent) throw new Error('Offline inspection mutated artifacts');
  owner.release(); owner = null;
  let missingManifestDenied = false;
  if (!fs.existsSync(manifestFile)) {
    const priorFile = hash(file);
    try { await applyManagedRestore(directory, file); } catch (error) { missingManifestDenied = error.message === 'Managed restore artifacts unavailable; remain in maintenance'; }
    if (!missingManifestDenied || hash(file) !== priorFile) throw new Error('Partial generation promoted automatically');
    await open(); const prepared = prepareManagedRestore(db, root, 'fixture explicit new preparation'); db = null;
    await applyManagedRestore(directory, prepared.databaseBackup);
  } else {
    const manifest = JSON.parse(fs.readFileSync(manifestFile));
    await applyManagedRestore(directory, manifest.databaseBackup);
    await applyManagedRestore(directory, manifest.databaseBackup);
  }
  await open();
  const { createBudgetContext } = await load('/src/lib/apiKeyBudget/service.js');
  const context = await createBudgetContext('restore-crash-key', { adapter: async () => db });
  let gateCode; try { context.gate(); } catch (error) { gateCode = error.code; }
  if (gateCode !== 'api_key_accounting_unavailable') throw new Error('Maintenance falsely ready');
  const result = { recoveredOwner, missingManifestDenied, gateCode, offlineInspectionUnchanged: true, intentUnchanged: hash(intentFile) === beforeIntent,
    maintenancePresent: Boolean(db.coverage.status().maintenance), globalGapPresent: db.coverage.status().gaps.some(g => g.apiKeyId === null && !g.resolvedAt),
    audits: db.get('SELECT COUNT(*) AS n FROM apiKeyAccountingAudit').n, active: Boolean(db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")), generations: fs.readdirSync(root).length,
    coverageUnchangedOnReplay: ['manifest-installed', 'database-installed'].includes(boundary) ? hash(path.join(directory, '.accounting-coverage.json')) === beforeCoverage : null };
  fs.writeSync(1, 'RESULT:' + JSON.stringify(result) + '\n');
} finally { db?.close(); owner?.release(); await server.close(); }
