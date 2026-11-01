import { describe, expect, it } from 'vitest';
import { normalizeResponsesUsage, createResponsesUsageObservation, assertResponsesRequest, assertResponsesChatSource } from '../../open-sse/utils/accounting-responses-usage.js';
import { RESPONSES_EXPLICIT_USAGE_PROFILE as profile } from '../../open-sse/config/accountingProfiles.js';
import { rawResponsesUsage } from '../fixtures/accounting/responses-loopback.js';

describe('strict native Responses token-only profile', () => {
  it('normalizes explicit counters including all-zero without estimates', () => {
    expect(normalizeResponsesUsage(rawResponsesUsage(), profile)).toEqual({ exact:true,input:1000,output:100,cacheRead:400,
      cacheWrite:0,reasoning:20,reasoningIncludedInOutput:true,cacheWrite5m:0,cacheWrite1h:0 });
    expect(normalizeResponsesUsage({ input_tokens:0,output_tokens:0,total_tokens:0,input_tokens_details:{cached_tokens:0},
      output_tokens_details:{reasoning_tokens:0} },profile)?.input).toBe(0);
    expect(normalizeResponsesUsage(rawResponsesUsage(),'caller-profile')).toBeNull();
  });
  it.each([
    raw=>{delete raw.input_tokens_details;}, raw=>{delete raw.output_tokens_details;}, raw=>{raw.total_tokens++;},
    raw=>{raw.input_tokens_details.cached_tokens=1001;},raw=>{raw.output_tokens_details.reasoning_tokens=101;},
    raw=>{raw.input_tokens=-1;},raw=>{raw.input_tokens=1.5;},raw=>{raw.input_tokens='1000';},
    raw=>{raw.output_tokens=Number.MAX_SAFE_INTEGER+1;},raw=>{raw.estimated=true;},
    raw=>{raw.cache_creation_input_tokens=0;},raw=>{raw.tool_calls=0;},raw=>{raw.input_tokens_details.audio_tokens=0;},
    raw=>{raw.output_tokens_details.image_tokens=1;},raw=>{raw.output_tokens_details.accepted_prediction_tokens=0;},
  ])('rejects unsupported/malformed evidence rather than swallowing billing dimensions', mutate=>{
    const raw=rawResponsesUsage();mutate(raw);expect(normalizeResponsesUsage(raw,profile)).toBeNull();
  });
  it('retains malformed/conflicting classifications and deduplicates exact snapshots',()=>{
    const observation=createResponsesUsageObservation(profile);
    expect(observation.evidence()).toEqual({kind:'absent'});
    observation.observe(rawResponsesUsage());observation.observe(rawResponsesUsage());expect(observation.value()?.input).toBe(1000);
    observation.observe(rawResponsesUsage(401));expect(observation.evidence()).toEqual({kind:'conflicting'});
    observation.observe(rawResponsesUsage());expect(observation.value()).toBeNull();
    const malformed=createResponsesUsageObservation(profile);malformed.observe(null);malformed.observe(rawResponsesUsage());
    expect(malformed.evidence()).toEqual({kind:'malformed'});
  });
  it('admits original Chat text/function subset before conversion',()=>{
    const body={model:'fixture',messages:[{role:'user',content:'hello'},{role:'assistant',content:null,
      tool_calls:[{id:'call_1',type:'function',function:{name:'lookup',arguments:'{}'}}]},
      {role:'tool',tool_call_id:'call_1',content:'result'}],tools:[{type:'function',function:{name:'lookup',parameters:{type:'object'}}}]};
    expect(()=>assertResponsesChatSource(body)).not.toThrow();
  });
  const wire=()=>({model:'fixture',input:[{type:'message',role:'user',content:[{type:'input_text',text:'hello'}]}],stream:true,store:false});
  it('admits inline text and client function definitions/results',()=>{
    expect(()=>assertResponsesRequest(wire())).not.toThrow();
    const body=wire();body.tools=[{type:'function',name:'lookup',parameters:{type:'object'},strict:true}];
    body.input.push({type:'function_call',name:'lookup',call_id:'call_1',arguments:'{}'},
      {type:'function_call_output',call_id:'call_1',output:'result'});
    expect(()=>assertResponsesRequest(body)).not.toThrow();
  });
  it.each([
    body=>{body.tools=[{type:'web_search'}];},body=>{body.tools=[{type:'image_generation'}];},
    body=>{body.background=true;},body=>{body.previous_response_id='remote';},body=>{body.modalities=['audio'];},
    body=>{body.input=[{type:'message',role:'user',content:[{type:'input_image',image_url:'https://example.invalid/image'}]}];},
    body=>{body.input=[{type:'item_reference',id:'remote'}];},body=>{body.input=[{type:'message',role:'user',content:[{type:'input_file',file_id:'remote'}]}];},
    body=>{body.service_tier='priority';},body=>{body.unknown_billing_option=0;},body=>{body.stream_options={include_usage:true};},
    body=>{body.tools=[{type:'function',name:'lookup',parameters:{},hosted:true}];},
  ])('refuses unsupported final-wire declarations before dispatch',mutate=>{
    const body=wire();mutate(body);expect(()=>assertResponsesRequest(body)).toThrow();
  });
});
