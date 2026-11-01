import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const [engine,file,mode]=process.argv.slice(2);
const root=path.dirname(file);
if(!process.env.R1_ISOLATED_ROOT||!root.startsWith(process.env.R1_ISOLATED_ROOT+'/'))throw new Error('Isolated child root required');
// Subprocess inherits OS namespaces. Keep all application default paths private.
Object.assign(process.env,{DATA_DIR:path.join(root,'default'),HOME:path.join(root,'home')});
fs.mkdirSync(process.env.DATA_DIR,{recursive:true});fs.mkdirSync(process.env.HOME,{recursive:true});
const {openFixture,addKey}=await import('./test-database.js');
const {associateEmbeddingsAccountingFixture}=await import('../../../src/sse/services/embeddings-accounting.js');
const {handleEmbeddings}=await import('../../../src/sse/handlers/embeddings.js');
const {updateAccountingPolicy}=await import('../../../src/lib/db/helpers/accounting-policy.js');
const {parseBudgetPolicy}=await import('../../../src/lib/accounting/budget-policy.js');
const fixture=await openFixture(engine,file),db=fixture.db;
global._dbAdapter.instance=db;
const now='2026-10-25T16:00:00.000Z',provider='openai-compatible-embeddings-process-fixture';
const request=async(hooks={},at=now)=>{
  const req=new Request('http://localhost/v1/embeddings',{method:'POST',headers:{authorization:'Bearer fixture-secret','content-type':'application/json'},
    body:JSON.stringify({model:'process-node/fixture',input:'hello'})});
  associateEmbeddingsAccountingFixture(req,db,hooks,{clock:()=>at});return handleEmbeddings(req);
};
const checkpoint=async phase=>{process.send({phase,rows:db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')});await new Promise(()=>{});};
try{
  if(mode.startsWith('write')){
    addKey(db);db.durableTransaction(()=>{
      db.run('INSERT INTO settings(id,data) VALUES(1,?)',[JSON.stringify({requireApiKey:true,rtkEnabled:false,enableObservability:false})]);
      db.run('INSERT INTO providerNodes(id,type,data,createdAt,updatedAt) VALUES(?,?,?,?,?)',[provider,'openai-compatible',JSON.stringify({prefix:'process-node',apiType:'responses',baseUrl:process.env.FIXTURE_UPSTREAM}),now,now]);
      db.run('INSERT INTO providerConnections(id,provider,authType,priority,data,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)',[
        'connection-one',provider,'apikey',1,JSON.stringify({apiKey:'provider-secret',providerSpecificData:{apiType:'responses',baseUrl:process.env.FIXTURE_UPSTREAM}}),now,now]);
      db.run("INSERT INTO kv(scope,key,value) VALUES('pricing',?,?)",[provider,JSON.stringify({fixture:{input:'1',output:'0'}})]);
    });
    updateAccountingPolicy(db,'key-one',parseBudgetPolicy({weeklyLimitUsd:'0.001',monthlyLimitUsd:null,expectedVersion:1}),now);
    if(mode==='write-intent')await request({intentAck:()=>checkpoint('durable-intent')});
    else if(mode==='write-committed')await request({terminalAck:()=>checkpoint('durable-terminal')});
    else if(mode==='write-volatile'){
      // Arm only after own intent ACK. The next durable operation is terminal
      // publication after raw usage arrives. Synchronously stop BEFORE work;
      // no async transaction callback or fake durable acknowledgement escapes.
      await request({intentAck:()=>{const run=db.durableTransaction;let armed=true;db.durableTransaction=work=>{
        if(armed){armed=false;process.send({phase:'volatile-terminal',rows:db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')});
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
          throw new Error('Crash checkpoint unexpectedly resumed');}
        return run(work);
      };}});
      throw new Error('Volatile checkpoint unexpectedly returned');
    }else{const response=await request();assert.equal(response.status,200);await response.text();}
  }else{
    const rows=db.all('SELECT state,costNanoUsd,startedAt,priceSnapshotJson FROM apiKeyAccounting');assert.equal(rows.length,1);
    const committed=mode==='read-committed';assert.equal(rows[0].state,committed?'settled':'unrecorded');assert.equal(rows[0].costNanoUsd,committed?1000000:null);
    assert.equal(rows[0].startedAt,now);const snapshot=JSON.parse(rows[0].priceSnapshotJson);assert.equal(snapshot.rates.input,'1');assert.equal(snapshot.rates.output,'0');assert.equal(snapshot.endpoint,'embeddings');
    const {projectBudget}=await import('../../../src/lib/accounting/budget-projection.js');
    const projection=projectBudget(db,'key-one',{weeklyLimitNanoUsd:1000000,monthlyLimitNanoUsd:2000000},'2026-10-25T17:01:00.000Z');
    assert.equal(projection.weekly.spentUsd,'0');assert.equal(projection.previousWindows.weekly.spentUsd,committed?'0.001':'0');assert.equal(projection.monthly.spentUsd,committed?'0.001':'0');
    if(committed){const denied=await request();assert.equal(denied.status,429);}
    const next=await request({},'2026-10-25T17:00:00.000Z');assert.equal(next.status,200);await next.text();
  }
  fs.writeFileSync(path.join(root,`${mode}.json`),JSON.stringify({driver:db.driver,rows:db.all('SELECT state,costNanoUsd,startedAt FROM apiKeyAccounting'),
    fingerprint:db.get("SELECT fingerprint FROM apiKeyBindings WHERE apiKeyId='key-one'").fingerprint,coverageId:db.coverage.status().id}));
}finally{db.close();}
