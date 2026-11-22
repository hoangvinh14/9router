import fs from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { selectedAccountingSecret } from '../../src/lib/accounting/request-boundary.js';
assert.equal(process.env.BUDGET_PURE_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
let sequence=0;
function child(body){
 const prelude=`
 import assert from 'node:assert/strict';
 const {createNodeSqliteAdapter}=await import('/app/src/lib/db/adapters/nodeSqliteAdapter.js');
 const {initializeNodeKeyPolicy,createNodeKeyPolicy}=await import('/app/src/lib/accounting/node-key-policy.js');
 const {initializeNodeAttemptLedger}=await import('/app/src/lib/accounting/node-attempt-ledger.js');
 const {classifyAccountingSecret}=await import('/app/src/lib/accounting/request-boundary.js');
 const {assertAccountingHealthy,finalAccountingDispatch}=await import('/app/src/lib/accounting/process-state.js');
 const db=await createNodeSqliteAdapter('/tmp/boundary-${++sequence}.sqlite');
 db.exec('CREATE TABLE apiKeys(id TEXT PRIMARY KEY,key TEXT UNIQUE NOT NULL,isActive INTEGER NOT NULL)');
 db.run('INSERT INTO apiKeys VALUES(?,?,1)',['key-A','fixture-A']);
 db.run('INSERT INTO apiKeys VALUES(?,?,1)',['key-B','fixture-B']);
 try { ${body} }finally{db.close();}`;
 const r=spawnSync('/runtime/node',['--unhandled-rejections=strict','--input-type=module','--eval',prelude],{env:process.env,encoding:'utf8',timeout:10000});
 assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stdout+r.stderr);
}

test('credential selection retains existing guard precedence and never accepts client identity fields',()=>{
 const request=(headers={},query='')=>({headers:new Headers(headers),url:'https://fixture.invalid/v1/messages'+query,accounting:{keyId:'spoofed'}});
 assert.equal(selectedAccountingSecret(request()),null);
 assert.equal(selectedAccountingSecret(request({'authorization':'Bearer A','x-api-key':'B','x-goog-api-key':'C'},'?key=D')),'A');
 // Headers trims trailing space; explicit fake accessor exercises the existing
 // startsWith Bearer-empty branch without silently changing its contract.
 assert.equal(selectedAccountingSecret({headers:{get:name=>name==='authorization'?'Bearer ':name==='x-api-key'?'B':null}}),'');
 assert.equal(selectedAccountingSecret(request({'authorization':'Basic A','x-api-key':'B','x-goog-api-key':'C'},'?key=D')),'B');
 assert.equal(selectedAccountingSecret(request({'x-api-key':'','x-goog-api-key':'C'},'?key=D')),'C');
 assert.equal(selectedAccountingSecret(request({},'?key=D')),'D');
});

test('no-key does not touch DB; absent observed schema is explicit limited ordinary classification',()=>child(`
 assert.deepEqual(classifyAccountingSecret({all(){assert.fail('no-key DB read');}},null),{kind:'ordinary'});
 assert.deepEqual(classifyAccountingSecret(db,'fixture-A'),{kind:'ordinary',installation:'absent-in-observed-db'});
 assertAccountingHealthy();
`));

test('actual policy binding is controlled and genuine unbound key remains ordinary',()=>child(`
 initializeNodeKeyPolicy(db);initializeNodeAttemptLedger(db);
 createNodeKeyPolicy(db).save('key-A',0,{weekly:null,monthly:'1000'});
 assert.deepEqual(classifyAccountingSecret(db,'fixture-A'),{kind:'controlled',keyId:'key-A'});
 assert.deepEqual(classifyAccountingSecret(db,'fixture-B'),{kind:'ordinary'});
 assert.deepEqual(classifyAccountingSecret(db,'unknown'),{kind:'ordinary'});
 assertAccountingHealthy();
`));

test('partial or malformed enrollment schema cannot downgrade to ordinary',()=>child(`
 initializeNodeKeyPolicy(db);
 assert.deepEqual(classifyAccountingSecret(db,'fixture-A'),{kind:'indeterminate'});
 initializeNodeAttemptLedger(db);
 db.exec('ALTER TABLE accounting_key_policy_v1 ADD COLUMN ignored TEXT');
 assert.deepEqual(classifyAccountingSecret(db,'fixture-B'),{kind:'indeterminate'});
`));

test('revoked orphaned and silently replaced bindings refuse instead of ordinary identity',()=>child(`
 initializeNodeKeyPolicy(db);initializeNodeAttemptLedger(db);
 createNodeKeyPolicy(db).save('key-A',0,{weekly:null,monthly:'1000'});
 db.run('UPDATE apiKeys SET isActive=0 WHERE id=?',['key-A']);
 assert.deepEqual(classifyAccountingSecret(db,'fixture-A'),{kind:'indeterminate'});
 db.run('DELETE FROM apiKeys WHERE id=?',['key-A']);
 assert.deepEqual(classifyAccountingSecret(db,'fixture-A'),{kind:'indeterminate'});
 db.run('INSERT INTO apiKeys VALUES(?,?,1)',['key-A','replacement']);
 assert.deepEqual(classifyAccountingSecret(db,'replacement'),{kind:'indeterminate'});
`));

test('historical rotated and retired secrets never downgrade to ordinary and current replacement stays controlled',()=>child(`
 initializeNodeKeyPolicy(db);initializeNodeAttemptLedger(db);const policy=createNodeKeyPolicy(db);
 policy.save('key-A',0,{weekly:null,monthly:'1000'});
 policy.rotate('key-A',1,'fixture-A','replacement-A');
 assert.deepEqual(classifyAccountingSecret(db,'fixture-A'),{kind:'indeterminate'});
 assert.deepEqual(classifyAccountingSecret(db,'replacement-A'),{kind:'controlled',keyId:'key-A'});
 assert.deepEqual(classifyAccountingSecret(db,'fixture-B'),{kind:'ordinary'});
 policy.retire('key-A',2);
 for(const secret of ['fixture-A','replacement-A'])assert.deepEqual(classifyAccountingSecret(db,secret),{kind:'indeterminate'});
 assertAccountingHealthy();
 db.run('DELETE FROM apiKeys WHERE id=?',['key-A']);
 for(const secret of ['fixture-A','replacement-A'])assert.deepEqual(classifyAccountingSecret(db,secret),{kind:'indeterminate'});
 assertAccountingHealthy();
`));

test('generation-only table or view markers cannot masquerade as absent accounting',()=>child(`
 db.exec('CREATE TABLE accounting_key_generations_v1 (fingerprint TEXT)');
 assert.deepEqual(classifyAccountingSecret(db,'fixture-B'),{kind:'indeterminate'});
 db.exec('DROP TABLE accounting_key_generations_v1');
 db.exec('CREATE VIEW accounting_key_generations_v1 AS SELECT 1 AS generation');
 assert.deepEqual(classifyAccountingSecret(db,'fixture-B'),{kind:'indeterminate'});assertAccountingHealthy();
`));

test('administrative-event-only markers cannot downgrade to ordinary or permit generic mutation',()=>child(`
 const {assertNoAccountingMutation}=await import('/app/src/lib/accounting/mutation-barrier.js');
 db.exec('CREATE TABLE accounting_admin_events_v1 (key_id TEXT)');
 assert.deepEqual(classifyAccountingSecret(db,'fixture-B'),{kind:'indeterminate'});
 assert.throws(()=>assertNoAccountingMutation(db));
 db.exec('DROP TABLE accounting_admin_events_v1');db.exec('CREATE VIEW accounting_admin_events_v1 AS SELECT 1 AS key_id');
 assert.deepEqual(classifyAccountingSecret(db,'fixture-B'),{kind:'indeterminate'});
 assert.throws(()=>assertNoAccountingMutation(db));assertAccountingHealthy();
`));

test('invalid NUL input refuses without DB read or process fault',()=>child(`
 assert.deepEqual(classifyAccountingSecret({all(){assert.fail('invalid input must not read');}},'a\\0b'),{kind:'indeterminate'});
 assertAccountingHealthy();
`));

for(const target of ['schema','key','binding'])test('direct '+target+' SQL read failure latches same-process final dispatch without leaking cause',()=>child(`
 initializeNodeKeyPolicy(db);initializeNodeAttemptLedger(db);
 createNodeKeyPolicy(db).save('key-A',0,{weekly:null,monthly:'1000'});
 const target='${target}';
 const actualAll=db.all,actualGet=db.get;
 db.all=(sql,params)=>{if((target==='schema'&&sql.startsWith('SELECT name FROM sqlite_schema'))||(target==='binding'&&sql.startsWith('SELECT key_id FROM')))throw new Error('fixture-private-secret');return actualAll(sql,params);};
 db.get=(sql,params)=>{if(target==='key'&&sql.startsWith('SELECT id, isActive'))throw new Error('fixture-private-secret');return actualGet(sql,params);};
 assertAccountingHealthy();
 assert.deepEqual(classifyAccountingSecret(db,'fixture-A'),{kind:'indeterminate'});
 assert.throws(assertAccountingHealthy);let posts=0;
 assert.throws(()=>finalAccountingDispatch(()=>true,()=>{posts++;}));assert.equal(posts,0);
 db.all=actualAll;db.get=actualGet;
`));
