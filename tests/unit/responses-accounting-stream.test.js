import { describe, expect, it, vi } from 'vitest';
import { createAccountedResponsesStream } from '../../open-sse/utils/accounting-responses-stream.js';
import { RESPONSES_EXPLICIT_USAGE_PROFILE as profile } from '../../open-sse/config/accountingProfiles.js';
import { accountingStreamActivity } from '../../open-sse/utils/accounting-stream-activity.js';
import { createStreamController, pipeWithDisconnect } from '../../open-sse/utils/streamHandler.js';
import { responsesReply } from '../fixtures/accounting/responses-loopback.js';
const enc=new TextEncoder();
const event=(type,data)=>`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`;
const terminal=(status='completed',raw=responsesReply())=>event(`response.${status}`,{response:{...raw,status}});
const rawResponse=(text,split=false)=>new Response(new ReadableStream({start(c){const bytes=enc.encode(text);if(split)for(const byte of bytes)c.enqueue(new Uint8Array([byte]));else c.enqueue(bytes);c.close();}}),{headers:{'content-type':'text/event-stream'}});
const wrap=(response,finish=vi.fn(async()=>{}),signal)=>({response:createAccountedResponsesStream(response,{finish},{profile,signal}),finish});
describe('native raw Responses SSE authority',()=>{
  it.each(['completed','failed','incomplete'])('settles %s terminal without Chat DONE and retains native bytes',async status=>{
    const text=terminal(status);const {response,finish}=wrap(rawResponse(text));expect(await response.text()).toBe(text);
    expect(finish).toHaveBeenCalledTimes(1);expect(finish.mock.calls[0][0]).toMatchObject({input:1000,output:100,cacheRead:400,reasoning:20});
    expect(finish.mock.calls[0][2]).toMatchObject({kind:'valid',interrupted:false});
  });
  it('holds terminal until own ACK and cancels sole reader at cutoff',async()=>{
    let release,entered;const hold=new Promise(r=>release=r),gate=new Promise(r=>entered=r);let cancelled=0;
    const source=new Response(new ReadableStream({start(c){c.enqueue(enc.encode(terminal()));},cancel(){cancelled++;}}),{headers:{'content-type':'text/event-stream'}});
    const {response}=wrap(source,vi.fn(async()=>{entered();await hold;}));let returned=false;
    const pending=response.text().then(text=>{returned=true;return text;});
    try{await gate;expect(returned).toBe(false);expect(cancelled).toBe(1);release();expect(await pending).toContain('response.completed');}finally{release();await pending.catch(()=>{});}
  });
  it('handles every-byte UTF8, CRLF and multiline data',async()=>{
    const raw=responsesReply();raw.output[0].content[0].text='café 🌍';
    const text=`event: response.completed\r\ndata: {"type":"response.completed",\r\ndata: "response":${JSON.stringify(raw)}}\r\n\r\n`;
    const {response,finish}=wrap(rawResponse(text,true));expect(await response.text()).toContain('café 🌍');expect(finish.mock.calls[0][0]?.exact).toBe(true);
  });
  it('collapses identical terminals already read in one transport chunk',async()=>{
    const {response,finish}=wrap(rawResponse(terminal()+terminal()));expect((await response.text()).match(/event: response.completed/g)).toHaveLength(1);expect(finish).toHaveBeenCalledTimes(1);
  });
  it.each([
    ()=>terminal()+terminal('failed'),
    ()=>terminal()+terminal('completed',{...responsesReply(),id:'different'}),
    ()=>terminal()+terminal('completed',{...responsesReply(),usage:{...responsesReply().usage,input_tokens:1001,total_tokens:1101}}),
    ()=>terminal()+'trailing',
    ()=>terminal()+event('error',{error:{message:'trailing'}}),
    ()=>terminal()+event('response.done',{response:responsesReply()}),
    ()=>event('response.completed',{response:{...responsesReply(),status:'failed'}}),
    ()=>`event: response.completed\ndata: ${JSON.stringify({type:'response.failed',response:responsesReply()})}\n\n`,
    ()=>event('response.created',{response:{id:'other'}})+terminal(),
    ()=>terminal('completed',{...responsesReply(),usage:undefined}),
    ()=>terminal('completed',{...responsesReply(),output:[{type:'web_search_call'}]}),
    ()=>`data: [DONE]\n\n`,
    ()=>`event: response.completed\ndata: {`,
    ()=>`data: ${'x'.repeat(270000)}\n\n`,
  ])('rejects contradictory/malformed/absent terminal without exact settlement',async text=>{
    const {response,finish}=wrap(rawResponse(text()));await expect(response.text()).rejects.toThrow();expect(finish).toHaveBeenCalledTimes(1);
    expect(finish.mock.calls[0][0]).toBeNull();expect(finish.mock.calls[0][2].kind).not.toBe('valid');
  });
  it('classifies EOF without terminal as interrupted+absent but not error-only terminal',async()=>{
    const delta=event('response.output_text.delta',{delta:'hello'});
    const a=wrap(rawResponse(delta));await expect(a.response.text()).rejects.toThrow();expect(a.finish.mock.calls[0][2]).toMatchObject({kind:'absent',interrupted:true});
    const b=wrap(rawResponse(event('error',{error:{message:'provider failed'}})));await expect(b.response.text()).rejects.toThrow();expect(b.finish.mock.calls[0][2]).toMatchObject({kind:'absent',interrupted:false});
  });
  it('does not use usage from a delta as authoritative evidence',async()=>{
    const {response,finish}=wrap(rawResponse(event('response.output_text.delta',{delta:'hello',usage:responsesReply().usage})));
    await expect(response.text()).rejects.toThrow();expect(finish.mock.calls[0][0]).toBeNull();
  });
  it('preserves DB rejection once and never publishes held success',async()=>{
    const error=new Error('own sink failed');const {response,finish}=wrap(rawResponse(terminal()),vi.fn(async()=>{throw error;}));
    await expect(response.text()).rejects.toBe(error);expect(finish).toHaveBeenCalledTimes(1);
  });
  it('consumes already-received terminal evidence on cancellation after a delta from the same chunk',async()=>{
    const {response,finish}=wrap(rawResponse(event('response.output_text.delta',{delta:'hello'})+terminal()));
    const reader=response.body.getReader();await reader.read();await reader.cancel('client cancelled');reader.releaseLock();
    expect(finish).toHaveBeenCalledTimes(1);expect(finish.mock.calls[0][0]?.exact).toBe(true);
  });
  it('refuses conflicting already-received terminal even when cancelled after the delta',async()=>{
    const {response,finish}=wrap(rawResponse(event('response.output_text.delta',{delta:'hello'})+terminal()+terminal('failed')));
    const reader=response.body.getReader();await reader.read();await reader.cancel('client cancelled');reader.releaseLock();
    expect(finish).toHaveBeenCalledTimes(1);expect(finish.mock.calls[0][0]).toBeNull();
    expect(finish.mock.calls[0][2].kind).toBe('conflicting');
  });
  it('records cancelled partial buffered evidence as malformed, never absent',async()=>{
    const source=new Response(new ReadableStream({start(c){c.enqueue(enc.encode(event('response.output_text.delta',{delta:'hello'})+'data: {'));}}));
    const {response,finish}=wrap(source);const reader=response.body.getReader();await reader.read();await reader.cancel();reader.releaseLock();
    expect(finish.mock.calls[0][2].kind).toBe('malformed');expect(finish.mock.calls[0][0]).toBeNull();
  });
  it('classifies partial-only prior chunk when cancelled during the next pending read',async()=>{
    let entered;const nextRead=new Promise(r=>entered=r);let pulls=0;
    const source=new Response(new ReadableStream({pull(c){pulls++;if(pulls===1)c.enqueue(enc.encode('data: {'));else entered();}}));
    const {response,finish}=wrap(source);const reader=response.body.getReader();const reading=reader.read();
    await nextRead;await reader.cancel();await reading;reader.releaseLock();
    expect(finish.mock.calls[0][2].kind).toBe('malformed');
  });
  it('rejects invalid UTF8 and retains malformed rather than absent',async()=>{
    const source=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([0xff]));c.close();}}));
    const {response,finish}=wrap(source);await expect(response.text()).rejects.toThrow();expect(finish.mock.calls[0][2].kind).toBe('malformed');
  });
  it.each(['completed','failed','incomplete'])('accepts response.done only with embedded %s terminal',async status=>{
    const text=event('response.done',{response:{...responsesReply(),status}});const {response,finish}=wrap(rawResponse(text));
    expect(await response.text()).toBe(text);expect(finish.mock.calls[0][0]?.exact).toBe(true);
  });
  it('never lets a nonsettling cancel promise hold durable terminal ACK',async()=>{
    const source=new Response(new ReadableStream({start(c){c.enqueue(enc.encode(terminal()));},cancel(){return new Promise(()=>{});}}),{headers:{'content-type':'text/event-stream'}});
    const {response,finish}=wrap(source);expect(await response.text()).toContain('response.completed');expect(finish).toHaveBeenCalledTimes(1);
  });
  it('bounds per-frame state without depending on transport chunk partition',async()=>{
    const text=event('response.output_text.delta',{delta:'x'.repeat(1000)}).repeat(600)+terminal();
    const {response,finish}=wrap(rawResponse(text));expect((await response.text()).length).toBe(text.length);expect(finish).toHaveBeenCalledTimes(1);
  });
  it('removes abort listener and releases upstream reader after terminal settlement',async()=>{
    const abort=new AbortController(),remove=vi.spyOn(abort.signal,'removeEventListener');const source=rawResponse(terminal());
    const {response}=wrap(source,vi.fn(async()=>{}),abort.signal);await response.text();
    expect(source.body.locked).toBe(false);expect(remove).toHaveBeenCalledWith('abort',expect.any(Function));remove.mockRestore();
  });
  it('uses raw activity for watchdog and disables it while own ACK holds terminal bytes',async()=>{
    vi.useFakeTimers();let upstream,release;const hold=new Promise(r=>release=r),ctrl=createStreamController();
    const {response}=wrap(new Response(new ReadableStream({start(c){upstream=c;}})),vi.fn(()=>hold),ctrl.signal);
    const activity=accountingStreamActivity(response),seen=[];const unsubscribe=activity.subscribe((size,done)=>seen.push({size,done}));
    const reading=new Response(pipeWithDisconnect(response,new TransformStream(),ctrl,null,30)).text();
    try{
      for(let i=0;i<4;i++){upstream.enqueue(enc.encode(': raw activity'));await vi.advanceTimersByTimeAsync(20);expect(ctrl.signal.aborted).toBe(false);}
      upstream.enqueue(enc.encode('\n\n'+terminal()));await vi.advanceTimersByTimeAsync(100);
      expect(ctrl.signal.aborted).toBe(false);expect(seen.at(-1).done).toBe(true);release();expect(await reading).toContain('response.completed');
      expect(vi.getTimerCount()).toBe(0);unsubscribe();
    }finally{release();vi.useRealTimers();}
  });
  it('abort during pending ACK preserves the persistence error over abort reason',async()=>{
    const abort=new AbortController();let reject,entered;const hold=new Promise((_resolve,r)=>reject=r),gate=new Promise(r=>entered=r);
    const error=new Error('terminal write failed');const {response,finish}=wrap(rawResponse(terminal()),vi.fn(()=>{entered();return hold;}),abort.signal);
    const pending=response.text().then(value=>({value}),error=>({error}));
    await gate;abort.abort(new Error('client cancelled'));reject(error);expect((await pending).error).toBe(error);expect(finish).toHaveBeenCalledTimes(1);
  });
  it('cancellation after valid observed usage retains settlement but publishes no success',async()=>{
    const abort=new AbortController();let release,entered;const hold=new Promise(r=>release=r),gate=new Promise(r=>entered=r);
    const {response,finish}=wrap(rawResponse(terminal()),vi.fn(async()=>{entered();await hold;}),abort.signal);
    const reader=response.body.getReader();const pending=reader.read().then(value=>({value}),error=>({error}));
    try{await gate;abort.abort();release();const result=await pending;expect(result.error).toBeTruthy();expect(finish.mock.calls[0][0]?.exact).toBe(true);expect(finish).toHaveBeenCalledTimes(1);}
    finally{release();await pending;reader.releaseLock();}
  });
});
