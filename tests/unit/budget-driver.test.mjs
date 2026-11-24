import fs from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
assert.equal(process.env.BUDGET_DRIVER_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
let seq=0;
function child(body){
 const r=spawnSync('/runtime/node',['--unhandled-rejections=strict','--experimental-loader','/app/tests/fixtures/budget/alias-loader.mjs','--input-type=module','--eval',`
  import assert from 'node:assert/strict';
  import fs from 'node:fs';
  const {getAdapter,getAccountingAdapter}=await import('/app/src/lib/db/driver.js');
  const {initializeNodeAttemptLedger,createNodeAttemptLedger}=await import('/app/src/lib/accounting/node-attempt-ledger.js');
  const {assertAccountingHealthy:healthy}=await import('/app/src/lib/accounting/process-state.js');
  ${body}
  `],{env:{...process.env,DATA_DIR:'/sandbox/data/driver-'+(++seq)},encoding:'utf8',timeout:10000});
 assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stdout+r.stderr);
}

test('actual installed driver connection is shared with accounting, ordinary migration and NUL sanitation unchanged',()=>child(`
 const ordinary=await getAdapter();
 try {
  const accounting=await getAccountingAdapter();assert.equal(accounting,ordinary);assert.equal(accounting.raw,ordinary.raw);
  assert.equal(accounting.driver,'node:sqlite');
  assert.ok(ordinary.get("SELECT name FROM sqlite_schema WHERE name='apiKeys'"));
  assert.equal(ordinary.get("SELECT name FROM sqlite_schema WHERE name='accounting_attempts_v1'"),undefined);
  ordinary.run("INSERT INTO kv VALUES(?,?,?)",['fixture','a'+String.fromCharCode(0)+'b','v']);
  assert.equal(ordinary.get('SELECT value FROM kv WHERE key=?',['ab']).value,'v');
  // Explicit sandbox setup only, never implicit application activation.
  initializeNodeAttemptLedger(accounting);const store=createNodeAttemptLedger(accounting);
  const now='2026-11-16T10:00:00.000Z';
  const a=store.prepare({attemptId:'actual-driver',keyId:'key-A',bindingGeneration:'g1',provider:'fixture',model:'fixture',startedAt:now,
   price:{currency:'USD',unit:'USD/1M tokens',revision:'fixture',rates:{input:'1',output:'2'}}});
  a.settle(null);assert.deepEqual(store.totals('key-A',now),{weekly:'0',monthly:'0',unknown:1});healthy();
 }finally{ordinary.close();}
`));

test('installed accounting close retires retained terminal even when native close throws before execution',()=>child(`
 const db=await getAccountingAdapter();
 initializeNodeAttemptLedger(db);const store=createNodeAttemptLedger(db);
 const a=store.prepare({attemptId:'retired',keyId:'key-A',bindingGeneration:'1',provider:'fixture',model:'fixture',startedAt:'2026-11-16T10:00:00.000Z',
  price:{currency:'USD',unit:'USD/1M tokens',revision:'fixture',rates:{input:'1',output:'2'}}});
 const original=db.raw.close.bind(db.raw);db.raw.close=()=>{throw new Error('close before execution');};
 db.close();assert.equal(db.raw.isOpen,true);
 assert.throws(()=>a.settle(null));assert.throws(healthy);await assert.rejects(getAccountingAdapter());
 assert.equal(db.get('SELECT COUNT(*) AS n FROM accounting_terminals_v1').n,0);
 db.raw.close=original;db.close();assert.equal(db.raw.isOpen,false);assert.throws(healthy);
`));

test('installed accounting initialization failure is sanitized and faults instead of ordinary fallback authority',()=>child(`
 const {DatabaseSync}=await import('node:sqlite');const exec=DatabaseSync.prototype.exec;
 DatabaseSync.prototype.exec=()=>{throw new Error('private initialization cause');};
 try {await assert.rejects(getAccountingAdapter(),e=>e.code==='api_key_accounting_unavailable'&&!e.message.includes('private'));}
 finally{DatabaseSync.prototype.exec=exec;}
 assert.throws(healthy);
`));

test('old HMR adapter without opening provenance cannot manufacture accounting capability',()=>child(`
 const db=await getAdapter();
 try {delete global._dbAdapter.accountingNodeRaw;await assert.rejects(getAccountingAdapter());healthy();}
 finally{db.close();}
`));

test('actual failed-after-open is remembered and accounting refuses later adapter publication',()=>child(`
 const {DatabaseSync}=await import('node:sqlite');const exec=DatabaseSync.prototype.exec;
 DatabaseSync.prototype.exec=function(){throw new Error('fixture init fault');};
 try {await assert.rejects(getAdapter());}finally{DatabaseSync.prototype.exec=exec;}
 assert.equal(global._dbAdapter.accountingOpenFault,true);
 // Ordinary driver failed closed because fallback package intentionally absent.
 // Install a separate fixture adapter only to test provenance latch; not a
 // claimed real fallback success or permission for production replacement.
 const {createNodeSqliteAdapter}=await import('/app/src/lib/db/adapters/nodeSqliteAdapter.js');
 const replacement=await createNodeSqliteAdapter('/tmp/driver-replacement.sqlite');
 global._dbAdapter.instance=replacement;global._dbAdapter.accountingNodeRaw=replacement.raw;
 try{await assert.rejects(getAccountingAdapter());assert.throws(healthy);}finally{replacement.close();}
`));

for (const timing of ['before-enrollment', 'scheduled', 'busy']) {
  test('installed accounting handles ' + timing + ' checkpoint outcome', () => child(`
    const timers = global.setInterval;
    let tick;
    global.setInterval = (callback, delay, ...args) => {
      if (delay === 60000) tick = callback;
      return timers(callback, delay, ...args);
    };
    let db;
    try { db = await getAdapter(); } finally { global.setInterval = timers; }
    try {
      if ('${timing}' !== 'before-enrollment') await getAccountingAdapter();
      const execute = db.raw.exec.bind(db.raw);
      db.raw.exec = sql => {
        if (sql === 'PRAGMA wal_checkpoint(TRUNCATE)') {
          throw Object.assign(new Error('checkpoint fixture'), { errcode: ${timing === 'busy' ? 5 : 1034} });
        }
        return execute(sql);
      };
      try { tick(); } finally { db.raw.exec = execute; }
      if ('${timing}' === 'busy') {
        healthy();
        assert.equal(await getAccountingAdapter(), db);
      } else {
        if ('${timing}' === 'before-enrollment') healthy();
        await assert.rejects(getAccountingAdapter(), { code: 'api_key_accounting_unavailable' });
        assert.throws(healthy);
      }
      db.run("INSERT INTO kv VALUES(?,?,?)", ['test','ordinary','ok']);
      assert.equal(db.get("SELECT value FROM kv WHERE scope='test' AND key='ordinary'").value, 'ok');
    } finally { db.close(); }
  `));
}
