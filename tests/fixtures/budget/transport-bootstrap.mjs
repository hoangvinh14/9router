import fs from 'node:fs';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { spawnSync } from 'node:child_process';
assert.equal(process.env.BUDGET_TRANSPORT_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
function run(binary,args){
  const r=spawnSync(binary,args,{env:process.env,encoding:'utf8',timeout:15000});
  if(r.error||r.signal||r.status!==0)throw new Error(`Sandbox setup failed: ${binary}: ${r.stderr}`);
}
assert.notEqual(fs.readlinkSync('/proc/self/ns/user'),process.env.BUDGET_OUTER_USER);
if (process.env.BUDGET_CAPS_DROPPED !== '1') {
  const links = spawnSync('/usr/sbin/ip',['-j','link','show'],{encoding:'utf8'});
  assert.equal(links.status,0);
  assert.deepEqual(JSON.parse(links.stdout).map(link=>link.ifname),['lo']);
  run('/usr/sbin/ip',['link','set','lo','up']);
  const child = spawnSync('/usr/bin/setpriv', ['--bounding-set=-all','--inh-caps=-all',
    '--ambient-caps=-all','--no-new-privs','/runtime/node',import.meta.filename], {
    env: {...process.env,BUDGET_CAPS_DROPPED:'1'},stdio:'inherit',timeout:45000,
  });
  process.exit(child.error || child.signal || child.status !== 0 ? 1 : 0);
}
const status = fs.readFileSync('/proc/self/status','utf8');
for (const name of ['CapInh','CapPrm','CapEff','CapBnd','CapAmb']) {
  const line = status.split('\n').find(line=>line.startsWith(name+':'));
  assert.equal(BigInt('0x'+line.split(':')[1].trim()),0n);
}
assert.match(status,/^NoNewPrivs:\s+1$/m);
process.umask(0o077);
run('/usr/bin/openssl',['req','-config','/dev/null','-x509','-newkey','rsa:2048','-nodes','-days','1',
  '-keyout','/tmp/test-key.pem','-out','/tmp/test-cert.pem','-subj','/CN=budget-sandbox',
  '-addext','subjectAltName=IP:127.0.0.1','-addext','basicConstraints=critical,CA:TRUE']);
const certificate=new X509Certificate(fs.readFileSync('/tmp/test-cert.pem'));
assert.equal(certificate.ca,true);
assert.equal(certificate.checkIP('127.0.0.1'),'127.0.0.1');
assert.ok(Date.parse(certificate.validFrom)<=Date.now() && Date.parse(certificate.validTo)>Date.now());
assert.equal(fs.statSync('/tmp/test-key.pem').mode & 0o077,0);
const result=spawnSync('/runtime/node',['--unhandled-rejections=strict','--test','/app/tests/unit/budget-direct-transport.test.mjs'],{
  env:{...process.env,NODE_EXTRA_CA_CERTS:'/tmp/test-cert.pem'},stdio:'inherit',timeout:30000,
});
if(result.error||result.signal||result.status!==0)process.exitCode=1;
