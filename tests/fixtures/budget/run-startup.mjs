import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
if(process.platform!=='linux'||process.version!=='v24.21.0'||process.argv.length!==2||process.env.NODE_OPTIONS||process.env.NODE_PATH)throw new Error('Clean pinned Linux Node required');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const files=[
 'src/shared/utils/keyAccess.js','src/shared/constants/keyAccess.js',
 'src/lib/dataDir.js','src/lib/db/paths.js','src/lib/db/driver.js','src/lib/db/migrate.js','src/lib/db/schema.js',
 'src/lib/db/backup.js','src/lib/db/version.js','src/lib/db/helpers/nullBytes.js','src/lib/db/helpers/metaStore.js','src/lib/db/helpers/jsonCol.js',
 'src/lib/db/migrations/index.js','src/lib/db/migrations/001-initial.js','src/lib/db/adapters/nodeSqliteAdapter.js','src/lib/db/adapters/nodeClosure.js',
 'src/lib/accounting/attempt-payload.js','src/lib/accounting/budget-windows.js','src/lib/accounting/exact-money.js','src/lib/accounting/process-state.js',
 'src/lib/accounting/sql-operation-scope.js','src/lib/accounting/node-outer-transaction.js','src/lib/accounting/node-attempt-ledger.js',
 'src/lib/accounting/terminal-cost.js','src/lib/accounting/node-key-policy.js','src/lib/accounting/mutation-barrier.js',
 'src/lib/accounting/node-existing-audit.js','src/lib/db/app-schema-work.js',
 'src/lib/pricing/constants.js','src/lib/pricing/decimalMoney.js','src/lib/pricing/claude-standard-reference.js','tests/fixtures/budget/alias-loader.mjs','tests/unit/budget-startup-barrier.test.mjs',
 'scripts/provision-internal-accounting.mjs','scripts/inspect-legacy-accounting.mjs','tests/unit/budget-provisioning.test.mjs',
 'src/lib/accounting/internal-binding.js','src/lib/accounting/node-anthropic-account.js',
 'src/lib/accounting/anthropic-reference-price.js','src/lib/accounting/node-routing-snapshot.js',
 'open-sse/services/accountFallback.js','open-sse/config/errorConfig.js','tests/unit/budget-internal-binding.test.mjs',
];
const args=['--unshare-all','--die-with-parent','--new-session','--ro-bind','/usr','/usr','--symlink','usr/bin','/bin','--ro-bind','/lib','/lib'];
if(fs.existsSync('/lib64'))args.push('--ro-bind','/lib64','/lib64');
for(const file of [...files,'tests/fixtures/budget/module-scope.json']){
 const source=path.join(repo,file);for(let p=source;p!==repo;p=path.dirname(p))if(fs.lstatSync(p).isSymbolicLink())throw new Error('Symlink input');
 if(!fs.statSync(source).isFile())throw new Error('Nonfile input');
 args.push('--ro-bind',source,file.endsWith('module-scope.json')?'/app/package.json':`/app/${file}`);
}
args.push('--ro-bind',fs.realpathSync(process.execPath),'/runtime/node','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--tmpfs','/sandbox');
const registry = path.join(repo, 'docker/internal-profile-registry.js');
if (fs.realpathSync(registry) !== registry || !fs.statSync(registry).isFile()) throw new Error('Unsafe Docker registry input');
args.push('--ro-bind', registry, '/app/src/lib/accounting/profile-registry.js', '--tmpfs', '/run/9router');
for(const name of ['home','data','config','cache','tmp'])args.push('--dir',`/sandbox/${name}`);
args.push('--chdir','/app','--remount-ro','/','--','/runtime/node','--unhandled-rejections=strict','--test-concurrency=1','--test','/app/tests/unit/budget-startup-barrier.test.mjs','/app/tests/unit/budget-provisioning.test.mjs','/app/tests/unit/budget-internal-binding.test.mjs');
const env={PATH:'/runtime:/usr/bin:/bin',HOME:'/sandbox/home',DATA_DIR:'/sandbox/data',XDG_DATA_HOME:'/sandbox/data',XDG_CONFIG_HOME:'/sandbox/config',
 XDG_CACHE_HOME:'/sandbox/cache',TMPDIR:'/sandbox/tmp',TZ:'UTC',LANG:'C',NODE_ENV:'test',BUDGET_DRIVER_SANDBOX:'1',BUDGET_OUTER_NET:fs.readlinkSync('/proc/self/ns/net')};
const r=spawnSync('/usr/bin/bwrap',args,{env,stdio:'inherit',timeout:60000});
if(r.error||r.signal||r.status!==0){console.error('Startup sandbox failed; no host fallback',r.error?.code,r.signal,r.status);process.exitCode=1;}
