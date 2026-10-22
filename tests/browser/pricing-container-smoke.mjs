import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const image = process.env.PRICING_TEST_IMAGE;
if (!image) throw new Error('Set PRICING_TEST_IMAGE to the built test image');
const root = fs.mkdtempSync(path.join(os.tmpdir(), '9router-container-'));
const data = path.join(root, 'data'); fs.mkdirSync(data);
const name = `9router-pricing-test-${process.pid}`;
const passed = [];
let created = false;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 30000 });
const check = (label, action) => { action(); passed.push(label); console.log(`PASS ${label}`); };
const api = (body) => JSON.parse(docker('exec', name, 'node', '--input-type=module', '-e', `
  import assert from 'node:assert/strict';
  const base='http://127.0.0.1:23128';
  let response;
  for(let i=0;i<30;i++) {
    try { response=await fetch(base+'/api/auth/status',{signal:AbortSignal.timeout(1000)});if(response.status===200)break; }catch{}
    await new Promise(resolve=>setTimeout(resolve,300));
  }
  assert.equal(response?.status,200);
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'disposable-container-password'})});
  assert.equal(login.status,200);
  const cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  async function request(target,method='GET',data) {
    const response=await fetch(base+target,{method,headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});
    return {status:response.status,body:await response.json()};
  }
  ${body}
`));
try {
  docker('run', '-d', '--name', name, '--network', 'none', '--memory', '1g', '--cpus', '2',
    '--mount', `type=bind,src=${data},dst=/app/data`,
    '--tmpfs', '/app/data-home:rw,size=16777216,uid=1000,gid=1000',
    '-e', 'PORT=23128', '-e', 'HOSTNAME=127.0.0.1', '-e', 'DATA_DIR=/app/data',
    '-e', 'JWT_SECRET=disposable-container-jwt-secret', '-e', 'INITIAL_PASSWORD=disposable-container-password',
    '-e', 'MODEL_CATALOG_SYNC=off', '-e', 'DISABLE_BACKGROUND_TOKEN_REFRESH=true', image);
  created = true;
  check('Node 22 Alpine runtime', () => {
    const details = docker('exec', name, 'node', '-e', 'console.log(JSON.stringify({version:process.versions.node,glibc:process.report.getReport().header.glibcVersionRuntime??null,serverUid:require("node:fs").readFileSync("/proc/1/status","utf8").match(/^Uid:\\s+(\\d+)/m)[1]}))');
    const runtime = JSON.parse(details); assert.match(runtime.version, /^22\./); assert.equal(runtime.glibc, null); assert.equal(runtime.serverUid, '1000');
    fs.writeFileSync(path.join(root,'runtime.json'), details);
  });
  check('container authenticated exact override and schedule enable', () => {
    api(`
      const denied=await fetch(base+'/api/pricing');assert.equal(denied.status,401);
      const patch=await request('/api/pricing','PATCH',{custom:{fixture:{input:'0.000000001',output:'7.125',cached:'0'}}});assert.equal(patch.status,200);
      const schedule=await request('/api/pricing/sync','PUT',{schedulerEnabled:true});assert.equal(schedule.status,200);assert.equal(schedule.body.schedulerEnabled,true);
      console.log(JSON.stringify({status:'pass'}));
    `);
  });
  docker('stop', '--time', '10', name);
  fs.cpSync(data, path.join(root,'before-restart'), { recursive: true });
  docker('start', name);
  fs.writeFileSync(path.join(root,'after-restart-process.json'), docker('exec', name, 'node', '-e', `
    const fs=require('node:fs'),stat=fs.readFileSync('/proc/1/stat','utf8');
    const lock='/app/data/db/.gateway-writer.lock';
    console.log(JSON.stringify({pid:1,startTime:stat.slice(stat.lastIndexOf(')')+2).split(' ')[19],owner:fs.existsSync(lock)?JSON.parse(fs.readFileSync(lock,'utf8')):null}));
  `));
  check('container restart retains exact decimals and running schedule', () => {
    api(`
      const editor=await request('/api/pricing?view=editor');assert.equal(editor.status,200);
      assert.deepEqual(editor.body.exact.custom.fixture,{input:'0.000000001',output:'7.125',cached:'0'});
      const status=await request('/api/pricing/sync');assert.equal(status.body.schedulerConfigured,true);assert.equal(status.body.schedulerEnabled,true);assert.equal(status.body.lastAttempt,null);
      const disable=await request('/api/pricing/sync','PUT',{schedulerEnabled:false});assert.equal(disable.status,200);assert.equal(disable.body.schedulerEnabled,false);
      const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync('/app/data/db/data.sqlite',{readOnly:true});
      assert.equal(db.prepare("SELECT count(*) AS n FROM _meta WHERE key='ledgerStartedAt'").get().n,0);
      assert.equal(JSON.stringify(db.prepare('SELECT * FROM settings').all()).includes('ledgerStartedAt'),false);db.close();
      console.log(JSON.stringify({status:'pass'}));
    `);
  });
  fs.writeFileSync(path.join(root,'server.log'),docker('logs',name));
  assert.match(fs.readFileSync(path.join(root,'server.log'),'utf8'), /\[DB\] Driver: /);
} catch(error) {
  process.exitCode=1; fs.writeFileSync(path.join(root,'error.txt'),String(error.stack||error)); console.error(error);
} finally {
  if(created) {
    const logs = spawnSync('docker', ['logs', name], { encoding: 'utf8', timeout: 30000 });
    fs.writeFileSync(path.join(root,'server.log'), `${logs.stdout || ''}${logs.stderr || ''}`);
    docker('rm','--force',name);
  }
  fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({image,name,passed,success:!process.exitCode},null,2));
  console.log(`Evidence: ${root}`);
}
