import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'linux' || process.version !== 'v24.21.0' || process.argv.length !== 2 ||
    process.env.NODE_OPTIONS || process.env.NODE_PATH) throw new Error('Clean pinned Linux Node required');
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const test = 'tests/unit/budget-route-readers.test.mjs';
const loader = 'tests/fixtures/budget/route-readers-loader.mjs';
const scope = 'tests/fixtures/budget/module-scope.json';
const files = [
  'src/sse/services/model.js', 'src/sse/services/keyAccess.js', 'src/sse/services/accounted-route.js', 'src/sse/utils/logger.js',
  'src/shared/constants/keyAccess.js', 'src/shared/constants/providers.js', 'src/shared/constants/providersDisplay.js',
  'open-sse/services/model.js', 'open-sse/utils/error.js', 'open-sse/config/runtimeConfig.js', 'open-sse/config/errorConfig.js',
  'src/lib/accounting/node-routing-snapshot.js', 'src/lib/accounting/node-outer-transaction.js',
  'src/lib/accounting/attempt-payload.js', 'src/lib/accounting/process-state.js', 'src/lib/accounting/sql-operation-scope.js',
  'src/lib/db/adapters/nodeClosure.js',
  'src/lib/db/helpers/jsonCol.js', 'src/lib/db/repos/settingsRepo.js', 'src/shared/utils/keyAccess.js',
  'src/sse/handlers/chat.js', 'src/lib/accounting/installed-service.js', 'src/lib/accounting/request-boundary.js',
  'src/lib/accounting/node-attempt-ledger.js', 'src/lib/accounting/node-key-policy.js', 'src/lib/accounting/budget-windows.js',
  'src/lib/accounting/node-anthropic-account.js', 'src/lib/accounting/anthropic-reference-price.js',
  'src/lib/accounting/exact-money.js', 'src/lib/accounting/terminal-cost.js', 'src/lib/pricing/constants.js', 'src/lib/pricing/decimalMoney.js','src/lib/pricing/claude-standard-reference.js',
  'open-sse/services/combo.js', 'open-sse/services/capacityAdapter.js', 'open-sse/services/accountFallback.js',
  'open-sse/services/systemoneRouter.js', 'open-sse/utils/accountingResponse.js',
  'tests/fixtures/budget/route-chat-stubs.mjs', 'tests/unit/budget-route-chat-cases.mjs', test, loader, scope,
];
const args = ['--unshare-all', '--die-with-parent', '--new-session', '--ro-bind', '/usr', '/usr', '--ro-bind', '/lib', '/lib'];
if (fs.existsSync('/lib64')) args.push('--ro-bind', '/lib64', '/lib64');
for (const file of files) {
  const source = path.resolve(repo, file);
  if (fs.realpathSync(source) !== source || !fs.statSync(source).isFile()) throw new Error('Unsafe fixture input');
  args.push('--ro-bind', source, file === scope ? '/app/package.json' : `/app/${file}`);
}
args.push('--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--ro-bind', fs.realpathSync(process.execPath), '/runtime/node',
  '--chdir', '/app', '--remount-ro', '/', '--', '/runtime/node', '--experimental-loader', `/app/${loader}`, '--test', `/app/${test}`);
const result = spawnSync('/usr/bin/bwrap', args, {
  env: { PATH: '/usr/bin:/bin', HOME: '/tmp', TMPDIR: '/tmp', BUDGET_OUTER_NET: fs.readlinkSync('/proc/self/ns/net') },
  stdio: 'inherit', timeout: 15000,
});
if (result.error || result.signal || result.status !== 0) {
  console.error('Route reader fixture failed; no host fallback', result.error?.code, result.signal, result.status);
  process.exitCode = 1;
}
