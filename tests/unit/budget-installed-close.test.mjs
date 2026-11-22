import fs from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
assert.equal(process.env.BUDGET_DRIVER_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
for(const mode of ['retirement','native','both','ordinary'])test('installed close exception safety '+mode,()=>{
 const source=`
 import assert from 'node:assert/strict';
 const mode=${JSON.stringify(mode)};
 const baseline=['beforeExit','SIGINT','SIGTERM'].map(n=>process.listenerCount(n));
 if(mode==='retirement'||mode==='both'){
  Object.defineProperty(globalThis,Symbol.for('9router.accounting.node-outer-transaction.v1'),{value:Object.freeze({version:1,
   claim(){return true;},release(){},quarantine(){throw new Error('private retirement failure');},canRetain(){return false;}}),writable:false,configurable:false});
 }
 const {getAdapter,getAccountingAdapter}=await import('/app/src/lib/db/driver.js');
 const {assertAccountingHealthy,finalAccountingDispatch}=await import('/app/src/lib/accounting/process-state.js');
 const db=await (mode==='ordinary'?getAdapter():getAccountingAdapter());
 const original=db.raw.close.bind(db.raw);let closes=0;
 db.raw.close=()=>{closes++;if(mode==='native'||mode==='both')throw new Error('private native failure');return original();};
 db.close();assert.equal(closes,1);
 if(mode==='ordinary'){
  assert.equal(db.raw.isOpen,false);assertAccountingHealthy();
  assert.equal(global._dbAdapter.accountingCloseDisposition,undefined);
 }else{
  const disposition=global._dbAdapter.accountingCloseDisposition;
  assert.equal(disposition.retirementFailed,mode==='retirement'||mode==='both');
  assert.equal(disposition.closure,mode==='retirement'?'confirmed':'unknown');
  assert.equal(disposition.checkpoint,'confirmed');
  assert.equal(global._dbAdapter.accountingRetired,true);
  await assert.rejects(getAccountingAdapter());assert.throws(assertAccountingHealthy);
  let sends=0;assert.throws(()=>finalAccountingDispatch(()=>true,()=>{sends++;}));assert.equal(sends,0);
  db.raw.close=original;db.close();db.close();assert.equal(db.raw.isOpen,false);assert.throws(assertAccountingHealthy);
 }
 assert.deepEqual(['beforeExit','SIGINT','SIGTERM'].map(n=>process.listenerCount(n)),baseline);
 `;
 const r=spawnSync('/runtime/node',['--unhandled-rejections=strict','--experimental-loader','/app/tests/fixtures/budget/alias-loader.mjs','--input-type=module','--eval',source],{
 env:{...process.env,DATA_DIR:'/sandbox/data/close-'+mode},encoding:'utf8',timeout:10000});
 assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stdout+r.stderr);
});
