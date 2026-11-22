import assert from 'node:assert/strict';
import fs from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { spawnSync } from 'node:child_process';

assert.equal(process.env.BUDGET_COMPOSED_TLS, '1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'), process.env.BUDGET_OUTER_NET);
assert.notEqual(fs.readlinkSync('/proc/self/ns/user'), process.env.BUDGET_OUTER_USER);
function run(binary, args) {
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 15000 });
  if (result.error || result.signal || result.status !== 0) throw new Error(`Sandbox setup failed: ${binary}: ${result.stderr}`);
  return result.stdout;
}
if (process.env.BUDGET_CAPS_DROPPED !== '1') {
  const links = JSON.parse(run('/usr/sbin/ip', ['-j', 'link', 'show']));
  assert.deepEqual(links.map(link => link.ifname), ['lo']);
  run('/usr/sbin/ip', ['link', 'set', 'lo', 'up']);
  const result = spawnSync('/usr/bin/setpriv', ['--bounding-set=-all', '--inh-caps=-all',
    '--ambient-caps=-all', '--no-new-privs', '/runtime/node', import.meta.filename], {
    env: { ...process.env, BUDGET_CAPS_DROPPED: '1' }, stdio: 'inherit', timeout: 45000,
  });
  process.exit(result.error || result.signal || result.status !== 0 ? 1 : 0);
}
const status = fs.readFileSync('/proc/self/status', 'utf8');
for (const key of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) {
  assert.equal(BigInt(`0x${status.split('\n').find(line => line.startsWith(`${key}:`)).split(':')[1].trim()}`), 0n);
}
assert.match(status, /^NoNewPrivs:\s+1$/m);
process.umask(0o077);
run('/usr/bin/openssl', ['req', '-config', '/dev/null', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-keyout', '/tmp/composed-key.pem', '-out', '/tmp/composed-cert.pem', '-subj', '/CN=budget-composed-sandbox',
  '-addext', 'subjectAltName=IP:127.0.0.1', '-addext', 'basicConstraints=critical,CA:TRUE']);
const certificate = new X509Certificate(fs.readFileSync('/tmp/composed-cert.pem'));
assert.equal(certificate.ca, true);
assert.equal(certificate.checkIP('127.0.0.1'), '127.0.0.1');
assert.ok(Date.parse(certificate.validFrom) <= Date.now() && Date.parse(certificate.validTo) > Date.now());
assert.equal(fs.statSync('/tmp/composed-key.pem').mode & 0o077, 0);
const result = spawnSync('/runtime/node', ['--unhandled-rejections=strict', '--experimental-loader',
  '/app/tests/fixtures/budget/composed-loader.mjs', '--test', '/app/tests/unit/budget-composed.test.mjs'], {
  env: { ...process.env, NODE_EXTRA_CA_CERTS: '/tmp/composed-cert.pem' }, stdio: 'inherit', timeout: 30000,
});
if (result.error || result.signal || result.status !== 0) process.exitCode = 1;
