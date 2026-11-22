import fs from 'node:fs';
import assert from 'node:assert/strict';
import https from 'node:https';
import { test, after, mock } from 'node:test';
assert.equal(process.env.BUDGET_TRANSPORT_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
assert.notEqual(fs.readlinkSync('/proc/self/ns/user'),process.env.BUDGET_OUTER_USER);
const status=fs.readFileSync('/proc/self/status','utf8');
for(const name of ['CapInh','CapPrm','CapEff','CapBnd','CapAmb']) {
 const line=status.split('\n').find(line=>line.startsWith(name+':'));
 assert.equal(BigInt('0x'+line.split(':')[1].trim()),0n);
}
assert.match(status,/^NoNewPrivs:\s+1$/m);
// Dependency mocks isolate BaseExecutor's actual dispatch/retry branch, not
// provider registry/credential discovery or endpoint/model eligibility coverage.
mock.module('/app/open-sse/services/oauthCredentialManager.js',{namedExports:{shouldRefreshCredentials:()=>false}});
mock.module('/app/open-sse/providers/shared.js',{namedExports:{ANTHROPIC_API_VERSION:'2023-06-01',OPENAI_COMPAT_BASE:'https://unsupported.test',ANTHROPIC_COMPAT_BASE:'https://unsupported.test'}});
mock.module('/app/open-sse/services/provider.js',{namedExports:{resolveOpenAICompatibleApiType:()=> 'chat'}});
const {BaseExecutor}=await import('/app/open-sse/executors/base.js');
const {prepareAccountedDirectPost,getDirectDispatcher,getAccountedDirectDispatcher}=await import('/app/open-sse/utils/proxyFetch.js');
const {createNodeSqliteAdapter}=await import('/app/src/lib/db/adapters/nodeSqliteAdapter.js');
const {initializeNodeAttemptLedger,createNodeAttemptLedger}=await import('/app/src/lib/accounting/node-attempt-ledger.js');
const {initializeNodeKeyPolicy,createNodeKeyPolicy}=await import('/app/src/lib/accounting/node-key-policy.js');
let posts=0;
const server=https.createServer({key:fs.readFileSync('/tmp/test-key.pem'),cert:fs.readFileSync('/tmp/test-cert.pem')},async(req,res)=>{
 for await(const _chunk of req){} posts++;res.writeHead(503,{'content-type':'application/json'});res.end('{}');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const endpoint=`https://127.0.0.1:${server.address().port}/messages`;
after(async()=>{await(await getDirectDispatcher(false)).close();await(await getAccountedDirectDispatcher()).close();await new Promise(resolve=>server.close(resolve));});
const executor=()=>new BaseExecutor('fixture',{baseUrl:endpoint,retry:{503:{attempts:2,delayMs:1}}});

test('actual executor opt-in POST has own ACK, returns terminal authority and suppresses configured HTTP retry',async()=>{
 const db=await createNodeSqliteAdapter('/tmp/executor-fixture.sqlite');
 try{
  initializeNodeAttemptLedger(db);const store=createNodeAttemptLedger(db);let prepares=0;
  db.exec('CREATE TABLE apiKeys (id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, isActive INTEGER NOT NULL)');
  db.run('INSERT INTO apiKeys VALUES (?,?,1)',['key-A','fixture-key-A']);
  initializeNodeKeyPolicy(db);createNodeKeyPolicy(db).save('key-A',0,{weekly:null,monthly:null});
  const now='2026-11-16T10:00:00.000Z';
  const result=await executor().execute({model:'fixture',body:{fixture:true},stream:false,credentials:{apiKey:'fake'},accounting:{
   async prepare({url,options,proxyOptions}){
    prepares++;const initiate=await prepareAccountedDirectPost(url,options,proxyOptions);
    const attempt=store.prepare({attemptId:'executor-post',keyId:'key-A',bindingGeneration:'1',provider:'fixture',model:'fixture',startedAt:now,
      price:{currency:'USD',unit:'USD/1M tokens',revision:'fixture',rates:{input:'1',output:'2'}}});
    return Object.freeze({dispatch:()=>store.dispatch(attempt.ack,{presentedSecret:'fixture-key-A',now},initiate),settle:()=>attempt.settle(null)});
   }
  }});
  assert.equal(result.response.status,503);await result.response.text();
  assert.equal(prepares,1);assert.equal(posts,1);result.accounting.settle();
  assert.equal(db.get('SELECT COUNT(*) AS n FROM accounting_terminals_v1').n,1);
 }finally{db.close();}
});

test('executor preparation or dispatch fault has no automatic retry/fallback or extra POST',async()=>{
 const before=posts;let preparations=0;
 const ex=executor();ex.getFallbackCount=()=>2;
 await assert.rejects(ex.execute({model:'fixture',body:{},stream:false,credentials:{apiKey:'fake'},accounting:{prepare(){preparations++;throw new Error('refused');}}}),/refused/);
 assert.equal(preparations,1);assert.equal(posts,before);
 await assert.rejects(ex.execute({model:'fixture',body:{},stream:false,credentials:{apiKey:'fake'},accounting:{prepare(){preparations++;return {dispatch(){throw new Error('storage');}};}}}),/storage/);
 assert.equal(preparations,2);assert.equal(posts,before);
});

test('ordinary executor retains configured HTTP retry behavior',async()=>{
 const before=posts;
 const result=await executor().execute({model:'fixture',body:{},stream:false,credentials:{apiKey:'fake'}});
 assert.equal(result.response.status,503);await result.response.text();assert.equal(posts,before+3);
});
