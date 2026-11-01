import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Linux-only, fail-closed runner. Nothing from host HOME or environment reaches
// application imports. No host network: all real sockets live in private loopback.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
if (args.some(arg => /^(--config|--root|--setupFiles|--globalSetup|--pool|--environment|--dir)(=|$)|^-c$/.test(arg))) throw new Error('Isolation configuration cannot be overridden');
if (process.platform !== 'linux' || !args.length || args.some(arg => arg.includes('\0'))) throw new Error('Linux isolated test arguments required');
const root = fs.mkdtempSync(path.join(os.tmpdir(), '9router-r1-isolated-'));
for (const name of ['home','data','tmp','cache','artifacts']) fs.mkdirSync(path.join(root,name));
const canary = path.join(root,'read-only-canary'); fs.writeFileSync(canary,'sacrificial-read-only');
const secret = path.join(root,'hidden-canary'); fs.writeFileSync(secret,'sacrificial-hidden');
const readOnlyDir = path.join(root,'read-only-dir'); fs.mkdirSync(readOnlyDir);
const sandbox = path.join(root,'sandbox'); fs.mkdirSync(sandbox);
for (const name of ['home','data','tmp','cache','artifacts']) fs.renameSync(path.join(root,name),path.join(sandbox,name));
const node = fs.realpathSync(process.execPath);
const bind = ['--ro-bind','/usr','/usr','--symlink','usr/bin','/bin','--ro-bind','/lib','/lib'];
if (fs.existsSync('/lib64')) bind.push('--ro-bind','/lib64','/lib64');
const mount = (source,target=source) => bind.push('--ro-bind',source,target);
// Bind only public project code/dependencies, never repo .env, build artifacts,
// plans/logs, .git, user profiles or host sockets.
for (const name of ['src','open-sse','tests','cli','scripts','node_modules','package.json','jsconfig.json','next.config.mjs']) mount(path.join(repo,name));
mount(node,'/runtime/node'); mount(canary,'/isolation-canary'); mount(readOnlyDir,'/read-only-fixture');
const env = { PATH:'/runtime:/usr/bin:/bin',HOME:`${sandbox}/home`,DATA_DIR:`${sandbox}/data`,TMPDIR:`${sandbox}/tmp`,
  XDG_CACHE_HOME:`${sandbox}/cache`,ENABLE_REQUEST_LOGS:'false',OBSERVABILITY_ENABLED:'false',
  NODE_ENV:'test',TZ:'UTC',R1_ISOLATED_ROOT:sandbox,R1_OUTER_NET:fs.readlinkSync('/proc/self/ns/net'),
  R1_HIDDEN_CANARY:secret,NO_COLOR:'1',NODE_OPTIONS:'--max-old-space-size=4096' };
const command = ['--unshare-all','--die-with-parent','--new-session',...bind,'--proc','/proc','--dev','/dev','--tmpfs','/tmp',
  '--bind',sandbox,sandbox,'--chdir',`${repo}/tests`,'--remount-ro','/','--',
  '/runtime/node',`${repo}/tests/node_modules/vitest/vitest.mjs`,'run','--configLoader','native','--config',`${repo}/tests/vitest.accounting-isolated.config.js`,...args,'--reporter=default','--reporter=json',`--outputFile=${sandbox}/artifacts/results.json`];
const result = spawnSync('/usr/bin/bwrap',command,{env,stdio:'inherit',timeout:600000});
const outsideArtifacts = fs.readdirSync(readOnlyDir);
console.log(JSON.stringify({kind:'r1-isolated-run',root:sandbox,status:result.status,signal:result.signal,error:result.error?.message ?? null,outsideArtifacts}));
// Preserve only explicitly isolated artifacts. No cleanup of any host data path.
process.exitCode = outsideArtifacts.length ? 1 : result.status ?? 1;
