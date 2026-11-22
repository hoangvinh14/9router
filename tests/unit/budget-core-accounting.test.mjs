import fs from 'node:fs';
import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {handleChatCore} from '../../open-sse/handlers/chatCore.js';
import {handleComboChat} from '../../open-sse/services/combo.js';
import {markAccountingResponse,isAccountingResponse} from '../../open-sse/utils/accountingResponse.js';
import {createNodeSqliteAdapter} from '../../src/lib/db/adapters/nodeSqliteAdapter.js';
import {initializeNodeAttemptLedger,createNodeAttemptLedger} from '../../src/lib/accounting/node-attempt-ledger.js';
import {anthropicJsonUsage} from '../../src/lib/accounting/anthropic-usage.js';
assert.equal(process.env.BUDGET_PURE_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
const db=await createNodeSqliteAdapter('/tmp/core.sqlite');initializeNodeAttemptLedger(db);const ledger=createNodeAttemptLedger(db);after(()=>db.close());
let index=0;
const state=()=>globalThis.__budgetCore={helpers:0,executors:0,refresh:0,peeks:0,executor:{execute:()=>assert.fail('unexpected executor')}};
const request=extra=>({body:{model:'fixture',stream:false,messages:[{role:'user',content:'hi'}]},modelInfo:{provider:'anthropic',model:'fixture'},credentials:{apiKey:'fake'},accounting:{prepare(){},validateInput(){}},...extra});
function terminal(){const now='2026-11-16T10:00:00.000Z';const key='key-'+(++index);
 const a=ledger.prepare({attemptId:'core-'+index,keyId:key,bindingGeneration:'1',provider:'anthropic',model:'fixture',startedAt:now,
 price:{currency:'USD',unit:'USD/1M tokens',revision:'fixture',rates:{input:'3',output:'15'}}});
 let settlements=0;
 return {settleJson:usage=>{settlements++;const result=a.settle(anthropicJsonUsage(usage));globalThis.__budgetCore.settled=true;return result;},settlements:()=>settlements,total:()=>ledger.totals(key,now)};
}
const result=response=>({response,url:'https://fixture.invalid',headers:{},transformedBody:{},accounting:terminal()});
const combo=handleSingleModel=>handleComboChat({body:{},models:['fixture/one','fixture/two'],comboStrategy:'fallback',autoSwitch:false,handleSingleModel,log:{info(){},warn(){}}});

test('private response identity cannot be forged on wire and does not survive copying',()=>{
 const response=new Response('{}',{headers:{'x-accounting-terminal':'true'}});
 assert.equal(isAccountingResponse(response),false);markAccountingResponse(response);assert.equal(isAccountingResponse(response),true);
 assert.equal(isAccountingResponse(response.clone()),false);assert.equal(isAccountingResponse(new Response(response.body,{headers:response.headers})),false);
 assert.equal(isAccountingResponse({accountingRefused:true}),false);
});

test('actual combo returns marked success empty JSON SSE and retryable errors without peek or successor',async()=>{
 for(const response of [new Response('{"choices":[]}'),new Response('data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}}),new Response('{}',{status:503}),new Response('{}',{status:401})]){
  const s=state();let members=0;markAccountingResponse(response);
  const output=await combo(async()=>{members++;return response;});assert.equal(output,response);assert.equal(members,1);assert.equal(s.peeks,0);assert.equal(response.bodyUsed,false);
 }
});

test('actual core post-terminal processing faults cannot replay at actual combo boundary',async()=>{
 for(const failure of ['logger','decloak','translation','serialization','completion']){
  const s=state();s.failure=failure;let members=0,calls=0,reads=0;const attempt=terminal();
  s.executor={execute:async()=>{calls++;const response=new Response(JSON.stringify({type:'message',content:[],usage:{input_tokens:1000,output_tokens:0}}));const text=response.text.bind(response);response.text=()=>{reads++;return text();};return {response,headers:{},accounting:attempt};}};
  const output=await combo(async()=>{members++;const r=await handleChatCore(request());assert.equal(r.accountingRefused,true);return r.response;});
  assert.equal(output.status,503);assert.equal(isAccountingResponse(output),true);assert.equal((await output.text()).includes('private'),false);
  assert.equal(members,1);assert.equal(calls,1);assert.equal(reads,1);assert.equal(attempt.settlements(),1);assert.equal(attempt.total().monthly,'3000000');
  assert.equal(s.completions||0,failure==='completion'?1:0);assert.equal(s.peeks,0);
 }
});

test('actual combo still falls through ordinary unmarked empty status and thrown failures',async()=>{
 for(const mode of ['empty','status','throw']){
  state();let calls=0;const success=new Response('{"choices":[{"message":{"content":"ok"}}]}',{headers:{'content-type':'application/json'}});
  const output=await combo(async()=>{calls++;if(calls===2)return success;if(mode==='throw')throw new Error('ordinary');return mode==='status'?new Response('{}',{status:503}):new Response('{"choices":[]}',{headers:{'content-type':'application/json','x-accounting-terminal':'true'}});});
  assert.equal(output,success);assert.equal(calls,2);assert.equal(isAccountingResponse(output),false);
 }
});

test('actual core native success error malformed interruption and refusal remain terminal through combo',async()=>{
 for(const mode of ['success','error','malformed','interrupted','refusal']){
  const s=state();let members=0,calls=0;const attempt=terminal();
  s.executor={execute:async()=>{calls++;return {headers:{},accounting:attempt,response:mode==='interrupted'?{ok:true,status:200,headers:new Headers(),text:async()=>{throw new Error('private read');}}:new Response(mode==='malformed'?'{':JSON.stringify({type:'message',content:[],usage:{input_tokens:1000,output_tokens:0}}),{status:mode==='error'?503:200})};}};
  const output=await combo(async()=>{members++;return (await handleChatCore(request(mode==='refusal'?{rtkEnabled:true}:{}))).response;});
  assert.equal(isAccountingResponse(output),true);assert.equal(members,1);assert.equal(calls,mode==='refusal'?0:1);assert.equal(s.peeks,0);
  assert.equal(attempt.settlements(),['refusal','interrupted'].includes(mode)?0:1);
  assert.equal(attempt.total().monthly,['success','error'].includes(mode)?'3000000':'0');
  assert.equal(attempt.total().unknown,mode==='malformed'?1:0);
 }
});

test('ordinary core post-response exception still escapes unmarked as before',async()=>{
 const s=state();s.settled=true;s.failure='logger';let calls=0;
 s.executor={execute:async()=>{calls++;return {response:new Response('{"type":"message","content":[]}'),headers:{}};}};
 await assert.rejects(handleChatCore(request({accounting:null})),/private logger/);assert.equal(calls,1);
});

test('actual core rejects unadmitted helper shapes before bypass executor or helper invocation',async()=>{
 for(const patch of [{headroomEnabled:true},{pxpipeEnabled:true},{rtkEnabled:true},{providerThinking:{mode:'high'}},{body:{stream:true}},
 {accounting:{prepare(){},validateInput(){throw new Error('private');}}}]){
  const s=state();const response=await handleChatCore(request(patch));
  assert.equal(response.status,503);assert.equal(response.accountingRefused,true);assert.equal(s.helpers,0);assert.equal(s.executors,0);
 }
});

test('actual core propagates trusted context and native success awaits original ledger terminal',async()=>{
 const s=state();const ctx=request();let calls=0,reads=0;let prepared;
 s.executor={execute:async options=>{calls++;assert.equal(options.accounting,ctx.accounting);prepared=result(new Response(JSON.stringify({type:'message',content:[],usage:{input_tokens:1000,output_tokens:0}})));const read=prepared.response.text.bind(prepared.response);prepared.response.text=()=>{reads++;return read();};return prepared;}};
 const response=await handleChatCore(ctx);assert.equal(response.success,true);assert.equal(calls,1);assert.equal(reads,1);assert.equal(prepared.accounting.total().monthly,'3000000');assert.equal(s.refresh,0);
});

test('accounted401 settles native evidence once and cannot trigger credential refresh or executor replay',async()=>{
 const s=state();let calls=0;let prepared;
 s.executor={noAuth:false,execute:async()=>{calls++;prepared=result(new Response(JSON.stringify({error:{message:'denied'},usage:{input_tokens:1000,output_tokens:0}}),{status:401}));return prepared;},refreshCredentials:()=>assert.fail('refresh reached')};
 const response=await handleChatCore(request());assert.equal(response.status,401);assert.equal(response.accountingRefused,true);assert.equal(calls,1);assert.equal(s.refresh,0);assert.equal(prepared.accounting.total().monthly,'3000000');
});

test('accounted error owner distinguishes completed missing usage, interrupted read and terminal ACK failure',async()=>{
 for(const mode of ['missing','interrupted','ack-failed']){
  const s=state();const attempt=terminal();let calls=0,reads=0,settlementCalls=0,members=0;
  const response=new Response('{"type":"error","error":{"message":"fixture denied"}}',{status:401});
  const text=response.text.bind(response);
  response.text=()=>{reads++;if(mode==='interrupted')throw new Error('private read');return text();};
  s.executor={execute:async()=>{
   calls++;return {response,headers:{},accounting:{settleJson(usage){
    settlementCalls++;if(mode==='ack-failed')throw new Error('private storage');return attempt.settleJson(usage);
   }}};
  },refreshCredentials:()=>assert.fail('refresh reached')};
  const output=await combo(async()=>{members++;return (await handleChatCore(request())).response;});
  assert.equal(output.status,mode==='missing'?401:503);
  assert.equal(isAccountingResponse(output),true);assert.equal((await output.text()).includes('private'),false);
  assert.deepEqual([members,calls,reads,s.refresh,s.peeks],[1,1,1,0,0]);
  assert.equal(settlementCalls,mode==='interrupted'?0:1);
  assert.equal(attempt.settlements(),mode==='missing'?1:0);
  assert.equal(attempt.total().unknown,mode==='missing'?1:0);
 }
});

test('accounted executor fault and absent terminal authority sanitize and suppress retry',async()=>{
 const s=state();let calls=0;
 s.executor={execute:async()=>{calls++;throw new Error('private transport');}};
 let response=await handleChatCore(request());assert.equal(response.status,503);assert.equal(response.accountingRefused,true);assert.equal((await response.response.text()).includes('private'),false);assert.equal(calls,1);
 s.executor={execute:async()=>{calls++;return {response:new Response('{}')};}};
 response=await handleChatCore(request());assert.equal(response.status,503);assert.equal(response.accountingRefused,true);assert.equal(calls,2);
});

test('core native completed-malformed vs interrupted exposure preserves owner D01/E2 and no fallback marker',async()=>{
 for(const interrupted of [false,true]){
  const s=state();let calls=0;const attempt=terminal();
  const response=interrupted?{ok:true,status:200,headers:new Headers(),text:async()=>{throw new SyntaxError('interrupted');}}:new Response('{');
  s.executor={execute:async()=>{calls++;return {response,url:'https://fixture.invalid',headers:{},accounting:attempt};}};
  const output=await handleChatCore(request());assert.equal(output.status,interrupted?503:502);assert.equal(output.accountingRefused,true);assert.equal(calls,1);assert.equal(attempt.total().unknown,interrupted?0:1);
 }
});
