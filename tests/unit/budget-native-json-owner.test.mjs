import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test,mock} from 'node:test';
assert.equal(process.env.BUDGET_PURE_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
const stub=(path,namedExports)=>mock.module('/app/'+path,{namedExports});
stub('open-sse/translator/index.js',{needsTranslation:()=>false});
stub('open-sse/translator/concerns/claudeMessage.js',{openAICompletionToClaudeMessage:x=>x});
stub('open-sse/translator/response/ollama-to-openai.js',{ollamaBodyToOpenAI:x=>x});
stub('open-sse/utils/usageTracking.js',{
 addBufferToUsage:x=>({...x,input_tokens:x.input_tokens+2000}),
 filterUsageForFormat:({cache_creation,...rest})=>rest,
});
stub('open-sse/handlers/chatCore/sseToJsonHandler.js',{parseSSEToOpenAIResponse:()=>assert.fail('second SSE parser')});
stub('open-sse/shared/clineEnvelope.js',{unwrapClineEnvelope:x=>x});
stub('open-sse/handlers/chatCore/requestDetail.js',{buildRequestDetail:x=>x,extractRequestConfig:()=>({}),extractUsageFromResponse:x=>x.usage,saveUsageStats:()=>{},formatDoneLine:()=>''});
stub('src/lib/usageDb.js',{appendRequestLog:async()=>{},saveRequestDetail:async()=>{}});
stub('open-sse/utils/claudeCloaking.js',{decloakToolNames:x=>x});
stub('open-sse/utils/opencodeFingerprint.js',{restoreToolNames:x=>x});
stub('open-sse/translator/schema/index.js',{ROLE:{SYSTEM:'system',ASSISTANT:'assistant',USER:'user'},RESPONSES_ITEM:{}});
const {handleNonStreamingResponse}=await import('/app/open-sse/handlers/chatCore/nonStreamingHandler.js');
const {createNodeSqliteAdapter}=await import('/app/src/lib/db/adapters/nodeSqliteAdapter.js');
const {initializeNodeAttemptLedger,createNodeAttemptLedger}=await import('/app/src/lib/accounting/node-attempt-ledger.js');
const {anthropicJsonUsage}=await import('/app/src/lib/accounting/anthropic-usage.js');
function args(response,accountingAttempt){return{providerResponse:response,provider:'anthropic',model:'fixture',sourceFormat:'claude',targetFormat:'claude',body:{},stream:false,
 requestStartTime:Date.now(),trackDone:()=>{},appendLog:()=>{},reqLogger:{logProviderResponse:()=>{},logConvertedResponse:()=>{}},accountingAttempt};}

test('existing native JSON owner reads once and waits terminal write before returning client success',async()=>{
 const db=await createNodeSqliteAdapter('/tmp/json-owner.sqlite');
 try{
  initializeNodeAttemptLedger(db);const store=createNodeAttemptLedger(db);
  const now='2026-11-16T10:00:00.000Z';
  const a=store.prepare({attemptId:'json',keyId:'key-A',bindingGeneration:'1',provider:'anthropic',model:'fixture',startedAt:now,
   price:{currency:'USD',unit:'USD/1M tokens',revision:'fixture',rates:{input:'3',output:'15'}}});
  const native={type:'message',content:[{type:'text',text:'ok'}],usage:{input_tokens:1000,output_tokens:1000}};
  const response=new Response(JSON.stringify(native),{headers:{'content-type':'application/json'}});let reads=0;
  const read=response.text.bind(response);response.text=()=>{reads++;return read();};
  response.json=()=>assert.fail('second JSON reader');
  let settlements=0;
  const result=await handleNonStreamingResponse(args(response,{settleJson(usage){settlements++;return a.settle(anthropicJsonUsage(usage));}}));
  assert.equal(result.success,true);assert.equal(reads,1);assert.equal(settlements,1);
  assert.equal(store.totals('key-A',now).monthly,'18000000');assert.equal((await result.response.json()).type,'message');
 }finally{db.close();}
});

test('native accounted Claude keeps usage intact while ordinary Claude applies the compatibility projection',async()=>{
 const usage={input_tokens:10,output_tokens:2,cache_creation_input_tokens:9,
  cache_creation:{ephemeral_5m_input_tokens:4,ephemeral_1h_input_tokens:5}};
 const response=()=>Response.json({type:'message',content:[],usage});
 let settled=0;
 const accounted=await handleNonStreamingResponse(args(response(),{settleJson(raw){settled++;assert.deepEqual(raw,usage);}}));
 assert.equal(settled,1);
 assert.deepEqual((await accounted.response.json()).usage,usage);
 const ordinary=await handleNonStreamingResponse(args(response(),null));
 assert.deepEqual((await ordinary.response.json()).usage,{input_tokens:2010,output_tokens:2,cache_creation_input_tokens:9});
});

test('recording failure refuses client success and never swallows terminal ACK fault',async()=>{
 const response=new Response(JSON.stringify({type:'message',usage:{}}),{headers:{'content-type':'application/json'}});
 const result=await handleNonStreamingResponse(args(response,{settleJson(){throw new Error('private');}}));
 assert.equal(result.accountingRefused,true);assert.equal(result.status,503);assert.equal(result.success,false);
 assert.equal((await result.response.text()).includes('private'),false);
});

test('unexpected SSE and interrupted JSON never create completed zero settlement, regardless of error class',async()=>{
 let settlements=0;const sink={settleJson(){settlements++;}};
 const wrong=await handleNonStreamingResponse(args(new Response('data: {}\n\n',{headers:{'content-type':'text/event-stream'}}),sink));
 assert.equal(wrong.accountingRefused,true);
 for(const fault of [new Error('interrupted'),new SyntaxError('read interrupted')]){
  let reads=0;const interrupted={headers:new Headers({'content-type':'application/json'}),text:async()=>{reads++;throw fault;},json:()=>assert.fail('second reader')};
  const broken=await handleNonStreamingResponse(args(interrupted,sink));
  assert.equal(broken.accountingRefused,true);assert.equal(broken.status,503);assert.equal(reads,1);
 }
 assert.equal(settlements,0);
});

test('complete malformed empty and scalar JSON settle unknown once then return502 without fallback',async()=>{
 const db=await createNodeSqliteAdapter('/tmp/json-malformed.sqlite');
 try{
  initializeNodeAttemptLedger(db);const store=createNodeAttemptLedger(db);const now='2026-11-16T10:00:00.000Z';
  for(const [index,text] of ['{','','null','[]','1'].entries()){
   const a=store.prepare({attemptId:'malformed-'+index,keyId:'key-A',bindingGeneration:'1',provider:'anthropic',model:'fixture',startedAt:now,
    price:{currency:'USD',unit:'USD/1M tokens',revision:'fixture',rates:{input:'3',output:'15'}}});
   let reads=0,calls=0;const response={headers:new Headers({'content-type':'application/json'}),text:async()=>{reads++;return text;},json:()=>assert.fail('second reader')};
   const result=await handleNonStreamingResponse(args(response,{settleJson(usage){calls++;assert.equal(usage,undefined);return a.settle(anthropicJsonUsage(usage));}}));
   assert.equal(reads,1);assert.equal(calls,1);assert.equal(result.status,502);assert.equal(result.accountingRefused,true);assert.equal(result.success,false);
  }
  assert.deepEqual(store.totals('key-A',now),{weekly:'0',monthly:'0',unknown:5});
 }finally{db.close();}
});

test('malformed complete JSON recording failure returns503 with exactly one settlement attempt',async()=>{
 let calls=0;
 const result=await handleNonStreamingResponse(args(new Response('{'),{settleJson(){calls++;throw new Error('private ACK');}}));
 assert.equal(calls,1);assert.equal(result.status,503);assert.equal(result.accountingRefused,true);
 assert.equal((await result.response.text()).includes('private'),false);
});

test('native JSON owner awaits asynchronous ACK and defaults unusable usage without blocking success',async()=>{
 let release,calls=0,done=false;const ack=new Promise(resolve=>{release=resolve;});
 const response={headers:new Headers({'content-type':'application/json'}),status:200,text:async()=>JSON.stringify({type:'message',content:[],usage:null})};
 const result=handleNonStreamingResponse(args(response,{settleJson(usage){calls++;assert.equal(usage,null);return ack;}}));
 const observed=result.then(value=>{done=true;return value;});
 await Promise.resolve();await Promise.resolve();
 assert.equal(calls,1);assert.equal(done,false);release();assert.equal((await observed).success,true);
});

test('ordinary JSON keeps existing json-reader success and malformed-body behavior',async()=>{
 const response=new Response(JSON.stringify({type:'message',content:[],usage:{}}));let reads=0;
 const json=response.json.bind(response);response.json=()=>{reads++;return json();};response.text=()=>assert.fail('ordinary reader changed');
 assert.equal((await handleNonStreamingResponse(args(response,null))).success,true);assert.equal(reads,1);
 const invalid=await handleNonStreamingResponse(args(new Response('{'),null));assert.equal(invalid.status,502);assert.equal(invalid.accountingRefused,undefined);
});
