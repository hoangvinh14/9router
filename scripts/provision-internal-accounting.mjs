import fs from 'node:fs';
import path from 'node:path';

// Run offline before serving traffic. The operator controls the parent and
// must keep the new directory private until this command exits successfully.
const [command, directory] = process.argv.slice(2);
const checking = command === '--check-binding';
const enabling = command === '--enable-existing';

async function readBinding() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 4096) throw new Error();
    chunks.push(chunk);
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}

function requirePrivateDb(directory) {
  const dir = fs.lstatSync(directory);
  if (!dir.isDirectory() || dir.uid !== process.getuid() || (dir.mode & 0o077) !== 0 ||
      fs.realpathSync(directory) !== directory) throw new Error();
  const dbDir = path.join(directory, 'db');
  const file = path.join(dbDir, 'data.sqlite');
  if (fs.realpathSync(dbDir) !== dbDir || !fs.lstatSync(dbDir).isDirectory()) throw new Error();
  for (const name of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) {
    const stat = fs.lstatSync(name, { throwIfNoEntry: false });
    if (!stat && name !== file) continue;
    if (!stat?.isFile() || stat.uid !== process.getuid() || stat.nlink !== 1) throw new Error();
  }
  return file;
}

async function backupExistingDb(directory, file) {
  const { DatabaseSync, backup } = await import('node:sqlite');
  const { readAccountingMarkers } = await import('../src/lib/accounting/mutation-barrier.js');
  const source = new DatabaseSync(file, { readOnly: true });
  try {
    if (!source.prepare("SELECT 1 FROM main.sqlite_schema WHERE type = 'table' AND name = 'apiKeys'").get()) {
      throw new Error();
    }
    const accountingObjects = source.prepare("SELECT 1 FROM main.sqlite_schema WHERE lower(name) GLOB 'accounting_*'").get();
    if (accountingObjects || readAccountingMarkers({ all: (sql, params) => source.prepare(sql).all(...params) }).length) {
      throw new Error('Refused: existing accounting schema');
    }
    const backupDir = fs.mkdtempSync(path.join(directory, 'before-budget-'));
    await backup(source, path.join(backupDir, 'data.sqlite'));
    console.log('SQLite backup saved in ' + path.basename(backupDir));
  } finally {
    source.close();
  }
}

try {
  if (process.argv.length !== 4 || (!checking && !enabling && command !== '--create-new') || !path.isAbsolute(directory ?? '') ||
      path.normalize(directory) !== directory || directory.endsWith('/') || process.platform !== 'linux' ||
      Number(process.versions.node.split('.')[0]) !== 24 || process.getuid() === 0) {
    throw new Error('Usage (non-root Linux Node 24): node scripts/provision-internal-accounting.mjs {--create-new|--enable-existing|--check-binding} /absolute/directory');
  }
  const parent = path.dirname(directory);
  if (fs.realpathSync(parent) !== parent) throw new Error('Use a canonical, operator-controlled parent directory');
  let binding;
  if (checking) {
    try { binding = await readBinding(); requirePrivateDb(directory); }
    catch { throw new Error('Refused: invalid binding input or private existing database unavailable'); }
  } else if (enabling) {
    try { await backupExistingDb(directory, requirePrivateDb(directory)); }
    catch { throw new Error('Refused: expected a private SQLite database with no accounting schema and a successful backup'); }
  } else {
    try { fs.mkdirSync(directory, { mode: 0o700 }); }
    catch { throw new Error('Refused: target must not exist and its parent must be writable'); }
  }

  try {
    process.env.DATA_DIR = directory;
    const { DATA_DIR } = await import('../src/lib/dataDir.js');
    if (DATA_DIR !== directory) throw new Error();
    const driver = await import('../src/lib/db/driver.js');
    const adapter = await (checking ? driver.getMarkedAccountingAdapterForOfflineCheck() : driver.getAccountingAdapter());
    try {
      if (checking) {
        const { resolveInternalOperatorBinding } = await import('../src/lib/accounting/internal-binding.js');
        await resolveInternalOperatorBinding(adapter, binding);
      } else {
        const { provisionEmptyNodeAccountingSchema } = await import('../src/lib/accounting/node-existing-audit.js');
        provisionEmptyNodeAccountingSchema(adapter, { existingSqlite: enabling });
      }
    } finally { adapter.close(); }
    const disposition = globalThis._dbAdapter.accountingCloseDisposition;
    if (disposition?.closure !== 'confirmed' || disposition.checkpoint !== 'confirmed' || disposition.retirementFailed !== false) throw new Error();
    console.log(checking ? 'Local binding matched; no profile or budget was enabled.' :
      'Accounting schema prepared; no profile or budget was enabled.');
  } catch {
    // Preserve the new directory for inspection; no implicit removal or retry.
    throw new Error(checking ? 'Binding check failed; no admission granted' :
      'Provisioning failed: keep the instance offline and inspect the data and any backup');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
