import fs from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
assert.equal(process.env.BUDGET_PURE_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
let sequence=0;
function child(body){
  const prelude=`
    import assert from 'node:assert/strict';
    const {createNodeSqliteAdapter}=await import('/app/src/lib/db/adapters/nodeSqliteAdapter.js');
    const {initializeNodeKeyPolicy:initialize,createNodeKeyPolicy:policy}=await import('/app/src/lib/accounting/node-key-policy.js');
    const {assertAccountingHealthy:healthy}=await import('/app/src/lib/accounting/process-state.js');
    const db=await createNodeSqliteAdapter('/tmp/policy-${++sequence}.sqlite');
    db.exec('CREATE TABLE apiKeys (id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, isActive INTEGER NOT NULL)');
    db.run('INSERT INTO apiKeys VALUES (?,?,1)',['key-A','fake-secret-A']);
    db.run('INSERT INTO apiKeys VALUES (?,?,1)',['key-B','fake-secret-B']);
    initialize(db);const store=policy(db);
    try{
  `;
  const r=spawnSync('/runtime/node',['--unhandled-rejections=strict','--input-type=module','--eval',prelude+body+`
    }finally{db.close();}
  `],{env:process.env,encoding:'utf8',timeout:10000});
  assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stdout+r.stderr);
}

test('server key lookup, policy CAS and fresh limits do not grant client key identity authority',()=>child(`
  assert.equal(store.resolve('fake-secret-A'),null);
  const first=store.save('key-A',0,{weekly:'1000',monthly:null});
  assert.deepEqual(first,{keyId:'key-A',bindingGeneration:'1',version:1,limits:{weekly:'1000',monthly:null}});
  assert.throws(()=>store.save('key-A',0,{weekly:'0',monthly:'0'}),e=>e.status===409);
  const second=store.save('key-A',1,{weekly:'0',monthly:'2000'});
  assert.equal(second.version,2);assert.equal(store.resolve('fake-secret-B'),null);
  assert.equal(store.current('fake-secret-A',first).limits.weekly,'0');
  assert.throws(()=>store.current('fake-secret-B',first));
  const row=db.get('SELECT * FROM accounting_key_policy_v1');
  assert.equal(Object.values(row).includes('fake-secret-A'),false);
  assert.equal(row.fingerprint.length,64);healthy();
`));

test('invalid secrets, inactive and unknown keys refuse without silently becoming ordinary',()=>child(`
  store.save('key-A',0,{weekly:null,monthly:'100'});
  assert.throws(()=>store.resolve('invalid'));
  assert.throws(()=>store.resolve('fake-secret-A'+String.fromCharCode(0)));
  db.run('UPDATE apiKeys SET isActive=0 WHERE id=?',['key-A']);
  assert.throws(()=>store.resolve('fake-secret-A'));
  assert.throws(()=>store.save('key-A',1,{weekly:null,monthly:null}));healthy();
`));

test('unexpected secret replacement on same stable ID quarantines instead of resetting policy or spend',()=>child(`
  store.save('key-A',0,{weekly:'123',monthly:'456'});
  db.run('UPDATE apiKeys SET key=? WHERE id=?',['replacement','key-A']);
  assert.throws(()=>store.resolve('replacement'));assert.throws(healthy);
  assert.equal(db.get('SELECT monthly FROM accounting_key_policy_v1').monthly,'456');
  assert.throws(()=>store.save('key-A',1,{weekly:null,monthly:null}));
`));

test('existing-binding audit covers all pages including disabled keys without mutation or secret output',()=>child(`
  assert.deepEqual(store.validateExistingBindings(),{validatedBindings:0});
  for(let i=0;i<7;i++){
    const key='page-'+i;db.run('INSERT INTO apiKeys VALUES(?,?,1)',[key,'private-'+i]);
    store.save(key,0,{weekly:'123',monthly:null});
  }
  db.run('UPDATE apiKeys SET isActive=0 WHERE id=?',['page-5']);
  const before=db.all('SELECT * FROM accounting_key_policy_v1 ORDER BY key_id');
  const changes=db.get('SELECT total_changes() AS n').n;
  const audit=store.validateExistingBindings();assert.deepEqual(audit,{validatedBindings:7});assert.equal(Object.isFrozen(audit),true);
  assert.equal(db.get('SELECT total_changes() AS n').n,changes);
  assert.deepEqual(db.all('SELECT * FROM accounting_key_policy_v1 ORDER BY key_id'),before);healthy();
`));

for(const corrupt of ['fingerprint','limit','orphan','retired'])test('existing-binding audit refuses hidden unrelated '+corrupt+' corruption',()=>child(`
  store.save('key-A',0,{weekly:null,monthly:'10'});store.save('key-B',0,{weekly:null,monthly:'20'});
  const mode=${JSON.stringify(corrupt)};
  if(mode==='fingerprint')db.run('UPDATE accounting_key_policy_v1 SET fingerprint=? WHERE key_id=?',['bad','key-B']);
  if(mode==='limit')db.run('UPDATE accounting_key_policy_v1 SET monthly=? WHERE key_id=?',['1.1','key-B']);
  if(mode==='orphan')db.run('DELETE FROM apiKeys WHERE id=?',['key-B']);
  if(mode==='retired')db.run('UPDATE accounting_key_policy_v1 SET retired=1 WHERE key_id=?',['key-B']);
  // Addressed key A alone is valid; audit must not ignore stored key B.
  assert.equal(store.resolve('fake-secret-A').limits.monthly,'10');
  assert.throws(()=>store.validateExistingBindings());assert.throws(healthy);
  assert.equal(db.get('SELECT monthly FROM accounting_key_policy_v1 WHERE key_id=?',['key-A']).monthly,'10');
`));

test('authorized internal rotation preserves stable policy and every revoked fingerprint without returning secrets',()=>child(`
  store.save('key-A',0,{weekly:'123',monthly:'456'});
  const rotated=store.rotate('key-A',1,'fake-secret-A','new-private-A');
  assert.deepEqual(rotated,{keyId:'key-A',bindingGeneration:'2',version:2,limits:{weekly:'123',monthly:'456'}});
  assert.equal(JSON.stringify(rotated).includes('private'),false);
  assert.throws(()=>store.resolve('fake-secret-A'));
  assert.equal(store.resolve('new-private-A').bindingGeneration,'2');
  assert.throws(()=>store.current('new-private-A',{keyId:'key-A',bindingGeneration:'1'}));
  assert.deepEqual(db.all('SELECT generation,retired FROM accounting_key_generations_v1 ORDER BY generation').map(row=>({...row})),[{generation:1,retired:1},{generation:2,retired:0}]);
  assert.throws(()=>store.rotate('key-A',1,'new-private-A','third'),e=>e.status===409);
  assert.throws(()=>store.rotate('key-A',2,'fake-secret-A','third'),e=>e.status===409);
  assert.throws(()=>store.rotate('key-A',2,'new-private-A','fake-secret-A'),e=>e.status===409);
  assert.throws(()=>store.rotate('key-A',2,'new-private-A','fake-secret-B'),e=>e.status===409);
  store.save('key-B',0,{weekly:null,monthly:null});
  assert.throws(()=>store.rotate('key-B',1,'fake-secret-B','fake-secret-A'),e=>e.status===409);
  assert.deepEqual(store.validateExistingBindings(),{validatedBindings:2});healthy();
`));

test('two SQLite connections cannot both rotate the same key version',()=>child(`
  store.save('key-A',0,{weekly:'123',monthly:'456'});
  const peerDb=await createNodeSqliteAdapter(db.get('PRAGMA database_list').file);
  try {
    const peer=policy(peerDb);
    const pending=peer.inspect('key-A');
    const winner=store.rotate('key-A',pending.version,'fake-secret-A','replacement-A');
    assert.throws(()=>peer.rotate('key-A',pending.version,'fake-secret-A','replacement-B'),{status:409});
    assert.deepEqual(peer.resolve('replacement-A'),winner);
    assert.throws(()=>peer.resolve('replacement-B'));
    assert.throws(()=>peer.resolve('fake-secret-A'));
    assert.equal(peerDb.get('SELECT COUNT(*) AS n FROM accounting_key_generations_v1 WHERE key_id=?',['key-A']).n,2);
    healthy();
  } finally { peerDb.close(); }
`));

test('generation validation covers multiple pages and disabled current key without mutating history',()=>child(`
  store.save('key-A',0,{weekly:'123',monthly:null});let secret='fake-secret-A';
  for(let generation=1;generation<8;generation++){
    const next='generation-private-'+(generation+1);
    assert.equal(store.rotate('key-A',generation,secret,next).bindingGeneration,String(generation+1));secret=next;
  }
  db.run('UPDATE apiKeys SET isActive=0 WHERE id=?',['key-A']);
  const changes=db.get('SELECT total_changes() AS n').n;
  assert.deepEqual(store.validateExistingBindings(),{validatedBindings:1});
  assert.equal(db.get('SELECT total_changes() AS n').n,changes);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM accounting_key_generations_v1').n,8);
  assert.throws(()=>store.resolve(secret));healthy();
`));

test('retirement retains identity generations and policy while rejecting new admission and ID reuse',()=>child(`
  store.save('key-A',0,{weekly:'123',monthly:'456'});
  store.rotate('key-A',1,'fake-secret-A','new-private-A');
  assert.deepEqual(store.retire('key-A',2),{retired:true});
  assert.equal(db.get('SELECT isActive FROM apiKeys WHERE id=?',['key-A']).isActive,0);
  assert.deepEqual(store.validateExistingBindings(),{validatedBindings:1});
  assert.throws(()=>store.resolve('new-private-A'));healthy();
  assert.equal(db.get('SELECT monthly FROM accounting_key_policy_v1').monthly,'456');
  assert.equal(db.get('SELECT COUNT(*) AS n FROM accounting_key_generations_v1 WHERE retired=1').n,2);
  assert.throws(()=>store.save('key-A',0,{weekly:null,monthly:null}));
  db.run('UPDATE apiKeys SET isActive=1 WHERE id=?',['key-A']);
  assert.throws(()=>store.resolve('new-private-A'));assert.throws(healthy);
`));

for(const mode of ['missing','gap','zero','orphan','current-fingerprint'])test('generation history audit refuses '+mode+' corruption',()=>child(`
  store.save('key-A',0,{weekly:null,monthly:'10'});
  store.rotate('key-A',1,'fake-secret-A','new-private-A');
  const mode=${JSON.stringify(mode)};
  if(mode==='missing')db.run('DELETE FROM accounting_key_generations_v1 WHERE generation=1');
  if(mode==='gap')db.run('UPDATE accounting_key_generations_v1 SET generation=3 WHERE generation=1');
  if(mode==='zero')db.run('UPDATE accounting_key_generations_v1 SET generation=0 WHERE generation=1');
  if(mode==='current-fingerprint')db.run('UPDATE accounting_key_generations_v1 SET fingerprint=? WHERE generation=2',['a'.repeat(64)]);
  if(mode==='orphan'){db.exec('PRAGMA foreign_keys=OFF');db.run('INSERT INTO accounting_key_generations_v1 VALUES(?,?,?,?)',['missing',1,'b'.repeat(64),0]);}
  assert.throws(()=>store.validateExistingBindings());assert.throws(healthy);
`));

for(const mode of ['empty-id','version-before-generation','retired-version'])test('whole binding audit rejects hidden '+mode+' lifecycle inconsistency',()=>child(`
  store.save('key-A',0,{weekly:null,monthly:'10'});
  const mode=${JSON.stringify(mode)};
  if(mode==='empty-id'){
    // Linked policy/history pair is not an orphan, but positive pagination
    // starting at '' must not silently omit it. Never use the public ID parser
    // to manufacture the malformed fixture.
    db.exec('PRAGMA foreign_keys=OFF');
    db.run('UPDATE apiKeys SET id=? WHERE id=?',['','key-A']);
    db.run('UPDATE accounting_key_policy_v1 SET key_id=? WHERE key_id=?',['','key-A']);
    db.run('UPDATE accounting_key_generations_v1 SET key_id=? WHERE key_id=?',['','key-A']);
  }else{
    store.rotate('key-A',1,'fake-secret-A','new-private-A');
    if(mode==='retired-version')store.retire('key-A',2);
    db.run('UPDATE accounting_key_policy_v1 SET version=? WHERE key_id=?',[mode==='retired-version'?2:1,'key-A']);
  }
  const before=db.all('SELECT * FROM accounting_key_policy_v1');
  const changes=db.get('SELECT total_changes() AS n').n;
  assert.throws(()=>store.validateExistingBindings());assert.throws(healthy);
  assert.equal(db.get('SELECT total_changes() AS n').n,changes);
  assert.deepEqual(db.all('SELECT * FROM accounting_key_policy_v1'),before);
`));

for(const mode of ['rotation-sql','rotation-commit','retire-sql'])test('lifecycle '+mode+' fault keeps atomic facts and faults without replacement authority',()=>child(`
  store.save('key-A',0,{weekly:'123',monthly:'456'});
  const beforeKey=db.get('SELECT * FROM apiKeys WHERE id=?',['key-A']);
  const beforePolicy=db.get('SELECT * FROM accounting_key_policy_v1');
  const beforeHistory=db.all('SELECT * FROM accounting_key_generations_v1');
  const mode=${JSON.stringify(mode)};const actualRun=db.run;const actualExec=db.exec;let injected=false;let armed=false;
  db.run=(sql,params)=>{if(armed&&!injected&&((mode==='rotation-sql'&&sql.startsWith('INSERT INTO accounting_key_generations'))||(mode==='retire-sql'&&sql.startsWith('UPDATE apiKeys SET isActive')))){injected=true;throw new Error('private lifecycle failure');}return actualRun(sql,params);};
  db.exec=sql=>{if(armed&&!injected&&mode==='rotation-commit'&&sql==='COMMIT'){actualExec(sql);injected=true;throw new Error('private ambiguous commit');}return actualExec(sql);};
  // Existing outer owner captures adapter methods at construction. Inject before
  // constructing this store, arm only AFTER its schema transaction completes.
  const guarded=policy(db);armed=true;
  assert.throws(()=>mode==='retire-sql'?guarded.retire('key-A',1):guarded.rotate('key-A',1,'fake-secret-A','new-private-A'));
  db.run=actualRun;db.exec=actualExec;assert.equal(injected,true);assert.throws(healthy);
  if(mode==='rotation-commit'){
    assert.equal(db.get('SELECT key FROM apiKeys WHERE id=?',['key-A']).key,'new-private-A');
    assert.equal(db.get('SELECT generation FROM accounting_key_policy_v1').generation,2);
    assert.equal(db.get('SELECT COUNT(*) AS n FROM accounting_key_generations_v1').n,2);
  }else{
    assert.deepEqual(db.get('SELECT * FROM apiKeys WHERE id=?',['key-A']),beforeKey);
    assert.deepEqual(db.get('SELECT * FROM accounting_key_policy_v1'),beforePolicy);
    assert.deepEqual(db.all('SELECT * FROM accounting_key_generations_v1'),beforeHistory);
  }
  assert.throws(()=>store.rotate('key-A',1,'fake-secret-A','other'));
  assert.equal(db.raw.isTransaction,false);assert.equal(db.get('PRAGMA synchronous').synchronous,1);
`));

test('old retained attempts settle after rotation and retirement and stable-key totals include all generations',()=>child(`
  const {initializeNodeAttemptLedger,createNodeAttemptLedger}=await import('/app/src/lib/accounting/node-attempt-ledger.js');
  const {EXCLUSIVE_USAGE}=await import('/app/src/lib/accounting/terminal-cost.js');
  initializeNodeAttemptLedger(db);const ledger=createNodeAttemptLedger(db);
  store.save('key-A',0,{weekly:'2000',monthly:'2000'});
  const now='2026-11-16T10:00:00.000Z';
  const command=(attemptId,bindingGeneration)=>({attemptId,keyId:'key-A',bindingGeneration,startedAt:now,provider:'fixture',model:'fixture',price:{currency:'USD',unit:'USD/1M tokens',revision:'original',rates:{input:'1',output:'2'}}});
  const first=ledger.prepare(command('generation-one','1'));
  store.rotate('key-A',1,'fake-secret-A','new-private-A');
  const second=ledger.prepare(command('generation-two','2'));
  store.retire('key-A',2);
  const usage={semantics:EXCLUSIVE_USAGE,components:[{category:'input',count:1,unit:'USD/1M tokens'},{category:'output',count:0,unit:'USD/1M tokens'}]};
  first.settle(usage);second.settle(usage);
  assert.deepEqual(ledger.totals('key-A',now),{weekly:'2000',monthly:'2000',unknown:0});
  assert.deepEqual(first.settle(usage),{recorded:true,replay:true});
  assert.deepEqual(ledger.prepare(command('generation-one','1')),{replay:true});
  assert.deepEqual(store.validateExistingBindings(),{validatedBindings:1});healthy();
  // Ledger is still an internal primitive, NOT a current-auth admission gate.
  // Final coherent policy/ACL checks remain unimplemented; don't test fake rights.
`));

test('administrative retirement events page completely without secrets or permission revival',()=>child(`
  for(let i=0;i<7;i++){
    const key='event-'+i;db.run('INSERT INTO apiKeys VALUES(?,?,1)',[key,'private-'+i]);
    store.save(key,0,{weekly:'123',monthly:'456'});store.retireAudited(key,1);
  }
  assert.equal(db.get('SELECT COUNT(*) AS n FROM accounting_admin_events_v1').n,7);
  const before=db.all('SELECT * FROM accounting_admin_events_v1 ORDER BY key_id');
  assert.equal(JSON.stringify(before).includes('private'),false);
  assert.deepEqual(store.validateExistingBindings(),{validatedBindings:7});
  assert.deepEqual(db.all('SELECT * FROM accounting_admin_events_v1 ORDER BY key_id'),before);healthy();
`));

for(const mode of ['timestamp','version','generation','orphan','empty-id','nontext-id','duplicate'])test('administrative event integrity '+mode+' cannot grant lifecycle authority',()=>child(`
  store.save('key-A',0,{weekly:'123',monthly:'456'});store.retireAudited('key-A',1);
  const mode=${JSON.stringify(mode)};
  if(mode==='timestamp')db.run('UPDATE accounting_admin_events_v1 SET occurred_at=?',['invalid']);
  if(mode==='version')db.run('UPDATE accounting_admin_events_v1 SET previous_version=2');
  if(mode==='generation')db.run('UPDATE accounting_admin_events_v1 SET generation=2');
  if(['orphan','empty-id','nontext-id'].includes(mode)){
    db.exec('PRAGMA foreign_keys=OFF');
    if(mode==='nontext-id')db.exec("UPDATE accounting_admin_events_v1 SET key_id=x'00'");
    else db.run('UPDATE accounting_admin_events_v1 SET key_id=?',[mode==='orphan'?'absent':'']);
  }
  if(mode==='duplicate'){
    assert.throws(()=>db.run('INSERT INTO accounting_admin_events_v1 SELECT * FROM accounting_admin_events_v1'));
    assert.equal(db.get('SELECT COUNT(*) AS n FROM accounting_admin_events_v1').n,1);
    assert.deepEqual(store.validateExistingBindings(),{validatedBindings:1});healthy();
  }else{assert.throws(()=>store.validateExistingBindings());assert.throws(healthy);}
`));

test('budget strings reject floats, numeric values, negative, unknown fields and stale CAS',()=>child(`
  for(const limits of [{weekly:0,monthly:null},{weekly:'-1',monthly:null},{weekly:'1.1',monthly:null},
    {weekly:null,monthly:null,extra:true}])assert.throws(()=>store.save('key-A',0,limits));
  assert.equal(db.get('SELECT COUNT(*) AS n FROM accounting_key_policy_v1').n,0);
  assert.throws(()=>store.save('key-A',-1,{weekly:null,monthly:null}));healthy();
`));
