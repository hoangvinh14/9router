import { describe, expect, it } from 'vitest';
import { convertResponsesStreamToJson } from '../../open-sse/transformer/streamToJsonConverter.js';
import { bindNativeResponsesAccounting } from '../../open-sse/config/accountingProfiles.js';
import { responsesReply } from '../fixtures/accounting/responses-loopback.js';
const binding=bindNativeResponsesAccounting(Object.freeze({}));
const stream=(text,split=false)=>new ReadableStream({start(c){const bytes=new TextEncoder().encode(text);if(split)for(const b of bytes)c.enqueue(new Uint8Array([b]));else c.enqueue(bytes);c.close();}});
const event=(type,response)=>`event: ${type}\ndata: ${JSON.stringify({type,response})}\n\n`;
describe('Responses converter native-associated fidelity and default baseline',()=>{
  it.each(['completed','failed','incomplete'])('preserves entire %s native terminal including output/details/error',async status=>{
    const raw={...responsesReply(),status,error:status==='failed'?{code:'fixture',message:'failure'}:null,incomplete_details:status==='incomplete'?{reason:'max_output_tokens'}:null};
    expect(await convertResponsesStreamToJson(stream(event(`response.${status}`,raw)),binding)).toEqual(raw);
  });
  it('uses embedded status for compatibility done and handles multiline CRLF/byte splits',async()=>{
    const raw={...responsesReply(),status:'incomplete',incomplete_details:{reason:'max_output_tokens'}};raw.output[0].content[0].text='café 🌍';
    const text=`event: response.done\r\ndata: {"type":"response.done",\r\ndata: "response":${JSON.stringify(raw)}}\r\n\r\n`;
    expect(await convertResponsesStreamToJson(stream(text,true),binding)).toEqual(raw);
  });
  it('does not invent missing usage or success at EOF/error',async()=>{
    await expect(convertResponsesStreamToJson(stream(''),binding)).rejects.toThrow();
    await expect(convertResponsesStreamToJson(stream('event: error\ndata: {"type":"error","error":{"message":"failed"}}\n\n'),binding)).rejects.toThrow();
    const raw=responsesReply();delete raw.usage;
    expect(await convertResponsesStreamToJson(stream(event('response.completed',raw)),binding)).not.toHaveProperty('usage');
  });
  it('preserves explicit zero and never uses assembled delta output over native terminal',async()=>{
    const raw=responsesReply({input_tokens:0,output_tokens:0,total_tokens:0,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}});
    const delta='event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"discarded partial"}\n\n';
    expect(await convertResponsesStreamToJson(stream(delta+event('response.completed',raw)),binding)).toEqual(raw);
  });
  it('keeps concurrently bound converter calls isolated',async()=>{
    const first=responsesReply(),second={...responsesReply(),id:'resp_second',model:'second'};
    const values=await Promise.all([convertResponsesStreamToJson(stream(event('response.completed',first),true),binding),
      convertResponsesStreamToJson(stream(event('response.completed',second),true),bindNativeResponsesAccounting(Object.freeze({})))]);
    expect(values).toEqual([first,second]);
  });
  it('keeps unassociated legacy terminal-only baseline including filtered details and absent output',async()=>{
    const raw=responsesReply();const result=await convertResponsesStreamToJson(stream(event('response.completed',raw)));
    expect(result.status).toBe('completed');expect(result.output).toEqual([]);expect(result.usage).toEqual({input_tokens:1000,output_tokens:100,total_tokens:1100});
    const untrusted=await convertResponsesStreamToJson(stream(event('response.completed',raw)),{profile:'openai-responses-explicit-details'});
    expect(untrusted.output).toEqual([]);
  });
});
