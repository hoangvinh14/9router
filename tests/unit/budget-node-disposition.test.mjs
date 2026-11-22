import fs from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
assert.equal(process.env.BUDGET_PURE_SANDBOX, '1');
assert.equal(process.version, 'v24.21.0');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'), process.env.BUDGET_OUTER_NET);
for (const path of ['/home/gmo', '/app/.env', '/app/.git', '/app/src/lib/db/driver.js']) assert.equal(fs.existsSync(path), false);
const mounts = fs.readFileSync('/proc/self/mountinfo', 'utf8').trim().split('\n').map(line => {
  const f = line.split(' '); return { path: f[4], ro: f[5].split(',').includes('ro') };
});
for (const target of ['/', '/app/src/lib/accounting/node-connection-admission.js', '/app/tests/unit/budget-node-disposition.test.mjs']) {
  assert.ok(mounts.filter(m => target === m.path || target.startsWith(`${m.path.replace(/\/$/, '')}/`)).sort((a,b) => b.path.length-a.path.length)[0]?.ro);
}
let sequence = 0;
function child(body) {
  const prefix = `
    import assert from 'node:assert/strict';
    import { DatabaseSync } from 'node:sqlite';
    const { openNodeSqliteAttempt: attempt, createNodeSqliteAdapter: ordinary } = await import('/app/src/lib/db/adapters/nodeSqliteAdapter.js');
    const { admitNodeAccountingConnection: admit, closeNodeAccountingConnection: close } = await import('/app/src/lib/accounting/node-connection-admission.js');
    const { assertAccountingHealthy: healthy, faultAccounting: fault, finalAccountingDispatch: dispatch } = await import('/app/src/lib/accounting/process-state.js');
    const file = '/tmp/disposition-${++sequence}.sqlite';
    const events = ['beforeExit','SIGINT','SIGTERM']; const baseline = events.map(e=>process.listeners(e));
    const resourcesClean = () => assert.deepEqual(events.map(e=>process.listeners(e)), baseline);
    const stopped = async () => {
      assert.throws(healthy); let posts = 0;
      assert.throws(()=>dispatch(()=>true,()=>{posts++;})); assert.equal(posts,0);
      await assert.rejects(admit(file+'.successor'));
    };
  `;
  const r = spawnSync('/runtime/node', ['--unhandled-rejections=strict','--input-type=module','--eval',prefix+body], { env:process.env, encoding:'utf8', timeout:10000 });
  assert.equal(r.error,undefined); assert.equal(r.signal,null); assert.equal(r.status,0,r.stdout+r.stderr);
}

test('selected-node capability closes with confirmed disposition, HMR recognition and idempotent result', () => child(`
  const handle = await admit(file);
  assert.equal(handle.adapter.raw.isOpen,true);
  handle.adapter.exec('CREATE TABLE fixture (id TEXT)');
  const copy = await import('/app/src/lib/accounting/node-connection-admission.js?hmr=disposition');
  assert.deepEqual(copy.closeNodeAccountingConnection(handle),{closure:'confirmed',checkpoint:'confirmed'});
  handle.adapter.raw.close = ()=>assert.fail('closed twice');
  assert.deepEqual(close(handle),{closure:'confirmed',checkpoint:'confirmed'});
  assert.throws(()=>close({adapter:handle.adapter,closeStrict:()=>({closure:'confirmed'})}));
  resourcesClean(); healthy();
`));

test('close attempt retires retained terminal authority even if native handle stays open', () => child(`
  const handle = await admit(file);
  handle.adapter.exec('CREATE TABLE terminal_retirement (id TEXT)');
  const { createNodeOuterTransaction } = await import('/app/src/lib/accounting/node-outer-transaction.js');
  const transact = createNodeOuterTransaction(handle.adapter, { put: { method: 'run', sql: 'INSERT INTO terminal_retirement VALUES (?)' } });
  const record = transact.retainTerminal(scope => scope.put(['original']));
  const original = handle.adapter.raw.close.bind(handle.adapter.raw);
  handle.adapter.raw.close = () => { throw new Error('close before execution'); };
  assert.equal(close(handle).closure, 'unknown');
  assert.equal(handle.adapter.raw.isOpen, true);
  assert.throws(record, e => e.connectionQuarantined === true);
  assert.equal(handle.adapter.get('SELECT COUNT(*) AS n FROM terminal_retirement').n, 0);
  handle.adapter.raw.close = original; close(handle); resourcesClean(); await stopped();
`));

test('strict close before/after-execution failure latches; later confirmed retry never clears fault', () => {
  for (const after of [false,true]) child(`
    const handle = await admit(file); const raw=handle.adapter.raw; const original=raw.close.bind(raw);
    let calls=0; raw.close=()=>{calls++; ${after?'original();':''} throw new Error('private close cause');};
    assert.equal(close(handle).closure,'unknown'); await stopped();
    raw.close=original;
    assert.equal(close(handle).closure,'confirmed'); assert.equal(calls,1);
    resourcesClean(); await stopped();
  `);
});

test('checkpoint failure is sticky independently of confirmed close and never becomes durability success', () => child(`
  const handle=await admit(file); const raw=handle.adapter.raw;
  raw.exec=()=>{throw new Error('checkpoint fault');};
  assert.deepEqual(close(handle),{closure:'confirmed',checkpoint:'failed'});
  assert.deepEqual(close(handle),{closure:'confirmed',checkpoint:'failed'});
  resourcesClean(); await stopped();
`));

test('closure-observation unit helper requires literal false and rejects unavailable or throwing state', async () => {
  const { nodeClosureConfirmed } = await import('../../src/lib/db/adapters/nodeClosure.js');
  for (const value of [undefined, null, true, 0, 1, 'false', {}, []]) {
    assert.equal(nodeClosureConfirmed({ isOpen: value }), false);
  }
  assert.equal(nodeClosureConfirmed({}), false);
  assert.equal(nodeClosureConfirmed(Object.defineProperty({}, 'isOpen', { get() { throw new Error('state unreadable'); } })), false);
  assert.equal(nodeClosureConfirmed({ isOpen: false }), true);
  // Native Node24 isOpen is nonconfigurable: this is unit observation coverage,
  // not an end-to-end native admission test for runtimes lacking that property.
});

test('init cleanup disposition is per attempt even for shared error identity and primitive throws', () => child(`
  const proto=DatabaseSync.prototype; const exec=proto.exec; const closeRaw=proto.close;
  for (const primary of [new Error('same identity'), 'primitive failure']) {
    let handle;
    proto.exec=function(){handle=this;throw primary;};
    let first;
    try { first=await attempt(file+'.a'+String(typeof primary)); } finally { proto.exec=exec; }
    assert.equal(first.ok,false); assert.equal(first.phase,'initialization_failed');
    assert.equal(first.error,primary); assert.equal(first.closure,'confirmed'); resourcesClean();
    proto.exec=function(){handle=this;throw primary;}; proto.close=()=>{throw new Error('cleanup failed');};
    let second;
    try { second=await attempt(file+'.b'+String(typeof primary)); } finally { proto.exec=exec;proto.close=closeRaw; }
    assert.equal(second.error,primary); assert.equal(second.closure,'unknown');
    assert.equal(second.cleanupError.message,'cleanup failed');
    assert.equal(first.cleanupError,undefined);
    assert.equal(first.closure,'confirmed'); closeRaw.call(handle); resourcesClean();
  }
`));

test('accounting boundary consumes actual init+cleanup failure and denies successor opening', () => {
  for (const cleanup of [false,true]) child(`
    const proto=DatabaseSync.prototype; const exec=proto.exec; const closeRaw=proto.close;
    let handle;let opens=0;
    proto.exec=function(){opens++;handle=this;throw new Error('primary initialization fault');};
    if (${cleanup}) proto.close=()=>{throw new Error('cleanup fault');};
    let error;
    try { await admit(file); } catch(e) {error=e;} finally {proto.exec=exec;proto.close=closeRaw;}
    assert.equal(error.code,'api_key_accounting_unavailable'); assert.equal(error.message,'Accounting storage unavailable');
    assert.equal(error.initializationPhase,'initialization_failed');
    assert.equal(error.closure,'${cleanup?'unknown':'confirmed'}');
    if (${cleanup}) closeRaw.call(handle);
    await stopped();assert.equal(opens,1);resourcesClean();
  `);
});

test('partial listener installation and timer setup failures close handle and preserve original errors', () => child(`
  const once=process.once; const interval=globalThis.setInterval;
  const primary=new Error('setup failure');
  process.once=function(event,...args){if(event==='SIGTERM')throw primary;return once.call(this,event,...args);};
  let result;try{result=await attempt(file);}finally{process.once=once;}
  assert.equal(result.error,primary);assert.equal(result.closure,'confirmed');resourcesClean();
  globalThis.setInterval=()=>{throw primary;};
  try{result=await attempt(file+'.timer');}finally{globalThis.setInterval=interval;}
  assert.equal(result.error,primary);assert.equal(result.closure,'confirmed');resourcesClean();
  healthy();
`));

test('concurrent pending admission observes new fault and disposes its opened connection before publication', () => child(`
  const pending=admit(file);
  fault();
  await assert.rejects(pending);
  resourcesClean();await stopped();
`));

test('constructor/open ambiguity denies selected-node admission, no automatic fallback or retry', () => child(`
  await assert.rejects(admit('/missing-parent/disposition.sqlite'),error=>error.initializationPhase==='open_failed_unknown'&&error.closure==='unknown');
  await stopped();resourcesClean();
`));
