import fs from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
assert.equal(process.env.BUDGET_DRIVER_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
let seq=0;
function child(mode){
 const source=`
 import assert from 'node:assert/strict';import {mock} from 'node:test';import {DatabaseSync} from 'node:sqlite';
 const mode=${JSON.stringify(mode)};
 const baseline=['beforeExit','SIGINT','SIGTERM'].map(n=>process.listenerCount(n));
 if(mode==='retire-throws'){
  Object.defineProperty(globalThis,Symbol.for('9router.accounting.node-outer-transaction.v1'),{value:Object.freeze({version:1,
   claim(){return true;},release(){},quarantine(){throw new Error('retire fault');},canRetain(){return false;}}),writable:false,configurable:false});
 }
 const primary=new Error('fixture primary');let migrations=0,closes=0;
 const originalClose=DatabaseSync.prototype.close,originalExec=DatabaseSync.prototype.exec;
 mock.module('/app/src/lib/db/migrate.js',{namedExports:{runMigrationOnce(){migrations++;
  if(mode==='close-throws')DatabaseSync.prototype.close=function(){closes++;throw new Error('native close fault');};
  if(mode==='checkpoint-fails')DatabaseSync.prototype.exec=function(sql){if(sql==='PRAGMA wal_checkpoint(TRUNCATE)')throw new Error('checkpoint');return originalExec.call(this,sql);};
  throw primary;
 }}});
 const {getAdapter,getAdapterSync,getAccountingAdapter}=await import('/app/src/lib/db/driver.js');
 const a=getAdapter(),b=getAdapter();
 const results=await Promise.allSettled([a,b]);
 for(const r of results){assert.equal(r.status,'rejected');assert.equal(r.reason,primary);}
 await assert.rejects(getAdapter(),e=>e===primary);assert.equal(migrations,1);assert.throws(getAdapterSync);
 const state=global._dbAdapter;assert.equal(state.instance,null);assert.equal(state.accountingRetired,true);assert.equal(state.accountingOpenFault,true);
 await assert.rejects(getAccountingAdapter());
 const raw=state.accountingNodeRaw;
 if(mode==='close-throws'){
  assert.equal(raw.isOpen,true);assert.equal(closes,1);assert.equal(state.accountingInitCleanup.closure,'unknown');
  DatabaseSync.prototype.close=originalClose;state.accountingCloseStrict();assert.equal(raw.isOpen,false);
 }else{
  assert.equal(raw.isOpen,false);assert.equal(state.accountingInitCleanup.closure,'confirmed');
 }
 assert.equal(state.accountingInitCleanup.checkpoint,mode==='checkpoint-fails'?'failed':'confirmed');
 assert.deepEqual(['beforeExit','SIGINT','SIGTERM'].map(n=>process.listenerCount(n)),baseline);
 DatabaseSync.prototype.exec=originalExec;DatabaseSync.prototype.close=originalClose;
 `;
 const r=spawnSync('/runtime/node',['--unhandled-rejections=strict','--experimental-test-module-mocks','--experimental-loader','/app/tests/fixtures/budget/alias-loader.mjs','--input-type=module','--eval',source],{
 env:{...process.env,DATA_DIR:'/sandbox/data/cleanup-'+(++seq)},encoding:'utf8',timeout:10000});
 assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stdout+r.stderr);
}
for(const mode of ['migration-rejects','retire-throws','close-throws','checkpoint-fails'])test('unpublished driver cleanup '+mode+' preserves primary refusal without publication or reopen',()=>child(mode));
