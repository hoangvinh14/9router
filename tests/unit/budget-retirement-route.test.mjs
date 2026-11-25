import fs from 'node:fs';
import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {spawnSync} from 'node:child_process';
import {GET,POST,dynamic} from '../../src/app/api/keys/[id]/budget/retire/route.js';
import {GET as lookupRotation,POST as rotate} from '../../src/app/api/keys/[id]/budget/rotate/route.js';
import {keyManagementView} from '../../src/lib/accounting/key-management-view.js';
import {createNodeSqliteAdapter} from '../../src/lib/db/adapters/nodeSqliteAdapter.js';
import {backupDbLite} from '../../src/lib/db/backup.js';
import {getAdapter,getAdapterSync} from '../../src/lib/db/driver.js';
import {initializeNodeKeyPolicy,createNodeKeyPolicy} from '../../src/lib/accounting/node-key-policy.js';
import {initializeNodeAttemptLedger,createNodeAttemptLedger} from '../../src/lib/accounting/node-attempt-ledger.js';
import {validateApiKey,updateApiKey,deleteApiKey} from '../../src/lib/db/repos/apiKeysRepo.js';
import {classifyAccountingSecret} from '../../src/lib/accounting/request-boundary.js';
import {assertAccountingHealthy} from '../../src/lib/accounting/process-state.js';
assert.equal(process.env.BUDGET_DRIVER_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
const params={params:Promise.resolve({id:'target'})};
function req(body={expectedVersion:1},headers={},token='fixture-admin'){
 const r=new Request('https://dashboard.invalid/api/keys/target/budget/retire',{method:'POST',headers:{origin:'https://dashboard.invalid','content-type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
 Object.defineProperty(r,'cookies',{value:{get:()=>token?{value:token}:undefined}});return r;
}

test('authorization and request failures do not acquire installed DB or consume untrusted body',{concurrency:false},async()=>{
 assert.throws(getAdapterSync);assert.equal(dynamic,'force-dynamic');
 for(const token of [null,'inference-key','fixture-change-password','fixture-wrong-claim']){
  const request=req('{',{'authorization':'Bearer inference-key','x-9r-cli-token':'fixture-cli','x-9r-real-ip':'127.0.0.1'},token);
  const response=await POST(request,params);
  assert.equal(response.status,401);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(request.bodyUsed,false);
  assert.equal((await GET(req('{',{},token),params)).status,401);
 }
 for(const headers of [{origin:'null'},{origin:'https://evil.invalid'},{origin:'https://dashboard.invalid/'},{origin:''},{'sec-fetch-site':'cross-site'},{origin:'https://evil.invalid','x-forwarded-host':'evil.invalid','x-forwarded-proto':'https'}]){
  const request=req('{',headers);assert.equal((await POST(request,params)).status,403);assert.equal(request.bodyUsed,false);
 }
 for(const body of ['{',null,[],{}, {expectedVersion:0},{expectedVersion:-1},{expectedVersion:1.5},{expectedVersion:'1'},{expectedVersion:1,ready:true},{expectedVersion:1,actorClass:'forged'},{expectedVersion:1,occurredAt:'forged'}])assert.equal((await POST(req(body),params)).status,400);
 assert.equal((await POST(req({}, {'content-type':'text/plain'}),params)).status,400);
 assert.equal((await POST(req('x'.repeat(4097)),params)).status,413);
 assert.equal((await POST(req({}, {'content-length':'5000'}),params)).status,413);
 const bytes=req(JSON.stringify({expectedVersion:1})+' '.repeat(4090));assert.equal((await POST(bytes,params)).status,413);
 let cancelled=false;let index=0;const chunks=[new TextEncoder().encode('{"expectedVersion":1}'),new TextEncoder().encode('é'.repeat(2050))];
 const streamed=new Request('https://dashboard.invalid/api/keys/target/budget/retire',{method:'POST',headers:{origin:'https://dashboard.invalid','content-type':'application/json','content-length':'1'},duplex:'half',body:new ReadableStream({pull(c){if(index<chunks.length)c.enqueue(chunks[index++]);},cancel(){cancelled=true;}})});
 Object.defineProperty(streamed,'cookies',{value:{get:()=>({value:'fixture-admin'})}});
 assert.equal((await POST(streamed,params)).status,413);assert.equal(index,2);assert.equal(cancelled,true);
 assert.equal((await POST(req(),{params:Promise.resolve({id:'../unsafe'})})).status,400);
 assert.throws(getAdapterSync);
});
let db;
after(()=>db?.close());
test('ordinary installed DB without accounting schema refuses retirement without enrollment or key changes',async()=>{
 db=await getAdapter();
 db.run('INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES(?,?,1,?)',['target','private-target','2026-11-16T00:00:00.000Z']);
 const before=JSON.stringify(db.all('SELECT * FROM apiKeys'));
 const r=await POST(req(),params);assert.equal(r.status,503);assert.equal(r.headers.get('cache-control'),'no-store');
 assert.equal((await GET(req(),params)).status,503);
 assert.equal(JSON.stringify(db.all('SELECT * FROM apiKeys')),before);
 assert.equal(db.all("SELECT name FROM sqlite_schema WHERE name LIKE 'accounting_%'").length,0);
 assertAccountingHealthy();
});
test('dashboard rotation publishes the replacement only on a fresh committed version', async () => {
  db.exec("VACUUM INTO '/tmp/before-rotation-schema.sqlite'");
  initializeNodeKeyPolicy(db);
  initializeNodeAttemptLedger(db);
  db.run('INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES(?,?,1,?)',
    ['rotation', 'fixture-old-rotation', '2026-11-16T00:00:00.000Z']);
  const target = { params: Promise.resolve({ id: 'rotation' }) };
  const policy = createNodeKeyPolicy(db);
  policy.save('rotation', 0, { weekly: '123', monthly: '456' });
  const operationId = '1010'.repeat(8);
  const command = { expectedVersion: 1, operationId };
  const lookup = (token = 'fixture-admin') => {
    const request = new Request(`https://dashboard.invalid/api/keys/rotation/budget/rotate?operationId=${operationId}`);
    Object.defineProperty(request, 'cookies', { value: { get: () => token ? { value: token } : undefined } });
    return request;
  };
  assert.equal((await rotate(req(command, {}, null), target)).status, 401);
  assert.equal((await rotate(req(command, {origin:'https://evil.invalid'}), target)).status, 403);
  assert.equal((await rotate(req({...command, key:'supplied'}), target)).status, 400);
  assert.equal((await rotate(req(), target)).status, 400);
  assert.equal((await lookupRotation(lookup(null), target)).status, 401);
  assert.equal((await lookupRotation(lookup(), target)).status, 404);

  const responses = await Promise.all([rotate(req(command), target), rotate(req(command), target)]);
  const results = [];
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    results.push(await response.json());
  }
  const { key, policy: rotated, receipt } = results.find(result => Object.hasOwn(result, 'key'));
  assert.deepEqual(results.find(result => !Object.hasOwn(result, 'key')), { receipt });
  assert.ok(/^sk-r[0-9a-f]{64}$/.test(key));
  assert.equal(rotated.bindingGeneration, '2');
  assert.deepEqual(rotated.limits, { weekly: '123', monthly: '456' });
  assert.deepEqual(receipt, { operationId, keyId: 'rotation', previousVersion: 1, version: 2,
    bindingGeneration: '2', occurredAt: new Date(receipt.occurredAt).toISOString(),
    action: 'rotate', actorClass: 'dashboard-session' });
  assert.equal(await validateApiKey('fixture-old-rotation'), false);
  assert.equal(await validateApiKey(key), true);
  assert.equal(keyManagementView({ id: 'rotation', key }).key, null);
  assert.equal((await rotate(req({...command, expectedVersion:2}), target)).status, 409);
  assert.equal((await rotate(req(command), params)).status, 409);
  assert.equal((await lookupRotation(lookup(), params)).status, 404);
  const status = await GET(req(), target);
  assert.equal(status.status, 200);
  const snapshot = await status.json();
  assert.equal(snapshot.policy.version, 2);
  assert.equal(JSON.stringify(snapshot).includes(key), false);

  const nextId = '2020'.repeat(8);
  assert.equal((await rotate(req({expectedVersion:1, operationId:nextId}), target)).status, 409);
  const next = await rotate(req({expectedVersion:2, operationId:nextId}), target);
  assert.equal(next.status, 200);
  assert.equal(await validateApiKey(key), false);
  assert.equal(await validateApiKey((await next.json()).key), true);
  const observed = await lookupRotation(lookup(), target);
  assert.equal(observed.status, 200);
  assert.equal(observed.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await observed.json(), { receipt });
  assert.deepEqual(await (await rotate(req(command), target)).json(), { receipt });
  const recovered = await createNodeSqliteAdapter(backupDbLite(db, '/tmp', 'rotation-receipts.sqlite'));
  try {
    assert.deepEqual(createNodeKeyPolicy(recovered).inspectRotation('rotation', operationId), receipt);
    assert.equal(recovered.get("SELECT COUNT(*) AS n FROM kv WHERE scope = 'budgetKeyRotation'").n, 2);
  } finally { recovered.close(); }
});

test('actual installed services retirement preserves stable history and blocks reactivation without DELETE erasure',async()=>{
 const policy=createNodeKeyPolicy(db);policy.save('target',0,{weekly:'123',monthly:'456'});
 const inspected=policy.inspect('target');assert.equal(Object.isFrozen(inspected),true);assert.equal(Object.isFrozen(inspected.limits),true);
 const active=await GET(req(),params);assert.equal(active.status,200);assert.equal(active.headers.get('cache-control'),'no-store');
 assert.deepEqual(await active.json(),{readiness:{ready:false,reason:'no_admitted_profile'},policy:{keyId:'target',bindingGeneration:'1',version:1,limits:{weekly:'123',monthly:'456'},lifecycle:'active'},retirementEvent:null,usage:null});
 const ledger=createNodeAttemptLedger(db);const now='2026-11-16T10:00:00.000Z';
 const original=ledger.prepare({attemptId:'original',keyId:'target',bindingGeneration:'1',provider:'fixture',model:'fixture',startedAt:now,price:{currency:'USD',unit:'USD/1M tokens',revision:'original',rates:{input:'1',output:'2'}}});
 const before=JSON.stringify([db.all('SELECT * FROM apiKeys'),db.all('SELECT * FROM accounting_key_policy_v1'),db.all('SELECT * FROM accounting_key_generations_v1')]);
 assert.equal(db.get('SELECT COUNT(*) AS n FROM accounting_admin_events_v1').n,0);
 const denied=await POST(req({expectedVersion:1},{},'inference-key'),params);assert.equal(denied.status,401);
 assert.equal(db.get('SELECT COUNT(*) AS n FROM accounting_admin_events_v1').n,0);
 const stale=await POST(req({expectedVersion:2}),params);assert.equal(stale.status,409);assert.equal(stale.headers.get('cache-control'),'no-store');
 assert.equal(JSON.stringify([db.all('SELECT * FROM apiKeys'),db.all('SELECT * FROM accounting_key_policy_v1'),db.all('SELECT * FROM accounting_key_generations_v1')]),before);
 assert.equal(db.get('SELECT COUNT(*) AS n FROM accounting_admin_events_v1').n,0);
 const result=await POST(req(),params);assert.equal(result.status,200);assert.deepEqual(await result.json(),{retired:true,credentialMaterialRetained:true});
 assert.equal(result.headers.get('cache-control'),'no-store');
 const events=db.all('SELECT * FROM accounting_admin_events_v1');assert.equal(events.length,1);
 const {occurred_at,...event}=events[0];assert.equal(new Date(occurred_at).toISOString(),occurred_at);
 const observed=policy.inspectRetirement('target');
 assert.equal(Object.isFrozen(observed),true);assert.equal(Object.isFrozen(observed.policy),true);
 assert.equal(Object.isFrozen(observed.policy.limits),true);assert.equal(Object.isFrozen(observed.retirementEvent),true);
 let begins=0,commits=0,eventReads=0;const wrapped={...db,
  exec(sql){if(sql==='BEGIN IMMEDIATE')begins++;if(sql==='COMMIT')commits++;return db.exec(sql);},
  get(sql,p){if(sql==='SELECT * FROM accounting_admin_events_v1 WHERE key_id = ?'){eventReads++;assert.equal(db.raw.isTransaction,true);}return db.get(sql,p);}};
 const observer=createNodeKeyPolicy(wrapped);begins=0;commits=0;const changes=db.get('SELECT total_changes() AS n').n;
 assert.deepEqual(observer.inspectRetirement('target'),observed);assert.equal(begins,1);assert.equal(commits,1);assert.equal(eventReads,1);
 assert.equal(db.get('SELECT total_changes() AS n').n,changes);
 assert.deepEqual(event,{key_id:'target',version:2,previous_version:1,generation:1,action:'retire',actor_class:'dashboard-session'});
 assert.equal(JSON.stringify(events).includes('private-target'),false);
 assert.equal(await validateApiKey('private-target'),false);assert.deepEqual(classifyAccountingSecret(db,'private-target'),{kind:'indeterminate'});
 await assert.rejects(updateApiKey('target',{isActive:true}));await assert.rejects(deleteApiKey('target'));
 assert.equal(db.get('SELECT key FROM apiKeys WHERE id=?',['target']).key,'private-target');
 assert.equal(db.get('SELECT version FROM accounting_key_policy_v1 WHERE key_id=?',['target']).version,2);
 assert.equal(db.get('SELECT monthly FROM accounting_key_policy_v1 WHERE key_id=?',['target']).monthly,'456');
 assert.equal(db.get('SELECT retired FROM accounting_key_generations_v1 WHERE key_id=?',['target']).retired,1);
 assertAccountingHealthy();original.settle(null);assert.deepEqual(ledger.totals('target',now),{weekly:'0',monthly:'0',unknown:1});
 assert.equal(policy.validateExistingBindings().validatedBindings,2);
 const retired=JSON.stringify([db.all('SELECT * FROM apiKeys'),db.all('SELECT * FROM accounting_key_policy_v1'),db.all('SELECT * FROM accounting_key_generations_v1')]);
 assert.equal((await POST(req(),params)).status,503); // existing owner repeat semantics, no retry/admission
 assert.equal(JSON.stringify([db.all('SELECT * FROM apiKeys'),db.all('SELECT * FROM accounting_key_policy_v1'),db.all('SELECT * FROM accounting_key_generations_v1')]),retired);
 assert.deepEqual(db.all('SELECT * FROM accounting_admin_events_v1'),events);
 const {createNodeSqliteAdapter}=await import('../../src/lib/db/adapters/nodeSqliteAdapter.js');
 const {DATA_FILE}=await import('../../src/lib/db/paths.js');
 const reopened=await createNodeSqliteAdapter(DATA_FILE);
 try{assert.deepEqual(reopened.all('SELECT * FROM accounting_admin_events_v1'),events);assert.equal(createNodeKeyPolicy(reopened).inspect('target').lifecycle,'retired');assert.equal(createNodeKeyPolicy(reopened).validateExistingBindings().validatedBindings,2);}finally{reopened.close();}
 db.run('INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES(?,?,1,?)',['race','private-race','2026-11-16T00:00:00.000Z']);
 createNodeKeyPolicy(db).save('race',0,{weekly:null,monthly:'456'});
 const race=await Promise.all([POST(req(),{params:Promise.resolve({id:'race'})}),POST(req(),{params:Promise.resolve({id:'race'})})]);
 assert.equal(race.filter(r=>r.status===200).length,1);assert.ok([409,503].includes(race.find(r=>r.status!==200).status));
 assert.equal(db.get('SELECT COUNT(*) AS n FROM accounting_admin_events_v1 WHERE key_id=?',['race']).n,1);
 assert.equal(db.get('SELECT version FROM accounting_key_policy_v1 WHERE key_id=?',['race']).version,2);
 const status=await GET(req(),params);assert.equal(status.status,200);assert.equal(status.headers.get('cache-control'),'no-store');
 assert.deepEqual(await status.json(),{readiness:{ready:false,reason:'no_admitted_profile'},policy:{keyId:'target',bindingGeneration:'1',version:2,limits:{weekly:'123',monthly:'456'},lifecycle:'retired'},retirementEvent:{action:'retire',actorClass:'dashboard-session',occurredAt:occurred_at,version:2,previousVersion:1,bindingGeneration:'1'},usage:null});
 assert.equal(db.raw.isTransaction,false);assertAccountingHealthy();
});
for(const mode of ['missing','unbound','disabled','malformed','history','view','faulted-absent','internal-retired','event-time','event-version','event-active','event-read'])test('status snapshot '+mode+' preserves narrow existing-binding contract',()=>{
 const source=`
 import assert from 'node:assert/strict';
 import {GET,POST} from '/app/src/app/api/keys/[id]/budget/retire/route.js';
 import {getAdapter} from '/app/src/lib/db/driver.js';
 import {initializeNodeKeyPolicy,createNodeKeyPolicy} from '/app/src/lib/accounting/node-key-policy.js';
 import {initializeNodeAttemptLedger} from '/app/src/lib/accounting/node-attempt-ledger.js';
 import {assertAccountingHealthy,faultAccounting} from '/app/src/lib/accounting/process-state.js';
 const db=await getAdapter();const mode=${JSON.stringify(mode)};
 const request=()=>{const r=new Request('https://dashboard.invalid/api/keys/target/budget/retire',{method:'POST',headers:{origin:'https://dashboard.invalid','content-type':'application/json'},body:'{"expectedVersion":1}'});Object.defineProperty(r,'cookies',{value:{get:()=>({value:'fixture-admin'})}});return r;};
 const params={params:Promise.resolve({id:'target'})};
 try{
 db.run('INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES(?,?,1,?)',['target','private-target','2026-11-16T00:00:00.000Z']);
 if(mode!=='faulted-absent'){
  initializeNodeKeyPolicy(db);initializeNodeAttemptLedger(db);
  if(mode!=='unbound')createNodeKeyPolicy(db).save('target',0,{weekly:'123',monthly:'456'});
 }
 if(mode==='missing')db.run('DELETE FROM apiKeys WHERE id=?',['target']);
 if(mode==='disabled')db.run('UPDATE apiKeys SET isActive=0 WHERE id=?',['target']);
 if(mode==='malformed')db.run('UPDATE apiKeys SET isActive=2 WHERE id=?',['target']);
 if(mode==='history')db.run('DELETE FROM accounting_key_generations_v1 WHERE key_id=?',['target']);
 if(mode==='view'){db.exec('DROP TABLE accounting_key_generations_v1');db.exec('CREATE VIEW accounting_key_generations_v1 AS SELECT 1 AS invalid');}
 if(mode==='faulted-absent')faultAccounting();
 if(mode==='internal-retired')createNodeKeyPolicy(db).retire('target',1);
 if(mode==='event-time'||mode==='event-version'){
  createNodeKeyPolicy(db).retireAudited('target',1);
  if(mode==='event-time')db.run('UPDATE accounting_admin_events_v1 SET occurred_at=?',['private-invalid']);
  else db.run('UPDATE accounting_admin_events_v1 SET previous_version=2');
 }
 if(mode==='event-active')db.run("INSERT INTO accounting_admin_events_v1 VALUES(?,2,1,1,'retire','dashboard-session',?)",['target','2026-11-16T00:00:00.000Z']);
 const get=db.get;let eventReads=0;
 if(mode==='event-read')db.get=(sql,p)=>{if(sql==='SELECT * FROM accounting_admin_events_v1 WHERE key_id = ?'){eventReads++;throw new Error('private event read');}return get(sql,p);};
 const before=JSON.stringify(db.all('SELECT * FROM apiKeys'));const changes=db.get('SELECT total_changes() AS n').n;
 const response=await GET(request(),params);assert.equal(response.headers.get('cache-control'),'no-store');
 if(mode==='internal-retired'){
  assert.equal(response.status,200);const body=await response.json();
  assert.equal(body.policy.lifecycle,'retired');assert.equal(body.policy.version,2);assert.equal(body.retirementEvent,null);
  assert.deepEqual(body.readiness,{ready:false,reason:'no_admitted_profile'});assert.equal(body.usage,null);assertAccountingHealthy();
 }else if(mode==='disabled'){
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{readiness:{ready:false,reason:'no_admitted_profile'},policy:{keyId:'target',bindingGeneration:'1',version:1,limits:{weekly:'123',monthly:'456'},lifecycle:'disabled'},retirementEvent:null,usage:null});assertAccountingHealthy();
 }else{
  assert.equal(response.status,503);assert.ok(!(await response.text()).includes('private-target'));
  if(['malformed','history','faulted-absent','event-time','event-version','event-active','event-read'].includes(mode))assert.throws(assertAccountingHealthy);else assertAccountingHealthy();
 }
 if(mode==='event-read')assert.equal(eventReads,1);
 assert.equal(JSON.stringify(db.all('SELECT * FROM apiKeys')),before);assert.equal(db.get('SELECT total_changes() AS n').n,changes);assert.equal(db.raw.isTransaction,false);
 if(mode==='disabled'){
  // A status version is not a reservation: a legitimate policy edit invalidates
  // that CAS before a later request, without mixing lifecycle snapshots.
  db.run('UPDATE apiKeys SET isActive=1 WHERE id=?',['target']);createNodeKeyPolicy(db).save('target',1,{weekly:'789',monthly:'456'});
  assert.equal((await POST(request(),params)).status,409);
  const next=await GET(request(),params);assert.equal(next.status,200);const body=await next.json();assert.equal(body.policy.version,2);assert.equal(body.policy.limits.weekly,'789');assert.equal(body.policy.lifecycle,'active');assert.equal(db.get('SELECT retired FROM accounting_key_policy_v1').retired,0);
 }
 }finally{db.close();}`;
 const r=spawnSync('/runtime/node',['--unhandled-rejections=strict','--experimental-loader','/app/tests/fixtures/budget/retirement-loader.mjs','--input-type=module','--eval',source],{env:{...process.env,DATA_DIR:'/tmp/status-'+mode},encoding:'utf8',timeout:10000});
 assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stdout+r.stderr);
});

for(const mode of ['partial','history','audit-absent','audit-view','event-write','write','commit-before','commit-after'])test('actual route '+mode+' refuses sanitized without success or retry',()=>{
 const source=`
 import assert from 'node:assert/strict';
 import {GET,POST} from '/app/src/app/api/keys/[id]/budget/retire/route.js';
 import {getAdapter,getAccountingAdapter} from '/app/src/lib/db/driver.js';
 import {initializeNodeKeyPolicy,createNodeKeyPolicy} from '/app/src/lib/accounting/node-key-policy.js';
 import {initializeNodeAttemptLedger} from '/app/src/lib/accounting/node-attempt-ledger.js';
 import {assertAccountingHealthy,finalAccountingDispatch} from '/app/src/lib/accounting/process-state.js';
 const db=await getAdapter();const mode=${JSON.stringify(mode)};
 const request=()=>{const r=new Request('https://dashboard.invalid/api/keys/target/budget/retire',{method:'POST',headers:{origin:'https://dashboard.invalid','content-type':'application/json'},body:'{"expectedVersion":1}'});Object.defineProperty(r,'cookies',{value:{get:()=>({value:'fixture-admin'})}});return r;};
 const params={params:Promise.resolve({id:'target'})};
 try{
 db.run('INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES(?,?,1,?)',['target','private-target','2026-11-16T00:00:00.000Z']);
 initializeNodeKeyPolicy(db);initializeNodeAttemptLedger(db);createNodeKeyPolicy(db).save('target',0,{weekly:'123',monthly:'456'});
 if(mode==='partial')db.exec('DROP TABLE accounting_key_generations_v1');
 if(mode==='history')db.run('DELETE FROM accounting_key_generations_v1 WHERE key_id=?',['target']);
 if(mode==='audit-absent'||mode==='audit-view')db.exec('DROP TABLE accounting_admin_events_v1');
 if(mode==='audit-view')db.exec('CREATE VIEW accounting_admin_events_v1 AS SELECT 1 AS invalid');
 const structural=['partial','audit-absent','audit-view'].includes(mode);
 const run=db.run,exec=db.exec;let hit=0,dispatches=0,writes=0,commits=0;
 db.run=(sql,p)=>{if(sql.startsWith('UPDATE accounting_key_policy_v1 SET retired')){writes++;if(mode==='write'){hit++;throw new Error('private SQL private-target');}}if(mode==='event-write'&&sql.startsWith('INSERT INTO accounting_admin_events_v1')){hit++;assert.equal(writes,1);throw new Error('private event private-target');}return run(sql,p);};
 db.exec=sql=>{if(sql==='COMMIT'){commits++;if(mode.startsWith('commit')){hit++;if(hit===3){assert.equal(writes,1);if(mode==='commit-after')exec(sql);throw new Error('private COMMIT private-target');}}}return exec(sql);};
 const response=await POST(request(),params);assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');
 const text=await response.text();assert.ok(!/private|SQL|COMMIT|fingerprint/.test(text));
 if(mode==='write'||mode==='event-write')assert.equal(hit,1);if(mode.startsWith('commit'))assert.equal(hit,3); // ledger schema, policy schema, retire
 const committed=mode==='commit-after';assert.equal(db.get('SELECT isActive FROM apiKeys').isActive,committed?0:1);
 assert.equal(db.get('SELECT version FROM accounting_key_policy_v1').version,committed?2:1);
 assert.equal(db.get('SELECT retired FROM accounting_key_policy_v1').retired,committed?1:0);
 if(!['partial','history'].includes(mode))assert.equal(db.get('SELECT retired FROM accounting_key_generations_v1').retired,committed?1:0);
 if(!['audit-absent','audit-view'].includes(mode))assert.equal(db.get('SELECT COUNT(*) AS n FROM accounting_admin_events_v1').n,committed?1:0);
 if(structural)assert.equal(writes,0);
 assert.equal(db.raw.isTransaction,false);assert.equal(db.raw.isOpen,true);
 if(structural)assertAccountingHealthy(); // structural refusal, no fabricated storage fault
 else{assert.throws(assertAccountingHealthy);assert.throws(()=>finalAccountingDispatch(()=>true,()=>{dispatches++;}));assert.equal(dispatches,0);await assert.rejects(getAccountingAdapter());}
 const snapshot=()=>JSON.stringify([db.all('SELECT * FROM apiKeys'),db.all('SELECT * FROM accounting_key_policy_v1'),mode==='partial'?null:db.all('SELECT * FROM accounting_key_generations_v1'),['audit-absent','audit-view'].includes(mode)?null:db.all('SELECT * FROM accounting_admin_events_v1')]);
 const beforeRetry=snapshot();const writesBefore=writes,commitsBefore=commits;
 assert.equal((await POST(request(),params)).status,503);assert.equal(snapshot(),beforeRetry);
 if(!structural){assert.equal(writes,writesBefore);assert.equal(commits,commitsBefore);}
 assert.equal((await GET(request(),params)).status,503);assert.equal(snapshot(),beforeRetry);
 if(!structural){assert.equal(writes,writesBefore);assert.equal(commits,commitsBefore);}
 db.run=run;db.exec=exec;
 }finally{db.close();}`;
 const r=spawnSync('/runtime/node',['--unhandled-rejections=strict','--experimental-loader','/app/tests/fixtures/budget/retirement-loader.mjs','--input-type=module','--eval',source],{env:{...process.env,DATA_DIR:'/tmp/retire-'+mode},encoding:'utf8',timeout:10000});
 assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stdout+r.stderr);
});

for (const interrupted of ['receipt-write', 'after-commit']) {
  test(`rotation receipt and binding recover together after ${interrupted}`, () => {
    const source = `
      import assert from 'node:assert/strict';
      import {POST} from '/app/src/app/api/keys/[id]/budget/rotate/route.js';
      import {getAdapter} from '/app/src/lib/db/driver.js';
      import {initializeNodeKeyPolicy,createNodeKeyPolicy} from '/app/src/lib/accounting/node-key-policy.js';
      import {initializeNodeAttemptLedger} from '/app/src/lib/accounting/node-attempt-ledger.js';
      const db = await getAdapter();
      const committed = ${interrupted === 'after-commit'};
      db.run("INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES('target','fixture-old',1,'2026-11-16T00:00:00.000Z')");
      initializeNodeKeyPolicy(db);
      initializeNodeAttemptLedger(db);
      createNodeKeyPolicy(db).save('target', 0, { weekly: '123', monthly: '456' });
      const run = db.run, exec = db.exec;
      let attemptedReceipt = false;
      db.run = (sql, args) => {
        if (sql.includes("VALUES ('budgetKeyRotation'")) {
          attemptedReceipt = true;
          if (!committed) throw new Error('fixture receipt write failure');
        }
        return run(sql, args);
      };
      db.exec = sql => {
        const result = exec(sql);
        if (sql === 'COMMIT' && attemptedReceipt) throw new Error('fixture lost commit acknowledgement');
        return result;
      };
      const request = new Request('https://dashboard.invalid/api/keys/target/budget/rotate', {
        method: 'POST', headers: { origin: 'https://dashboard.invalid', 'content-type': 'application/json' },
        body: JSON.stringify({ expectedVersion: 1, operationId: 'abcd'.repeat(8) }),
      });
      Object.defineProperty(request, 'cookies', { value: { get: () => ({ value: 'fixture-admin' }) } });
      const result = await POST(request, { params: { id: 'target' } });
      assert.equal(result.status, 503);
      assert.equal(Object.hasOwn(await result.json(), 'key'), false);
      assert.equal(attemptedReceipt, true);
      assert.equal(db.raw.isTransaction, false);
      db.close();
    `;
    const reopened = `
      import assert from 'node:assert/strict';
      import {createNodeSqliteAdapter} from '/app/src/lib/db/adapters/nodeSqliteAdapter.js';
      import path from 'node:path';
      import {createNodeKeyPolicy} from '/app/src/lib/accounting/node-key-policy.js';
      const db = await createNodeSqliteAdapter(path.join(process.env.DATA_DIR, 'db', 'data.sqlite'));
      try {
        const policy = createNodeKeyPolicy(db);
        const committed = ${interrupted === 'after-commit'};
        const receipt = policy.inspectRotation('target', 'abcd'.repeat(8));
        assert.equal(receipt?.version ?? null, committed ? 2 : null);
        assert.equal(policy.inspect('target').version, committed ? 2 : 1);
        assert.equal(db.get('SELECT COUNT(*) AS n FROM accounting_key_generations_v1').n, committed ? 2 : 1);
        assert.equal(db.get("SELECT key = 'fixture-old' AS old_key FROM apiKeys").old_key, committed ? 0 : 1);
      } finally { db.close(); }
    `;
    for (const script of [source, reopened]) {
      const child = spawnSync('/runtime/node', ['--experimental-loader', '/app/tests/fixtures/budget/retirement-loader.mjs',
        '--input-type=module', '--eval', script], {
        env: { ...process.env, DATA_DIR: `/tmp/rotation-${interrupted}` }, encoding: 'utf8', timeout: 10000,
      });
      assert.equal(child.status, 0, child.stdout + child.stderr);
    }
  });
}
