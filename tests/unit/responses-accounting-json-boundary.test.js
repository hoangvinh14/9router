import { describe, expect, it, vi } from 'vitest';
import { createAccountedBoundary } from '../../open-sse/executors/accounted-base.js';
import { RESPONSES_EXPLICIT_USAGE_PROFILE as profile } from '../../open-sse/config/accountingProfiles.js';
import { responsesReply, rawResponsesUsage } from '../fixtures/accounting/responses-loopback.js';
const wire = {};
async function boundary(response, finish = vi.fn(async()=>{})) {
  const ticket = await createAccountedBoundary({profile,prepare:async()=>({finish})}).prepare(wire);
  return {pending:ticket.response(response),finish};
}
describe('native Responses raw JSON boundary',()=>{
  it('preserves UTF-8 bytes, HTTP status and headers exactly after raw ACK',async()=>{
    const raw=JSON.stringify({...responsesReply(),extra:'café 🌍'});let release;
    const hold=new Promise(resolve=>{release=resolve;});let finished=false;
    const {pending,finish}=await boundary(new Response(raw,{status:201,headers:{'content-type':'application/json; charset=utf-8','x-fixture':'native'}}),
      vi.fn(async()=>{await hold;finished=true;}));
    await Promise.resolve();expect(finished).toBe(false);release();const response=await pending;
    expect(response.status).toBe(201);expect(response.headers.get('x-fixture')).toBe('native');expect(await response.text()).toBe(raw);
    expect(finish).toHaveBeenCalledTimes(1);expect(finish.mock.calls[0][0]).toMatchObject({input:1000,output:100,cacheRead:400,reasoning:20});
  });
  it.each([400,401,429,500])('settles authoritative root usage on accepted HTTP %s error envelope before replay',async status=>{
    const raw=JSON.stringify({error:{message:'fixture'},usage:rawResponsesUsage()});const {pending,finish}=await boundary(new Response(raw,{status}));
    const result=await pending;expect(result.status).toBe(status);expect(await result.text()).toBe(raw);expect(finish.mock.calls[0][0]?.exact).toBe(true);
  });
  it.each([
    new Uint8Array([0xff]),'{','null','[]',JSON.stringify({object:'response',status:'completed'}),
    JSON.stringify({...responsesReply(),usage:{...rawResponsesUsage(),tool_tokens:1}}),
    JSON.stringify({...responsesReply(),status:'queued'}),
  ])('does not downgrade invalid or absent complete evidence into interruption',async bytes=>{
    const {pending,finish}=await boundary(new Response(bytes));await expect(pending).rejects.toThrow();
    expect(finish).toHaveBeenCalledTimes(1);expect(finish.mock.calls[0][0]).toBeNull();expect(finish.mock.calls[0][2].interrupted).toBe(false);
  });
  it('refuses unexpected hosted billable output despite valid token counters',async()=>{
    const raw={...responsesReply(),output:[{type:'web_search_call',id:'hosted',status:'completed'}]};
    const {pending,finish}=await boundary(new Response(JSON.stringify(raw)));
    await expect(pending).rejects.toThrow();expect(finish.mock.calls[0][0]).toBeNull();
    expect(finish.mock.calls[0][2].kind).toBe('malformed');
  });
  it('records malformed stream evidence even when reader cancellation rejects',async()=>{
    const finish=vi.fn(async()=>{});
    const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: invalid\n\n'));},cancel(){throw new Error('cancel refused');}});
    const {pending}=await boundary(new Response(stream,{headers:{'content-type':'text/event-stream'}}),finish);
    const response=await pending;await expect(response.text()).rejects.toThrow();expect(finish).toHaveBeenCalledTimes(1);
    expect(finish.mock.calls[0][2]).toMatchObject({kind:'malformed',interrupted:true});
  });
  it('preserves terminal persistence failure over cancellation rejection without a second write',async()=>{
    const error=new Error('own terminal persistence failed');const finish=vi.fn(async()=>{throw error;});
    const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: invalid\n\n'));},cancel(){throw new Error('cancel refused');}});
    const {pending}=await boundary(new Response(stream,{headers:{'content-type':'text/event-stream'}}),finish);
    const response=await pending;await expect(response.text()).rejects.toBe(error);expect(finish).toHaveBeenCalledTimes(1);
  });
  it('never recatches DB terminal failure as absent usage',async()=>{
    const error=new Error('own durable write failed');const finish=vi.fn(async()=>{throw error;});
    const {pending}=await boundary(new Response(JSON.stringify(responsesReply())),finish);
    await expect(pending).rejects.toBe(error);expect(finish).toHaveBeenCalledTimes(1);expect(finish.mock.calls[0][0]?.exact).toBe(true);
  });
});
