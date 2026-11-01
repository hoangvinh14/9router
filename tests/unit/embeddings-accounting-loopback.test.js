import {afterEach,describe,it,expect,vi} from 'vitest';
import {openEmbeddingsFixture,embeddingsReply,fixtureProvider} from '../fixtures/accounting/embeddings-loopback.js';
import {updateAccountingPolicy} from '../../src/lib/db/helpers/accounting-policy.js';
import {parseBudgetPolicy} from '../../src/lib/accounting/budget-policy.js';
let fixture;
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllEnvs();if(fixture){await fixture.close();fixture=null;}});
async function setup(engine,options){
  for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'])vi.stubEnv(key,'');
  fixture=await openEmbeddingsFixture(engine,options);return fixture;
}
function second(f){f.db.durableTransaction(()=>f.db.run("INSERT INTO providerConnections(id,provider,authType,priority,data,createdAt,updatedAt) SELECT 'connection-two',provider,authType,2,data,createdAt,updatedAt FROM providerConnections WHERE id='connection-one'"));}
for(const engine of ['node','sqljs'])describe(`${engine} actual E1 account fallback`,()=>{
  it.each([true,false])('predecessor own ACK before actual second POST; later success=%s',async success=>{
    let ackId;const raw=' {"error":{"message":"priced predecessor"},"usage":{"prompt_tokens":1000,"total_tokens":1000}} ';
    const f=await setup(engine,{respond:(_req,res,count)=>{
      if(count===2){expect(ackId).toBeTruthy();expect(f.db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?',[ackId]).state).toBe('settled');}
      res.statusCode=count===1||!success?503:200;res.setHeader('content-type','application/json');res.end(count===1||!success?raw:JSON.stringify(embeddingsReply()));
    }});second(f);
    const response=await f.request({hooks:{terminalAck:ack=>{ackId=ack.attemptId;}}});
    expect(response.status).toBe(success?200:503);expect(await response.text()).toBe(success?JSON.stringify(embeddingsReply()):raw);expect(f.posts).toBe(2);
    const rows=f.db.all('SELECT attemptId,connectionId,state,costNanoUsd,endpoint FROM apiKeyAccounting');expect(rows).toHaveLength(2);expect(new Set(rows.map(row=>row.attemptId)).size).toBe(2);
    expect(rows.map(row=>row.connectionId)).toEqual(['connection-one','connection-two']);for(const row of rows)expect(row).toMatchObject({state:'settled',costNanoUsd:1000000,endpoint:'embeddings'});
  });
  it('predecessor debit blocks successor and budget refusal supersedes retained upstream bytes',async()=>{
    const f=await setup(engine,{respond:(_req,res)=>{res.statusCode=503;res.end(JSON.stringify({error:{message:'upstream'},usage:{prompt_tokens:1000,total_tokens:1000}}));}});second(f);
    updateAccountingPolicy(f.db,'key-one',parseBudgetPolicy({weeklyLimitUsd:'0.001',monthlyLimitUsd:null,expectedVersion:1}),'2026-10-25T12:00:00.000Z');
    const response=await f.request({clock:()=> '2026-10-25T12:00:00.000Z'});expect(response.status).toBe(429);expect((await response.json()).error.code).toBe('api_key_budget_exceeded');expect(f.posts).toBe(1);
  });
  it.each([401,403])('dynamic API key HTTP %s never produces refresh credentials or a successor on one account',async status=>{
    const f=await setup(engine,{respond:(_req,res)=>{res.statusCode=status;res.end(JSON.stringify({error:{message:'bad key'},usage:{prompt_tokens:1,total_tokens:1}}));}});
    const response=await f.request();expect(response.status).toBe(status);expect(f.posts).toBe(1);expect(f.db.get('SELECT state FROM apiKeyAccounting').state).toBe('settled');
    const row=f.db.get('SELECT data FROM providerConnections WHERE provider=?',[fixtureProvider]);expect(JSON.parse(row.data).apiKey).toBe('provider-secret');
  });
  it('successor persisted authority refusal supersedes earlier final error',async()=>{
    const f=await setup(engine,{respond:(_req,res)=>{res.statusCode=503;res.end(JSON.stringify({error:{message:'predecessor'},usage:{prompt_tokens:1,total_tokens:1}}));}});second(f);
    const response=await f.request({hooks:{terminalAck:()=>f.db.durableTransaction(()=>f.db.run("UPDATE apiKeys SET isActive=0 WHERE id='key-one'"))}});
    expect(response.status).toBe(503);expect((await response.json()).error.code).toBe('api_key_accounting_unavailable');expect(f.posts).toBe(1);
  });
  it('terminal recording/ACK refusal cannot advance even with a second actual account',async()=>{
    const f=await setup(engine,{respond:(_req,res)=>{res.statusCode=503;res.end(JSON.stringify({usage:{prompt_tokens:1,total_tokens:1}}));}});second(f);
    const response=await f.request({hooks:{terminalAck:()=>{throw new Error('lost ACK');}}});expect(response.status).toBe(503);expect((await response.json()).error.code).toBe('api_key_accounting_unavailable');expect(f.posts).toBe(1);
  });
});
