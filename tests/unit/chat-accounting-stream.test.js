import { describe, it, expect, vi } from 'vitest';
import { createAccountedStream, accountingStreamActivity } from '../../open-sse/utils/accounting-openai-stream.js';
import { OPENAI_EXPLICIT_USAGE_PROFILE } from '../../open-sse/utils/accounting-openai-usage.js';
import { createStreamController, pipeWithDisconnect } from '../../open-sse/utils/streamHandler.js';
const usage = {prompt_tokens:1000,completion_tokens:100,total_tokens:1100,prompt_tokens_details:{cached_tokens:400},completion_tokens_details:{reasoning_tokens:0}};
const frame = value => `data: ${typeof value==='string'?value:JSON.stringify(value)}\n\n`;
const delta = {choices:[{index:0,delta:{content:'héllo'},finish_reason:null}]};
const finish = {choices:[{index:0,delta:{},finish_reason:'stop'}]};
const trailer = {choices:[],usage};
const source = (text,size=999999) => { const bytes=new TextEncoder().encode(text);let offset=0;return new Response(new ReadableStream({pull(c){if(offset>=bytes.length){c.close();return;}const end=Math.min(offset+size,bytes.length);c.enqueue(bytes.subarray(offset,end));offset=end;}}),{headers:{'content-type':'text/event-stream'}}); };
function wrap(text,{size,hold,signal}={}){const calls=[];const response=createAccountedStream(source(text,size),{async finish(value,outcome){calls.push({value,outcome});await hold;}},{profile:OPENAI_EXPLICIT_USAGE_PROFILE,signal});return {response,calls};}
const complete = frame(delta)+frame(finish)+frame(trailer)+frame('[DONE]');
describe('raw accounting SSE evidence',()=>{
  it.each([1,2,7,4096])('parses fragmented UTF-8 and frames at %s bytes',async size=>{const {response,calls}=wrap(complete,{size});const text=await response.text();expect(text).toContain('héllo');expect(text).toContain('[DONE]');expect(calls).toHaveLength(1);expect(calls[0].value).toMatchObject({input:1000,cacheRead:400});});
  it('parses CRLF and multiline data',async()=>{const text=frame(delta).replaceAll('\n','\r\n')+'data: {"choices":[],\r\ndata: "usage":'+JSON.stringify(usage)+'}\r\n\r\n'+frame(finish)+frame('[DONE]');const {response,calls}=wrap(text,{size:1});expect(await response.text()).toContain('[DONE]');expect(calls[0].value.cacheRead).toBe(400);});
  it('splits a mixed delta and finish and holds completion behind own ACK',async()=>{let release,entered;const hold=new Promise(r=>{release=r;});const terminal=new Promise(r=>{entered=r;});const mixed={choices:[{index:0,delta:{content:'mixed'},finish_reason:'stop'}],usage};const response=createAccountedStream(source(frame(mixed)+frame('[DONE]')),{async finish(){entered();await hold;}},{profile:OPENAI_EXPLICIT_USAGE_PROFILE});const reader=response.body.getReader();try{const first=new TextDecoder().decode((await reader.read()).value);expect(first).toContain('mixed');expect(first).not.toContain('"finish_reason":"stop"');let delivered=false;const pending=reader.read().then(v=>{delivered=true;return v;});await terminal;expect(delivered).toBe(false);release();const last=new TextDecoder().decode((await pending).value);expect(last).toContain('"finish_reason":"stop"');expect(last).not.toContain('mixed');while(!(await reader.read()).done){} }finally{release();await reader.cancel();}});
  it('accepts identical usage once',async()=>{const {response,calls}=wrap(frame(delta)+frame(finish)+frame(trailer)+frame(trailer)+frame('[DONE]'));await response.text();expect(calls).toHaveLength(1);expect(calls[0].value.cacheRead).toBe(400);});
  it.each([
    frame(delta)+frame(finish)+frame('[DONE]'),
    frame(delta)+frame(finish)+frame(trailer),
    frame(delta)+frame(trailer)+frame('[DONE]'),
    frame(delta)+frame(finish)+frame(trailer)+frame({usage:{...usage,prompt_tokens_details:{cached_tokens:401}}})+frame('[DONE]'),
    complete+frame({usage}),
    frame(delta)+'data: '+ 'x'.repeat(256*1024),
    frame(delta)+frame({error:{message:'failed'}}),
    frame(delta)+'data: invalid\n\n',
  ])('fails incomplete, contradictory or unbounded protocol without successful close (%#)',async text=>{const {response,calls}=wrap(text);await expect(response.text()).rejects.toThrow();expect(calls).toHaveLength(1);expect(calls[0].value).toBeNull();});
  it('rejects invalid UTF-8',async()=>{const response=createAccountedStream(new Response(new Uint8Array([0xff])),{finish:async()=>{}},{profile:OPENAI_EXPLICIT_USAGE_PROFILE});await expect(response.text()).rejects.toThrow();});
  it('does not release terminal after lost ACK',async()=>{const response=createAccountedStream(source(complete),{finish:async()=>{throw new Error('ACK lost');}},{profile:OPENAI_EXPLICIT_USAGE_PROFILE});await expect(response.text()).rejects.toThrow();});
  it('cancels its reader and records unknown evidence',async()=>{let cancelled=false;const calls=[];const response=createAccountedStream(new Response(new ReadableStream({pull(c){c.enqueue(new TextEncoder().encode(frame(delta)));},cancel(){cancelled=true;}})),{finish:async value=>{calls.push(value);}},{profile:OPENAI_EXPLICIT_USAGE_PROFILE});const reader=response.body.getReader();await reader.read();await reader.cancel();expect(cancelled).toBe(true);expect(calls).toEqual([null]);});
  it('notifies raw bytes and completion while terminal ACK is held',async()=>{let release;const hold=new Promise(r=>{release=r;});const {response}=wrap(complete,{hold});const events=[];accountingStreamActivity(response).subscribe((size,done)=>events.push({size,done}));const pending=response.text();await new Promise(r=>setImmediate(r));expect(events.some(e=>e.size>0)).toBe(true);expect(events.at(-1).done).toBe(true);release();await pending;});
  it('keeps the raw-byte stall watchdog alive during fragmented frames and pauses it during own ACK',async()=>{
    vi.useFakeTimers();let upstream,release;const hold=new Promise(r=>{release=r;});const streamController=createStreamController();const response=createAccountedStream(new Response(new ReadableStream({start(c){upstream=c;}})),{finish:async()=>hold},{profile:OPENAI_EXPLICIT_USAGE_PROFILE,signal:streamController.signal});const output=pipeWithDisconnect(response,new TransformStream(),streamController,null,30);const reading=new Response(output).text();
    try{for(let i=0;i<4;i++){upstream.enqueue(new TextEncoder().encode(': activity'));await vi.advanceTimersByTimeAsync(20);expect(streamController.signal.aborted).toBe(false);}upstream.enqueue(new TextEncoder().encode('\n\n'+complete));await vi.advanceTimersByTimeAsync(100);expect(streamController.signal.aborted).toBe(false);release();expect(await reading).toContain('[DONE]');expect(vi.getTimerCount()).toBe(0);}finally{release();vi.useRealTimers();}
  });
  it('turns an actual raw stall into unknown evidence without a successful flush',async()=>{
    vi.useFakeTimers();const calls=[];const streamController=createStreamController();const response=createAccountedStream(new Response(new ReadableStream()),{finish:async value=>{calls.push(value);}},{profile:OPENAI_EXPLICIT_USAGE_PROFILE,signal:streamController.signal});const output=pipeWithDisconnect(response,new TransformStream(),streamController,()=>new TextEncoder().encode('native-error'),30);const reading=new Response(output).text();
    try{await vi.advanceTimersByTimeAsync(31);expect(await reading).toBe('native-error');expect(calls).toEqual([null]);expect(vi.getTimerCount()).toBe(0);}finally{vi.useRealTimers();}
  });

});
