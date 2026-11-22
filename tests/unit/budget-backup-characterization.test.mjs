import fs from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {createNodeSqliteAdapter} from '../../src/lib/db/adapters/nodeSqliteAdapter.js';
import {initializeNodeKeyPolicy,createNodeKeyPolicy} from '../../src/lib/accounting/node-key-policy.js';
import {initializeNodeAttemptLedger,createNodeAttemptLedger} from '../../src/lib/accounting/node-attempt-ledger.js';
import {EXCLUSIVE_USAGE} from '../../src/lib/accounting/terminal-cost.js';
import {backupDbLite} from '../../src/lib/db/backup.js';
assert.equal(process.env.BUDGET_DRIVER_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
let sequence=0;
async function fixture(run){
 const dir='/tmp/backup-'+(++sequence);fs.mkdirSync(dir);
 const db=await createNodeSqliteAdapter(dir+'/source.sqlite');
 try{
 db.exec('CREATE TABLE apiKeys(id TEXT PRIMARY KEY,key TEXT UNIQUE NOT NULL,isActive INTEGER NOT NULL)');
 db.run('INSERT INTO apiKeys VALUES(?,?,1)',['key-A','fixture-secret']);
 db.exec('CREATE TABLE requestDetails(id TEXT PRIMARY KEY,data TEXT)');
 db.run('INSERT INTO requestDetails VALUES(?,?)',['omit','fixture-log']);
 initializeNodeKeyPolicy(db);createNodeKeyPolicy(db).save('key-A',0,{weekly:'10000000',monthly:'20000000'});
 initializeNodeAttemptLedger(db);
 const ledger=createNodeAttemptLedger(db);const now='2026-11-16T10:00:00.000Z';
 ledger.prepare({attemptId:'a',keyId:'key-A',bindingGeneration:'1',provider:'fixture',model:'fixture',startedAt:now,
 price:{currency:'USD',unit:'USD/1M tokens',revision:'fixture',rates:{input:'1',output:'2'}}}).settle(null);
 await run(db,dir);
 }finally{db.close();}
}

test('actual lightweight backup preserves current accounting schema rows and intrinsic constraints, excluding only requestDetails',()=>fixture(async(db,dir)=>{
 const copied=backupDbLite(db,dir,'copied.sqlite');const copy=new DatabaseSync(copied);
 try{
 for(const table of ['apiKeys','accounting_key_policy_v1','accounting_attempts_v1','accounting_terminals_v1']){
  assert.deepEqual(copy.prepare('SELECT * FROM '+table).all(),db.all('SELECT * FROM '+table));
  assert.equal(copy.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(table).sql,db.get('SELECT sql FROM sqlite_schema WHERE name=?',[table]).sql);
 }
 assert.equal(copy.prepare("SELECT name FROM sqlite_schema WHERE name='requestDetails'").get(),undefined);
 assert.equal(copy.prepare('PRAGMA foreign_key_check').all().length,0);
 assert.throws(()=>copy.prepare('INSERT INTO accounting_key_policy_v1 SELECT * FROM accounting_key_policy_v1').run());
 assert.equal(copy.prepare('SELECT amount FROM accounting_terminals_v1').get().amount,'0');
 assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 }finally{copy.close();}
}));

test('retired identity generation history and administrative event survive actual lightweight copy without new rights',()=>fixture(async(db,dir)=>{
 const policy=createNodeKeyPolicy(db);policy.rotate('key-A',1,'fixture-secret','fixture-replacement');policy.retireAudited('key-A',2);
 const tables=['apiKeys','accounting_key_policy_v1','accounting_key_generations_v1','accounting_admin_events_v1','accounting_attempts_v1','accounting_terminals_v1'];
 const before=tables.map(table=>db.all('SELECT * FROM '+table));
 const destination=backupDbLite(db,dir,'retired.sqlite');
 const copy=await createNodeSqliteAdapter(destination);
 try{
  for(let i=0;i<tables.length;i++){
   const table=tables[i];assert.deepEqual(copy.all('SELECT * FROM '+table),before[i]);
   assert.equal(copy.get('SELECT sql FROM sqlite_schema WHERE name=?',[table]).sql,db.get('SELECT sql FROM sqlite_schema WHERE name=?',[table]).sql);
  }
  const copiedPolicy=createNodeKeyPolicy(copy);
  assert.deepEqual(copiedPolicy.validateExistingBindings(),{validatedBindings:1});
  assert.deepEqual(copiedPolicy.inspect('key-A'),{keyId:'key-A',bindingGeneration:'2',version:3,limits:{weekly:'10000000',monthly:'20000000'},lifecycle:'retired'});
  assert.throws(()=>copiedPolicy.resolve('fixture-replacement'));
  assert.deepEqual(createNodeAttemptLedger(copy).validateExistingAttempts(),{validatedAttempts:1,validatedTerminals:1});
  assert.equal(copy.get('SELECT COUNT(*) AS n FROM accounting_admin_events_v1').n,1);
  assert.equal(copy.all('PRAGMA foreign_key_check').length,0);
  assert.throws(()=>copy.run('INSERT INTO accounting_admin_events_v1 SELECT * FROM accounting_admin_events_v1'));
  assert.throws(()=>copy.run('DELETE FROM accounting_key_policy_v1 WHERE key_id=?',['key-A']));
  assert.equal(copy.get('PRAGMA integrity_check').integrity_check,'ok');
  assert.deepEqual(tables.map(table=>db.all('SELECT * FROM '+table)),before);
 }finally{copy.close();}
}));

test('restoring an older standalone snapshot enforces its saved policy and recorded spend', () => fixture(async (db, dir) => {
  const now = '2026-11-16T10:00:00.000Z';
  const context = { presentedSecret: 'fixture-secret', now };
  const original = id => ({
    attemptId: id, keyId: 'key-A', bindingGeneration: '1', provider: 'fixture', model: 'fixture', startedAt: now,
    price: { currency: 'USD', unit: 'USD/1M tokens', revision: 'fixture', rates: { input: '1', output: '2' } },
  });
  const evidence = {
    semantics: EXCLUSIVE_USAGE,
    components: [{ category: 'input', count: 3000, unit: 'USD/1M tokens' }],
  };
  const sourcePolicy = createNodeKeyPolicy(db);
  const sourceLedger = createNodeAttemptLedger(db);
  let posts = 0;
  function charge(id) {
    const attempt = sourceLedger.prepare(original(id));
    sourceLedger.dispatch(attempt.ack, context, () => posts++);
    attempt.settle(evidence);
  }

  sourcePolicy.save('key-A', 1, { weekly: null, monthly: '3000000' });
  charge('before-backup');
  const policyAtBackup = sourcePolicy.inspect('key-A');
  const totalsAtBackup = sourceLedger.totals('key-A', now);
  assert.equal(totalsAtBackup.monthly, '3000000');
  const snapshot = backupDbLite(db, dir, 'backup.sqlite');

  sourcePolicy.save('key-A', policyAtBackup.version, { weekly: null, monthly: '6000000' });
  charge('after-backup');
  assert.equal(posts, 2);
  assert.equal(sourceLedger.totals('key-A', now).monthly, '6000000');

  const restoredPath = dir + '/restored.sqlite';
  fs.copyFileSync(snapshot, restoredPath, fs.constants.COPYFILE_EXCL);
  const restored = await createNodeSqliteAdapter(restoredPath);
  try {
    const policy = createNodeKeyPolicy(restored);
    const ledger = createNodeAttemptLedger(restored);
    assert.deepEqual(policy.inspect('key-A'), policyAtBackup);
    assert.deepEqual(ledger.validateExistingAttempts(), { validatedAttempts: 2, validatedTerminals: 2 });
    assert.deepEqual(ledger.totals('key-A', now), totalsAtBackup);
    const next = ledger.prepare(original('after-restore'));
    assert.throws(() => ledger.dispatch(next.ack, context, () => posts++));
    assert.equal(posts, 2);
    assert.deepEqual(ledger.validateExistingAttempts(), { validatedAttempts: 3, validatedTerminals: 2 });
    assert.deepEqual(ledger.totals('key-A', now), totalsAtBackup);
    assert.deepEqual(restored.all('PRAGMA foreign_key_check'), []);
    assert.equal(restored.get('PRAGMA integrity_check').integrity_check, 'ok');
  } finally {
    restored.close();
  }
  assert.equal(sourcePolicy.inspect('key-A').limits.monthly, '6000000');
  assert.equal(sourceLedger.totals('key-A', now).monthly, '6000000');
}));

test('administrative event copy failure rejects artifact completion and preserves original retirement facts',()=>fixture(async(db,dir)=>{
 createNodeKeyPolicy(db).retireAudited('key-A',1);
 const tables=['apiKeys','accounting_key_policy_v1','accounting_key_generations_v1','accounting_admin_events_v1'];
 const before=tables.map(table=>db.all('SELECT * FROM '+table));const exec=db.exec;let hit=0;
 db.exec=sql=>{if(sql.startsWith('INSERT INTO bak."accounting_admin_events_v1"')){hit++;throw new Error('fixture-event-copy-fault');}return exec(sql);};
 try{assert.throws(()=>backupDbLite(db,dir,'event-fault.sqlite'),/fixture-event-copy-fault/);}finally{db.exec=exec;}
 assert.equal(hit,1);assert.deepEqual(tables.map(table=>db.all('SELECT * FROM '+table)),before);
 assert.equal(db.all('PRAGMA database_list').some(row=>row.name==='bak'),false);
 const copy=new DatabaseSync(dir+'/event-fault.sqlite');
 try{assert.equal(copy.prepare("SELECT name FROM sqlite_schema WHERE name='accounting_admin_events_v1'").get(),undefined);}finally{copy.close();}
}));

test('inventory and rows share one read snapshot despite a concurrent committed writer',()=>fixture(async(db,dir)=>{
 const writer=new DatabaseSync(dir+'/source.sqlite');const all=db.all;
 let injected=false;
 db.all=(sql,params)=>{
  const rows=all(sql,params);
  if(sql.includes('FROM main.sqlite_master')&&!injected){
   injected=true;
   assert.equal(db.raw.isTransaction,true);
   // Separate connection, actual WAL commit after inventory but before copies.
   writer.exec("BEGIN IMMEDIATE; UPDATE apiKeys SET isActive=0 WHERE id='key-A'; CREATE TABLE later_table(id TEXT PRIMARY KEY); INSERT INTO later_table VALUES('new'); COMMIT");
  }
  return rows;
 };
 let copied;
 try{copied=backupDbLite(db,dir,'snapshot.sqlite');}finally{db.all=all;writer.close();}
 const copy=new DatabaseSync(copied);
 try{
  assert.equal(injected,true);assert.equal(db.get('SELECT isActive FROM apiKeys').isActive,0);
  assert.ok(db.get("SELECT name FROM sqlite_schema WHERE name='later_table'"));
  assert.equal(copy.prepare('SELECT isActive FROM apiKeys').get().isActive,1);
  assert.equal(copy.prepare("SELECT name FROM sqlite_schema WHERE name='later_table'").get(),undefined);
  assert.deepEqual(copy.prepare('SELECT * FROM accounting_terminals_v1').all(),db.all('SELECT * FROM accounting_terminals_v1'));
  assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 }finally{copy.close();}
}));

test('explicit ordinary unique partial expression and quoted indexes retain definitions and enforcement, excluding requestDetails indexes',()=>fixture(async(db,dir)=>{
 db.exec('CREATE INDEX fixture_explicit_index ON accounting_attempts_v1(key_id)');
 db.exec('CREATE UNIQUE INDEX "fixture ""unique" ON apiKeys(isActive)');
 db.exec('CREATE INDEX `fixture``expression` ON apiKeys(lower(key)) WHERE isActive=1');
 db.exec('CREATE INDEX [fixture bracket] ON apiKeys(key DESC)');
 db.exec('CREATE INDEX omitted_log_index ON requestDetails(id)');
 const copy=new DatabaseSync(backupDbLite(db,dir,'index-copy.sqlite'));
 try{
  const expected=db.all("SELECT name,sql FROM sqlite_schema WHERE type='index' AND sql IS NOT NULL AND tbl_name!='requestDetails' ORDER BY name");
  assert.deepEqual(copy.prepare("SELECT name,sql FROM sqlite_schema WHERE type='index' AND sql IS NOT NULL ORDER BY name").all(),expected);
  assert.throws(()=>copy.prepare('INSERT INTO apiKeys VALUES(?,?,1)').run('other','different'));
  assert.equal(copy.prepare("SELECT name FROM sqlite_schema WHERE name='omitted_log_index'").get(),undefined);
  assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 }finally{copy.close();}
}));

test('index recreation fault refuses completion rolls back and does not mutate original schema or facts',()=>fixture(async(db,dir)=>{
 db.exec('CREATE INDEX fixture_fault ON apiKeys(key)');const exec=db.exec;const before=db.all('SELECT * FROM apiKeys');
 db.exec=sql=>{if(sql.startsWith('CREATE INDEX bak.fixture_fault'))throw new Error('fixture-index-fault');return exec(sql);};
 try{assert.throws(()=>backupDbLite(db,dir,'index-fault.sqlite'),/fixture-index-fault/);}finally{db.exec=exec;}
 assert.deepEqual(db.all('SELECT * FROM apiKeys'),before);assert.ok(db.get("SELECT name FROM sqlite_schema WHERE name='fixture_fault'"));
 assert.equal(db.all('PRAGMA database_list').some(row=>row.name==='bak'),false);
 const copy=new DatabaseSync(dir+'/index-fault.sqlite');
 try{assert.equal(copy.prepare("SELECT name FROM sqlite_schema WHERE name='apiKeys'").get(),undefined);}finally{copy.close();}
}));

test('unrecognized or mismatched index declaration refuses rather than silently losing an index',()=>fixture(async(db,dir)=>{
 db.exec('CREATE INDEX fixture_validate ON apiKeys(key)');const all=db.all;
 for(const sql of ['CREATE INDEX other_name ON apiKeys(key)','CREATE INDEX IF NOT EXISTS fixture_validate ON apiKeys(key)']){
  db.all=(query,params)=>all(query,params).map(row=>row.name==='fixture_validate'?{...row,sql}:row);
  try{assert.throws(()=>backupDbLite(db,dir,'unsupported.sqlite'),/Unsupported backup index/);}finally{db.all=all;}
  assert.equal(db.all('PRAGMA database_list').some(row=>row.name==='bak'),false);
  assert.ok(db.get("SELECT name FROM sqlite_schema WHERE name='fixture_validate'"));
 }
}));

test('AUTOINCREMENT preserves deleted high-water empty tables and signed64 precision while excluding log sequences',()=>fixture(async(db,dir)=>{
 db.exec("CREATE TABLE auto_rows(id INTEGER PRIMARY KEY AUTOINCREMENT,value TEXT); INSERT INTO auto_rows VALUES(9007199254740997,'deleted'); DELETE FROM auto_rows");
 db.exec("CREATE TABLE auto_survivor(id INTEGER PRIMARY KEY AUTOINCREMENT,value TEXT); INSERT INTO auto_survivor VALUES(1,'kept'); INSERT INTO auto_survivor VALUES(90,'deleted'); DELETE FROM auto_survivor WHERE id=90");
 db.exec("DROP TABLE requestDetails; CREATE TABLE requestDetails(id INTEGER PRIMARY KEY AUTOINCREMENT,data TEXT); INSERT INTO requestDetails VALUES(900,'omitted')");
 const before=db.all('SELECT name, CAST(seq AS TEXT) AS seq FROM sqlite_sequence ORDER BY name');
 const copy=new DatabaseSync(backupDbLite(db,dir,'sequence.sqlite'));
 try{
  assert.deepEqual(copy.prepare('SELECT name, CAST(seq AS TEXT) AS seq FROM sqlite_sequence ORDER BY name').all(),before.filter(row=>row.name!=='requestDetails'));
  copy.exec("INSERT INTO auto_rows(value) VALUES('next'); INSERT INTO auto_survivor(value) VALUES('next')");
  assert.equal(copy.prepare('SELECT CAST(id AS TEXT) AS id FROM auto_rows').get().id,'9007199254740998');
  assert.equal(copy.prepare('SELECT MAX(id) AS id FROM auto_survivor').get().id,91);
  assert.deepEqual(db.all('SELECT name, CAST(seq AS TEXT) AS seq FROM sqlite_sequence ORDER BY name'),before);
  assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 }finally{copy.close();}
}));

test('sequence-copy failure rolls back and preserves original exact sequence',()=>fixture(async(db,dir)=>{
 db.exec('CREATE TABLE auto_fault(id INTEGER PRIMARY KEY AUTOINCREMENT); INSERT INTO auto_fault VALUES(99); DELETE FROM auto_fault');
 const exec=db.exec;const before=db.all('SELECT name, CAST(seq AS TEXT) AS seq FROM sqlite_sequence');
 db.exec=sql=>{if(sql.startsWith('INSERT INTO bak.sqlite_sequence'))throw new Error('fixture-sequence-fault');return exec(sql);};
 try{assert.throws(()=>backupDbLite(db,dir,'sequence-fault.sqlite'),/fixture-sequence-fault/);}finally{db.exec=exec;}
 assert.deepEqual(db.all('SELECT name, CAST(seq AS TEXT) AS seq FROM sqlite_sequence'),before);
 assert.equal(db.all('PRAGMA database_list').some(row=>row.name==='bak'),false);
 const copy=new DatabaseSync(dir+'/sequence-fault.sqlite');
 try{assert.equal(copy.prepare("SELECT name FROM sqlite_schema WHERE name='apiKeys'").get(),undefined);}finally{copy.close();}
}));

test('writable column copy preserves generated stored virtual columns and quoted table column names',()=>fixture(async(db,dir)=>{
 db.exec('CREATE TABLE "odd ""table" ("id key" INTEGER PRIMARY KEY,"input ""value" INTEGER, doubled INTEGER GENERATED ALWAYS AS ("input ""value"*2) STORED, description TEXT GENERATED ALWAYS AS (\'n=\'||"input ""value") VIRTUAL)');
 db.exec('INSERT INTO "odd ""table" ("id key","input ""value") VALUES(7,21)');
 db.exec('CREATE INDEX "generated index" ON "odd ""table"(doubled)');
 const copy=new DatabaseSync(backupDbLite(db,dir,'generated.sqlite'));
 try{
  assert.deepEqual(copy.prepare('SELECT * FROM "odd ""table"').all(),db.all('SELECT * FROM "odd ""table"'));
  copy.exec('UPDATE "odd ""table" SET "input ""value"=22 WHERE "id key"=7');
  assert.equal(copy.prepare('SELECT doubled FROM "odd ""table"').get().doubled,44);
  assert.equal(copy.prepare('SELECT description FROM "odd ""table"').get().description,'n=22');
  assert.equal(db.get('SELECT doubled FROM "odd ""table"').doubled,42);
  assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 }finally{copy.close();}
}));

test('unknown column metadata refuses rather than silently omitting writable data',()=>fixture(async(db,dir)=>{
 const all=db.all;db.all=(sql,params)=>sql.startsWith('PRAGMA main.table_xinfo')?[{name:'id',hidden:1}]:all(sql,params);
 try{assert.throws(()=>backupDbLite(db,dir,'columns-fault.sqlite'),/Unsupported backup table columns/);}finally{db.all=all;}
 assert.equal(db.all('PRAGMA database_list').some(row=>row.name==='bak'),false);
 assert.equal(db.get('SELECT COUNT(*) AS count FROM apiKeys').count,1);
}));

test('detach failure cannot report success or delete an attachment on a subsequent attempt',()=>fixture(async(db,dir)=>{
 const exec=db.exec;const detach=new Error('fixture-detach');
 db.exec=sql=>{if(sql==='DETACH DATABASE bak')throw detach;return exec(sql);};
 try{
  assert.throws(()=>backupDbLite(db,dir,'attached.sqlite'),error=>error===detach);
  assert.equal(db.all('PRAGMA database_list').some(row=>row.name==='bak'),true);
  const bytes=fs.readFileSync(dir+'/attached.sqlite');
  assert.throws(()=>backupDbLite(db,dir,'attached.sqlite'),/Backup attachment unavailable/);
  assert.deepEqual(fs.readFileSync(dir+'/attached.sqlite'),bytes);
  assert.equal(db.get('SELECT COUNT(*) AS count FROM bak.apiKeys').count,1);
 }finally{db.exec=exec;exec('DETACH DATABASE bak');}
 assert.equal(db.get('SELECT COUNT(*) AS count FROM apiKeys').count,1);
}));

test('simultaneous copy and detach failures preserve exact primary and sanitized cleanup warning',()=>fixture(async(db,dir)=>{
 const exec=db.exec;const warn=console.warn;const primary=new Error('fixture-primary');const warnings=[];
 console.warn=(...args)=>warnings.push(args);
 db.exec=sql=>{if(sql==='DETACH DATABASE bak')throw new Error('private detach SQL/path');if(sql.startsWith('INSERT INTO bak."accounting_terminals_v1"'))throw primary;return exec(sql);};
 try{
  assert.throws(()=>backupDbLite(db,dir,'double-fault.sqlite'),error=>error===primary);
  assert.deepEqual(warnings,[['[DB][backup] detach failed after copy failure; attachment retained']]);
  assert.equal(db.all('PRAGMA database_list').some(row=>row.name==='bak'),true);
  assert.equal(db.get('SELECT COUNT(*) AS count FROM accounting_terminals_v1').count,1);
 }finally{db.exec=exec;console.warn=warn;exec('DETACH DATABASE bak');}
}));

test('copy SQL fault propagates, rolls back copied rows, detaches file and leaves original accounting facts unchanged',()=>fixture(async(db,dir)=>{
 const original=db.exec;const before=db.all('SELECT * FROM accounting_terminals_v1');
 db.exec=(sql)=>{if(sql.startsWith('INSERT INTO bak."accounting_terminals_v1"'))throw new Error('fixture-copy-fault');return original(sql);};
 try{assert.throws(()=>backupDbLite(db,dir,'failed.sqlite'),/fixture-copy-fault/);}finally{db.exec=original;}
 assert.deepEqual(db.all('SELECT * FROM accounting_terminals_v1'),before);
 assert.equal(db.all('PRAGMA database_list').some(row=>row.name==='bak'),false);
 // Failure is not a valid restore artifact; partial/empty destination file may
 // remain. Production lifecycle must never infer completion from file existence.
 assert.equal(fs.existsSync(dir+'/failed.sqlite'),true);
 const copy=new DatabaseSync(dir+'/failed.sqlite');
 try{assert.equal(copy.prepare("SELECT name FROM sqlite_schema WHERE name='accounting_terminals_v1'").get(),undefined);}finally{copy.close();}
}));
