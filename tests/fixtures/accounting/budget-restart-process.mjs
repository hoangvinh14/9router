import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const [engine,file,mode]=process.argv.slice(2);
const root=path.dirname(file);
Object.assign(process.env,{DATA_DIR:path.join(root,'default'),HOME:path.join(root,'home'),APPDATA:path.join(root,'appdata')});
for(const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'])delete process.env[name];
for(const dir of [process.env.DATA_DIR,process.env.HOME,process.env.APPDATA])fs.mkdirSync(dir,{recursive:true});
const {openFixture,addKey}=await import('./test-database.js');
const {associateChatAccountingFixture}=await import('../../../src/sse/services/chat-accounting.js');
const {handleChat}=await import('../../../src/sse/handlers/chat.js');
const {updateAccountingPolicy}=await import('../../../src/lib/db/helpers/accounting-policy.js');
const {parseBudgetPolicy}=await import('../../../src/lib/accounting/budget-policy.js');
const fixture=await openFixture(engine,file),db=fixture.db;
assert.equal(db.driver,engine==='node'?'node:sqlite':'sql.js');
global._dbAdapter.instance=db;
const now='2026-10-25T16:00:00.000Z';
const request=async (at,hooks={})=>{
  const req=new Request('http://localhost/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer fixture-secret','content-type':'application/json'},body:JSON.stringify({model:'fixture-node/fixture',stream:false,messages:[{role:'user',content:'hello'}]})});
  associateChatAccountingFixture(req,db,hooks, {clock:()=>at});return handleChat(req);
};
let result;
try{
  if(mode==='write'||mode==='crash-write'){
    addKey(db);
    db.durableTransaction(()=>{
      db.run('INSERT INTO settings(id,data) VALUES(1,?)',[JSON.stringify({requireApiKey:true,rtkEnabled:false,enableObservability:false})]);
      db.run('INSERT INTO providerNodes(id,type,name,data,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',['openai-compatible-chat-accounting-fixture','openai-compatible','Fixture',JSON.stringify({prefix:'fixture-node',apiType:'chat',baseUrl:process.env.FIXTURE_UPSTREAM}),now,now]);
      db.run('INSERT INTO providerConnections(id,provider,authType,priority,data,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)',['connection-one','openai-compatible-chat-accounting-fixture','apikey',1,JSON.stringify({apiKey:'provider-secret',providerSpecificData:{baseUrl:process.env.FIXTURE_UPSTREAM,apiType:'chat'}}),now,now]);
      db.run("INSERT INTO kv(scope,key,value) VALUES('pricing',?,?)",['openai-compatible-chat-accounting-fixture',JSON.stringify({fixture:{input:'1',output:'2',cached:'0.25'}})]);
    });
    updateAccountingPolicy(db,'key-one',parseBudgetPolicy({weeklyLimitUsd:'0.0012',monthlyLimitUsd:null,expectedVersion:1}),now);
    if(mode==='crash-write'){
      await request(now,{intentAck:async()=>{
        assert.equal(db.get('SELECT state FROM apiKeyAccounting').state,'pending');
        process.send({phase:'durable-intent',fingerprint:db.get("SELECT fingerprint FROM apiKeyBindings WHERE apiKeyId='key-one'").fingerprint,coverageId:db.coverage.status().id,policyVersion:2});
        // Parent kills this verified live owner; never recover it while still alive.
        await new Promise(()=>{});
      }});
      throw new Error('Crash checkpoint unexpectedly resumed');
    }
    const response=await request(now);assert.equal(response.status,200);await response.text();
    result={status:response.status,row:db.get('SELECT apiKeyId,state,costNanoUsd,startedAt FROM apiKeyAccounting')};
  }else if(mode==='crash-read'){
    const row=db.get('SELECT attemptId,state,costNanoUsd,resolutionVersion,startedAt FROM apiKeyAccounting');assert.equal(row.state,'unresolved');assert.equal(row.costNanoUsd,null);assert.equal(row.startedAt,now);
    const nextAt='2027-01-01T00:00:00.000Z';
    const denied=await request(nextAt);assert.equal(denied.status,503);assert.equal((await denied.json()).error.code,'api_key_accounting_unresolved');
    updateAccountingPolicy(db,'key-one',parseBudgetPolicy({weeklyLimitUsd:null,monthlyLimitUsd:null,expectedVersion:2}),nextAt);
    const continued=await request(nextAt);assert.equal(continued.status,200);await continued.text();
    updateAccountingPolicy(db,'key-one',parseBudgetPolicy({weeklyLimitUsd:'1',monthlyLimitUsd:null,expectedVersion:3}),nextAt);
    const reenabled=await request(nextAt);assert.equal(reenabled.status,503);assert.equal((await reenabled.json()).error.code,'api_key_accounting_unresolved');
    const {resolveAttemptSync}=await import('../../../src/lib/db/repos/api-key-accounting-repo.js');
    resolveAttemptSync(db,row.attemptId,{action:'waive',operationId:'fixture-crash-waiver',actor:'fixture-admin',reason:'Audited disposable crash control',evidence:'Parent killed owner only after own durable intent ACK',expectedVersion:row.resolutionVersion});
    const positive=await request(nextAt);assert.equal(positive.status,200);await positive.text();
    result={deniedStatus:denied.status,unlimitedStatus:continued.status,reenabledStatus:reenabled.status,afterWaiverStatus:positive.status,rows:db.all('SELECT apiKeyId,state,costNanoUsd,startedAt FROM apiKeyAccounting ORDER BY startedAt'),auditCount:db.get('SELECT count(*) AS n FROM apiKeyAccountingAudit').n};
    assert.equal(result.rows.length,3);assert.equal(result.auditCount,1);
  }else{
    const denied=await request(now);assert.equal(denied.status,429);assert.equal((await denied.json()).error.code,'api_key_budget_exceeded');
    const count=db.get('SELECT count(*) AS n FROM apiKeyAccounting').n;assert.equal(count,1);
    const positive=await request('2026-10-25T17:00:00.000Z');assert.equal(positive.status,200);await positive.text();
    result={deniedStatus:denied.status,nextWindowStatus:positive.status,rows:db.all('SELECT apiKeyId,state,costNanoUsd,startedAt FROM apiKeyAccounting ORDER BY startedAt')};assert.equal(result.rows.length,2);
  }
  assert.equal(db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'"),undefined);
  result={...result,engine,driver:db.driver,fingerprint:db.get("SELECT fingerprint FROM apiKeyBindings WHERE apiKeyId='key-one'").fingerprint,coverageId:db.coverage.status().id,policyVersion:db.get("SELECT version FROM apiKeyBudgetPolicies WHERE apiKeyId='key-one'").version};
  fs.writeFileSync(path.join(root,`${engine}-${mode}-result.json`),JSON.stringify(result,null,2));
}finally{
  db.close();for(const timer of Object.values(global._statsEmitTimers||{}))if(timer)clearTimeout(timer);for(const timer of Object.values(global._pendingTimers||{}))if(timer)clearTimeout(timer);
}
