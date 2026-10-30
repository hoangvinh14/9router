import { afterEach, describe, expect, it, vi } from 'vitest';
import { openChatFixture, rawUsage, gate, observe, reach } from '../fixtures/accounting/chat-loopback.js';
import { streamReply, respondStream, event, streamDelta } from '../fixtures/accounting/chat-stream.js';
import { updateAccountingPolicy } from '../../src/lib/db/helpers/accounting-policy.js';
import { parseBudgetPolicy } from '../../src/lib/accounting/budget-policy.js';

let fixture;
afterEach(async()=>{vi.unstubAllEnvs();if(fixture){await fixture.close();fixture=null;}});
for(const engine of ['node','sqljs'])describe(`${engine} selected SSE budget`,()=>{
  async function setup(options={}){for(const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'])vi.stubEnv(name,'');fixture=await openChatFixture(engine,{respond:respondStream(streamReply()),...options});return fixture;}
  const policy=(f,w,m=null)=>updateAccountingPolicy(f.db,'key-one',parseBudgetPolicy({weeklyLimitUsd:w,monthlyLimitUsd:m,expectedVersion:1}),'2026-10-25T16:00:00.000Z');
  const clock=()=> '2026-10-25T16:00:00.000Z';
  it('ignores interrupted absent usage without an unknown blocker on the next request',async()=>{
    const f=await setup({respond:respondStream(event(streamDelta))});policy(f,'1');
    const first=await f.request({stream:true,clock});const text=await first.text();
    expect(text).not.toContain('[DONE]');expect(text).not.toContain('"finish_reason":"stop"');
    expect(f.db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toMatchObject({state:'unrecorded',costNanoUsd:null});
    const next=await f.request({stream:true,clock});await next.text();expect(next.status).toBe(200);expect(f.posts).toBe(2);
  });
  it('charges authoritative usage before EOF without releasing protocol success',async()=>{
    const incomplete=streamReply().replace(event('[DONE]'),'');expect(incomplete).not.toContain('[DONE]');
    const f=await setup({respond:respondStream(incomplete)});policy(f,'0.0012');
    const first=await f.request({stream:true,clock});const text=await first.text();expect(f.db.all('SELECT state,outcome,terminalJson FROM apiKeyAccounting')).toEqual(expect.arrayContaining([expect.objectContaining({state:'settled'})]));expect(text).not.toContain('[DONE]');expect(text).not.toContain('"finish_reason":"stop"');
    expect(f.db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toMatchObject({state:'settled',costNanoUsd:1200000});
    const next=await f.request({stream:true,clock});expect(next.status).toBe(429);expect(f.posts).toBe(1);
  });
  it.each(['malformed','conflicting'])('does not exempt observed %s SSE usage on interruption',async mode=>{
    const evidence=mode==='malformed'?event({choices:[],usage:{prompt_tokens:5}}):event({choices:[],usage:rawUsage(1)})+event({choices:[],usage:rawUsage(2)});
    const f=await setup({respond:respondStream(event(streamDelta)+evidence)});policy(f,'1');
    const first=await f.request({stream:true,clock});const text=await first.text();expect(text).not.toContain('[DONE]');
    expect(f.db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toMatchObject({state:'unresolved',costNanoUsd:null});
    const next=await f.request({stream:true,clock});expect(next.status).toBe(503);expect(f.posts).toBe(1);
  });
  it('settles SSE own terminal then successor gets native prestream429 no success marker',async()=>{
    const f=await setup();policy(f,'0.0012');const positive=await f.request({stream:true,clock});expect(positive.status).toBe(200);const text=await positive.text();expect(text).toContain('[DONE]');expect(text).toContain('"finish_reason":"stop"');
    const denied=await f.request({stream:true,clock});expect(denied.status).toBe(429);expect((await denied.json()).error.code).toBe('api_key_budget_exceeded');expect(denied.headers.get('cache-control')).toBe('no-store');expect(f.posts).toBe(1);expect(f.db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toMatchObject({state:'settled',costNanoUsd:1200000});
  });
  it('same-key in-flight SSE is not reservation, exact overshoot and next denial',async()=>{
    const entered=gate(),hold=gate();let count=0;
    const f=await setup({respond:async(_req,res)=>{if(++count===2)entered.release();await hold.promise;res.setHeader('content-type','text/event-stream');res.end(streamReply());}});policy(f,'0.0012');
    const pending=observe(Promise.all([f.request({stream:true,clock}),f.request({stream:true,clock})]));
    try{await reach(entered,pending);expect(f.posts).toBe(2);expect(f.db.all("SELECT state FROM apiKeyAccounting").every(row=>row.state==='pending')).toBe(true);hold.release();const result=await pending;if(!result.ok)throw result.error;
      const texts=await Promise.all(result.value.map(response=>response.text()));for(const text of texts)expect(text).toContain('[DONE]');
      expect(f.db.all('SELECT costNanoUsd FROM apiKeyAccounting').reduce((sum,row)=>sum+BigInt(row.costNanoUsd),0n)).toBe(2400000n);expect((await f.request({stream:true,clock})).status).toBe(429);expect(f.posts).toBe(2);
    }finally{hold.release();await pending;}
  });
  it('lost terminal ACK cannot synthesize successful SSE finish/DONE',async()=>{
    const f=await setup();policy(f,'1');const response=await f.request({stream:true,clock,hooks:{terminalAck:()=>{throw new Error('Lost own terminal acknowledgement');}}});
    expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');
    const text=await response.text();expect(text).toContain('api_key_accounting_unavailable');expect(text).not.toContain('[DONE]');expect(text).not.toContain('"finish_reason":"stop"');
    const errors=text.split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6))).filter(frame=>frame.error);
    expect(errors).toHaveLength(1);expect(errors[0].error.requestId).toBe(response.headers.get('x-request-id'));expect(text).not.toContain('Lost own terminal');expect(f.posts).toBe(1);expect(f.db.get('SELECT state FROM apiKeyAccounting').state).toBe('settled');
  });
});
