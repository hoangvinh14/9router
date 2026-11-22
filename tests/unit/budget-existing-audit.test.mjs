import fs from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
assert.equal(process.env.BUDGET_PURE_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
for(const mode of ['valid','ledger-corrupt','read-fault','commit-ambiguous','rotated','retired','missing-reference','wrong-key','noncanonical-generation','unsettled-reference'])test('single snapshot existing audit '+mode,()=>{
 const source=`
 import assert from 'node:assert/strict';
 import {createNodeSqliteAdapter} from '/app/src/lib/db/adapters/nodeSqliteAdapter.js';
 import {initializeNodeKeyPolicy,createNodeKeyPolicy,KEY_POLICY_AUDIT_DEFINITIONS} from '/app/src/lib/accounting/node-key-policy.js';
 import {initializeNodeAttemptLedger,createNodeAttemptLedger,LEDGER_AUDIT_DEFINITIONS} from '/app/src/lib/accounting/node-attempt-ledger.js';
 import {auditExistingNodeAccounting} from '/app/src/lib/accounting/node-existing-audit.js';
 import {assertAccountingHealthy} from '/app/src/lib/accounting/process-state.js';
 const db=await createNodeSqliteAdapter('/tmp/composed-${mode}.sqlite');
 try{
 db.exec('CREATE TABLE apiKeys(id TEXT PRIMARY KEY,key TEXT UNIQUE NOT NULL,isActive INTEGER NOT NULL)');
 db.run('INSERT INTO apiKeys VALUES(?,?,1)',['key-A','fixture-secret']);
 initializeNodeKeyPolicy(db);const policy=createNodeKeyPolicy(db);policy.save('key-A',0,{weekly:null,monthly:'100'});
 initializeNodeAttemptLedger(db);const ledger=createNodeAttemptLedger(db);
 const mode=${JSON.stringify(mode)};
 const original={attemptId:'original',keyId:mode==='wrong-key'?'key-B':'key-A',bindingGeneration:mode==='missing-reference'?'2':mode==='noncanonical-generation'?'01':'1',provider:'fixture',model:'fixture',startedAt:'2026-11-16T10:00:00.000Z',price:{currency:'USD',unit:'USD/1M tokens',revision:'fixture',rates:{input:'1',output:'2'}}};
 const retained=ledger.prepare(original);
 if(['rotated','retired'].includes(mode))policy.rotate('key-A',1,'fixture-secret','replacement-fixture');
 if(mode==='retired')policy.retire('key-A',2);
 retained.settle(null);
 if(mode==='unsettled-reference')ledger.prepare({...original,attemptId:'unsettled',bindingGeneration:'99'});
 if(mode==='ledger-corrupt')db.run('UPDATE accounting_terminals_v1 SET evidence=?',['{}']);
 const before=db.all('SELECT * FROM accounting_terminals_v1');const changes=db.get('SELECT total_changes() AS n').n;
 let begins=0,commits=0,rollbacks=0,policyReads=0,ledgerReads=0;
 const wrapped={...db,exec(sql){
  if(sql==='BEGIN IMMEDIATE')begins++;
  if(sql==='COMMIT')commits++;
  if(sql==='ROLLBACK')rollbacks++;
  const result=db.exec(sql);
  if(sql==='COMMIT'&&mode==='commit-ambiguous')throw new Error('private lost COMMIT return');
  return result;
 },all(sql,params){
  assert.equal(db.raw.isTransaction,true);
  if(sql.includes('FROM accounting_key_policy_v1'))policyReads++;
  if(sql.includes('FROM accounting_attempts_v1')){ledgerReads++;if(mode==='read-fault')throw new Error('private SQL read');}
  return db.all(sql,params);
 }};
 for(const group of [KEY_POLICY_AUDIT_DEFINITIONS,LEDGER_AUDIT_DEFINITIONS]){
  assert.equal(Object.isFrozen(group),true);
  for(const definition of Object.values(group)){assert.equal(Object.isFrozen(definition),true);assert.ok(['get','all'].includes(definition.method));}
 }
 if(['valid','rotated','retired'].includes(mode)){
  const result=auditExistingNodeAccounting(wrapped);
  assert.deepEqual(result,{validatedBindings:1,validatedAttempts:1,validatedTerminals:1});assert.equal(Object.isFrozen(result),true);
  assert.equal(commits,1);assert.equal(rollbacks,0);assertAccountingHealthy();
 }else{
  assert.throws(()=>auditExistingNodeAccounting(wrapped),error=>error.code==='api_key_accounting_unavailable'&&!error.message.includes('private'));
  assert.throws(assertAccountingHealthy);
  assert.equal(commits,mode==='commit-ambiguous'?1:0);
 }
 assert.equal(begins,1);assert.ok(policyReads>0);assert.ok(ledgerReads>0);
 assert.equal(db.raw.isTransaction,false);assert.equal(db.get('PRAGMA synchronous').synchronous,1);
 assert.equal(db.get('SELECT total_changes() AS n').n,changes);
 assert.deepEqual(db.all('SELECT * FROM accounting_terminals_v1'),before);
 // An audit count never revives an own intent ACK; replay stays authority-free.
 if(['valid','rotated','retired'].includes(mode))assert.deepEqual(ledger.prepare(original),{replay:true});
 }finally{db.close();}
 `;
 const r=spawnSync('/runtime/node',['--unhandled-rejections=strict','--input-type=module','--eval',source],{env:process.env,encoding:'utf8',timeout:10000});
 assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stdout+r.stderr);
});
