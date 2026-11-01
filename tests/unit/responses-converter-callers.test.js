import { beforeEach, describe, expect, it, vi } from 'vitest';
const {core}=vi.hoisted(()=>({core:vi.fn()}));
vi.mock('../../open-sse/handlers/chatCore.js',()=>({handleChatCore:core}));
import { handleResponsesCore } from '../../open-sse/handlers/responsesHandler.js';
import { handleForcedSSEToJson } from '../../open-sse/handlers/chatCore/sseToJsonHandler.js';
import { bindNativeResponsesAccounting } from '../../open-sse/config/accountingProfiles.js';
import { responsesReply } from '../fixtures/accounting/responses-loopback.js';
const response=()=>new Response(`event: response.completed\ndata: ${JSON.stringify({type:'response.completed',response:responsesReply()})}\n\n`,{headers:{'content-type':'text/event-stream'}});
beforeEach(()=>core.mockReset());
describe('both converter callers keep their association boundary',()=>{
  it('Workers compatibility-only caller keeps legacy unassociated baseline',async()=>{
    core.mockResolvedValue({success:true,response:response()});
    const result=await handleResponsesCore({body:{model:'fixture',input:'hello',stream:false},modelInfo:{provider:'fixture',model:'fixture'},credentials:{}});
    expect(result.success).toBe(true);const json=await result.response.json();expect(json.output).toEqual([]);
    expect(json.usage).toEqual({input_tokens:1000,output_tokens:100,total_tokens:1100});
    expect(core.mock.calls[0][0]).not.toHaveProperty('accounting');
  });
  it.each(['failed','incomplete'])('forced native %s never calls success bookkeeping',async status=>{
    const success=vi.fn(),accounting=bindNativeResponsesAccounting(Object.freeze({}));
    const raw={...responsesReply(),status};
    const providerResponse=new Response(`event: response.${status}\ndata: ${JSON.stringify({type:`response.${status}`,response:raw})}\n\n`,{headers:{'content-type':'text/event-stream'}});
    const result=await handleForcedSSEToJson({providerResponse,sourceFormat:'openai-responses',targetFormat:'openai-responses',provider:'fixture',model:'fixture',
      body:{},stream:false,requestStartTime:Date.now(),trackDone:vi.fn(),appendLog:vi.fn(),onRequestSuccess:success,accounting});
    expect(result.success).toBe(false);expect(result.terminal).toBe(true);expect(result.response.status).toBe(502);
    expect(await result.response.json()).toEqual(raw);expect(success).not.toHaveBeenCalled();
  });
  it.each([false,true])('forced JSON caller private native association=%s',async associated=>{
    const success=vi.fn();const accounting=associated?bindNativeResponsesAccounting(Object.freeze({})):null;
    const result=await handleForcedSSEToJson({providerResponse:response(),sourceFormat:'openai-responses',targetFormat:'openai-responses',
      provider:'fixture',model:'fixture',body:{},stream:false,requestStartTime:Date.now(),trackDone:vi.fn(),appendLog:vi.fn(),onRequestSuccess:success,accounting});
    const json=await result.response.json();expect(success).toHaveBeenCalledTimes(1);
    if(associated)expect(json).toEqual(responsesReply());else expect(json.output).toEqual([]);
  });
});
