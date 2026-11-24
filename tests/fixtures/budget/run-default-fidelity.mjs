// No real transport: actual default executor/header/transform characterization.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
if(process.platform!=='linux'||process.version!=='v24.21.0'||process.argv.length!==2||process.env.NODE_OPTIONS||process.env.NODE_PATH)throw new Error('Clean pinned Linux Node required');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const files=[
 'src/lib/accounting/claude-converted-request.js','src/lib/accounting/claude-tool-continuity.js',
 'src/lib/accounting/attempt-payload.js','src/lib/accounting/budget-windows.js','src/lib/accounting/exact-money.js',
 'src/lib/accounting/anthropic-usage.js','src/lib/accounting/terminal-cost.js','src/lib/accounting/anthropic-dispatch-context.js',
 'src/lib/accounting/node-anthropic-account.js','src/lib/accounting/anthropic-reference-price.js','open-sse/services/accountFallback.js',
 'src/lib/pricing/constants.js','src/lib/pricing/decimalMoney.js','src/lib/pricing/claude-standard-reference.js',
 'open-sse/executors/base.js','open-sse/executors/default.js','open-sse/providers/registry/anthropic.js','open-sse/providers/shared.js',
 'open-sse/config/runtimeConfig.js','open-sse/config/errorConfig.js','open-sse/utils/debugLog.js','open-sse/utils/claudeCliVersion.js',
 'open-sse/utils/reasoningContentInjector.js','open-sse/translator/concerns/paramSupport.js','tests/unit/budget-default-fidelity.test.mjs',
];
const targets=['open-sse/config/providers.js','open-sse/services/oauthCredentialManager.js','open-sse/services/provider.js',
 'open-sse/providers/capabilities.js','open-sse/config/appConstants.js','open-sse/shared/clineAuth.js',
 'open-sse/utils/claudeCloaking.js','open-sse/utils/proxyFetch.js'];
const args=['--unshare-all','--die-with-parent','--new-session','--ro-bind','/usr','/usr','--symlink','usr/bin','/bin','--ro-bind','/lib','/lib'];
if(fs.existsSync('/lib64'))args.push('--ro-bind','/lib64','/lib64');
function bind(file,target){const source=path.join(repo,file);for(let p=source;p!==repo;p=path.dirname(p))if(fs.lstatSync(p).isSymbolicLink())throw new Error('Symlink refused');if(!fs.statSync(source).isFile())throw new Error('Nonfile refused');args.push('--ro-bind',source,target);}
for(const file of files)bind(file,'/app/'+file);
bind('tests/fixtures/budget/module-scope.json','/app/package.json');
for(const target of targets)bind('tests/fixtures/budget/default-fidelity-stub.mjs','/app/'+target);
args.push('--ro-bind',fs.realpathSync(process.execPath),'/runtime/node','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--tmpfs','/sandbox');
for(const name of ['home','data','config','cache','tmp'])args.push('--dir',`/sandbox/${name}`);
args.push('--chdir','/app','--remount-ro','/','--','/runtime/node','--unhandled-rejections=strict','--experimental-test-module-mocks','--test','/app/tests/unit/budget-default-fidelity.test.mjs');
const env={PATH:'/runtime:/usr/bin:/bin',HOME:'/sandbox/home',DATA_DIR:'/sandbox/data',XDG_DATA_HOME:'/sandbox/data',XDG_CONFIG_HOME:'/sandbox/config',
 XDG_CACHE_HOME:'/sandbox/cache',TMPDIR:'/sandbox/tmp',TZ:'UTC',LANG:'C',NODE_ENV:'test',BUDGET_PURE_SANDBOX:'1',BUDGET_OUTER_NET:fs.readlinkSync('/proc/self/ns/net')};
const r=spawnSync('/usr/bin/bwrap',args,{env,stdio:'inherit',timeout:60000});
if(r.error||r.signal||r.status!==0){console.error('Default fidelity sandbox failed; no host fallback',r.error?.code,r.signal,r.status);process.exitCode=1;}
