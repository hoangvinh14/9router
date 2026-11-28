// Offline mounted fixture, not a live app/browser profile or Next server.
import fs from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
if(process.platform!=='linux'||process.version!=='v24.21.0'||process.argv.length!==2||process.env.NODE_OPTIONS||process.env.NODE_PATH)throw Error('Clean pinned Linux Node required');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const browser=path.join(homedir(),'.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64');
const font = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const fontConfig = path.join(repo, 'tests/fixtures/budget/chromium-fonts.conf');
const files=[
 'src/app/(dashboard)/dashboard/endpoint/components/AccountingStatus.js',
 'src/app/(dashboard)/dashboard/endpoint/components/accountingStatusClient.js',
 'tests/unit/budget-accounting-status-mounted.test.mjs',
 'src/lib/pricing/decimalMoney.js','src/lib/pricing/constants.js',
 'node_modules/typescript/package.json','node_modules/typescript/lib/typescript.js',
 'node_modules/react/cjs/react.production.js','node_modules/react/cjs/react-jsx-runtime.production.js',
 'node_modules/react-dom/cjs/react-dom.production.js','node_modules/react-dom/cjs/react-dom-client.production.js',
 'node_modules/scheduler/cjs/scheduler.production.js',
 'node_modules/prop-types/factoryWithThrowingShims.js','node_modules/prop-types/lib/ReactPropTypesSecret.js',
];
function regularTree(source){
 for(let p=source;p!=='/';p=path.dirname(p))if(fs.lstatSync(p).isSymbolicLink())throw Error('Symlink input '+p);
 const stat=fs.lstatSync(source);if(stat.isDirectory()){for(const name of fs.readdirSync(source))regularTree(path.join(source,name));}else if(!stat.isFile())throw Error('Nonregular input');
}
regularTree(font);regularTree(fontConfig);
for(const file of files)regularTree(path.join(repo,file));
regularTree(path.join(repo,'tests/fixtures/budget/module-scope.json'));
regularTree(path.join(repo,'node_modules/playwright-core'));regularTree(browser);
const args=['--unshare-all','--die-with-parent','--new-session','--cap-drop','ALL','--ro-bind','/usr/lib','/usr/lib','--ro-bind','/lib','/lib'];
args.push('--ro-bind',font,'/fonts/DejaVuSans.ttf','--ro-bind',fontConfig,'/etc/fonts/fonts.conf');
if(fs.existsSync('/lib64'))args.push('--ro-bind','/lib64','/lib64');
for(const file of files)args.push('--ro-bind',path.join(repo,file),'/app/'+file);
args.push('--ro-bind',path.join(repo,'node_modules/playwright-core'),'/app/node_modules/playwright-core','--ro-bind',path.join(repo,'tests/fixtures/budget/module-scope.json'),'/app/package.json','--ro-bind',browser,'/browser','--ro-bind',fs.realpathSync(process.execPath),'/runtime/node','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--tmpfs','/sandbox');
for(const dir of ['home','tmp','data','config','cache'])args.push('--dir','/sandbox/'+dir);
args.push('--chdir','/app','--remount-ro','/','--','/runtime/node','--max-old-space-size=256','--unhandled-rejections=strict','--test','--test-concurrency=1','/app/tests/unit/budget-accounting-status-mounted.test.mjs');
const env={PATH:'/runtime',HOME:'/sandbox/home',TMPDIR:'/sandbox/tmp',DATA_DIR:'/sandbox/data',XDG_DATA_HOME:'/sandbox/data',XDG_CONFIG_HOME:'/sandbox/config',XDG_CACHE_HOME:'/sandbox/cache',LANG:'C',TZ:'UTC',NODE_ENV:'production',PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:'1',BUDGET_UI_MOUNT_SANDBOX:'1',BUDGET_OUTER_NET:fs.readlinkSync('/proc/self/ns/net')};
// Outer timeout kills bwrap/PID1; namespace teardown kills every descendant.
// CPU/fd/output limits plus trusted bounded fixture; no aggregate RAM guarantee.
const r=spawnSync('/usr/bin/prlimit',['--cpu=45','--nofile=512','--fsize=33554432','--','/usr/bin/bwrap',...args],{env,stdio:'inherit',timeout:45000,killSignal:'SIGKILL'});
if(r.error||r.signal||r.status!==0){console.error('Offline mounted sandbox failed; no host fallback',r.error?.code,r.signal,r.status);process.exitCode=1;}
