import fs from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {test,mock} from 'node:test';
assert.equal(process.env.BUDGET_PURE_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
const {default:entry}=await import('../../open-sse/providers/registry/anthropic.js');
let transports=0,intents=0,posts=0,ordinaryPosts=0;
let lastHeaders;
const fail=()=>{throw new Error('unrelated dependency invoked');};
mock.module('/app/open-sse/config/providers.js',{namedExports:{PROVIDERS:{anthropic:entry.transport},PROVIDER_OAUTH:{}}});
mock.module('/app/open-sse/services/oauthCredentialManager.js',{namedExports:{shouldRefreshCredentials:fail}});
mock.module('/app/open-sse/services/provider.js',{namedExports:{resolveOpenAICompatibleApiType:fail}});
mock.module('/app/open-sse/providers/capabilities.js',{namedExports:{getCapabilitiesForModel:fail}});
mock.module('/app/open-sse/config/appConstants.js',{namedExports:{OAUTH_ENDPOINTS:{},buildKimiHeaders:fail,NOUS_ATTRIBUTION:{}}});
mock.module('/app/open-sse/shared/clineAuth.js',{namedExports:{buildClineHeaders:fail}});
mock.module('/app/open-sse/utils/claudeCloaking.js',{namedExports:{extractClaudeSessionIdFromUserId:fail}});
mock.module('/app/open-sse/utils/proxyFetch.js',{namedExports:{proxyAwareFetch:async(url,options)=>{
 ordinaryPosts++;assert.equal(url,entry.transport.baseUrl);
 assert.match(new Headers(options.headers).get('anthropic-beta'),/claude-code/);
 return new Response('{}');
},prepareAccountedDirectPost:async(url,options)=>{
 transports++;assert.equal(url,'https://api.anthropic.com/v1/messages');
 lastHeaders=Object.fromEntries(new Headers(options.headers));
 const encoded=options.body;return ()=>{posts++;return encoded;};
}}});
const {DefaultExecutor}=await import('../../open-sse/executors/default.js');
const {createAnthropicDispatchContext}=await import('../../src/lib/accounting/anthropic-dispatch-context.js');
const model='claude-sonnet-4-6';
const body=()=>({model,stream:false,inference_geo:'global',service_tier:'standard_only',max_tokens:123,messages:[{role:'user',content:'fixture'}]});
const workspaceBinding={scope:'single-workspace',workspaceId:'wrkspc_fixture',connectionId:'fixture-account',
 keyDigest:createHash('sha256').update('fixture-only').digest('hex')};
const profile={enabled:true,producerAdmitted:true,provider:'anthropic',auth:'api-key',model,inferenceGeo:'global',
 serviceTier:'standard_only',workspaceBinding};
const ownerPrice={currency:'USD',unit:'USD/1M tokens',revision:'test-owner-only',rates:{input:'3',output:'15',cached:'0.3',cache_creation:'3.75',cache_creation_1h:'6'}};
const ownerProof=Object.freeze({});
const credentials=Object.freeze({connectionId:'fixture-account',authType:'apikey',apiKey:'fixture-only'});
function context(overrides={}, stream=false){return createAnthropicDispatchContext({
 profile:{...profile,...overrides},
 stream,
 routeProof:Object.freeze({}),clock:()=>'2026-11-16T10:00:00.000Z',
 credentials,
 identity:{
  bindAnthropicAccount(_route,connectionId,key,geo){
   assert.equal(connectionId,'fixture-account');assert.equal(key,'fixture-only');
   assert.equal(geo,overrides.inferenceGeo??'global');return {proof:ownerProof,price:ownerPrice};
  },
  prepare(command,_route,proof){assert.equal(command.price,ownerPrice);assert.equal(proof,ownerProof);intents++;return {ack:{},settle:fail};},
  dispatch(_ack,_now,invoke){return invoke();},
 },
});}
const wire=(b)=>({url:'https://api.anthropic.com/v1/messages',provider:'anthropic',model,stream:b.stream,proxyOptions:null,
 options:{method:'POST',body:JSON.stringify(b),headers:{'x-api-key':'fixture-only','anthropic-version':'2023-06-01','content-type':'application/json'}}});

test('ordinary execution retains registry beta; accidentally using those headers in accounting still refuses',async()=>{
 const ctx=context(),input=body();ctx.validateInput(input);
 const before=[transports,intents,posts,ordinaryPosts];
 const ex=new DefaultExecutor('anthropic');
 await ex.execute({model,body:input,stream:false,credentials});
 await assert.rejects(ex.execute({model,body:input,stream:false,credentials,accounting:{prepare:ctx.prepare}}));
 assert.deepEqual([transports,intents,posts,ordinaryPosts],[...before.slice(0,3),before[3]+1]);
});

test('actual executor selects native accounting headers without changing config or body',async()=>{
 const ctx=context(),input=body();ctx.validateInput(input);
 const before=[transports,intents,posts,ordinaryPosts];
 const ex=new DefaultExecutor('anthropic');
 const result=await ex.execute({model,body:input,stream:false,credentials,accounting:ctx});
 assert.deepEqual(JSON.parse(result.response),input);
 assert.deepEqual(lastHeaders,wire(input).options.headers);
 assert.match(entry.transport.headers['Anthropic-Beta'],/claude-code/);
 assert.deepEqual([transports,intents,posts,ordinaryPosts],[before[0]+1,before[1]+1,before[2]+1,before[3]]);
});

test('accounting header selection rejects client beta, wrong account and stored overrides before transport',async()=>{
 for(const patch of [
  {credentials:{...credentials,rawHeaders:{'Anthropic-Beta':'fixture-beta'}}},
  {credentials:{...credentials,rawHeaders:{'Anthropic-Workspace-Id':'wrkspc_fixture'}}},
  {credentials:{...credentials,connectionId:'different-fixture-account'}},
  {providerOverrides:{headers:{'anthropic-version':'2024-01-01'}}},
 ]){
  const ctx=context(),input=body();ctx.validateInput(input);
  const before=[transports,intents,posts,ordinaryPosts];
  await assert.rejects(new DefaultExecutor('anthropic').execute({model,body:input,stream:false,credentials,accounting:ctx,...patch}));
  assert.deepEqual([transports,intents,posts,ordinaryPosts],before);
 }
});

test('actual default temperature deletion is independently refused even with native accounting headers',async()=>{
 const ctx=context(),input={...body(),temperature:0.2};ctx.validateInput(input);
 const ex=new DefaultExecutor('anthropic');
 const before=[transports,intents,posts];
 await assert.rejects(ex.execute({model,body:input,stream:false,credentials,accounting:ctx}));
 assert.equal(Object.hasOwn(input,'temperature'),false); // actual in-place helper
 assert.deepEqual([transports,intents,posts],before);
});

test('changed destination, effective API key and extra routing headers are refused before intent',async()=>{
 for(const mutate of [
  req=>{req.url='https://elsewhere.invalid/v1/messages';},
  req=>{req.options.headers['x-api-key']='different-fixture-key';},
  req=>{req.options.headers.Host='elsewhere.invalid';},
  req=>{req.options.headers.Authorization='Bearer fixture-only';},
  req=>{req.options.headers['anthropic-workspace-id']='wrkspc_fixture';},
 ]){
  const ctx=context(),input=body(),req=wire(input);ctx.validateInput(input);mutate(req);
  const before=[transports,intents,posts];await assert.rejects(ctx.prepare(req));
  assert.deepEqual([transports,intents,posts],before);
 }
});

test('profile cannot supply price and the wire must explicitly match its geography',async()=>{
 assert.throws(()=>context({priceAuthority:'test-owner-only',price:ownerPrice}));
 const ctx=context({inferenceGeo:'us'}), input={...body(),inference_geo:'us'};
 assert.throws(()=>ctx.validateInput(body()));
 ctx.validateInput(input);
 const before=[transports,intents,posts];await assert.rejects(ctx.prepare(wire(body())));
 assert.deepEqual([transports,intents,posts],before);
 const valid=context({inferenceGeo:'us'});valid.validateInput(input);
 const prepared=await valid.prepare(wire(input));assert.equal(JSON.parse(prepared.dispatch()).inference_geo,'us');
 assert.deepEqual([transports,intents,posts],before.map(n=>n+1));
});

test('only the exact single-workspace profile binding can qualify a selected key',()=>{
 const before=[transports,intents,posts];
 for(const binding of [undefined,null,{...workspaceBinding,scope:'organization'},
  {...workspaceBinding,workspaceId:'wrkspc_fixture\n'},{...workspaceBinding,connectionId:'other'},
  {...workspaceBinding,keyDigest:createHash('sha256').update('fixture-rotated').digest('hex')}]){
  assert.throws(()=>context({workspaceBinding:binding}));
 }
 assert.throws(()=>context({serviceTier:'auto'}));
 assert.deepEqual([transports,intents,posts],before);
});

test('missing, auto and other service tiers refuse in input and final wire',async()=>{
 const before=[transports,intents,posts];
 for(const tier of [undefined,'auto','priority',null]){
  const input=body();if(tier===undefined)delete input.service_tier;else input.service_tier=tier;
  assert.throws(()=>context().validateInput(input));
  const ctx=context();ctx.validateInput(body());
  await assert.rejects(ctx.prepare(wire(input)));
 }
 assert.deepEqual([transports,intents,posts],before);
});

test('baseline cannot rebind; original in-place mutation or replacement cannot bypass equality',async()=>{
 for(const mutate of [b=>{b.messages[0].content='changed';},b=>{b.max_tokens=124;},b=>{b.system=null;},b=>{b.messages.push({role:'assistant',content:'extra'});}]){
  const ctx=context(),input=body();ctx.validateInput(input);mutate(input);
  assert.throws(()=>ctx.validateInput(input));const before=[transports,intents,posts];
  await assert.rejects(ctx.prepare(wire(input)));await assert.rejects(ctx.prepare(wire(body())));
  assert.deepEqual([transports,intents,posts],before);
 }
});

test('structural equality ignores object order, maps only top-level model spelling and preserves arrays',async()=>{
 const a=context(),input=body();input.model='anthropic/'+model;a.validateInput(input);
 const reordered={messages:input.messages,max_tokens:123,inference_geo:'global',service_tier:'standard_only',stream:false,model};
 const prepared=await a.prepare(wire(reordered));
 assert.deepEqual(JSON.parse(prepared.dispatch()),reordered);
 await assert.rejects(a.prepare(wire(reordered)));assert.throws(()=>a.validateInput(input));
 const b=context(),history={...body(),messages:[{role:'user',content:'one'},{role:'assistant',content:'two'}]};b.validateInput(history);
 await assert.rejects(b.prepare(wire({...history,messages:[...history.messages].reverse()})));
});

test('native continuation rejects changed signed or redacted history and error flags before transport', async () => {
 const input = { ...body(), stream: true, thinking: { type: 'adaptive', display: 'omitted' }, messages: [
  ...body().messages,
  { role: 'assistant', content: [
   { type: 'thinking', thinking: '', signature: 'fixture-signature' },
   { type: 'redacted_thinking', data: 'fixture-data' },
   { type: 'tool_use', id: 'toolu_fixture', name: 'lookup', input: {} },
  ] },
  { role: 'user', content: [
   { type: 'tool_result', tool_use_id: 'toolu_fixture', is_error: true },
  ] },
 ] };
 assert.throws(() => context().validateInput({ ...input, stream: false }));
 const before = [transports, intents, posts];
 for (const changed of [
  b => { b.messages[1].content[0].signature = 'changed'; },
  b => { b.messages[1].content.splice(1, 1); },
  b => { delete b.messages[2].content[0].is_error; },
 ]) {
  const ctx = context({}, true);
  ctx.validateInput(input);
  const outgoing = structuredClone(input);
  changed(outgoing);
  await assert.rejects(ctx.prepare(wire(outgoing)));
 }
 assert.deepEqual([transports, intents, posts], before);
});

test('contexts isolate concurrent baselines and checked payload is handed unchanged to transport',async()=>{
 const a=context(),b=context(),one=body(),two={...body(),max_tokens:456};a.validateInput(one);b.validateInput(two);
 const before=[transports,intents,posts];await assert.rejects(a.prepare(wire(two)));
 assert.deepEqual([transports,intents,posts],before);
 const options=wire(two),pending=b.prepare(options);options.options.body=JSON.stringify(one);
 const result=await pending;assert.deepEqual(JSON.parse(result.dispatch()),two);
});
