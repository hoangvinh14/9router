// Fixed Linux budget primitive + existing SQLite fixture lane; legacy filename.
// No application imports on the host; no production driver/startup in child.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'linux' || process.version !== 'v24.21.0' || process.argv.length !== 2) {
  throw new Error('Budget fixture lane requires Linux, Node v24.21.0 and no arguments');
}
if (process.env.NODE_OPTIONS || process.env.NODE_PATH) throw new Error('Start launcher with a clean environment');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const files = [
  'src/lib/accounting/exact-money.js', 'src/lib/accounting/budget-windows.js',
  'src/lib/accounting/attempt-payload.js', 'src/lib/pricing/decimalMoney.js',
  'src/lib/pricing/constants.js', 'tests/unit/budget-pure.test.mjs',
  'src/lib/db/adapters/nodeSqliteAdapter.js', 'src/lib/db/adapters/nodeClosure.js', 'src/lib/db/schema.js',
  'tests/unit/budget-storage.test.mjs',
  'src/lib/accounting/process-state.js', 'src/lib/accounting/mutation-barrier.js', 'tests/unit/budget-process-state.test.mjs',
  'src/lib/accounting/sql-operation-scope.js', 'tests/unit/budget-operation-scope.test.mjs',
  'src/lib/accounting/node-outer-transaction.js', 'tests/unit/budget-outer-transaction.test.mjs',
  'tests/unit/budget-node-lifecycle.test.mjs',
  'src/lib/accounting/node-connection-admission.js', 'tests/unit/budget-node-disposition.test.mjs',
  'src/lib/accounting/terminal-cost.js', 'src/lib/accounting/node-attempt-ledger.js', 'src/lib/accounting/node-key-policy.js', 'tests/unit/budget-ledger.test.mjs',
  'open-sse/utils/accounted-anthropic-stream.js', 'open-sse/utils/accounted-responses-stream.js', 'open-sse/utils/usageTracking.js', 'open-sse/translator/formats.js', 'open-sse/utils/streamHandler.js',
  'open-sse/utils/debugLog.js', 'open-sse/config/runtimeConfig.js', 'open-sse/config/errorConfig.js',
  'tests/unit/budget-anthropic-stream.test.mjs', 'tests/unit/budget-responses-stream.test.mjs',
  'src/lib/accounting/responses-usage.js', 'tests/unit/budget-responses-usage.test.mjs',
  'src/lib/accounting/anthropic-usage.js', 'tests/unit/budget-anthropic-usage.test.mjs',
];
const args = ['--unshare-all', '--die-with-parent', '--new-session',
  '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin',
  '--ro-bind', '/lib', '/lib'];
if (fs.existsSync('/lib64')) args.push('--ro-bind', '/lib64', '/lib64');
for (const file of [...files, 'tests/fixtures/budget/module-scope.json']) {
  const source = path.join(repo, file);
  for (let part = source; part !== repo; part = path.dirname(part)) {
    if (fs.lstatSync(part).isSymbolicLink()) throw new Error('Symlink in selected test input');
  }
  if (!fs.statSync(source).isFile()) throw new Error('Selected test input is not a file');
  args.push('--ro-bind', source, file.endsWith('module-scope.json') ? '/app/package.json' : `/app/${file}`);
}
args.push('--ro-bind', fs.realpathSync(process.execPath), '/runtime/node',
  '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--tmpfs', '/sandbox');
for (const name of ['home', 'data', 'config', 'cache', 'tmp']) args.push('--dir', `/sandbox/${name}`);
args.push('--chdir', '/app', '--remount-ro', '/', '--',
  '/runtime/node', '--unhandled-rejections=strict', '--test', '--test-isolation=none',
  '/app/tests/unit/budget-pure.test.mjs', '/app/tests/unit/budget-storage.test.mjs',
  '/app/tests/unit/budget-process-state.test.mjs', '/app/tests/unit/budget-operation-scope.test.mjs',
  '/app/tests/unit/budget-outer-transaction.test.mjs', '/app/tests/unit/budget-node-lifecycle.test.mjs',
  '/app/tests/unit/budget-node-disposition.test.mjs', '/app/tests/unit/budget-ledger.test.mjs',
  '/app/tests/unit/budget-responses-usage.test.mjs',
  '/app/tests/unit/budget-anthropic-usage.test.mjs', '/app/tests/unit/budget-anthropic-stream.test.mjs', '/app/tests/unit/budget-responses-stream.test.mjs');
const env = {
  PATH: '/runtime:/usr/bin:/bin', HOME: '/sandbox/home', DATA_DIR: '/sandbox/data',
  XDG_CONFIG_HOME: '/sandbox/config', XDG_DATA_HOME: '/sandbox/data', XDG_CACHE_HOME: '/sandbox/cache',
  TMPDIR: '/sandbox/tmp', TZ: 'UTC', LANG: 'C', NODE_ENV: 'test',
  BUDGET_PURE_SANDBOX: '1', BUDGET_OUTER_NET: fs.readlinkSync('/proc/self/ns/net'),
};
// No shell, inherited proxy/credentials/options, repo-wide mounts or host output.
// /usr and system libraries are read-only runtime exposure, not file-only isolation.
const result = spawnSync('/usr/bin/bwrap', args, { env, stdio: 'inherit', timeout: 60000 });
if (result.error || result.signal || result.status !== 0) {
  console.error('Budget fixture sandbox failed; no host fallback', JSON.stringify({
    status: result.status, signal: result.signal, error: result.error?.code ?? null,
  }));
  process.exitCode = 1;
}
