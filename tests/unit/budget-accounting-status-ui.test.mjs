import fs from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parse} from '@babel/parser';
import {accountingStatusView,loadAccountingStatus,rotateBudgetKey,loadBudgetKeys} from '../../src/app/(dashboard)/dashboard/endpoint/components/accountingStatusClient.js';
assert.equal(process.env.BUDGET_UI_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
const body=()=>({readiness:{ready:false,reason:'no_admitted_profile'},policy:{keyId:'key-A',version:1,bindingGeneration:'1',lifecycle:'active',limits:{weekly:'0',monthly:null}},retirementEvent:null,usage:null});
const retired=()=>{const value=body();value.policy.lifecycle='retired';value.policy.version=2;value.retirementEvent={action:'retire',actorClass:'dashboard-session',occurredAt:'2026-11-16T00:00:00.000Z',version:2,previousVersion:1,bindingGeneration:'1'};return value;};
test('display projection retains exact zero/unlimited and only explicitly projected fields',()=>{
 const value=body();value.secret='private';value.policy.key='private';
 const view=accountingStatusView(value,'key-A');assert.equal(view.weekly,'0');assert.equal(view.monthly,null);assert.equal(view.retirementEvent,null);
 assert.equal(Object.isFrozen(view),true);assert.equal(JSON.stringify(view).includes('private'),false);
});
test('recorded event and internally retired absence are separate display states',()=>{
 const view=accountingStatusView(retired(),'key-A');assert.equal(Object.isFrozen(view.retirementEvent),true);assert.equal(view.retirementEvent.actorClass,'dashboard-session');
 const value=retired();value.retirementEvent=null;assert.equal(accountingStatusView(value,'key-A').retirementEvent,null);
});
test('malformed/mismatched/unsupported response fails closed instead of fabricated status',()=>{
 for(const mutate of [v=>{v.policy.keyId='other';},v=>{v.readiness.ready=true;},v=>{v.policy.limits.weekly=0;},v=>{delete v.retirementEvent;},v=>{v.policy.version=0;},v=>{v.retirementEvent.occurredAt='private';},v=>{v.retirementEvent.actorClass='person';},v=>{v.retirementEvent.version=3;},v=>{v.policy.lifecycle='active';}]){
  const value=retired();mutate(value);assert.throws(()=>accountingStatusView(value,'key-A'),/Accounting status unavailable/);
 }
});
test('request uses stable encoded ID only GET same-origin no-store no redirect and supplied abort signal',async()=>{
 const controller=new AbortController();let calls=0;
 const view=await loadAccountingStatus('key-A',{signal:controller.signal,fetcher:async(url,options)=>{
  calls++;assert.equal(url,'/api/keys/key-A/budget/retire');assert.deepEqual(options,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});
  assert.equal(Object.hasOwn(options,'body'),false);return {ok:true,status:200,json:async()=>body()};
 }});assert.equal(calls,1);assert.equal(view.lifecycle,'active');
 let reads=0;await assert.rejects(loadAccountingStatus('../private',{fetcher:()=>{reads++;}}));assert.equal(reads,0);
});
test('401 is explicit, other HTTP failures do not consume or expose raw response',async()=>{
 for(const status of [401,403,500,503]){
  let reads=0;await assert.rejects(loadAccountingStatus('key-A',{fetcher:async()=>({status,ok:false,json(){reads++;throw Error('private');}})}),e=>status===401?e.message.includes('signed dashboard session'):e.message.includes('No policy or retirement conclusion'));
  assert.equal(reads,0);
 }
});
test('network parse and malformed response errors are sanitized',async()=>{
 for(const fetcher of [async()=>{throw Error('private-network');},async()=>({ok:true,status:200,json:async()=>{throw Error('private-json');}}),async()=>({ok:true,status:200,json:async()=>({secret:'private'})})]){
  await assert.rejects(loadAccountingStatus('key-A',{fetcher}),e=>e.message.includes('Accounting status unavailable')&&!e.message.includes('private'));
 }
});
test('new components and existing endpoint parse as JSX with reveal and copy controls for available keys',()=>{
 const root='/app/src/app/(dashboard)/dashboard/endpoint/';
 const component=fs.readFileSync(root+'components/AccountingStatus.js','utf8');const endpoint=fs.readFileSync(root+'EndpointPageClient.js','utf8');
 const dashboard='/app/src/app/(dashboard)/dashboard/';
 const hook=fs.readFileSync(dashboard+'useAccountingSnapshot.js','utf8');
 const budget=fs.readFileSync(dashboard+'usage/components/BudgetTab.js','utf8');
 const details=fs.readFileSync(dashboard+'usage/components/BudgetDetails.js','utf8');
 for(const source of [component,endpoint,hook,budget,details])assert.ok(parse(source,{sourceType:'module',plugins:['jsx']}));
 assert.ok(endpoint.includes('<AccountingStatus keyId={key.id} onRotated='));
 assert.ok(endpoint.includes('visibleKeys.has(key.id) ? key.key : maskKey(key.key)'));assert.ok(endpoint.includes('onClick={() => copy(key.key, key.id)}'));
 // Source contract only, NOT mounted React effect/DOM or browser verification.
 assert.ok(component.includes('open && <StatusSnapshot key={keyId} keyId={keyId} onRotated={onRotated} />'));
 assert.ok(hook.includes('current = false; controller.abort()'));assert.ok(component.includes('disabled={state.loading}'));
 assert.ok(component.includes('No recorded retirement event. This does not mean this key was never retired.'));
 assert.ok(!component.includes('dangerouslySetInnerHTML'));
 assert.ok(endpoint.includes('{key.key && <div'));
 assert.ok(component.includes('onClick={() => setSecret(null)}'));
});


for (const committed of [false, true]) {
  test(`lost rotation response checks the original operation without another POST (committed=${committed})`, async t => {
    let operationId;
    const fetcher = t.mock.method(globalThis, 'fetch', async (url, options) => {
      assert.equal(options.cache, 'no-store');
      if (options.method === 'POST') {
        assert.equal(url, '/api/keys/key-A/budget/rotate');
        const command = JSON.parse(options.body);
        assert.equal(command.expectedVersion, 7);
        operationId = command.operationId;
        assert.match(operationId, /^[0-9a-f]{32}$/);
        throw new Error('fixture network failure');
      }
      assert.equal(url, `/api/keys/key-A/budget/rotate?operationId=${operationId}`);
      return committed ? Response.json({ receipt: { operationId, keyId: 'key-A',
        previousVersion: 7, version: 8, bindingGeneration: '2', action: 'rotate' } }) : new Response(null, { status: 404 });
    });
    if (committed) assert.deepEqual(await rotateBudgetKey('key-A', 7), { key: null });
    else await assert.rejects(rotateBudgetKey('key-A', 7), /Refresh accounting status/);
    assert.equal(fetcher.mock.callCount(), 2);
  });
}

test('budget list projects metadata and requests the admin view', async () => {
 const result = await loadBudgetKeys("budget-keys", {fetcher: async (url, options) => {
  assert.equal(url, "/api/keys?view=budget");
  assert.equal(options.credentials, "same-origin");
  assert.equal(options.cache, "no-store");
  return Response.json({keys:[{id:"key-A",name:"One",isActive:true,key:"private"}, {id:"key-B",name:"Two",isActive:false}]});
 }});
 assert.deepEqual(result, [{id:"key-A",name:"One",isActive:true}, {id:"key-B",name:"Two",isActive:false}]);
 await assert.rejects(loadBudgetKeys("budget-keys", {fetcher: async () => new Response(null,{status:401})}), /Sign in/);
});
