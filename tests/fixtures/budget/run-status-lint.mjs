// Exact scoped lint, no app execution or host fallback.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
if(process.platform!=='linux'||process.version!=='v24.21.0'||process.argv.length!==2||process.env.NODE_OPTIONS||process.env.NODE_PATH)throw Error('Clean pinned Node required');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const page='src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js';
const files=['eslint.config.mjs','package.json','jsconfig.json',page,'src/app/(dashboard)/dashboard/endpoint/components/AccountingStatus.js','src/app/(dashboard)/dashboard/endpoint/components/accountingStatusClient.js','tests/fixtures/budget/status-lint-check.mjs'];
const packages=JSON.parse(fs.readFileSync(path.join(repo,'tests/fixtures/budget/status-lint-packages.json'),'utf8'));
if(packages.length!==343||new Set(packages).size!==343)throw Error('Dependency inventory mismatch');
const internalLinks=new Map([
 ['node_modules/sharp/node_modules/.bin/semver',['../semver/bin/semver.js','node_modules/sharp']],
 ['node_modules/is-bun-module/node_modules/.bin/semver',['../semver/bin/semver.js','node_modules/is-bun-module']],
 ['node_modules/tsconfig-paths/node_modules/.bin/json5',['../json5/lib/cli.js','node_modules/tsconfig-paths']],
 ['node_modules/@typescript-eslint/typescript-estree/node_modules/.bin/semver',['../semver/bin/semver.js','node_modules/@typescript-eslint/typescript-estree']],
]);
const checkedLinks=new Set();
function noSymlink(source){for(let p=source;p!==path.dirname(p);p=path.dirname(p))if(fs.lstatSync(p).isSymbolicLink())throw Error('Symlink ancestor/target: '+p);}
function regularTree(source){
 const s=fs.lstatSync(source);
 if(s.isSymbolicLink()){
  const relative=path.relative(repo,source);const admitted=internalLinks.get(relative);
  if(!admitted||fs.readlinkSync(source)!==admitted[0])throw Error('Unadmitted symlink: '+relative);
  noSymlink(path.dirname(source));
  const target=path.resolve(path.dirname(source),admitted[0]);noSymlink(target);
  const within=path.relative(path.join(repo,admitted[1]),fs.realpathSync(target));
  if(!within||within==='..'||within.startsWith('../')||path.isAbsolute(within)||!fs.lstatSync(target).isFile())throw Error('Invalid internal link target');
  checkedLinks.add(relative);return;
 }
 noSymlink(source);
 if(s.isDirectory()){for(const name of fs.readdirSync(source))regularTree(path.join(source,name));}else if(!s.isFile())throw Error('Nonregular input');
}
for(const file of files)regularTree(path.join(repo,file));
// Full selected package subtrees, including their nested contents, are exposed
// readonly; this is a conservative declared closure, NOT minimal dynamic closure.
for(const pkg of packages){if(!/^node_modules\//.test(pkg)||pkg.split('/').includes('..'))throw Error('Invalid package path');regularTree(path.join(repo,pkg));}
if(checkedLinks.size!==internalLinks.size)throw Error('Internal link inventory mismatch');
console.log('Admitted four exact internal npm CLI links, readonly targets in same package subtree; not a general symlink grant.');
const baseline=spawnSync('/usr/bin/git',['show','HEAD:'+page],{cwd:repo,env:{PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',HOME:'/nonexistent'},encoding:'utf8',timeout:5000,maxBuffer:1024*1024});
if(baseline.status!==0||baseline.error)throw Error('HEAD baseline read failed');
const args=['--unshare-all','--die-with-parent','--new-session','--cap-drop','ALL','--ro-bind','/usr/lib','/usr/lib','--ro-bind','/lib','/lib'];
if(fs.existsSync('/lib64'))args.push('--ro-bind','/lib64','/lib64');
for(const file of files)args.push('--ro-bind',path.join(repo,file),'/app/'+file);
// Parent package mounts include nested package mounts already; avoid covering
// explicitly selected nested paths with mount-order-dependent overlays.
for(const pkg of packages.filter(p=>!packages.some(parent=>p!==parent&&p.startsWith(parent+'/'))))args.push('--ro-bind',path.join(repo,pkg),'/app/'+pkg);
args.push('--ro-bind',fs.realpathSync(process.execPath),'/runtime/node','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--tmpfs','/sandbox');
for(const dir of ['home','tmp','data','config','cache'])args.push('--dir','/sandbox/'+dir);
args.push('--chdir','/app','--remount-ro','/','--','/runtime/node','--max-old-space-size=512','--unhandled-rejections=strict','/app/tests/fixtures/budget/status-lint-check.mjs');
const env={PATH:'/runtime',HOME:'/sandbox/home',TMPDIR:'/sandbox/tmp',DATA_DIR:'/sandbox/data',XDG_DATA_HOME:'/sandbox/data',XDG_CONFIG_HOME:'/sandbox/config',XDG_CACHE_HOME:'/sandbox/cache',NODE_ENV:'test',LANG:'C',TZ:'UTC',BUDGET_LINT_SANDBOX:'1',BUDGET_OUTER_NET:fs.readlinkSync('/proc/self/ns/net')};
const r=spawnSync('/usr/bin/bwrap',args,{env,input:baseline.stdout,encoding:'utf8',stdio:['pipe','inherit','inherit'],timeout:60000,killSignal:'SIGKILL'});
if(r.error||r.signal||r.status!==0){console.error('Scoped lint sandbox failed; no host fallback',r.error?.code,r.signal,r.status);process.exitCode=1;}
