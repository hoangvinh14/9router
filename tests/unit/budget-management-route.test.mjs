import fs from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {GET,PUT} from '../../src/app/api/keys/[id]/budget/route.js';
assert.equal(process.env.BUDGET_PURE_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
const params={params:Promise.resolve({id:'key-A'})};
const payload={expectedVersion:0,limits:{weekly:'1000',monthly:null}};
function req(body=payload,headers={},token='fixture-admin'){
 const request=new Request('https://dashboard.invalid/api/keys/key-A/budget',{method:'PUT',headers:{origin:'https://dashboard.invalid','content-type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
 Object.defineProperty(request,'cookies',{value:{get:()=>token?{value:token}:undefined}});return request;
}

test('management requires dashboard authenticated session, not inference CLI local or optional-login shortcuts',async()=>{
 for(const token of [null,'inference-key','fixture-change-password','fixture-wrong-claim']){
  for(const handler of [GET,PUT]){
   const request=req(payload,{'authorization':'Bearer inference-key','x-9r-cli-token':'fixture-cli','x-9r-real-ip':'127.0.0.1'},token);
   const result=await handler(request,params);assert.equal(result.status,401);assert.equal(result.headers.get('cache-control'),'no-store');
  }
 }
});

test('management writes require exact Origin and reject cross-site and forwarded-host spoofing',async()=>{
 for(const headers of [{origin:'null'},{origin:'https://evil.invalid'},{origin:'https://dashboard.invalid/'},{origin:''},
  {'sec-fetch-site':'cross-site'},{origin:'https://evil.invalid','x-forwarded-host':'evil.invalid','x-forwarded-proto':'https'}]){
  assert.equal((await PUT(req(payload,headers),params)).status,403);
 }
 const savedBase = process.env.BASE_URL;
 try {
  process.env.BASE_URL = 'https://public-dashboard.invalid';
  assert.equal((await PUT(req(payload,{origin:'https://public-dashboard.invalid','sec-fetch-site':'same-origin'}),params)).status,503);
  assert.equal((await PUT(req(payload),params)).status,403);
  assert.equal((await PUT(req(payload,{origin:'https://public-dashboard.invalid','sec-fetch-site':'cross-site'}),params)).status,403);
  assert.equal((await PUT(req(payload,{origin:'https://evil.invalid','x-forwarded-host':'evil.invalid'}),params)).status,403);
  process.env.BASE_URL = 'https://user:pass@dashboard.invalid';
  assert.equal((await PUT(req(payload),params)).status,403);
 } finally {
  if (savedBase === undefined) delete process.env.BASE_URL;
  else process.env.BASE_URL = savedBase;
 }
});

test('management refuses finite and unlimited enrollment while real production coverage remains empty',async()=>{
 for(const limits of [{weekly:'0',monthly:'1000'},{weekly:null,monthly:null}]){
  const result=await PUT(req({expectedVersion:0,limits}),params);assert.equal(result.status,503);assert.equal(result.headers.get('cache-control'),'no-store');
 }
 const response=await GET(req(),params);assert.equal(response.status,200);
 const body=await response.json();assert.deepEqual(body,{readiness:{ready:false,reason:'no_admitted_profile'},policy:null,usage:null});
});

test('management payload validates exact integer money CAS schema content type and byte bounds before any save',async()=>{
 for(const body of ['{',{expectedVersion:-1,limits:{weekly:null,monthly:null}}, {expectedVersion:0,limits:{weekly:1,monthly:null}},
  {expectedVersion:0,limits:{weekly:'0.1',monthly:null}}, {expectedVersion:0,limits:{weekly:null,monthly:null},ready:true}]){
  assert.equal((await PUT(req(body),params)).status,400);
 }
 assert.equal((await PUT(req(payload,{'content-type':'text/plain'}),params)).status,400);
 assert.equal((await PUT(req('x'.repeat(4097)),params)).status,413);
 assert.equal((await PUT(req(payload,{'content-length':'5000'}),params)).status,413);
 assert.equal((await PUT(req(),{params:Promise.resolve({id:'../unsafe'})})).status,400);
});
