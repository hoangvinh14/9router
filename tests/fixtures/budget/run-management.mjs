import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
if(process.platform!=='linux'||process.version!=='v24.21.0'||process.argv.length!==2||process.env.NODE_OPTIONS||process.env.NODE_PATH)throw new Error('Clean pinned Linux Node required');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const files=['src/app/api/keys/[id]/budget/route.js','src/lib/accounting/management-auth.js','src/lib/accounting/profile-registry.js',
 'src/lib/accounting/management-request.js','src/lib/accounting/exact-money.js','src/lib/accounting/attempt-payload.js','src/lib/pricing/decimalMoney.js','src/lib/pricing/constants.js',
 'tests/fixtures/budget/management-loader.mjs','tests/fixtures/budget/management-session-stub.mjs','tests/unit/budget-management-route.test.mjs'];
const readbackTest = 'tests/unit/budget-management-readback.test.mjs';
files.push(readbackTest, 'src/lib/accounting/installed-service.js', 'src/lib/db/schema.js',
 'src/lib/db/adapters/nodeClosure.js', 'src/lib/db/adapters/nodeSqliteAdapter.js',
 ...['node-key-policy','node-attempt-ledger','node-outer-transaction','sql-operation-scope','process-state',
   'mutation-barrier','budget-windows','terminal-cost'].map(name => `src/lib/accounting/${name}.js`));
const args=['--unshare-all','--die-with-parent','--new-session','--ro-bind','/usr','/usr','--symlink','usr/bin','/bin','--ro-bind','/lib','/lib'];
if(fs.existsSync('/lib64'))args.push('--ro-bind','/lib64','/lib64');
for(const file of [...files,'tests/fixtures/budget/module-scope.json']){
 const source=path.join(repo,file);for(let p=source;p!==repo;p=path.dirname(p))if(fs.lstatSync(p).isSymbolicLink())throw new Error('Symlink input');
 if(!fs.statSync(source).isFile())throw new Error('Nonfile input');
 args.push('--ro-bind',source,file.endsWith('module-scope.json')?'/app/package.json':`/app/${file}`);
}
args.push('--ro-bind',fs.realpathSync(process.execPath),'/runtime/node','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--tmpfs','/sandbox');
for(const name of ['home','data','config','cache','tmp'])args.push('--dir',`/sandbox/${name}`);
args.push('--chdir','/app','--remount-ro','/','--','/runtime/node','--unhandled-rejections=strict','--experimental-loader','/app/tests/fixtures/budget/management-loader.mjs','--test','/app/tests/unit/budget-management-route.test.mjs', '/app/'+readbackTest);
const env={PATH:'/runtime:/usr/bin:/bin',HOME:'/sandbox/home',DATA_DIR:'/sandbox/data',XDG_DATA_HOME:'/sandbox/data',XDG_CONFIG_HOME:'/sandbox/config',
 XDG_CACHE_HOME:'/sandbox/cache',TMPDIR:'/sandbox/tmp',TZ:'UTC',LANG:'C',NODE_ENV:'test',BUDGET_PURE_SANDBOX:'1',BUDGET_OUTER_NET:fs.readlinkSync('/proc/self/ns/net')};
const r=spawnSync('/usr/bin/bwrap',args,{env,stdio:'inherit',timeout:60000});
if(r.error||r.signal||r.status!==0){console.error('Management sandbox failed; no host fallback',r.error?.code,r.signal,r.status);process.exitCode=1;}
