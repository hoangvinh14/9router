import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openChatFixture, fixtureProvider, rawUsage, jsonReply, gate, observe, reach } from '../fixtures/accounting/chat-loopback.js';
import { openFixture, intent, backupFixture } from '../fixtures/accounting/test-database.js';
import { insertAttemptSync } from '../../src/lib/db/repos/api-key-accounting-repo.js';
import { createAccountingService } from '../../src/lib/accounting/service.js';
import { normalizeOpenAIUsage, OPENAI_EXPLICIT_USAGE_PROFILE } from '../../open-sse/utils/accounting-openai-usage.js';

let fixture;
const envKeys=['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'];
async function setup(engine,options) {
  for(const key of envKeys)vi.stubEnv(key,'');
  fixture=await openChatFixture(engine,options);return fixture;
}
function recordingFault(engine) {
  let injected=false;
  if(engine==='sqljs'){
    const rename=fs.renameSync;
    vi.spyOn(fs,'renameSync').mockImplementation((source,target)=>{
      if(!injected&&target===fixture.file){injected=true;throw new Error('recording failed');}
      return rename(source,target);
    });
  }else{
    const exec=DatabaseSync.prototype.exec;
    vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(sql,...args){
      if(!injected&&sql.startsWith('RELEASE sp_0_')){injected=true;throw new Error('recording failed');}
      return exec.call(this,sql,...args);
    });
  }
  return ()=>expect(injected).toBe(true);
}
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllEnvs();if(fixture){await fixture.close();fixture=null;}});
for(const engine of ['node','sqljs'])describe(`${engine} actual app JSON accounting`,()=>{
  it.each([[0,'0.25','1200000'],[400,'0.25','900000'],[1000,'0.25','450000'],[400,'0','800000'],[400,undefined,'1200000']])('settles raw cache %s rate %s and survives reopen',async(cached,rate,expected)=>{
    const raw=jsonReply(rawUsage(cached));
    const f=await setup(engine,{rates:{input:'1',output:'2',...(rate===undefined?{}:{cached:rate})},respond:(_req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(raw));}});
    const response=await f.request();expect(response.status).toBe(200);expect((await response.json()).choices[0].message.content).toBe('hello');expect(f.posts).toBe(1);
    const row=f.db.get('SELECT * FROM apiKeyAccounting');expect(row.state).toBe('settled');expect(String(row.costNanoUsd)).toBe(expected);
    expect(JSON.parse(row.usageJson)).toMatchObject({input:1000,output:100,cacheRead:cached,cacheWrite:0});
    f.db.durableTransaction(()=>{});f.db.close();
    const reopened=await openFixture(engine,f.file);
    try{expect(String(reopened.db.get('SELECT costNanoUsd FROM apiKeyAccounting').costNanoUsd)).toBe(expected);expect(reopened.db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined();}
    finally{reopened.db.close();}
  });
  it('awaits its own intent and settlement ACKs',async()=>{
    const entered=gate(),intentHold=gate(),terminal=gate(),terminalHold=gate();const f=await setup(engine);
    let returned=false;const outcome=observe(f.request({hooks:{intentAck:async()=>{entered.release();await intentHold.promise;},terminalAck:async()=>{terminal.release();await terminalHold.promise;}}}).then(value=>{returned=true;return value;}));
    try{await reach(entered,outcome);expect(f.posts).toBe(0);intentHold.release();await reach(terminal,outcome);expect(f.posts).toBe(1);expect(returned).toBe(false);terminalHold.release();const result=await outcome;if(!result.ok)throw result.error;expect(result.value.status).toBe(200);await result.value.text();}
    finally{intentHold.release();terminalHold.release();await outcome;}
  });
  it('cannot dispatch from a visible intent whose ACK delivery is lost',async()=>{
    const f=await setup(engine);const response=await f.request({hooks:{intentAck:()=>{throw new Error('lost own intent ACK');}}});
    expect(response.status).toBe(503);expect(f.posts).toBe(0);expect(f.db.get('SELECT state FROM apiKeyAccounting').state).toBe('pending');
  });
  it('cannot return eligible JSON from a visible terminal whose ACK is lost',async()=>{
    const f=await setup(engine);const response=await f.request({hooks:{terminalAck:()=>{throw new Error('lost own terminal ACK');}}});
    expect(response.status).toBe(503);expect(f.posts).toBe(1);expect(f.db.get('SELECT state FROM apiKeyAccounting').state).toBe('settled');
  });
  it.each([
    "UPDATE apiKeys SET isActive=0 WHERE id='key-one'",
    "UPDATE providerConnections SET data=json_set(data,'$.apiKey','changed') WHERE id='connection-one'",
    "UPDATE providerNodes SET data=json_set(data,'$.baseUrl','http://invalid.example')",
    "UPDATE settings SET data=json_set(data,'$.providerOverrides','changed')",
  ])('refuses current-authority drift after intent await: %s',async sql=>{
    const f=await setup(engine);const response=await f.request({hooks:{intentAck:()=>f.db.durableTransaction(()=>f.db.run(sql))}});
    expect(response.status).toBe(503);expect(f.posts).toBe(0);expect(f.db.get('SELECT state FROM apiKeyAccounting').state).toBe('not_dispatched');
  });
  it('preserves the original cache price after upstream dispatch',async()=>{
    const f=await setup(engine,{respond:(_req,res)=>{
      f.db.durableTransaction(()=>f.db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key=?",[JSON.stringify({fixture:{input:'9',output:'9',cached:'9'}}),fixtureProvider]));
      res.setHeader('content-type','application/json');res.end(JSON.stringify(jsonReply(rawUsage(400))));
    }});
    const response=await f.request();expect(response.status).toBe(200);await response.text();
    expect(f.db.get('SELECT costNanoUsd FROM apiKeyAccounting').costNanoUsd).toBe(900000);
  });
  it('charges exact failed HTTP before returning the failure',async()=>{
    const f=await setup(engine,{respond:(_req,res)=>{res.statusCode=400;res.setHeader('content-type','application/json');res.end(JSON.stringify({error:{message:'invalid'},usage:rawUsage(400)}));}});
    const response=await f.request();expect(response.status).toBe(400);expect(f.posts).toBe(1);
    expect(f.db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({state:'settled',costNanoUsd:900000});
  });
  it('replays missing usage after its unresolved ACK with null cost',async()=>{
    const f=await setup(engine,{respond:(_req,res)=>{res.setHeader('content-type','application/json');const raw=jsonReply();delete raw.usage;res.end(JSON.stringify(raw));}});
    const response=await f.request();expect(response.status).toBe(200);await response.text();
    const row=f.db.get('SELECT state,costNanoUsd FROM apiKeyAccounting');
    expect(row).toEqual({state:'unresolved',costNanoUsd:null});
  });
  it('keeps two keys isolated on the cached Default executor',async()=>{
    const f=await setup(engine);const responses=await Promise.all([f.request(),f.request({key:'fixture-secret-two'})]);
    expect(responses.map(r=>r.status)).toEqual([200,200]);await Promise.all(responses.map(r=>r.text()));expect(f.posts).toBe(2);
    expect(f.db.all('SELECT apiKeyId,costNanoUsd FROM apiKeyAccounting ORDER BY apiKeyId')).toEqual([{apiKeyId:'key-one',costNanoUsd:1200000},{apiKeyId:'key-two',costNanoUsd:1200000}]);
  });
  it('dispatches through the saved HTTP proxy with a real own intent',async()=>{
    const f=await setup(engine,{proxy:true});const response=await f.request();expect(response.status).toBe(200);await response.text();expect(f.posts).toBe(1);expect(f.connects).toBeGreaterThan(0);
    expect(f.db.get('SELECT state FROM apiKeyAccounting').state).toBe('settled');
  });
  it('preserves healthy round-robin bookkeeping without accepting credential drift',async()=>{
    const f=await setup(engine,{settings:{fallbackStrategy:'round-robin'}});const response=await f.request();expect(response.status).toBe(200);await response.text();expect(f.posts).toBe(1);
    expect(JSON.parse(f.db.get('SELECT data FROM providerConnections').data).consecutiveUseCount).toBe(1);
  });
  it.each([false,true])('bootstraps fresh degraded unlimited requests, proxy=%s',async proxy=>{
    const f=await setup(engine,{proxy});const injected=recordingFault(engine);
    expect(()=>insertAttemptSync(f.db,intent(f.db))).toThrow('recording failed');injected();
    const ordinary=vi.spyOn(f.db,'get');
    const response=await f.request();expect(response.status).toBe(200);await response.text();expect(f.posts).toBe(1);expect(ordinary).not.toHaveBeenCalled();
    expect(f.db.coverage.status('key-one').gaps).toHaveLength(1);
  });
  it('requires delivered independent gap ACK despite visible durable gap',async()=>{
    const f=await setup(engine);const injected=recordingFault(engine);expect(()=>insertAttemptSync(f.db,intent(f.db))).toThrow();injected();
    const response=await f.request({hooks:{gapAck:()=>{throw new Error('gap ACK lost');}}});expect(response.status).toBe(503);expect(f.posts).toBe(0);expect(f.db.coverage.status('key-one').gaps).toHaveLength(1);
  });
  it('settles an empty successful predecessor before real combo fallback',async()=>{
    const f=await setup(engine,{respond:(_req,res,count)=>{
      if(count===2)expect(f.db.get('SELECT state FROM apiKeyAccounting ORDER BY startedAt LIMIT 1').state).toBe('settled');
      const raw=jsonReply();if(count===1){raw.choices[0].message.content='';raw.choices[0].finish_reason='incomplete';}
      res.setHeader('content-type','application/json');res.end(JSON.stringify(raw));
    }});
    f.db.durableTransaction(()=>f.db.run('INSERT INTO combos(id,name,models,createdAt,updatedAt) VALUES(?,?,?,?,?)',
      ['combo-one','FixtureCombo',JSON.stringify(['fixture-node/fixture',`${fixtureProvider}/fixture`]),new Date().toISOString(),new Date().toISOString()]));
    const response=await f.request({model:'FixtureCombo'});expect(response.status).toBe(200);expect((await response.json()).choices[0].message.content).toBe('hello');expect(f.posts).toBe(2);
    expect(f.db.all('SELECT state FROM apiKeyAccounting')).toEqual([{state:'settled'},{state:'settled'}]);
  });
  it('does not turn local refusal into combo fallback or account cooldown',async()=>{
    const f=await setup(engine);f.db.durableTransaction(()=>f.db.run('INSERT INTO combos(id,name,models,createdAt,updatedAt) VALUES(?,?,?,?,?)',
      ['combo-one','FixtureCombo',JSON.stringify(['fixture-node/fixture',`${fixtureProvider}/fixture`]),new Date().toISOString(),new Date().toISOString()]));
    const before=f.db.get('SELECT data FROM providerConnections').data;
    const response=await f.request({model:'FixtureCombo',hooks:{intentAck:()=>{throw new Error('lost own ACK');}}});
    expect(response.status).toBe(503);expect(f.posts).toBe(0);expect(f.db.all('SELECT state FROM apiKeyAccounting')).toHaveLength(1);expect(f.db.get('SELECT data FROM providerConnections').data).toBe(before);
  });
  it('settles failed exact HTTP before actual account successor',async()=>{
    const f=await setup(engine,{respond:(_req,res,count)=>{
      res.setHeader('content-type','application/json');res.statusCode=count===1?402:200;
      res.end(JSON.stringify(count===1?{error:{message:'account credit exhausted'},usage:rawUsage()}:jsonReply()));
    }});
    f.db.durableTransaction(()=>f.db.run("INSERT INTO providerConnections SELECT 'connection-two',provider,authType,name,email,2,isActive,data,createdAt,updatedAt FROM providerConnections WHERE id='connection-one'"));
    const response=await f.request();expect(response.status).toBe(200);await response.text();expect(f.posts).toBe(2);
    expect(f.db.all('SELECT connectionId,state FROM apiKeyAccounting ORDER BY connectionId')).toEqual([{connectionId:'connection-one',state:'settled'},{connectionId:'connection-two',state:'settled'}]);
  });
  it('aborts while intent ACK is held without a POST',async()=>{
    const f=await setup(engine),ctrl=new AbortController();
    const response=await f.request({signal:ctrl.signal,hooks:{intentAck:()=>ctrl.abort()}});
    expect(response.status).toBe(503);expect(f.posts).toBe(0);expect(f.db.get('SELECT state FROM apiKeyAccounting').state).toBe('not_dispatched');
  });
  it('pins authority before the body parsing await',async()=>{
    const f=await setup(engine);
    // Request.json is the real await boundary; the native body still supplies payload.
    const { associateChatAccountingFixture }=await import('../../src/sse/services/chat-accounting.js');
    const { handleChat }=await import('../../src/sse/handlers/chat.js');
    const request=new Request('http://localhost/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer fixture-secret'},body:JSON.stringify({model:'fixture-node/fixture',messages:[{role:'user',content:'hello'}]})});
    const json=request.json.bind(request);request.json=async()=>{const body=await json();f.db.durableTransaction(()=>f.db.run("UPDATE apiKeys SET isActive=0 WHERE id='key-one'"));return body;};
    associateChatAccountingFixture(request,f.db);expect((await handleChat(request)).status).not.toBe(200);expect(f.posts).toBe(0);
  });
  it('holds its own gap ACK before dispatch and rechecks drift after delivery',async()=>{
    const f=await setup(engine),entered=gate(),held=gate();const injected=recordingFault(engine);expect(()=>insertAttemptSync(f.db,intent(f.db))).toThrow();injected();
    const outcome=observe(f.request({hooks:{gapAck:async()=>{entered.release();await held.promise;}}}));
    try{await reach(entered,outcome);expect(f.posts).toBe(0);expect(f.db.coverage.status('key-one').gaps).toHaveLength(1);f.db.coverage.enterMaintenance('fixture maintenance');held.release();const result=await outcome;if(!result.ok)throw result.error;expect(result.value.status).toBe(503);expect(f.posts).toBe(0);}
    finally{held.release();await outcome;}
  });
  it('enforces persisted restricted access during degraded bootstrap',async()=>{
    const f=await setup(engine);f.db.durableTransaction(()=>f.db.run("UPDATE apiKeys SET accessRestricted=1,accessAllow=? WHERE id='key-one'",[JSON.stringify([`${fixtureProvider}/other`])]));
    backupFixture(f.db,f.file);const injected=recordingFault(engine);expect(()=>insertAttemptSync(f.db,intent(f.db))).toThrow();injected();
    expect((await f.request()).status).toBe(503);expect(f.posts).toBe(0);expect(f.db.coverage.status('key-one').gaps).toHaveLength(0);
  });
  it('retains late settlement after app disposal and rejects conflicting duplicate observations',async()=>{
    const f=await setup(engine,{respond:(_req,res)=>{const raw=jsonReply();delete raw.usage;res.setHeader('content-type','application/json');res.end(JSON.stringify(raw));}});
    let receipt;const response=await f.request({hooks:{intentAck:value=>{receipt=value;}}});expect(response.status).toBe(200);await response.text();
    expect(f.db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({state:'unresolved',costNanoUsd:null});
    const service=createAccountingService(f.db),evidence={state:'settled',outcome:'late_exact_usage',finishedAt:new Date().toISOString(),usage:normalizeOpenAIUsage(rawUsage(400),OPENAI_EXPLICIT_USAGE_PROFILE)};
    await service.completeAttempt(receipt,evidence);await service.completeAttempt(receipt,evidence);
    expect(f.db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({state:'settled',costNanoUsd:900000});
    await expect(service.completeAttempt({...receipt},evidence)).rejects.toThrow(/Own intent/);
    await expect(service.completeAttempt(receipt,{...evidence,usage:normalizeOpenAIUsage(rawUsage(401),OPENAI_EXPLICIT_USAGE_PROFILE)})).rejects.toThrow(/conflict/);
    expect(f.db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(1);expect(f.db.get('SELECT costNanoUsd FROM apiKeyAccounting').costNanoUsd).toBe(900000);
  });
  it('recovers an unacknowledged persisted intent as unresolved after restart',async()=>{
    const f=await setup(engine);expect((await f.request({hooks:{intentAck:()=>{throw new Error('ACK lost');}}})).status).toBe(503);expect(f.posts).toBe(0);
    const before=f.db.get('SELECT apiKeyId,priceSnapshotJson FROM apiKeyAccounting');f.db.close();
    const reopened=await openFixture(engine,f.file);
    try{expect(reopened.db.get('SELECT apiKeyId,priceSnapshotJson,state,costNanoUsd FROM apiKeyAccounting')).toEqual({...before,state:'unresolved',costNanoUsd:null});}
    finally{reopened.db.close();}
  });
  it('verifies persisted authority immediately before every healthy POST',async()=>{
    const f=await setup(engine),proof=vi.spyOn(f.db,'withPersistedAccountingAuthority');
    const response=await f.request();expect(response.status).toBe(200);await response.text();
    expect(proof).toHaveBeenCalledTimes(1);expect(f.posts).toBe(1);
  });
  it('refuses a persisted proof failure after healthy intent ACK',async()=>{
    const f=await setup(engine);
    const response=await f.request({hooks:{intentAck:()=>{vi.spyOn(f.db,'withPersistedAccountingAuthority').mockImplementationOnce(()=>{throw new Error('persisted mismatch');});}}});
    expect(response.status).toBe(503);expect(f.posts).toBe(0);expect(f.db.get('SELECT state FROM apiKeyAccounting').state).toBe('not_dispatched');
  });
  it('switches from healthy entry to persisted continuation when intent publication fails',async()=>{
    const f=await setup(engine),injected=recordingFault(engine);
    const response=await f.request();injected();expect(response.status).toBe(200);await response.text();expect(f.posts).toBe(1);expect(f.db.health().healthy).toBe(false);
    expect(f.db.coverage.status('key-one').gaps).toHaveLength(1);
  });
  it('checks accounting schema even on healthy entry',async()=>{
    const f=await setup(engine);f.db.durableTransaction(()=>f.db.run('DROP TRIGGER accounting_audit_no_update'));
    expect((await f.request()).status).toBe(503);expect(f.posts).toBe(0);
  });
  it('records unresolved exposure after abort following the native POST',async()=>{
    const ctrl=new AbortController(),f=await setup(engine,{respond:(_req,res)=>{res.setHeader('content-type','application/json');res.flushHeaders();res.write('{');ctrl.abort();res.end();}});
    const response=await f.request({signal:ctrl.signal});expect([499,503]).toContain(response.status);expect(f.posts).toBe(1);
    expect(f.db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({state:'unresolved',costNanoUsd:null});
  });
  it('bounds oversized raw JSON and records unknown cost',async()=>{
    const f=await setup(engine,{respond:(_req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({padding:'x'.repeat(8*1024*1024),...jsonReply()}));}});
    const response=await f.request();expect(response.status).toBe(503);expect(f.posts).toBe(1);
    expect(f.db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({state:'unresolved',costNanoUsd:null});
  });
  it('refuses unrelated credentials changed during owned account-failure bookkeeping',async()=>{
    const f=await setup(engine,{respond:(_req,res)=>{res.statusCode=402;res.setHeader('content-type','application/json');res.end(JSON.stringify({error:{message:'account credit exhausted'},usage:rawUsage()}));}});
    f.db.durableTransaction(()=>f.db.run("INSERT INTO providerConnections SELECT 'connection-two',provider,authType,name,email,2,isActive,data,createdAt,updatedAt FROM providerConnections WHERE id='connection-one'"));
    const run=f.db.run.bind(f.db);let changed=false;
    vi.spyOn(f.db,'run').mockImplementation((sql,params)=>{
      const value=run(sql,params);
      if(!changed&&sql.includes('INSERT INTO providerConnections')&&params?.[0]==='connection-one'){
        changed=true;run("UPDATE providerConnections SET data=json_set(data,'$.apiKey','external-change') WHERE id='connection-two'");
      }
      return value;
    });
    const response=await f.request();expect(changed).toBe(true);expect(response.status).toBe(503);expect(f.posts).toBe(1);expect(f.db.all('SELECT state FROM apiKeyAccounting')).toEqual([{state:'settled'}]);
  });
  it('refuses finite policy after recording failure',async()=>{
    const f=await setup(engine);f.db.durableTransaction(()=>f.db.run("UPDATE apiKeyBudgetPolicies SET weeklyLimitNanoUsd=0 WHERE apiKeyId='key-one'"));backupFixture(f.db,f.file);
    const injected=recordingFault(engine);expect(()=>insertAttemptSync(f.db,intent(f.db))).toThrow();injected();
    expect((await f.request()).status).toBe(503);expect(f.posts).toBe(0);
  });
  it('retains unknown exposure when a native JSON body is truncated',async()=>{
    const f=await setup(engine,{respond:(_req,res)=>{res.setHeader('content-type','application/json');res.setHeader('content-length','999');res.flushHeaders();res.write('{"usage":');res.destroy();}});const response=await f.request();expect(response.status).toBe(503);expect(f.posts).toBe(1);expect(f.db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({state:'unresolved',costNanoUsd:null});
  });

});
