import fs from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
assert.equal(process.env.BUDGET_DRIVER_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
const modes=['current','app-version','missing-index','missing-table','missing-version','older-version','malformed-version','future-version','check','unique','default','collation','primary-key','missing-column','pre-access','upgraded-access','autoincrement','partial-index','generated','trigger','unknown-table','read-fault','accounting-shape-only','admin-event-shape-only'];
for(const mode of modes)test('application schema work classification '+mode,()=>{
 const dir='/tmp/app-shape-'+mode;fs.mkdirSync(dir);
 const source=`
 import assert from 'node:assert/strict';
 import {createNodeSqliteAdapter} from '/app/src/lib/db/adapters/nodeSqliteAdapter.js';
 import {runMigrationOnce} from '/app/src/lib/db/migrate.js';
 import {DATA_FILE,ensureDirs} from '/app/src/lib/db/paths.js';
 import {TABLES,buildCreateTableSql} from '/app/src/lib/db/schema.js';
 import {classifyNodeAppSchemaWork,APP_SCHEMA_READ_DEFINITIONS} from '/app/src/lib/db/app-schema-work.js';
 import {assertAccountingHealthy} from '/app/src/lib/accounting/process-state.js';
 ensureDirs();const db=await createNodeSqliteAdapter(DATA_FILE);
 try{
 await runMigrationOnce(db);const mode=${JSON.stringify(mode)};
 if(mode==='app-version')db.run('UPDATE _meta SET value=? WHERE key=?',['different-info-version','appVersion']);
 if(mode==='missing-index')db.exec('DROP INDEX idx_ak_key');
 if(mode==='missing-table')db.exec('DROP TABLE usageDaily');
 if(mode==='missing-version')db.run('DELETE FROM _meta WHERE key=?',['schemaVersion']);
 if(mode==='older-version')db.run('UPDATE _meta SET value=? WHERE key=?',['0','schemaVersion']);
 if(mode==='malformed-version')db.run('UPDATE _meta SET value=? WHERE key=?',['1junk','schemaVersion']);
 if(mode==='future-version')db.run('UPDATE _meta SET value=? WHERE key=?',['999','backupSchemaVersion']);
 const recreate=(name,sql)=>{db.exec('DROP TABLE '+name);db.exec(sql);for(const index of TABLES[name].indexes??[])db.exec(index);};
 if(mode==='check')recreate('settings',buildCreateTableSql('settings',TABLES.settings).replace('CHECK (id = 1)','CHECK (id > 0)'));
 if(mode==='unique')recreate('apiKeys',buildCreateTableSql('apiKeys',TABLES.apiKeys).replace('TEXT UNIQUE NOT NULL','TEXT NOT NULL'));
 if(mode==='default')recreate('apiKeys',buildCreateTableSql('apiKeys',TABLES.apiKeys).replace('accessRestricted INTEGER DEFAULT 0','accessRestricted INTEGER DEFAULT 1'));
 if(mode==='collation')recreate('apiKeys',buildCreateTableSql('apiKeys',TABLES.apiKeys).replace('key TEXT UNIQUE NOT NULL','key TEXT COLLATE NOCASE UNIQUE NOT NULL'));
 if(mode==='primary-key')recreate('kv',buildCreateTableSql('kv',TABLES.kv).replace('PRIMARY KEY (scope, key)','PRIMARY KEY (key, scope)'));
 if(mode==='missing-column')db.exec('ALTER TABLE apiKeys DROP COLUMN accessAllow');
 if(['pre-access','upgraded-access'].includes(mode)){
  const predecessor={...TABLES.apiKeys,columns:Object.fromEntries(Object.entries(TABLES.apiKeys.columns).slice(0,-2))};
  recreate('apiKeys',buildCreateTableSql('apiKeys',predecessor));
  if(mode==='upgraded-access'){
   db.exec('ALTER TABLE apiKeys ADD COLUMN accessRestricted INTEGER DEFAULT 0');
   db.exec('ALTER TABLE apiKeys ADD COLUMN accessAllow TEXT');
  }
 }
 if(mode==='autoincrement')recreate('usageHistory',buildCreateTableSql('usageHistory',TABLES.usageHistory).replace(' AUTOINCREMENT',''));
 if(mode==='partial-index'){db.exec('DROP INDEX idx_ak_key');db.exec('CREATE INDEX idx_ak_key ON apiKeys(key) WHERE isActive=1');}
 if(mode==='generated')db.exec('ALTER TABLE apiKeys ADD COLUMN generated_id TEXT GENERATED ALWAYS AS (id) VIRTUAL');
 if(mode==='trigger')db.exec('CREATE TRIGGER unexpected AFTER INSERT ON usageDaily BEGIN UPDATE apiKeys SET isActive=1; END');
 if(mode==='unknown-table')db.exec('CREATE TABLE unknown_state(id TEXT)');
 // Intentionally malformed accounting shell: schema-only current does NOT
 // certify accounting or grant startup; separate audit MUST validate it later.
 if(mode==='accounting-shape-only')db.exec('CREATE TABLE accounting_key_policy_v1 (broken TEXT)');
 if(mode==='admin-event-shape-only')db.exec('CREATE TABLE accounting_admin_events_v1 (broken TEXT)');
 const schema=JSON.stringify(db.all('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name'));
 const changes=db.get('SELECT total_changes() AS n').n;
 let begins=0,commits=0;
 const observed={...db,exec(sql){if(sql==='BEGIN IMMEDIATE')begins++;if(sql==='COMMIT')commits++;return db.exec(sql);},all(sql,params){
  assert.equal(db.raw.isTransaction,true);
  if(mode==='read-fault'&&sql.startsWith('PRAGMA main.table_xinfo'))throw new Error('private schema fault');
  return db.all(sql,params);
 }};
 assert.equal(Object.isFrozen(APP_SCHEMA_READ_DEFINITIONS),true);
 for(const value of Object.values(APP_SCHEMA_READ_DEFINITIONS)){assert.equal(Object.isFrozen(value),true);assert.ok(['get','all'].includes(value.method));}
 if(mode==='read-fault'){
  assert.throws(()=>classifyNodeAppSchemaWork(observed),e=>e.code==='api_key_accounting_unavailable'&&!e.message.includes('private'));
  assert.throws(assertAccountingHealthy);assert.equal(commits,0);
 }else{
  const value=classifyNodeAppSchemaWork(observed);
  const work=['missing-index','missing-table','missing-version','older-version','pre-access'].includes(mode);
  const current=['current','app-version','accounting-shape-only','admin-event-shape-only','upgraded-access'].includes(mode);
  assert.equal(value.kind,current?'current':work?'required-work':'unsupported-shape');
  assert.equal(value.profile,'app-current-v1');
  assert.equal(Object.isFrozen(value),true);assert.equal(Object.isFrozen(value.reasons),true);
  assert.equal(commits,1);assertAccountingHealthy();
 }
 assert.equal(begins,1);assert.equal(db.raw.isTransaction,false);assert.equal(db.get('PRAGMA synchronous').synchronous,1);
 assert.equal(db.get('SELECT total_changes() AS n').n,changes);
 assert.equal(JSON.stringify(db.all('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name')),schema);
 }finally{db.close();}
 `;
 const r=spawnSync('/runtime/node',['--unhandled-rejections=strict','--experimental-loader','/app/tests/fixtures/budget/alias-loader.mjs','--input-type=module','--eval',source],{env:{...process.env,DATA_DIR:dir},encoding:'utf8',timeout:10000});
 assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stdout+r.stderr);
});
