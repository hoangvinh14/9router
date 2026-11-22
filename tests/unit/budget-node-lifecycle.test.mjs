import fs from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';

assert.equal(process.env.BUDGET_PURE_SANDBOX, '1');
assert.equal(process.version, 'v24.21.0');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'), process.env.BUDGET_OUTER_NET);
for (const hidden of ['/home/gmo', '/app/.env', '/app/.git', '/app/node_modules', '/app/src/lib/db/driver.js']) assert.equal(fs.existsSync(hidden), false);
const mounts = fs.readFileSync('/proc/self/mountinfo', 'utf8').trim().split('\n').map(line => {
  const fields = line.split(' '); return { path: fields[4], options: fields[5].split(',') };
});
for (const target of ['/', '/app/src/lib/db/adapters/nodeSqliteAdapter.js', '/app/tests/unit/budget-node-lifecycle.test.mjs']) {
  const covering = mounts.filter(m => target === m.path || target.startsWith(`${m.path.replace(/\/$/, '')}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  assert.ok(covering?.options.includes('ro'));
}
let sequence = 0;
function child(body) {
  const prefix = `
    import assert from 'node:assert/strict';
    import { DatabaseSync } from 'node:sqlite';
    const events = ['beforeExit', 'SIGINT', 'SIGTERM'];
    const before = () => events.map(event => process.listeners(event));
    const baseline = before(); const originalEmit = process.emit;
    const timers = new Set(); const interval = globalThis.setInterval; const clear = globalThis.clearInterval;
    globalThis.setInterval = (...args) => { const timer = interval(...args); timers.add(timer); return timer; };
    globalThis.clearInterval = timer => { timers.delete(timer); return clear(timer); };
    const { createNodeSqliteAdapter: open } = await import('/app/src/lib/db/adapters/nodeSqliteAdapter.js');
    const file = '/tmp/lifecycle-${++sequence}.sqlite';
    const clean = () => { assert.deepEqual(before(), baseline); assert.equal(timers.size, 0); assert.equal(process.emit, originalEmit); };
  `;
  const result = spawnSync('/runtime/node', ['--unhandled-rejections=strict', '--input-type=module', '--eval', prefix + body], {
    env: process.env, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

test('twenty open/close cycles restore exact listener identities and timer baseline without process.emit mutation', () => child(`
  for (let i = 0; i < 20; i++) {
    const db = await open(file);
    for (let n = 0; n < events.length; n++) assert.equal(process.listeners(events[n]).length, baseline[n].length + 1);
    assert.equal(timers.size, 1);
    db.exec('CREATE TABLE IF NOT EXISTS fixture (id TEXT PRIMARY KEY)');
    db.transaction(() => db.run('INSERT INTO fixture VALUES (?)', [String(i)]));
    assert.equal(db.get('SELECT COUNT(*) AS count FROM fixture').count, i + 1);
    db.close(); clean();
    const exec = db.raw.exec; const close = db.raw.close;
    db.raw.exec = () => assert.fail('repeated close performed DB work');
    db.raw.close = () => assert.fail('repeated close performed DB close');
    db.close(); clean(); db.raw.exec = exec; db.raw.close = close;
  }
`));

test('closing one connection removes only its own callbacks and preserves another live connection', () => child(`
  const first = await open(file); const owned = before().map((listeners, i) => listeners.filter(fn => !baseline[i].includes(fn)));
  const second = await open(file + '.other');
  const all = before();
  first.close();
  for (let i = 0; i < events.length; i++) assert.deepEqual(process.listeners(events[i]), all[i].filter(fn => !owned[i].includes(fn)));
  assert.equal(timers.size, 1);
  assert.equal(second.get('SELECT 1 AS value').value, 1);
  second.close(); clean();
`));

test('explicit close failure cancels timer but retains unfired listeners until successful retry', () => child(`
  const db = await open(file); const listeners = before();
  const close = db.raw.close.bind(db.raw); let attempts = 0;
  db.raw.close = () => { attempts++; if (attempts === 1) throw new Error('fake close failure'); return close(); };
  db.close(); assert.equal(attempts, 1); assert.equal(timers.size, 0);
  assert.deepEqual(before(), listeners); assert.equal(db.get('SELECT 1 AS value').value, 1);
  db.close(); assert.equal(attempts, 2); clean();
`));

test('PRAGMA initialization failure attempts close and preserves primary error even if cleanup throws', () => {
  for (const cleanupThrows of [false, true]) child(`
    const proto = DatabaseSync.prototype; const exec = proto.exec; const close = proto.close;
    const primary = new Error('fake PRAGMA initialization failure');
    let closes = 0; let handle;
    proto.exec = function () { handle = this; throw primary; };
    proto.close = function () { closes++; if (${cleanupThrows}) throw new Error('fake cleanup failure'); return close.call(this); };
    try { await assert.rejects(open(file), error => error === primary); }
    finally { proto.exec = exec; proto.close = close; }
    assert.equal(closes, 1); clean();
    if (${cleanupThrows}) close.call(handle); // fixture cleanup, NOT safe fallback proof.
  `);
});

test('failure before database opens adds no lifecycle callbacks or timers', () => child(`
  await assert.rejects(open('/missing-parent/no.sqlite'));
  clean();
`));
