import { describe, expect, it } from 'vitest';
import { createAccountedStream, accountingStreamActivity } from '../../open-sse/utils/accounting-openai-stream.js';
import { streamReply } from '../fixtures/accounting/chat-stream.js';
import { createStreamController, pipeWithDisconnect } from '../../open-sse/utils/streamHandler.js';

const encoder=new TextEncoder();
const safe=encoder.encode('data: {"error":{"code":"api_key_accounting_unavailable","requestId":"server-owned"}}\n\n');
const profile='openai-chat-explicit-details';
const upstream=()=>new Response(streamReply(),{headers:{'content-type':'text/event-stream'}});
describe('private accounting stream terminal provenance',()=>{
  it('formatter exception uses injected sanitized bytes',async()=>{
    const response=createAccountedStream(upstream(),{finish:async()=>{},terminalError:()=>{throw new Error('private SQL details');},fallbackTerminalBytes:safe},{profile});
    const bytes=accountingStreamActivity(response).terminalError(new Error('untrusted'));
    expect(new TextDecoder().decode(bytes)).toContain('api_key_accounting_unavailable');expect(new TextDecoder().decode(bytes)).not.toContain('SQL');await response.body.cancel();
  });
  it('ordinary lookalike error does not acquire accounting provenance',async()=>{
    const response=createAccountedStream(upstream(),{finish:async()=>{},terminalError:()=>null,fallbackTerminalBytes:safe},{profile});
    expect(accountingStreamActivity(response).terminalError(Object.assign(new Error('upstream'),{code:'api_key_accounting_unavailable'}))).toBeNull();await response.body.cancel();
  });
  it('accounting terminal works without legacy formatter and emits once after content',async()=>{
    let failed=false;
    const response=createAccountedStream(upstream(),{finish:async()=>{failed=true;throw new Error('private ACK detail');},terminalError:()=>failed?safe:null,fallbackTerminalBytes:safe},{profile});
    const controller=createStreamController({log:{errorLine:()=>{}}});
    const body=pipeWithDisconnect(response,new TransformStream(),controller,null);
    const text=await new Response(body).text();expect(text).toContain('hello');expect(text.match(/api_key_accounting_unavailable/g)).toHaveLength(1);expect(text).not.toContain('[DONE]');expect(text).not.toContain('private ACK');
  });
  it('ordinary unaccounted transport retains legacy terminal formatter',async()=>{
    const response=new Response(new ReadableStream({start(controller){controller.error(Object.assign(new Error('upstream'),{code:'api_key_accounting_unavailable'}));}}));
    const controller=createStreamController({log:{errorLine:()=>{}}});
    const text=await new Response(pipeWithDisconnect(response,new TransformStream(),controller,()=>encoder.encode('legacy-error\n[DONE]'))).text();
    expect(text).toBe('legacy-error\n[DONE]');
  });
  it('normal raw success still finishes exactly once and releases withheld terminal',async()=>{
    let finished=0;const response=createAccountedStream(upstream(),{finish:async usage=>{expect(usage).toBeTruthy();finished++;},terminalError:()=>null},{profile});
    const text=await response.text();expect(finished).toBe(1);expect(text).toContain('[DONE]');expect(text).toContain('"finish_reason":"stop"');
  });
});
