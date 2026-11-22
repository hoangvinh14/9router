import fs from 'node:fs';
import path from 'node:path';

// Run offline before serving traffic. The operator controls the parent and
// must keep the new directory private until this command exits successfully.
const [command, directory] = process.argv.slice(2);
const checking = command === '--check-binding';

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
}
try {
  if (process.argv.length !== 4 || (!checking && command !== '--create-new') || !path.isAbsolute(directory ?? '') ||
      path.normalize(directory) !== directory || directory.endsWith('/') || process.platform !== 'linux' ||
      Number(process.versions.node.split('.')[0]) !== 24 || process.getuid() === 0) {
    throw new Error('Usage (non-root Linux Node 24): node scripts/provision-internal-accounting.mjs {--create-new|--check-binding} /absolute/directory');
  }
  const parent = path.dirname(directory);
  if (fs.realpathSync(parent) !== parent) throw new Error('Use a canonical, operator-controlled parent directory');
  // Only exclusive creation grants first-provision provenance. The separate
  // check can inspect a marked database but cannot provision or adopt it.
  let binding;
  if (checking) {
    try { binding = await readBinding(); requirePrivateDb(directory); }
    catch { throw new Error('Refused: invalid binding input or private existing database unavailable'); }
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
        const { verifyInternalAnthropicBinding } = await import('../src/lib/accounting/internal-binding.js');
        verifyInternalAnthropicBinding(adapter, binding);
      } else {
        const { provisionEmptyNodeAccountingSchema } = await import('../src/lib/accounting/node-existing-audit.js');
        provisionEmptyNodeAccountingSchema(adapter);
      }
    } finally { adapter.close(); }
    const disposition = globalThis._dbAdapter.accountingCloseDisposition;
    if (disposition?.closure !== 'confirmed' || disposition.checkpoint !== 'confirmed' || disposition.retirementFailed !== false) throw new Error();
    console.log(checking ? 'Local binding matched; no profile or budget was enabled.' :
      'Accounting schema prepared; no profile or budget was enabled.');
  } catch {
    // Preserve the new directory for inspection; no implicit removal or retry.
    throw new Error(checking ? 'Binding check failed; no admission granted' :
      'Provisioning failed: do not serve this directory; inspect offline');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
