// Exact bounded native transport integration; no app startup or host imports.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
if(process.platform!=='linux'||process.version!=='v24.21.0'||process.argv.length!==2||process.env.NODE_OPTIONS||process.env.NODE_PATH)throw new Error('Clean pinned Linux Node required');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const files=[
  'src/lib/accounting/attempt-payload.js','src/lib/accounting/budget-windows.js','src/lib/accounting/exact-money.js',
  'src/lib/accounting/process-state.js','src/lib/accounting/mutation-barrier.js','src/lib/accounting/sql-operation-scope.js','src/lib/accounting/node-outer-transaction.js',
  'src/lib/accounting/node-attempt-ledger.js','src/lib/accounting/node-key-policy.js','src/lib/accounting/terminal-cost.js','src/lib/accounting/anthropic-usage.js',
  'src/lib/pricing/constants.js','src/lib/pricing/decimalMoney.js','src/lib/db/adapters/nodeSqliteAdapter.js',
  'src/lib/db/adapters/nodeClosure.js','src/lib/db/schema.js',
  'open-sse/utils/proxyFetch.js','open-sse/utils/debugLog.js','open-sse/utils/claudeCliVersion.js',
  'open-sse/config/runtimeConfig.js','open-sse/config/errorConfig.js',
  'tests/unit/budget-direct-transport.test.mjs','tests/fixtures/budget/transport-bootstrap.mjs',
];
const args=['--unshare-all','--unshare-user','--unshare-net','--uid','0','--gid','0','--cap-drop','ALL','--cap-add','CAP_NET_ADMIN','--cap-add','CAP_SETPCAP','--die-with-parent','--new-session','--ro-bind','/usr','/usr','--symlink','usr/bin','/bin','--ro-bind','/lib','/lib'];
if(fs.existsSync('/lib64'))args.push('--ro-bind','/lib64','/lib64');
for(const file of [...files,'tests/fixtures/budget/module-scope.json']){
  const source=path.join(repo,file);
  for(let p=source;p!==repo;p=path.dirname(p))if(fs.lstatSync(p).isSymbolicLink())throw new Error('Symlink input refused');
  if(!fs.statSync(source).isFile())throw new Error('Nonfile input refused');
  args.push('--ro-bind',source,file.endsWith('module-scope.json')?'/app/package.json':`/app/${file}`);
}
// Already-installed dependency, no npm scripts/install/network; exact tree hash
// recorded in admission. No other host node_modules exposed.
const dependency=path.join(repo,'node_modules/undici');
for(const p of [path.join(repo,'node_modules'),dependency])if(fs.lstatSync(p).isSymbolicLink())throw new Error('Symlink dependency refused');
args.push('--ro-bind',dependency,'/app/node_modules/undici','--ro-bind',fs.realpathSync(process.execPath),'/runtime/node',
  '--proc','/proc','--dev','/dev','--tmpfs','/tmp','--tmpfs','/sandbox');
for(const name of ['home','data','config','cache','tmp'])args.push('--dir',`/sandbox/${name}`);
args.push('--chdir','/app','--remount-ro','/','--','/runtime/node','/app/tests/fixtures/budget/transport-bootstrap.mjs');
const env={PATH:'/runtime:/usr/bin:/bin',HOME:'/sandbox/home',DATA_DIR:'/sandbox/data',XDG_DATA_HOME:'/sandbox/data',
  XDG_CONFIG_HOME:'/sandbox/config',XDG_CACHE_HOME:'/sandbox/cache',TMPDIR:'/sandbox/tmp',TZ:'UTC',LANG:'C',
  NODE_ENV:'production',BUDGET_TRANSPORT_SANDBOX:'1',BUDGET_OUTER_NET:fs.readlinkSync('/proc/self/ns/net'),BUDGET_OUTER_USER:fs.readlinkSync('/proc/self/ns/user')};
const result=spawnSync('/usr/bin/bwrap',args,{env,stdio:'inherit',timeout:60000});
if(result.error||result.signal||result.status!==0){console.error('Transport sandbox failed; no host fallback',result.error?.code,result.signal,result.status);process.exitCode=1;}
