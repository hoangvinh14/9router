import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { insertAttemptSync } from '../../src/lib/db/repos/api-key-accounting-repo.js';
import { intent } from '../fixtures/accounting/test-database.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openChatFixture, rawUsage, gate, observe, reach, fixtureProvider } from '../fixtures/accounting/chat-loopback.js';
import { openFixture } from '../fixtures/accounting/test-database.js';
import { event, streamDelta, streamFinish, streamReply, respondStream } from '../fixtures/accounting/chat-stream.js';
let fixture;
const envKeys=['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'];
async function setup(engine,options){for(const key of envKeys)vi.stubEnv(key,'');fixture=await openChatFixture(engine,options);return fixture;}
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllEnvs();if(fixture){await fixture.close();fixture=null;}});
for(const engine of ['node','sqljs'])describe(`${engine} actual app SSE accounting`,()=>{
  it.each([[0,'0.25','1200000'],[400,'0.25','900000'],[1000,'0.25','450000'],[400,'0','800000'],[400,undefined,'1200000']])('settles cache %s rate %s with original prices after reopen',async(cached,rate,cost)=>{
    const f=await setup(engine,{rates:{input:'1',output:'2',...(rate===undefined?{}:{cached:rate})},respond:respondStream(streamReply(rawUsage(cached)))});
    const response=await f.request({stream:true});expect(response.status).toBe(200);const text=await response.text();expect(text).toContain('hello');expect(text).toContain('"finish_reason":"stop"');expect(text).toContain('[DONE]');expect(f.posts).toBe(1);expect(f.requests[0].body.stream_options.include_usage).toBe(true);
    const row=f.db.get('SELECT state,costNanoUsd,usageJson FROM apiKeyAccounting');expect(row.state).toBe('settled');expect(String(row.costNanoUsd)).toBe(cost);expect(JSON.parse(row.usageJson)).toMatchObject({input:1000,output:100,cacheRead:cached,cacheWrite:0});
    f.db.durableTransaction(()=>{});f.db.close();const reopened=await openFixture(engine,f.file);
    try{expect(String(reopened.db.get('SELECT costNanoUsd FROM apiKeyAccounting').costNanoUsd)).toBe(cost);expect(reopened.db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined();}finally{reopened.db.close();}
  });
  it('passes deltas while holding successful terminal for its own settlement ACK',async()=>{
    const entered=gate(),held=gate(),f=await setup(engine,{respond:respondStream(streamReply())});
    const response=await f.request({stream:true,hooks:{terminalAck:async()=>{entered.release();await held.promise;}}});const reader=response.body.getReader();
    try{const first=new TextDecoder().decode((await reader.read()).value);expect(first).toContain('hello');expect(first).not.toContain('"finish_reason":"stop"');let delivered=false;const pending=reader.read().then(v=>{delivered=true;return v;});await entered.promise;expect(delivered).toBe(false);expect(f.db.get('SELECT state FROM apiKeyAccounting').state).toBe('settled');held.release();let text=new TextDecoder().decode((await pending).value);while(true){const part=await reader.read();if(part.done)break;text+=new TextDecoder().decode(part.value);}expect(text).toContain('"finish_reason":"stop"');expect(text).toContain('[DONE]');}finally{held.release();await reader.cancel();}
  });
  it('holds intent ACK and rechecks current credentials before actual SSE POST',async()=>{
    const f=await setup(engine,{respond:respondStream(streamReply())}),entered=gate(),held=gate();
    const outcome=observe(f.request({stream:true,hooks:{intentAck:async()=>{entered.release();await held.promise;}}}));
    try{await reach(entered,outcome);expect(f.posts).toBe(0);f.db.durableTransaction(()=>f.db.run("UPDATE providerConnections SET data=json_set(data,'$.apiKey','changed')"));held.release();const result=await outcome;if(!result.ok)throw result.error;expect(result.value.status).toBe(503);expect(f.posts).toBe(0);}finally{held.release();await outcome;}
  });
  it('emits one native failure and no successful finish when settlement ACK is lost',async()=>{
    const f=await setup(engine,{respond:respondStream(streamReply())});const response=await f.request({stream:true,hooks:{terminalAck:()=>{throw new Error('own ACK lost');}}});const text=await response.text();expect(text).toContain('"error"');expect(text).not.toContain('"finish_reason":"stop"');expect((text.match(/"error"/g)||[])).toHaveLength(1);expect(f.db.get('SELECT state FROM apiKeyAccounting').state).toBe('settled');
  });
  it.each([
    event(streamDelta)+event(streamFinish)+event('[DONE]'),
    event(streamDelta)+event(streamFinish)+event({choices:[],usage:rawUsage(400)})+event({choices:[],usage:rawUsage(401)})+event('[DONE]'),
    event(streamDelta)+event(streamFinish)+event({choices:[],usage:{...rawUsage(),prompt_tokens_details:{}}})+event('[DONE]'),
  ])('keeps missing or conflicting protocol evidence unresolved (%#)',async text=>{
    const f=await setup(engine,{respond:respondStream(text)});const response=await f.request({stream:true});const output=await response.text();expect(output).toContain('"error"');expect(output).not.toContain('"finish_reason":"stop"');expect(f.db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({state:'unresolved',costNanoUsd:null});
  });
  it('charges authoritative usage before EOF without claiming protocol success',async()=>{
    const f=await setup(engine,{respond:respondStream(event(streamDelta)+event(streamFinish)+event({choices:[],usage:rawUsage()}))});
    const response=await f.request({stream:true}),text=await response.text();expect(text).toContain('"error"');expect(text).not.toContain('[DONE]');expect(text).not.toContain('"finish_reason":"stop"');
    expect(f.db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({state:'settled',costNanoUsd:1200000});
  });
  it('preserves original cache rate through post-dispatch price drift',async()=>{
    const f=await setup(engine,{respond:(_req,res)=>{f.db.durableTransaction(()=>f.db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key=?",[JSON.stringify({fixture:{input:'9',output:'9',cached:'9'}}),fixtureProvider]));respondStream(streamReply(rawUsage(400)))(_req,res);}});const response=await f.request({stream:true});await response.text();expect(f.db.get('SELECT costNanoUsd FROM apiKeyAccounting').costNanoUsd).toBe(900000);
  });
  it('keeps concurrent keys isolated on the shared executor',async()=>{
    const f=await setup(engine,{respond:respondStream(streamReply())});const responses=await Promise.all([f.request({stream:true}),f.request({stream:true,key:'fixture-secret-two'})]);const texts=await Promise.all(responses.map(r=>r.text()));expect(texts.every(text=>text.includes('"finish_reason":"stop"'))).toBe(true);expect(f.posts).toBe(2);expect(f.db.all('SELECT apiKeyId,state,costNanoUsd FROM apiKeyAccounting ORDER BY apiKeyId')).toEqual([{apiKeyId:'key-one',state:'settled',costNanoUsd:1200000},{apiKeyId:'key-two',state:'settled',costNanoUsd:1200000}]);
  });
  it('streams through the actual saved HTTP proxy',async()=>{const f=await setup(engine,{proxy:true,respond:respondStream(streamReply())});const response=await f.request({stream:true});expect(await response.text()).toContain('"finish_reason":"stop"');expect(f.posts).toBe(1);expect(f.connects).toBeGreaterThan(0);});
  it('aborts after native POST without releasing successful terminal',async()=>{const ctrl=new AbortController();const f=await setup(engine,{respond:(_req,res)=>{res.setHeader('content-type','text/event-stream');res.write(event(streamDelta));ctrl.abort();res.end();}});const response=await f.request({stream:true,signal:ctrl.signal});const text=await response.text();expect(text).not.toContain('"finish_reason":"stop"');expect(f.posts).toBe(1);expect(f.db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({state:'unrecorded',costNanoUsd:null});});
  it('does not emit completion when aborted during its own settlement ACK',async()=>{
    const entered=gate(),held=gate(),ctrl=new AbortController(),f=await setup(engine,{respond:respondStream(streamReply())});const response=await f.request({stream:true,signal:ctrl.signal,hooks:{terminalAck:async()=>{entered.release();await held.promise;}}});const reading=response.text();try{await entered.promise;ctrl.abort();const text=await reading;expect(text).not.toContain('"finish_reason":"stop"');expect(text).toContain('"error"');expect(f.db.get('SELECT state FROM apiKeyAccounting').state).toBe('settled');}finally{held.release();await reading;}
  });

  it('continues SSE from a fresh persisted unlimited proof and independent gap ACK',async()=>{
    const f=await setup(engine,{respond:respondStream(streamReply())});let injected=false;
    if(engine==='sqljs'){const rename=fs.renameSync;vi.spyOn(fs,'renameSync').mockImplementation((source,target)=>{if(!injected&&target===f.file){injected=true;throw new Error('recording failed');}return rename(source,target);});}
    else{const exec=DatabaseSync.prototype.exec;vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(sql,...args){if(!injected&&sql.startsWith('RELEASE sp_0_')){injected=true;throw new Error('recording failed');}return exec.call(this,sql,...args);});}
    expect(()=>insertAttemptSync(f.db,intent(f.db))).toThrow('recording failed');expect(injected).toBe(true);let gapAck=false;const response=await f.request({stream:true,hooks:{gapAck:()=>{gapAck=true;}}});expect(await response.text()).toContain('"finish_reason":"stop"');expect(gapAck).toBe(true);expect(f.posts).toBe(1);expect(f.db.coverage.status('key-one').gaps).toHaveLength(1);
  });
  it('rejects lost intent ACK before SSE POST',async()=>{const f=await setup(engine,{respond:respondStream(streamReply())});const response=await f.request({stream:true,hooks:{intentAck:()=>{throw new Error('lost own intent');}}});expect(response.status).toBe(503);expect(f.posts).toBe(0);expect(f.db.get('SELECT state FROM apiKeyAccounting').state).toBe('pending');});
  it('bounds actual SSE frame evidence and leaves cost unknown',async()=>{const f=await setup(engine,{respond:respondStream(event(streamDelta)+'data: '+'x'.repeat(256*1024))});const response=await f.request({stream:true});const text=await response.text();expect(text).toContain('"error"');expect(text).not.toContain('"finish_reason":"stop"');expect(f.db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({state:'unresolved',costNanoUsd:null});});

});
