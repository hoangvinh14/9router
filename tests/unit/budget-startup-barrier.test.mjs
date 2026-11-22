import fs from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
assert.equal(process.env.BUDGET_DRIVER_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
let sequence=0;
function child(body){
 const dir='/tmp/startup-'+(++sequence);fs.mkdirSync(dir);
 const source=`
 import fs from 'node:fs';import assert from 'node:assert/strict';
 const {createNodeSqliteAdapter}=await import('/app/src/lib/db/adapters/nodeSqliteAdapter.js');
 const {runMigrationOnce}=await import('/app/src/lib/db/migrate.js');
 const {ensureDirs,DATA_FILE,LEGACY_FILES,BACKUPS_DIR,DB_DIR}=await import('/app/src/lib/db/paths.js');
 ensureDirs();const db=await createNodeSqliteAdapter(DATA_FILE);
 const {initializeNodeKeyPolicy}=await import('/app/src/lib/accounting/node-key-policy.js');
 const {initializeNodeAttemptLedger}=await import('/app/src/lib/accounting/node-attempt-ledger.js');
 const refused=e=>e.code==='api_key_accounting_startup_unavailable';
 const snapshot=()=>JSON.stringify(db.all('SELECT name,sql FROM sqlite_schema ORDER BY name'));
 try{${body}}finally{db.close();}
 `;
 const result=spawnSync('/runtime/node',['--unhandled-rejections=strict','--experimental-loader','/app/tests/fixtures/budget/alias-loader.mjs','--input-type=module','--eval',source],{
 env:{...process.env,DATA_DIR:dir},encoding:'utf8',timeout:10000});
 assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,0,result.stdout+result.stderr);
}

test('complete or partial markers refuse before any startup DDL import backup prune or sentinel',()=>{
 for(const mode of ['partial','complete','event-table','event-view'])child(`
 ${mode==='event-table'?"db.exec('CREATE TABLE accounting_admin_events_v1 (key_id TEXT)');":mode==='event-view'?"db.exec('CREATE VIEW accounting_admin_events_v1 AS SELECT 1 AS key_id');":'initializeNodeKeyPolicy(db);'}${mode==='complete'?'initializeNodeAttemptLedger(db);':''}
 fs.writeFileSync(LEGACY_FILES.main,JSON.stringify({apiKeys:[{id:'legacy',key:'old-secret'}]}));
 for(let i=0;i<4;i++)fs.mkdirSync(BACKUPS_DIR+'/keep-'+i);
 const before=snapshot();
 for(let i=0;i<2;i++)await assert.rejects(runMigrationOnce(db),refused);
 assert.equal(snapshot(),before);assert.equal(fs.readdirSync(BACKUPS_DIR).length,4);
 assert.equal(fs.existsSync(DB_DIR+'/.migrated-from-json'),false);
 assert.equal(db.get("SELECT name FROM sqlite_schema WHERE name='_meta'"),undefined);
 `);
});

for(const mode of ['partial','complete','view','event-table','event-view','read-fault','close-fault'])test('installed native preconfiguration refusal '+mode,()=>child(`
 const mode=${JSON.stringify(mode)};
 if(mode==='complete'){initializeNodeKeyPolicy(db);initializeNodeAttemptLedger(db);}
 else if(mode==='view')db.exec('CREATE VIEW accounting_attempts_v1 AS SELECT 1 AS value');
 else if(mode==='event-table')db.exec('CREATE TABLE accounting_admin_events_v1 (key_id TEXT)');
 else if(mode==='event-view')db.exec('CREATE VIEW accounting_admin_events_v1 AS SELECT 1 AS key_id');
 else if(mode!=='read-fault')initializeNodeKeyPolicy(db);
 const beforeSchema=snapshot();
 const {DatabaseSync}=await import('node:sqlite');
 const prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec,close=DatabaseSync.prototype.close;
 const interval=globalThis.setInterval,warn=console.warn;
 const baseline=['beforeExit','SIGINT','SIGTERM'].map(n=>process.listenerCount(n));
 let raw,executions=0,intervals=0,closes=0;const warnings=[];
 DatabaseSync.prototype.prepare=function(sql){raw=this;if(mode==='read-fault')throw new Error('private marker read');return prepare.call(this,sql);};
 DatabaseSync.prototype.exec=function(sql){executions++;return exec.call(this,sql);};
 DatabaseSync.prototype.close=function(){closes++;if(mode==='close-fault')throw new Error('private native close');return close.call(this);};
 globalThis.setInterval=(...args)=>{intervals++;return interval(...args);};console.warn=(...args)=>warnings.push(args.join(' '));
 try{
  const {getAdapter,getAdapterSync}=await import('/app/src/lib/db/driver.js');
  const results=await Promise.allSettled([getAdapter(),getAdapter()]);
  for(const result of results){assert.equal(result.status,'rejected');assert.equal(result.reason.code,'api_key_accounting_startup_unavailable');assert.equal(result.reason.message.includes('private'),false);}
  assert.equal(results[0].reason,results[1].reason);
  await assert.rejects(getAdapter(),error=>error===results[0].reason);assert.throws(getAdapterSync);
  assert.equal(executions,0);assert.equal(intervals,0);assert.equal(closes,1);assert.deepEqual(warnings,[]);
  assert.deepEqual(['beforeExit','SIGINT','SIGTERM'].map(n=>process.listenerCount(n)),baseline);
  assert.equal(global._dbAdapter.instance,null);assert.equal(global._dbAdapter.accountingRetired,true);assert.equal(global._dbAdapter.accountingOpenFault,true);
  assert.deepEqual(global._dbAdapter.accountingInitCleanup,{attempted:true,closure:mode==='close-fault'?'unknown':'confirmed',checkpoint:'not_attempted'});
  assert.equal(raw.isOpen,mode==='close-fault');
  const {assertAccountingHealthy,finalAccountingDispatch}=await import('/app/src/lib/accounting/process-state.js');assert.throws(assertAccountingHealthy);
  let sends=0;assert.throws(()=>finalAccountingDispatch(()=>true,()=>sends++));assert.equal(sends,0);
 }finally{
  DatabaseSync.prototype.prepare=prepare;DatabaseSync.prototype.exec=exec;DatabaseSync.prototype.close=close;
  globalThis.setInterval=interval;console.warn=warn;if(raw?.isOpen)close.call(raw);
 }
 assert.equal(snapshot(),beforeSchema);
 assert.equal(db.get("SELECT name FROM sqlite_schema WHERE name='_meta'"),undefined);
 assert.equal(fs.existsSync(DB_DIR+'/.migrated-from-json'),false);
`));

for(const mode of ['current','pending-import','missing-app-index','invalid-binding'])test('installed marked startup qualifies existing state: '+mode,()=>child(`
 const mode=${JSON.stringify(mode)};
 await runMigrationOnce(db);
 db.run("INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES('fixture','synthetic',1,'2026-11-16T10:00:00.000Z')");
 initializeNodeKeyPolicy(db);initializeNodeAttemptLedger(db);
 const {createNodeKeyPolicy}=await import('/app/src/lib/accounting/node-key-policy.js');
 createNodeKeyPolicy(db).save('fixture',0,{weekly:null,monthly:'105900'});
 if(mode==='pending-import')db.run("UPDATE _meta SET value='pending-v1' WHERE key='legacyImportState'");
 if(mode==='missing-app-index')db.exec('DROP INDEX idx_ak_key');
 if(mode==='invalid-binding')db.run("UPDATE accounting_key_policy_v1 SET fingerprint='invalid'");
 const state=adapter=>JSON.stringify([adapter.all('SELECT type,name,sql FROM main.sqlite_schema ORDER BY name'),
  ...['_meta','accounting_key_policy_v1','accounting_key_generations_v1','accounting_attempts_v1','accounting_terminals_v1'].map(
   name=>adapter.all('SELECT * FROM '+name+' ORDER BY rowid'))]);
 const before=state(db);db.close();
 // A legacy file arriving after completion must not be imported on restart.
 fs.writeFileSync(LEGACY_FILES.main,JSON.stringify({apiKeys:[{id:'unexpected',key:'synthetic-legacy'}]}));
 const {getAdapter,getAdapterSync,getAccountingAdapter}=await import('/app/src/lib/db/driver.js');
 if(mode==='current'){
  const installed=await getAdapter();
  try{
   assert.equal(installed,getAdapterSync());assert.equal(installed,await getAccountingAdapter());
   assert.equal(installed.raw,global._dbAdapter.accountingNodeRaw);
   assert.equal(installed.raw.isTransaction,false);assert.equal(installed.get('PRAGMA synchronous').synchronous,1);
   assert.equal(installed.get('SELECT total_changes() n').n,0);assert.equal(state(installed),before);
   assert.equal(installed.get("SELECT id FROM apiKeys WHERE id='unexpected'"),undefined);
  }finally{installed.close();}
 }else{
  const qualifiedRefusal=e=>refused(e)&&e.startupReason==='unqualified_accounting_state';
  await assert.rejects(getAdapter(),qualifiedRefusal);await assert.rejects(getAdapter(),qualifiedRefusal);
  assert.throws(getAdapterSync);assert.equal(global._dbAdapter.instance,null);
  assert.equal(global._dbAdapter.accountingRetired,true);assert.equal(global._dbAdapter.accountingNodeRaw.isOpen,false);
  await assert.rejects(getAccountingAdapter());
  const {finalAccountingDispatch}=await import('/app/src/lib/accounting/process-state.js');
  let sends=0;assert.throws(()=>finalAccountingDispatch(()=>true,()=>{sends++;}));assert.equal(sends,0);
 }
 const {DatabaseSync}=await import('node:sqlite');
 const read=new DatabaseSync(DATA_FILE,{readOnly:true});
 try{assert.equal(state({all:sql=>read.prepare(sql).all()}),before);}finally{read.close();}
 assert.equal(fs.existsSync(DB_DIR+'/.migrated-from-json'),false);
`));

test('previous successful cached adapter cannot bypass newly appearing accounting markers',()=>child(`
 await runMigrationOnce(db);initializeNodeKeyPolicy(db);const before=snapshot();
 await assert.rejects(runMigrationOnce(db),refused);assert.equal(snapshot(),before);
`));

test('marker SQL exception refuses repeated calls without writes and publishes process fault',()=>child(`
 const original=db.all;let writes=0;db.exec=()=>{writes++;throw new Error('must not write');};
 db.all=()=>{throw new Error('fixture-private');};
 for(let i=0;i<2;i++)await assert.rejects(runMigrationOnce(db),refused);
 assert.equal(writes,0);const {assertAccountingHealthy}=await import('/app/src/lib/accounting/process-state.js');assert.throws(assertAccountingHealthy);
 db.all=original;
`));

test('marker-free ordinary legacy import and repeated ordinary startup retain key data',()=>child(`
 fs.writeFileSync(LEGACY_FILES.main,JSON.stringify({apiKeys:[{id:'legacy',key:'fixture-legacy',name:'original',machineId:'m',isActive:true}]}));
 await runMigrationOnce(db);await runMigrationOnce(db);
 assert.equal(db.get('SELECT key FROM apiKeys WHERE id=?',['legacy']).key,'fixture-legacy');
 assert.equal(fs.existsSync(DB_DIR+'/.migrated-from-json'),true);
`));

test('unexpected metadata SQL failure is not fresh; failed call cannot be cached as successful',()=>child(`
 db.exec('CREATE TABLE _meta(key TEXT PRIMARY KEY,value TEXT)');
 const original=db.get;let failures=0;
 db.get=(sql,params)=>{if(sql==='SELECT COUNT(*) as c FROM _meta'){failures++;throw new Error('metadata read fault');}return original(sql,params);};
 const before=snapshot();for(let i=0;i<2;i++)await assert.rejects(runMigrationOnce(db),/metadata read fault/);
 assert.equal(failures,2);assert.equal(snapshot(),before);
 db.get=original;await runMigrationOnce(db);assert.ok(db.get("SELECT name FROM sqlite_schema WHERE name='apiKeys'"));
`));

test('actual application driver does not publish instance or fall back after startup refusal',()=>child(`
 initializeNodeKeyPolicy(db);
 const {getAdapter,getAdapterSync}=await import('/app/src/lib/db/driver.js');
 await assert.rejects(getAdapter(),refused);await assert.rejects(getAdapter(),refused);
 assert.throws(getAdapterSync);assert.equal(global._dbAdapter.instance,null);
 assert.equal(db.get("SELECT name FROM sqlite_schema WHERE name='_meta'"),undefined);
 // Refused before configuration/publication: no successful raw capability.
 assert.equal(global._dbAdapter.accountingNodeRaw,undefined);
 assert.deepEqual(global._dbAdapter.accountingInitCleanup,{attempted:true,closure:'confirmed',checkpoint:'not_attempted'});
`));
