import fs from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';

// No app imports before boundary assertions; each case gets a fresh global, not a
// production reset backdoor. Children inherit this sandbox's namespaces/mounts.
assert.equal(process.env.BUDGET_PURE_SANDBOX, '1');
assert.equal(process.version, 'v24.21.0');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'), process.env.BUDGET_OUTER_NET);
for (const name of ['HOME', 'DATA_DIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'TMPDIR']) {
  assert.ok(process.env[name]?.startsWith('/sandbox/'));
}
for (const hidden of ['/home/gmo', '/app/.env', '/app/.git', '/app/node_modules', '/app/src/lib/db/driver.js']) {
  assert.equal(fs.existsSync(hidden), false);
}
const mounts = fs.readFileSync('/proc/self/mountinfo', 'utf8').trim().split('\n').map(line => {
  const fields = line.split(' '); return { path: fields[4], options: fields[5].split(',') };
});
for (const target of ['/', '/app/src/lib/accounting/process-state.js', '/app/tests/unit/budget-process-state.test.mjs']) {
  const covering = mounts.filter(m => target === m.path || target.startsWith(`${m.path.replace(/\/$/, '')}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  assert.ok(covering?.options.includes('ro'));
}

const prelude = `
import assert from 'node:assert/strict';
const path = '/app/src/lib/accounting/process-state.js';
const { assertAccountingHealthy: healthy, faultAccounting: fault,
  awaitAccountingWrite: write, awaitTerminalAccountingWrite: terminal,
  finalAccountingDispatch: dispatch } = await import(path);
const unavailable = error => error.code === 'api_key_accounting_unavailable' &&
  error.status === 503 && error.message === 'Accounting storage unavailable';
`;
function child(body, prefix = prelude) {
  const result = spawnSync('/runtime/node', ['--unhandled-rejections=strict', '--input-type=module', '--eval', prefix + body], {
    env: process.env, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr + result.stdout);
}

test('write waits for this ACK before final synchronous invocation; unknown usage does not fault', () => child(`
  let release; let calls = 0; let validated = false;
  const ack = Object.freeze({ attempt: 'fake-a', usage: 'unknown/defaulted', cost: '0' });
  const pending = write(() => new Promise(resolve => { release = resolve; }), value => {
    validated = true; return value === ack;
  });
  assert.equal(validated, false); assert.equal(calls, 0);
  release({ ok: true, ack });
  assert.equal(await pending, ack); assert.equal(validated, true);
  const order = [];
  queueMicrotask(() => order.push('microtask'));
  const response = dispatch(() => { order.push('gate'); return true; }, () => {
    order.push('invoke'); calls++; return 'response';
  });
  assert.equal(response, 'response'); assert.deepEqual(order, ['gate', 'invoke']);
  await Promise.resolve(); assert.deepEqual(order, ['gate', 'invoke', 'microtask']);
  assert.equal(calls, 1); healthy();
`));

test('thrown and explicit error-result writes latch; finite/unlimited/retry/fallback all refuse', () => {
  for (const operation of [
    `() => { throw new Error('fake secret not for response'); }`,
    `async () => { throw new Error('fake rejection'); }`,
    `() => ({ ok: false, error: 'fake storage error' })`,
    `() => ({ error: 'missing success envelope' })`,
    `() => ({ ok: true })`,
    `() => ({ ok: true, ack: null })`,
    `() => undefined`,
  ]) child(`
    await assert.rejects(write(${operation}, () => true), unavailable);
    for (const consumer of ['finite', 'unlimited', 'retry', 'fallback']) {
      let posts = 0;
      assert.throws(() => dispatch(() => true, () => { posts++; }), unavailable);
      assert.equal(posts, 0, consumer);
    }
    let writes = 0;
    await assert.rejects(write(() => { writes++; return { ok: true, ack: {} }; }, () => true), unavailable);
    assert.equal(writes, 0);
  `);
});

test('missing, conflicting, non-boolean and asynchronous own-ACK validators cannot grant success', () => {
  for (const validator of ['undefined', '() => false', '() => 1', '() => ({ ok: true })',
    `() => { throw new Error('bad ACK'); }`, 'async () => true',
    `async () => { throw new Error('late ACK validator rejection'); }`]) child(`
    await assert.rejects(write(() => ({ ok: true, ack: { fake: 'row-visible' } }), ${validator}), unavailable);
    assert.throws(healthy, unavailable);
    await new Promise(resolve => setImmediate(resolve));
  `);
  child(`
    await assert.rejects(write(() => ({ ok: true, ack: { attempt: 'other' } }),
      ack => ack.attempt === 'own'), unavailable);
    assert.throws(healthy, unavailable);
  `);
});

test('successful ACK after a concurrent fault cannot report healthy success', () => child(`
  let release;
  const ack = {};
  const pending = write(() => new Promise(resolve => { release = resolve; }), value => value === ack);
  await assert.rejects(write(() => ({ ok: false }), () => true), unavailable);
  release({ ok: true, ack });
  await assert.rejects(pending, unavailable);
  assert.throws(() => dispatch(() => true, () => assert.fail('POST')), unavailable);
`));

test('retained terminal evidence can record after fault without restoring dispatch authority', () => child(`
  fault(); let recorded = 0;
  const ack = { attempt: 'already-admitted-original' };
  assert.equal(await terminal(() => { recorded++; return { ok: true, ack }; }, value => value === ack), ack);
  assert.equal(recorded, 1); assert.throws(healthy, unavailable);
  assert.throws(() => dispatch(() => true, () => assert.fail('POST')), unavailable);
  await assert.rejects(write(() => assert.fail('new intent'), () => true), unavailable);
  await assert.rejects(terminal(() => { throw new Error('private storage cause'); }, () => true), unavailable);
  await assert.rejects(terminal(() => ({ ok: false }), () => true), unavailable);
  await assert.rejects(terminal(() => ({ ok: true, ack }), () => false), unavailable);
  assert.throws(healthy, unavailable);
`));

test('fault during ACK validation cannot return usable success', () => child(`
  await assert.rejects(write(() => ({ ok: true, ack: {} }), () => { fault(); return true; }), unavailable);
  assert.throws(healthy, unavailable);
`));

test('fault during final validation is checked again immediately before invocation', () => child(`
  let posts = 0;
  assert.throws(() => dispatch(() => { fault(); return true; }, () => { posts++; }), unavailable);
  assert.equal(posts, 0);
`));

test('policy denial and accidental async final checks refuse without poisoning the latch', () => {
  for (const gate of ['() => false', '() => undefined', '() => 1',
    `() => { throw new Error('retired key'); }`, 'async () => true',
    `async () => { throw new Error('late gate rejection'); }`]) child(`
    let posts = 0;
    assert.throws(() => dispatch(${gate}, () => { posts++; }), unavailable);
    assert.equal(posts, 0); healthy();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(dispatch(() => true, () => ++posts), 1);
  `);
});

test('transport exceptions are not reclassified as accounting storage faults', () => child(`
  const error = new Error('fake transport failure');
  assert.throws(() => dispatch(() => true, () => { throw error; }), value => value === error);
  healthy();
`));

test('module/HMR copies and replacement writer cannot reset shared state; no reset export', () => child(`
  const copy = await import(path + '?hmr=fake-before');
  fault(); fault();
  assert.throws(copy.assertAccountingHealthy, unavailable);
  const replacement = await import(path + '?hmr=fake-after');
  assert.throws(replacement.assertAccountingHealthy, unavailable);
  assert.equal('resetAccounting' in replacement, false);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, Symbol.for('9router.accounting.process-fault.v1'));
  assert.equal(descriptor.writable, false); assert.equal(descriptor.configurable, false);
  assert.ok(Object.isFrozen(descriptor.value));
  await assert.rejects(replacement.awaitAccountingWrite(() => assert.fail('replacement adapter invoked'), () => true), unavailable);
`));

test('incompatible shared state is refused rather than overwritten on initialization', () => child(`
  import assert from 'node:assert/strict';
  const key = Symbol.for('9router.accounting.process-fault.v1');
  const old = Object.freeze({ version: 0 });
  Object.defineProperty(globalThis, key, { value: old });
  await assert.rejects(import('/app/src/lib/accounting/process-state.js'), error => error.code === 'api_key_accounting_unavailable');
  assert.equal(globalThis[key], old);
`, ''));

test('a genuinely separate process starts independently; cross-instance propagation not promised', () => {
  child('fault(); assert.throws(healthy, unavailable);');
  child('healthy(); assert.equal(dispatch(() => true, () => 1), 1);');
});
