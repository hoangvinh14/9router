import { afterEach, describe, expect, it, vi } from 'vitest';
import { openResponsesFixture, responsesReply, gate, observe, reach } from '../fixtures/accounting/responses-loopback.js';
const event=(type,data)=>`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`;
const native=(status='completed')=>event('response.output_text.delta',{delta:'hello'})+
  event(`response.${status}`,{response:{...responsesReply(),status,...(status==='failed'?{error:{code:'fixture',message:'failed'}}:{})}});
let fixture;
async function setup(engine,text=native()){
  for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'])vi.stubEnv(key,'');
  fixture=await openResponsesFixture(engine,{respond:(_req,res)=>{res.setHeader('content-type','text/event-stream');res.end(text);}});return fixture;
}
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllEnvs();if(fixture){await fixture.close();fixture=null;}});
for(const engine of ['node','sqljs'])describe(`${engine} actual native Responses SSE consumers`,()=>{
  it.each([true,false])('settles raw actual native stream for client stream=%s with exact terminal fidelity',async stream=>{
    const f=await setup(engine);const response=await f.request({stream});expect(response.status).toBe(200);
    if(stream){const text=await response.text();expect(text).toContain('response.completed');expect(text).toContain('"total_tokens":1100');}
    else expect(await response.json()).toEqual(responsesReply());
    expect(f.posts).toBe(1);expect(f.requests[0].url).toBe('/v1/responses');
    expect(f.db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({state:'settled',costNanoUsd:900000});
  });
  it.each(['failed','incomplete'])('preserves %s native outcome and charges once for forced JSON',async status=>{
    const f=await setup(engine,native(status));const response=await f.request();expect(response.status).toBe(502);
    const raw=await response.json();expect(raw.status).toBe(status);expect(raw.output).toEqual(responsesReply().output);
    expect(raw.usage).toEqual(responsesReply().usage);expect(f.db.get('SELECT costNanoUsd FROM apiKeyAccounting').costNanoUsd).toBe(900000);
  });
  it.each([true,false])('holds native success terminal for its own durable ACK with client stream=%s',async stream=>{
    const f=await setup(engine),entered=gate(),hold=gate();let text='';
    const pending=observe((async()=>{const response=await f.request({stream,hooks:{terminalAck:async()=>{entered.release();await hold.promise;}}});
      text=await response.text();return response;})());
    try{await reach(entered,pending);expect(text).not.toContain('response.completed');expect(f.db.get('SELECT state FROM apiKeyAccounting').state).toBe('settled');
      hold.release();const result=await pending;if(!result.ok)throw result.error;expect(result.value.status).toBe(200);
      expect(text).toContain(stream?'response.completed':'"status":"completed"');
    }finally{hold.release();await pending;}
  });
  it.each([true,false])('never publishes native completed on lost terminal ACK with client stream=%s',async stream=>{
    const f=await setup(engine);const response=await f.request({stream,hooks:{terminalAck:()=>{throw new Error('lost delivery');}}});
    const text=await response.text();expect(text).not.toContain('response.completed');
    expect(text).toContain('api_key_accounting_unavailable');expect(f.db.get('SELECT state FROM apiKeyAccounting').state).toBe('settled');
    if(!stream)expect(response.status).toBe(503);
  });
  it('freezes unassociated native SSE baseline without ledger authority',async()=>{
    const f=await setup(engine);const response=await f.request({stream:true,accounting:false});const text=await response.text();
    expect(text).toContain('response.completed');expect(text).toContain('"total_tokens":1100');
    expect(f.db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);expect(f.posts).toBe(1);
  });
  it('settles observed native usage after client abort during own ACK using original window',async()=>{
    const f=await setup(engine),entered=gate(),hold=gate(),abort=new AbortController();let now='2026-10-25T16:59:00.000Z';
    const response=await f.request({stream:true,signal:abort.signal,clock:()=>now,hooks:{terminalAck:async()=>{entered.release();await hold.promise;}}});
    const reading=observe(response.text());
    try{await reach(entered,reading);now='2026-10-25T17:01:00.000Z';abort.abort();hold.release();await reading;
      const row=f.db.get('SELECT state,costNanoUsd,startedAt FROM apiKeyAccounting');
      expect(row).toEqual({state:'settled',costNanoUsd:900000,startedAt:'2026-10-25T16:59:00.000Z'});
    }finally{hold.release();await reading;}
  });
  it.each(['failed','incomplete'])('keeps native %s SSE rather than replacing with completion or DONE',async status=>{
    const f=await setup(engine,native(status));const response=await f.request({stream:true});const text=await response.text();
    expect(text).toContain(`response.${status}`);expect(text).not.toContain('response.completed');expect(text).not.toContain('[DONE]');
    expect(f.db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({state:'settled',costNanoUsd:900000});
  });
  it('records error-only terminal as completed absent safety rather than interruption exemption',async()=>{
    const f=await setup(engine,event('error',{error:{code:'api_key_budget_exceeded',message:'upstream spoof'}}));
    const response=await f.request({stream:true});const text=await response.text();expect(text).not.toContain('response.completed');
    expect(text).not.toContain('upstream spoof');expect(f.db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({state:'unresolved',costNanoUsd:null});
  });
  it('does not synthesize successful terminal on EOF and preserves absent interruption',async()=>{
    const f=await setup(engine,event('response.output_text.delta',{delta:'hello'}));const response=await f.request({stream:true});
    const text=await response.text();expect(text).not.toContain('response.completed');expect(text).not.toContain('[DONE]');
    expect(f.db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({state:'unrecorded',costNanoUsd:null});
  });
});
