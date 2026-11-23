import fs from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SignJWT} from 'jose';
import {createDashboardAuthToken} from '../../src/lib/auth/dashboardSession.js';
import { PATCH as patchPricing, DELETE as deletePricing } from '../../src/app/api/pricing/route.js';
import { pricingMutations } from '../fixtures/budget/jwt-settings-stub.mjs';
import {GET,PUT} from '../../src/app/api/keys/[id]/budget/route.js';
assert.equal(process.env.BUDGET_PURE_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
assert.equal(process.env.JWT_SECRET,'fixture-only-jwt-secret-012345678901234567890123456789');
const key=new TextEncoder().encode(process.env.JWT_SECRET);
const params={params:Promise.resolve({id:'key-A'})};
function request(token,origin='https://dashboard.invalid'){
 const r=new Request('https://dashboard.invalid/api/keys/key-A/budget',{method:'PUT',headers:{origin,'content-type':'application/json'},body:JSON.stringify({expectedVersion:0,limits:{weekly:'0',monthly:null}})});
 Object.defineProperty(r,'cookies',{value:{get:()=>token?{value:token}:undefined}});return r;
}

test('actual dashboard HS256 session authorizes only read-readiness and still cannot activate budget',async()=>{
 const token=await createDashboardAuthToken();
 const get=await GET(request(token),params);assert.equal(get.status,200);assert.equal((await get.json()).readiness.ready,false);
 const put=await PUT(request(token),params);assert.equal(put.status,503);assert.equal(put.headers.get('cache-control'),'no-store');
});

test('actual JWT verification rejects tampered wrong-secret expired and unsigned tokens before management read or write',async()=>{
 const valid=await createDashboardAuthToken();const parts=valid.split('.');
 const tampered=[parts[0],Buffer.from(JSON.stringify({authenticated:true,exp:9999999999,admin:true})).toString('base64url'),parts[2]].join('.');
 const wrong=await new SignJWT({authenticated:true}).setProtectedHeader({alg:'HS256'}).setExpirationTime('1h').sign(new TextEncoder().encode('fixture-different-secret-01234567890123456789'));
 const expired=await new SignJWT({authenticated:true}).setProtectedHeader({alg:'HS256'}).setExpirationTime(1).sign(key);
 const unsigned=Buffer.from(JSON.stringify({alg:'none'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({authenticated:true})).toString('base64url')+'.';
 for(const token of [null,'not.jwt',tampered,wrong,expired,unsigned]){
  assert.equal((await GET(request(token),params)).status,401);assert.equal((await PUT(request(token),params)).status,401);
 }
});

test('valid signed missing-authenticated or mandatory-password-change claims do not grant management authority',async()=>{
 const missing=await new SignJWT({}).setProtectedHeader({alg:'HS256'}).setExpirationTime('1h').sign(key);
 for(const token of [missing,await createDashboardAuthToken({authenticated:false}),await createDashboardAuthToken({mustChangePassword:true})]){
  assert.equal((await GET(request(token),params)).status,401);
 }
});

test('actual signed session does not bypass Origin CSRF and creates no host/session secret file',async()=>{
 const token=await createDashboardAuthToken();assert.equal((await PUT(request(token,'https://evil.invalid'),params)).status,403);
 assert.equal(fs.existsSync('/sandbox/data/jwt-secret'),false);assert.equal(fs.existsSync('/app/.env'),false);assert.equal(fs.existsSync('/home/gmo'),false);
});


test('Codex price updates and resets require a dashboard session and same origin', async () => {
  const token = await createDashboardAuthToken();
  const body = { openai: { 'gpt-6.2-sol': { input: 2, output: 10, cached: 0.1, cache_creation: 2.5 } } };
  const change = (method, query, session, origin, data) => {
    const r = new Request('https://dashboard.invalid/api/pricing' + query, {
      method, headers: { origin, 'content-type': 'application/json', 'x-9r-cli-token': 'fixture-cli' },
      body: data && JSON.stringify(data),
    });
    Object.defineProperty(r, 'cookies', { value: { get: () => session ? { value: session } : undefined } });
    return r;
  };
  const origin = 'https://dashboard.invalid';
  for (const [handler, method, query, data] of [
    [patchPricing, 'PATCH', '', body],
    [deletePricing, 'DELETE', '?provider=openai&model=gpt-6.2-sol'],
    [deletePricing, 'DELETE', '?provider=openai'],
    [deletePricing, 'DELETE', ''],
  ]) {
    const before = pricingMutations.length;
    assert.equal((await handler(change(method, query, null, origin, data))).status, 401);
    assert.equal((await handler(change(method, query, token, 'https://foreign.invalid', data))).status, 403);
    assert.equal(pricingMutations.length, before);
    assert.equal((await handler(change(method, query, token, origin, data))).status, 200);
    assert.equal(pricingMutations.length, before + 1);
  }
  assert.equal((await patchPricing(change('PATCH', '', null, origin, { openai: { other: { input: 2 } } }))).status, 200);
  assert.equal((await deletePricing(change('DELETE', '?provider=openai&model=other', null, origin))).status, 200);
});
