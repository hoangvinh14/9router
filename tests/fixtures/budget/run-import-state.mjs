import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
if(process.platform!=='linux'||process.version!=='v24.21.0'||process.argv.length!==2||process.env.NODE_OPTIONS||process.env.NODE_PATH)throw new Error('Clean pinned Linux Node required');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const files=[
 'src/shared/utils/keyAccess.js','src/shared/constants/keyAccess.js',
 'src/lib/db/repos/connectionsRepo.js','tests/fixtures/budget/connection-import-loader.mjs',
 'src/lib/db/repos/nodesRepo.js','tests/fixtures/budget/node-import-loader.mjs',
 'src/lib/db/repos/proxyPoolsRepo.js','tests/fixtures/budget/pool-import-loader.mjs',
 'src/lib/db/repos/apiKeysRepo.js','tests/fixtures/budget/key-import-loader.mjs',
 'src/lib/db/repos/aliasRepo.js','src/lib/db/repos/pricingRepo.js','src/lib/db/repos/disabledModelsRepo.js',
 'src/lib/db/helpers/kvStore.js','src/lib/db/repos/usageRepo.js','tests/fixtures/budget/map-import-loader.mjs',
 'src/lib/dataDir.js','src/lib/db/paths.js','src/lib/db/driver.js','src/lib/db/migrate.js','src/lib/db/schema.js',
 'src/lib/db/backup.js','src/lib/db/version.js','src/lib/db/helpers/nullBytes.js','src/lib/db/helpers/metaStore.js','src/lib/db/helpers/jsonCol.js',
 'src/lib/db/migrations/index.js','src/lib/db/migrations/001-initial.js','src/lib/db/adapters/nodeSqliteAdapter.js','src/lib/db/adapters/nodeClosure.js',
 'src/lib/accounting/attempt-payload.js','src/lib/accounting/budget-windows.js','src/lib/accounting/exact-money.js','src/lib/accounting/process-state.js',
 'src/lib/accounting/sql-operation-scope.js','src/lib/accounting/node-outer-transaction.js','src/lib/accounting/node-attempt-ledger.js',
 'src/lib/accounting/terminal-cost.js','src/lib/accounting/node-key-policy.js', 'open-sse/utils/ordinary-dispatch.js','src/lib/accounting/mutation-barrier.js',
 'src/lib/pricing/constants.js','src/lib/pricing/decimalMoney.js','tests/fixtures/budget/alias-loader.mjs','tests/unit/budget-import-state.test.mjs',
];
const args=['--unshare-all','--die-with-parent','--new-session','--ro-bind','/usr','/usr','--symlink','usr/bin','/bin','--ro-bind','/lib','/lib'];
if(fs.existsSync('/lib64'))args.push('--ro-bind','/lib64','/lib64');
for(const file of [...files,'tests/fixtures/budget/module-scope.json']){
 const source=path.join(repo,file);for(let p=source;p!==repo;p=path.dirname(p))if(fs.lstatSync(p).isSymbolicLink())throw new Error('Symlink input');
 if(!fs.statSync(source).isFile())throw new Error('Nonfile input');
 args.push('--ro-bind',source,file.endsWith('module-scope.json')?'/app/package.json':`/app/${file}`);
}
args.push('--ro-bind',fs.realpathSync(process.execPath),'/runtime/node','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--tmpfs','/sandbox');
for(const name of ['home','data','config','cache','tmp'])args.push('--dir',`/sandbox/${name}`);
args.push('--chdir','/app','--remount-ro','/','--','/runtime/node','--unhandled-rejections=strict','--test','/app/tests/unit/budget-import-state.test.mjs');
const env={PATH:'/runtime:/usr/bin:/bin',HOME:'/sandbox/home',DATA_DIR:'/sandbox/data',XDG_DATA_HOME:'/sandbox/data',XDG_CONFIG_HOME:'/sandbox/config',
 XDG_CACHE_HOME:'/sandbox/cache',TMPDIR:'/sandbox/tmp',TZ:'UTC',LANG:'C',NODE_ENV:'test',BUDGET_DRIVER_SANDBOX:'1',BUDGET_OUTER_NET:fs.readlinkSync('/proc/self/ns/net')};
const r=spawnSync('/usr/bin/bwrap',args,{env,stdio:'inherit',timeout:90000});
if(r.error||r.signal||r.status!==0){console.error('Import state sandbox failed; no host fallback',r.error?.code,r.signal,r.status);process.exitCode=1;}
