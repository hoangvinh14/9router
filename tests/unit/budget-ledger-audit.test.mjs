import fs from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
assert.equal(process.env.BUDGET_PURE_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
for(const mode of ['valid','original','window','amount','evidence','orphan','empty-id'])test('whole ledger audit '+mode,()=>{
 const source=`
 import assert from 'node:assert/strict';
 import {createNodeSqliteAdapter} from '/app/src/lib/db/adapters/nodeSqliteAdapter.js';
 import {initializeNodeAttemptLedger,createNodeAttemptLedger} from '/app/src/lib/accounting/node-attempt-ledger.js';
 import {assertAccountingHealthy} from '/app/src/lib/accounting/process-state.js';
 const db=await createNodeSqliteAdapter('/tmp/audit-${mode}.sqlite');
 try{
 initializeNodeAttemptLedger(db);const ledger=createNodeAttemptLedger(db);
 assert.deepEqual(ledger.validateExistingAttempts(),{validatedAttempts:0,validatedTerminals:0});
 for(let i=0;i<7;i++){
  const attempt=ledger.prepare({attemptId:'attempt-'+i,keyId:i===0?'key-A':'key-B',bindingGeneration:'1',provider:'fixture',model:'fixture',startedAt:i===0?'2026-11-16T10:00:00.000Z':'2025-01-01T00:00:00.000Z',price:{currency:'USD',unit:'USD/1M tokens',revision:'fixture',rates:{input:'1',output:'2'}}});
  if(i<6)attempt.settle(null);
 }
 const mode=${JSON.stringify(mode)};
 if(mode==='empty-id')db.run('INSERT INTO accounting_attempts_v1 VALUES(?,?,?,?,?,?)',['','key-B','bad','bad','bad','{}']);
 if(mode==='original')db.run('UPDATE accounting_attempts_v1 SET original=? WHERE id=?',['{}','attempt-5']);
 if(mode==='window')db.run('UPDATE accounting_attempts_v1 SET week_start=? WHERE id=?',['bad','attempt-5']);
 if(mode==='amount')db.run('UPDATE accounting_terminals_v1 SET amount=? WHERE attempt_id=?',['1','attempt-5']);
 if(mode==='evidence')db.run('UPDATE accounting_terminals_v1 SET evidence=? WHERE attempt_id=?',['{}','attempt-5']);
 if(mode==='orphan'){
  db.exec('PRAGMA foreign_keys=OFF');db.run('INSERT INTO accounting_terminals_v1 VALUES(?,?,?)',['missing','0','{}']);db.exec('PRAGMA foreign_keys=ON');
 }
 // Runtime addressed-key read alone must not substitute for whole history audit.
 assert.equal(ledger.totals('key-A','2026-11-16T10:00:00.000Z').monthly,'0');
 const before=db.all('SELECT * FROM accounting_attempts_v1 ORDER BY id');
 const beforeTerminal=db.all('SELECT * FROM accounting_terminals_v1 ORDER BY attempt_id');
 const changes=db.get('SELECT total_changes() AS n').n;
 if(mode==='valid'){
  const audit=ledger.validateExistingAttempts();assert.deepEqual(audit,{validatedAttempts:7,validatedTerminals:6});assert.equal(Object.isFrozen(audit),true);assertAccountingHealthy();
  // A fresh store's validation cannot mint permission for a persisted intent.
  const fresh=createNodeAttemptLedger(db);assert.equal(fresh.validateExistingAttempts().validatedAttempts,7);
  let posts=0;assert.throws(()=>fresh.dispatch({}, {},()=>posts++));assert.equal(posts,0);
 }else{assert.throws(()=>ledger.validateExistingAttempts());assert.throws(assertAccountingHealthy);}
 assert.equal(db.get('SELECT total_changes() AS n').n,changes);
 assert.deepEqual(db.all('SELECT * FROM accounting_attempts_v1 ORDER BY id'),before);
 assert.deepEqual(db.all('SELECT * FROM accounting_terminals_v1 ORDER BY attempt_id'),beforeTerminal);
 }finally{db.close();}
 `;
 const r=spawnSync('/runtime/node',['--unhandled-rejections=strict','--input-type=module','--eval',source],{env:process.env,encoding:'utf8',timeout:10000});
 assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stdout+r.stderr);
});
