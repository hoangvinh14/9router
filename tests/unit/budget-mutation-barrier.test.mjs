import fs from 'node:fs';
import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {spawnSync} from 'node:child_process';
import {getAdapter} from '../../src/lib/db/driver.js';
import {exportDb,importDb} from '../../src/lib/db/index.js';
import {updateApiKey,deleteApiKey,getApiKeyById,validateApiKey} from '../../src/lib/db/repos/apiKeysRepo.js';
import {initializeNodeKeyPolicy,createNodeKeyPolicy} from '../../src/lib/accounting/node-key-policy.js';
import {classifyAccountingSecret} from '../../src/lib/accounting/request-boundary.js';
import {assertAccountingKeyActivationAllowed} from '../../src/lib/accounting/node-key-policy.js';
import {initializeNodeAttemptLedger} from '../../src/lib/accounting/node-attempt-ledger.js';
import {assertNoAccountingMutation} from '../../src/lib/accounting/mutation-barrier.js';
import {assertAccountingHealthy} from '../../src/lib/accounting/process-state.js';
assert.equal(process.env.BUDGET_DRIVER_SANDBOX,'1');assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
const db=await getAdapter();after(()=>db.close());
const seed=(id,key)=>db.run('INSERT INTO apiKeys(id,key,name,machineId,isActive,createdAt) VALUES(?,?,?,?,1,?)',[id,key,'before','machine','2026-11-16T00:00:00.000Z']);

test('actual ordinary update delete JSON export and import retain no-schema behavior',async()=>{
 seed('ordinary','ordinary-secret');
 assert.equal((await updateApiKey('ordinary',{key:'changed',machineId:'new-machine'})).key,'changed');
 const exported=await exportDb();assert.equal(exported.apiKeys.length,1);
 assert.equal(await deleteApiKey('ordinary'),true);assert.equal(await getApiKeyById('ordinary'),null);
 const restored=await importDb(exported);assert.equal(restored.apiKeys[0].key,'changed');
});

test('even empty accounting schema blocks incomplete JSON import export before any write or output',async()=>{
 initializeNodeKeyPolicy(db);initializeNodeAttemptLedger(db);
 const before=db.get('SELECT key FROM apiKeys WHERE id=?',['ordinary']).key;
 const settingsBefore=db.all('SELECT * FROM settings');
 await assert.rejects(exportDb(),e=>e.code==='api_key_accounting_unavailable');
 await assert.rejects(importDb({settings:{erased:true},apiKeys:[]}),e=>e.code==='api_key_accounting_unavailable');
 assert.equal(db.get('SELECT key FROM apiKeys WHERE id=?',['ordinary']).key,before);
 assert.deepEqual(db.all('SELECT * FROM settings'),settingsBefore);
});

test('bound secret machine changes and delete refuse while metadata disable and reenable preserve binding',async()=>{
 const policy=createNodeKeyPolicy(db);policy.save('ordinary',0,{weekly:'123',monthly:'456'});
 const before=await getApiKeyById('ordinary');
 const bindingBefore=db.get('SELECT * FROM accounting_key_policy_v1 WHERE key_id=?',['ordinary']);
 for(const patch of [{key:'replacement'},{machineId:'replacement'}])await assert.rejects(updateApiKey('ordinary',patch));
 await assert.rejects(deleteApiKey('ordinary'));assert.deepEqual(await getApiKeyById('ordinary'),before);
 const updated=await updateApiKey('ordinary',{name:'renamed',isActive:false,access:{restricted:true,allow:['fixture/model']}});
 assert.equal(updated.name,'renamed');assert.equal(updated.isActive,false);
 assert.deepEqual(db.get('SELECT * FROM accounting_key_policy_v1 WHERE key_id=?',['ordinary']),bindingBefore);
 await updateApiKey('ordinary',{isActive:true});assert.equal(policy.resolve('changed').limits.monthly,'456');
 assert.equal(db.get('SELECT generation FROM accounting_key_policy_v1').generation,1);
});

test('actual repository cannot reactivate internally retired key; complete history and retained terminal survive',async()=>{
 seed('retired','retired-secret');const policy=createNodeKeyPolicy(db);
 policy.save('retired',0,{weekly:'123',monthly:'456'});
 const {createNodeAttemptLedger}=await import('../../src/lib/accounting/node-attempt-ledger.js');
 const ledger=createNodeAttemptLedger(db);const now='2026-11-16T10:00:00.000Z';
 const original=ledger.prepare({attemptId:'retired-original',keyId:'retired',bindingGeneration:'1',provider:'fixture',model:'fixture',startedAt:now,price:{currency:'USD',unit:'USD/1M tokens',revision:'original',rates:{input:'1',output:'2'}}});
 policy.retire('retired',1);
 const rows=()=>JSON.stringify([db.all('SELECT * FROM apiKeys ORDER BY id'),db.all('SELECT * FROM accounting_key_policy_v1 ORDER BY key_id'),db.all('SELECT * FROM accounting_key_generations_v1 ORDER BY key_id,generation')]);
 const before=rows();
 for(const patch of [{isActive:true},{isActive:1},{isActive:'yes',name:'must-not-write'}])await assert.rejects(updateApiKey('retired',patch));
 assert.equal(rows(),before);assert.equal(db.raw.isTransaction,false);assert.equal(db.raw.isOpen,true);assertAccountingHealthy();
 assert.equal(await validateApiKey('retired-secret'),false);
 assert.deepEqual(classifyAccountingSecret(db,'retired-secret'),{kind:'indeterminate'});
 assert.equal((await updateApiKey('retired',{name:'retained label',isActive:false})).isActive,false);
 assertAccountingHealthy();original.settle(null);
 assert.deepEqual(ledger.totals('retired',now),{weekly:'0',monthly:'0',unknown:1});
 assert.equal(db.get('SELECT monthly FROM accounting_key_policy_v1 WHERE key_id=?',['retired']).monthly,'456');
 assert.equal(db.get('SELECT COUNT(*) AS n FROM accounting_key_generations_v1 WHERE key_id=?',['retired']).n,1);
 assert.equal(policy.validateExistingBindings().validatedBindings,2);
});

test('activation guard stays inside caller transaction and does not commit or write',()=>{
 const changes=db.get('SELECT total_changes() AS n').n;
 db.transaction(()=>assertAccountingKeyActivationAllowed(db,'ordinary'));
 assert.equal(db.get('SELECT total_changes() AS n').n,changes);assertAccountingHealthy();
});

test('temporary barrier conservatively blocks unbound delete or rebinding too and partial schema cannot bypass',async()=>{
 seed('unbound','unbound-secret');
 await assert.rejects(deleteApiKey('unbound'));await assert.rejects(updateApiKey('unbound',{key:'other'}));
 assert.equal((await updateApiKey('unbound',{name:'ordinary metadata'})).name,'ordinary metadata');
 db.exec('DROP TABLE accounting_terminals_v1');db.exec('DROP TABLE accounting_attempts_v1');
 await assert.rejects(importDb({}));await assert.rejects(exportDb());await assert.rejects(deleteApiKey('unbound'));
 assert.ok(await getApiKeyById('unbound'));
});

for(const mode of ['partial','view','history','read','outside','faulted-absent'])test('activation refuses '+mode+' without repository writes or fault recovery',()=>{
 const source=`
 import assert from 'node:assert/strict';
 import {getAdapter} from '/app/src/lib/db/driver.js';
 import {updateApiKey,validateApiKey} from '/app/src/lib/db/repos/apiKeysRepo.js';
 import {initializeNodeKeyPolicy,createNodeKeyPolicy,assertAccountingKeyActivationAllowed} from '/app/src/lib/accounting/node-key-policy.js';
 import {initializeNodeAttemptLedger} from '/app/src/lib/accounting/node-attempt-ledger.js';
 import {assertAccountingHealthy,faultAccounting} from '/app/src/lib/accounting/process-state.js';
 const db=await getAdapter();const mode=${JSON.stringify(mode)};
 try{
 db.run('INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES(?,?,1,?)',['target','private-target','2026-11-16T00:00:00.000Z']);
 if(mode==='partial')db.exec('CREATE TABLE accounting_key_policy_v1(broken TEXT)');
 else if(mode==='view')db.exec('CREATE VIEW accounting_key_policy_v1 AS SELECT 1 AS broken');
 else if(mode!=='faulted-absent'){initializeNodeKeyPolicy(db);initializeNodeAttemptLedger(db);createNodeKeyPolicy(db).save('target',0,{weekly:null,monthly:'456'});}
 db.run('UPDATE apiKeys SET isActive=0 WHERE id=?',['target']);
 if(mode==='history')db.run('DELETE FROM accounting_key_generations_v1 WHERE key_id=?',['target']);
 const before=JSON.stringify(db.all('SELECT * FROM apiKeys'));const changes=db.get('SELECT total_changes() AS n').n;
 const get=db.get;
 if(mode==='read')db.get=(sql,p)=>{if(sql==='SELECT * FROM accounting_key_policy_v1 WHERE key_id = ?')throw new Error('private read');return get(sql,p);};
 if(mode==='faulted-absent')faultAccounting();
 if(mode==='outside')assert.throws(()=>assertAccountingKeyActivationAllowed(db,'target'));
 else await assert.rejects(updateApiKey('target',{isActive:true,name:'must not write'}),e=>e.code==='api_key_accounting_unavailable'&&!e.message.includes('private'));
 db.get=get;
 assert.equal(JSON.stringify(db.all('SELECT * FROM apiKeys')),before);assert.equal(db.get('SELECT total_changes() AS n').n,changes);
 assert.equal(db.raw.isTransaction,false);assert.equal(db.raw.isOpen,true);
 assert.equal(await validateApiKey('private-target'),false);assert.throws(assertAccountingHealthy);
 await assert.rejects(updateApiKey('target',{isActive:true}));
 }finally{db.close();}`;
 const r=spawnSync('/runtime/node',['--unhandled-rejections=strict','--experimental-loader','/app/tests/fixtures/budget/mutation-loader.mjs','--input-type=module','--eval',source],{env:{...process.env,DATA_DIR:'/tmp/activation-'+mode},encoding:'utf8',timeout:10000});
 assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stdout+r.stderr);
});

test('actual barrier read fault publishes existing process latch before refusing',()=>{
 assertAccountingHealthy();let writes=0;
 assert.throws(()=>assertNoAccountingMutation({all(){throw new Error('private');},run(){writes++;}}),e=>e.code==='api_key_accounting_unavailable');
 assert.equal(writes,0);assert.throws(assertAccountingHealthy);
});
