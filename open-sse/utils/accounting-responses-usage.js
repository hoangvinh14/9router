import { RESPONSES_EXPLICIT_USAGE_PROFILE, RESPONSES_ACCOUNTING_USAGE_FIELDS, RESPONSES_ACCOUNTING_REQUEST_FIELDS, RESPONSES_ACCOUNTING_CHAT_FIELDS } from '../config/accountingProfiles.js';
import { RESPONSES_ITEM, ROLE, OPENAI_BLOCK } from '../translator/schema/index.js';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const only = (value, fields) => object(value) && Object.keys(value).every(field => fields.includes(field));
export function normalizeResponsesUsage(raw, profile) {
  if (profile !== RESPONSES_EXPLICIT_USAGE_PROFILE || !only(raw, RESPONSES_ACCOUNTING_USAGE_FIELDS) ||
      !only(raw.input_tokens_details,['cached_tokens']) || !only(raw.output_tokens_details,['reasoning_tokens'])) return null;
  const input=raw.input_tokens, output=raw.output_tokens, total=raw.total_tokens;
  const cacheRead=raw.input_tokens_details.cached_tokens, reasoning=raw.output_tokens_details.reasoning_tokens;
  if (![input,output,total,cacheRead,reasoning].every(n=>Number.isSafeInteger(n)&&n>=0) || !Number.isSafeInteger(input+output) ||
      total!==input+output || cacheRead>input || reasoning>output) return null;
  return Object.freeze({exact:true,input,output,cacheRead,cacheWrite:0,reasoning,reasoningIncludedInOutput:true,cacheWrite5m:0,cacheWrite1h:0});
}
export function createResponsesUsageObservation(profile) {
  let observed=null, malformed=false, conflicting=false;
  const kind=()=>conflicting?'conflicting':malformed?'malformed':observed?'valid':'absent';
  return Object.freeze({
    observe(raw) {
      const next=normalizeResponsesUsage(raw,profile);
      if (!next) malformed=true;
      if (next&&observed&&JSON.stringify(next)!==JSON.stringify(observed)) conflicting=true;
      if(next&&!observed)observed=next;
    },
    conflict(){conflicting=true;},
    value:()=>kind()==='valid'?observed:null,
    evidence:()=>Object.freeze(kind()==='valid'?{kind:'valid',usage:observed}:{kind:kind()}),
  });
}
export function assertResponsesOutput(raw) {
  if (!Array.isArray(raw.output)) throw new Error('Missing native Responses output');
  for (const item of raw.output) {
    if (!object(item)) throw new Error('Invalid native Responses output');
    if (item.type === RESPONSES_ITEM.MESSAGE) {
      if (!Array.isArray(item.content) || item.content.some(block => !object(block) || block.type !== RESPONSES_ITEM.OUTPUT_TEXT || typeof block.text !== 'string')) throw new Error('Unsupported Responses output modality');
    } else if (item.type === RESPONSES_ITEM.REASONING) {
      if (item.summary !== undefined && (!Array.isArray(item.summary) || item.summary.some(block => block.type !== RESPONSES_ITEM.SUMMARY_TEXT || typeof block.text !== 'string'))) throw new Error('Unsupported Responses reasoning output');
    } else if (item.type !== RESPONSES_ITEM.FUNCTION_CALL || typeof item.arguments !== 'string') throw new Error('Unsupported Responses hosted output');
  }
}
export function assertResponsesChatSource(body) {
  const refuse=()=>{throw new Error('Unsupported Chat source for Responses accounting');};
  if(!only(body,RESPONSES_ACCOUNTING_CHAT_FIELDS)||!Array.isArray(body.messages))refuse();
  if(body.tools!==undefined&&(!Array.isArray(body.tools)||body.tools.some(tool=>!only(tool,['type','function'])||
    tool.type!==OPENAI_BLOCK.FUNCTION||!only(tool.function,['name','description','parameters','strict']))))refuse();
  for(const message of body.messages){
    if(!only(message,['role','content','name','tool_calls','tool_call_id'])||!Object.values(ROLE).includes(message.role))refuse();
    if(message.content!==null&&typeof message.content!=='string'&&(!Array.isArray(message.content)||message.content.some(block=>
      !only(block,['type','text'])||block.type!==OPENAI_BLOCK.TEXT||typeof block.text!=='string')))refuse();
    if(message.tool_calls!==undefined&&(!Array.isArray(message.tool_calls)||message.tool_calls.some(call=>
      !only(call,['id','type','function'])||call.type!==OPENAI_BLOCK.FUNCTION||!only(call.function,['name','arguments'])||typeof call.function.arguments!=='string')))refuse();
  }
  return true;
}
// Validate before transforms can strip media or fetch remote resources, and again
// at the immutable actual POST boundary. Function arguments/schema are opaque text/data.
export function assertResponsesRequest(body) {
  const refuse=()=>{throw new Error('Unsupported Responses accounting request');};
  if(!only(body,RESPONSES_ACCOUNTING_REQUEST_FIELDS)||typeof body.model!=='string')refuse();
  if(body.tools!==undefined&&(!Array.isArray(body.tools)||body.tools.some(tool=>
    !only(tool,['type','name','description','parameters','strict'])||tool.type!==OPENAI_BLOCK.FUNCTION||typeof tool.name!=='string'||!tool.name)))refuse();
  if(body.reasoning!==undefined&&!only(body.reasoning,['effort','summary']))refuse();
  if(body.text!==undefined&&(!only(body.text,['format','verbosity'])||body.text.format!==undefined&&
    (!only(body.text.format,['type','name','schema','strict','description'])||!['text','json_object','json_schema'].includes(body.text.format.type))))refuse();
  if(body.tool_choice!==undefined&&typeof body.tool_choice!=='string'&&
    (!only(body.tool_choice,['type','name'])||body.tool_choice.type!==OPENAI_BLOCK.FUNCTION))refuse();
  if(typeof body.input==='string')return true;
  if(!Array.isArray(body.input))refuse();
  for(const item of body.input){
    if(!object(item))refuse();
    if(item.type===RESPONSES_ITEM.FUNCTION_CALL){
      if(!only(item,['type','id','call_id','name','arguments','status'])||typeof item.arguments!=='string')refuse();
    }else if(item.type===RESPONSES_ITEM.FUNCTION_CALL_OUTPUT){
      if(!only(item,['type','id','call_id','output','status'])||typeof item.output!=='string')refuse();
    }else{
      if(!only(item,['type','id','role','content','status'])||item.type!==undefined&&item.type!==RESPONSES_ITEM.MESSAGE||
        ![ROLE.USER,ROLE.ASSISTANT,ROLE.SYSTEM,ROLE.DEVELOPER].includes(item.role))refuse();
      if(typeof item.content==='string')continue;
      if(!Array.isArray(item.content)||item.content.some(block=>!only(block,['type','text','annotations'])||
        ![RESPONSES_ITEM.INPUT_TEXT,RESPONSES_ITEM.OUTPUT_TEXT].includes(block.type)||typeof block.text!=='string'))refuse();
    }
  }
  return true;
}
