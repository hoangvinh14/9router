import { afterEach, describe, expect, it, vi } from 'vitest';
import { openResponsesFixture,responsesReply,rawResponsesUsage,fixtureProvider,gate,observe,reach } from '../fixtures/accounting/responses-loopback.js';
import { getExecutor } from '../../open-sse/executors/index.js';
import { updateAccountingPolicy } from '../../src/lib/db/helpers/accounting-policy.js';
import { createAccountingService } from '../../src/lib/accounting/service.js';
import { normalizeResponsesUsage } from '../../open-sse/utils/accounting-responses-usage.js';
import { RESPONSES_EXPLICIT_USAGE_PROFILE } from '../../open-sse/config/accountingProfiles.js';
import { parseBudgetPolicy } from '../../src/lib/accounting/budget-policy.js';
let fixture,executor,originalConfig;
async function setup(engine,options){
  for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'])vi.stubEnv(key,'');
  fixture=await openResponsesFixture(engine,options);executor=getExecutor(fixtureProvider);originalConfig=executor.config;
  executor.config={...originalConfig,retry:{429:{attempts:0},502:{attempts:0},503:{attempts:1,delayMs:1},504:{attempts:0}}};return fixture;
}
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllEnvs();if(executor)executor.config=originalConfig;if(fixture){await fixture.close();fixture=null;}});
for(const engine of ['node','sqljs'])describe(`${engine} actual Responses retry/fallback authority`,()=>{
  it.each([false,true])('settles priced 503 predecessor before retry and own ACK, threshold=%s',async threshold=>{
    let f,predecessor;f=await setup(engine,{respond:(_req,res,count)=>{
      if(count>1)expect(f.db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?',[predecessor]).state).toBe('settled');
      res.statusCode=count===1?503:200;res.setHeader('content-type','application/json');
      res.end(JSON.stringify(count===1?{error:{message:'retryable fixture'},usage:rawResponsesUsage()}:responsesReply()));
    }});
    if(threshold)updateAccountingPolicy(f.db,'key-one',parseBudgetPolicy({weeklyLimitUsd:'0.0009',monthlyLimitUsd:null,expectedVersion:1}),'2026-10-25T16:00:00.000Z');
    const entered=gate(),hold=gate();let terminals=0;
    const outcome=observe(f.request({clock:()=> '2026-10-25T16:00:00.000Z',hooks:{terminalAck:async ack=>{if(++terminals===1){predecessor=ack.attemptId;entered.release();await hold.promise;}}}}));
    try{await reach(entered,outcome);expect(f.posts).toBe(1);hold.release();const result=await outcome;if(!result.ok)throw result.error;
      expect(result.value.status).toBe(threshold?429:200);await result.value.text();expect(f.posts).toBe(threshold?1:2);
      const rows=f.db.all('SELECT attemptId,state,costNanoUsd FROM apiKeyAccounting');expect(rows).toHaveLength(f.posts);
      expect(new Set(rows.map(row=>row.attemptId)).size).toBe(f.posts);expect(rows.every(row=>row.state==='settled'&&row.costNanoUsd===900000)).toBe(true);
    }finally{hold.release();await outcome;}
  });
  it('settles failed account before actual next-account POST with persisted owned cooldown',async()=>{
    let f;f=await setup(engine,{respond:(_req,res,count)=>{
      if(count===2)expect(f.db.get("SELECT state FROM apiKeyAccounting WHERE connectionId='connection-one'").state).toBe('settled');
      res.statusCode=count===1?402:200;res.setHeader('content-type','application/json');res.end(JSON.stringify(count===1?{error:{message:'credit exhausted'},usage:rawResponsesUsage()}:responsesReply()));
    }});
    f.db.durableTransaction(()=>f.db.run("INSERT INTO providerConnections SELECT 'connection-two',provider,authType,name,email,2,isActive,data,createdAt,updatedAt FROM providerConnections WHERE id='connection-one'"));
    const response=await f.request();expect(response.status).toBe(200);await response.text();expect(f.posts).toBe(2);
    expect(f.db.all('SELECT connectionId,state,costNanoUsd FROM apiKeyAccounting ORDER BY connectionId')).toEqual([
      {connectionId:'connection-one',state:'settled',costNanoUsd:900000},{connectionId:'connection-two',state:'settled',costNanoUsd:900000}]);
    expect(JSON.parse(f.db.get("SELECT data FROM providerConnections WHERE id='connection-one'").data).testStatus).toBe('unavailable');
  });
  it('does not retry when predecessor terminal ACK delivery is lost',async()=>{
    const f=await setup(engine,{respond:(_req,res)=>{res.statusCode=503;res.setHeader('content-type','application/json');res.end(JSON.stringify({error:{message:'retry'},usage:rawResponsesUsage()}));}});
    const response=await f.request({hooks:{terminalAck:()=>{throw new Error('own ACK lost');}}});expect(response.status).toBe(503);expect(f.posts).toBe(1);
    expect(f.db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({state:'settled',costNanoUsd:900000});
  });
  it('refuses credential refresh-like mutation after intent ACK rather than authorizing OAuth implicitly',async()=>{
    const f=await setup(engine);const response=await f.request({hooks:{intentAck:()=>f.db.durableTransaction(()=>f.db.run("UPDATE providerConnections SET data=json_set(data,'$.accessToken','unapproved-refresh')"))}});
    expect(response.status).toBe(503);expect(f.posts).toBe(0);expect(f.db.get('SELECT state FROM apiKeyAccounting').state).toBe('not_dispatched');
  });
  it('never follows redirect with credentials across origins',async()=>{
    const f=await setup(engine,{respond:(_req,res)=>{res.statusCode=307;res.setHeader('location','http://127.0.0.1:1/stolen');res.setHeader('content-type','application/json');res.end(JSON.stringify({error:{message:'redirect'},usage:rawResponsesUsage()}));}});
    const response=await f.request();expect(response.status).not.toBe(200);expect(f.posts).toBe(1);expect(f.db.get('SELECT costNanoUsd FROM apiKeyAccounting').costNanoUsd).toBe(900000);
  });
  it('rejects copied/stale receipt against actual request settlement while retaining one known charge',async()=>{
    const f=await setup(engine);let receipt;const response=await f.request({hooks:{intentAck:value=>receipt=value}});await response.text();
    const service=createAccountingService(f.db),evidence={state:'settled',outcome:'late',finishedAt:new Date().toISOString(),usage:normalizeResponsesUsage(rawResponsesUsage(),RESPONSES_EXPLICIT_USAGE_PROFILE)};
    await expect(service.completeAttempt({...receipt},evidence)).rejects.toThrow(/Own intent/);
    expect(f.db.all('SELECT costNanoUsd FROM apiKeyAccounting')).toEqual([{costNanoUsd:900000}]);
  });
  it('unavailable saved strict proxy refuses without a direct inference POST',async()=>{
    const f=await setup(engine,{proxy:true});f.db.durableTransaction(()=>f.db.run("UPDATE proxyPools SET data=json_set(data,'$.proxyUrl','http://127.0.0.1:1')"));
    const response=await f.request();expect(response.status).not.toBe(200);expect(f.posts).toBe(0);
    expect(f.db.all('SELECT costNanoUsd FROM apiKeyAccounting').every(row=>row.costNanoUsd===null)).toBe(true);
  });
  it('local bypass creates no inference attempt or debit',async()=>{
    const f=await setup(engine);const response=await f.request({ingress:'chat',userAgent:'claude-cli',body:{messages:[{role:'user',content:'Warmup'}]}});
    expect(response.status).toBe(200);expect(await response.text()).toContain('CLI Command Execution: Clear Terminal');
    expect(f.posts).toBe(0);expect(f.db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
    updateAccountingPolicy(f.db,'key-one',parseBudgetPolicy({weeklyLimitUsd:'0',monthlyLimitUsd:null,expectedVersion:1}),'2026-10-25T16:00:00.000Z');
    const normal=await f.request({ingress:'chat',userAgent:'claude-cli',body:{messages:[{role:'user',content:'Warmup please'}]}});
    expect(normal.status).toBe(429);expect((await normal.json()).error.code).toBe('api_key_budget_exceeded');
    expect(f.posts).toBe(0);expect(f.db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
});
