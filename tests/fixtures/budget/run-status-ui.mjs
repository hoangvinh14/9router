// Pure client request/projection + JSX parse only; no React mount/app/service.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
if(process.platform!=='linux'||process.version!=='v24.21.0'||process.argv.length!==2||process.env.NODE_OPTIONS||process.env.NODE_PATH)throw new Error('Clean pinned Linux Node required');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const files=[
 'src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js',
 'src/app/(dashboard)/dashboard/endpoint/components/AccountingStatus.js',
 'src/app/(dashboard)/dashboard/endpoint/components/accountingStatusClient.js',
 'tests/unit/budget-accounting-status-ui.test.mjs',
 'node_modules/@babel/parser/package.json','node_modules/@babel/parser/lib/index.js',
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
args.push('--chdir','/app','--remount-ro','/','--','/runtime/node','--unhandled-rejections=strict','--test','--test-concurrency=1','/app/tests/unit/budget-accounting-status-ui.test.mjs');
const env={PATH:'/runtime:/usr/bin:/bin',HOME:'/sandbox/home',DATA_DIR:'/sandbox/data',XDG_DATA_HOME:'/sandbox/data',XDG_CONFIG_HOME:'/sandbox/config',XDG_CACHE_HOME:'/sandbox/cache',TMPDIR:'/sandbox/tmp',TZ:'UTC',LANG:'C',NODE_ENV:'test',BUDGET_UI_SANDBOX:'1',BUDGET_OUTER_NET:fs.readlinkSync('/proc/self/ns/net')};
const r=spawnSync('/usr/bin/bwrap',args,{env,stdio:'inherit',timeout:30000});
if(r.error||r.signal||r.status!==0){console.error('Status UI pure sandbox failed; no host fallback',r.error?.code,r.signal,r.status);process.exitCode=1;}
