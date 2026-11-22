import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';

assert.equal(process.env.BUDGET_DRIVER_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
const cli='/app/scripts/provision-internal-accounting.mjs';
const names=['accounting_admin_events_v1','accounting_attempts_v1','accounting_key_generations_v1','accounting_key_policy_v1','accounting_terminals_v1'];
const run=(args,env={},input)=>{
 const r=spawnSync('/runtime/node',['--unhandled-rejections=strict',...args],{env:{...process.env,...env},encoding:'utf8',timeout:10000,input});
 assert.equal(r.error,undefined);assert.equal(r.signal,null);return r;
};
const markers=db=>db.prepare("SELECT name FROM sqlite_schema WHERE name GLOB 'accounting_*' ORDER BY name").all().map(r=>r.name);
const inspect=(dir,fn)=>{const db=new DatabaseSync(dir+'/db/data.sqlite',{readOnly:true});try{return fn(db);}finally{db.close();}};

test('explicit CLI creates privately, provisions all tables without policy, then refuses repeat',()=>{
 const dir='/tmp/first-provision';
 const r=run([cli,'--create-new',dir]);assert.equal(r.status,0,r.stdout+r.stderr);
 assert.equal(fs.statSync(dir).mode & 0o777,0o700);
 inspect(dir,db=>{
  assert.deepEqual(markers(db),names);
  for(const name of names)assert.equal(db.prepare(`SELECT count(*) n FROM ${name}`).get().n,0);
 });
 const before=fs.readFileSync(dir+'/db/data.sqlite');
 const repeat=run([cli,'--create-new',dir]);assert.equal(repeat.status,1);assert.match(repeat.stderr,/target must not exist/);
 assert.deepEqual(fs.readFileSync(dir+'/db/data.sqlite'),before);
 const reopened=run(['--input-type=module','--eval',`const {getAccountingAdapter}=await import('/app/src/lib/db/driver.js');const db=await getAccountingAdapter();db.close();`],{DATA_DIR:dir});
 assert.equal(reopened.status,0,reopened.stdout+reopened.stderr);
});

test('existing used unmarked database is refused before opening',()=>{
 const dir='/tmp/used-unmarked';
 const old=run(['--input-type=module','--eval',`const {getAdapter}=await import('/app/src/lib/db/driver.js');const db=await getAdapter();db.run("INSERT INTO kv VALUES('fixture','previously-used','yes')");db.close();`],{DATA_DIR:dir});
 assert.equal(old.status,0,old.stdout+old.stderr);
 const before=fs.readFileSync(dir+'/db/data.sqlite');
 const refused=run([cli,'--create-new',dir]);assert.equal(refused.status,1);assert.match(refused.stderr,/target must not exist/);
 assert.deepEqual(fs.readFileSync(dir+'/db/data.sqlite'),before);
 assert.deepEqual(inspect(dir,markers),[]);
});

const fixtureKey='offline-provider-only';
const binding=JSON.stringify({clientKeyId:'fixture',workspaceBinding:{scope:'single-workspace',workspaceId:'wrkspc_Fixture',connectionId:'provider',keyDigest:createHash('sha256').update(fixtureKey).digest('hex')}});

test('offline check validates exact binding without policy or row changes',()=>{
 const dir='/tmp/check-marked';
 const created=run([cli,'--create-new',dir]);assert.equal(created.status,0,created.stdout+created.stderr);
 const seeded=run(['--input-type=module','--eval',`
 const {getAccountingAdapter}=await import('/app/src/lib/db/driver.js');const db=await getAccountingAdapter();
 db.run("INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES('fixture','offline-client-only',1,'2026-11-16')");
 db.run("INSERT INTO providerConnections(id,provider,authType,isActive,data,createdAt,updatedAt) VALUES('provider','anthropic','apikey',1,?,'2026-11-16','2026-11-16')",[JSON.stringify({apiKey:${JSON.stringify(fixtureKey)}})]);db.close();
 `],{DATA_DIR:dir});
 assert.equal(seeded.status,0,seeded.stdout+seeded.stderr);
 const before=fs.readFileSync(dir+'/db/data.sqlite');
 const ok=run([cli,'--check-binding',dir],{},binding);assert.equal(ok.status,0,ok.stdout+ok.stderr);assert.match(ok.stdout,/Local binding matched/);
 const wrong=run([cli,'--check-binding',dir],{},binding.replace(/"keyDigest":"[a-f0-9]+"/,`"keyDigest":"${'0'.repeat(64)}"`));
 assert.equal(wrong.status,1);assert.match(wrong.stderr,/no admission granted/);assert(!wrong.stdout.includes('Local binding matched'));
 assert.deepEqual(fs.readFileSync(dir+'/db/data.sqlite'),before);
});

test('offline check refuses absent file, oversized input and unmarked schema without initializing DB',()=>{
 const dir='/tmp/check-unmarked';fs.mkdirSync(dir,{mode:0o700});
 for(const input of [binding,'x'.repeat(4097),'{']){
  const refused=run([cli,'--check-binding',dir],{},input);assert.equal(refused.status,1);assert.match(refused.stderr,/private existing database/);
  assert.deepEqual(fs.readdirSync(dir),[]);
 }
 const seed=run(['--input-type=module','--eval',`const {getAdapter}=await import('/app/src/lib/db/driver.js');(await getAdapter()).close();`],{DATA_DIR:dir});
 assert.equal(seed.status,0,seed.stdout+seed.stderr);
 const before=fs.readFileSync(dir+'/db/data.sqlite');
 const oversized=run([cli,'--check-binding',dir],{},'x'.repeat(4097));assert.equal(oversized.status,1);assert.doesNotMatch(oversized.stdout,/Driver:/);
 const refusal=run([cli,'--check-binding',dir],{},binding);assert.equal(refusal.status,1);assert.match(refusal.stderr,/no admission granted/);assert.doesNotMatch(refusal.stdout,/Driver:/);
 assert.deepEqual(fs.readFileSync(dir+'/db/data.sqlite'),before);assert.deepEqual(inspect(dir,markers),[]);
});

for(const mode of ['partial','ddl-failure'])test('schema setup does not repair or partially commit: '+mode,()=>{
 const dir='/tmp/provision-'+mode;
 const r=run(['--input-type=module','--eval',`
  import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
  import {getAccountingAdapter} from '/app/src/lib/db/driver.js';
  import {provisionEmptyNodeAccountingSchema} from '/app/src/lib/accounting/node-existing-audit.js';
  const db=await getAccountingAdapter();
  if('${mode}'==='partial')db.exec('CREATE TABLE accounting_admin_events_v1(x TEXT)');
  let injected=0;
  const prepare=DatabaseSync.prototype.prepare;
  if('${mode}'==='ddl-failure')DatabaseSync.prototype.prepare=function(sql){
   if(sql.startsWith('CREATE TABLE accounting_terminals_v1')){injected++;assert(this.isTransaction);throw new Error('fixture DDL failure');}
   return prepare.call(this,sql);
  };
  try {assert.throws(()=>provisionEmptyNodeAccountingSchema(db));assert.equal(injected,'${mode}'==='ddl-failure'?1:0);}
  finally {DatabaseSync.prototype.prepare=prepare;db.close();}
 `],{DATA_DIR:dir});
 assert.equal(r.status,0,r.stdout+r.stderr);
 assert.deepEqual(inspect(dir,markers),mode==='partial'?['accounting_admin_events_v1']:[]);
});
