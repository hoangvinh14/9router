import fs from 'node:fs';
import assert from 'node:assert/strict';
import { test, mock, after } from 'node:test';
assert.equal(process.env.BUDGET_DRIVER_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
const { getAdapter } = await import('/app/src/lib/db/driver.js');
const { initializeNodeKeyPolicy, createNodeKeyPolicy } = await import('/app/src/lib/accounting/node-key-policy.js');
const { initializeNodeAttemptLedger } = await import('/app/src/lib/accounting/node-attempt-ledger.js');
const db=await getAdapter();
for(const [id,secret] of [['key-A','controlled'],['key-B','ordinary']])db.run('INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES(?,?,1,?)',[id,secret,'2026-11-16T00:00:00.000Z']);
initializeNodeKeyPolicy(db);initializeNodeAttemptLedger(db);createNodeKeyPolicy(db).save('key-A',0,{weekly:null,monthly:'1'});
after(()=>db.close());
let authReads=0;
mock.module('/app/fixtures/next-server.js',{namedExports:{NextResponse:{next:()=>new Response(null,{status:204}),json:(body,options)=>Response.json(body,options),redirect:()=>new Response(null,{status:307})}}});
mock.module('/app/fixtures/local-db.js',{namedExports:{getSettings:async()=>({requireLogin:false}),validateApiKey:async secret=>{authReads++;return ['controlled','ordinary'].includes(secret);}}});
mock.module('/app/fixtures/machine-id.js',{namedExports:{getConsistentMachineId:async()=>{authReads++;return 'fixture-cli';}}});
mock.module('/app/fixtures/dashboard-session.js',{namedExports:{verifyDashboardAuthToken:async()=>true}});
mock.module('/app/fixtures/trusted-peer.js',{namedExports:{hasTrustedPeerHeaders:()=>true}});
const {proxy}=await import('/app/src/dashboardGuard.js');
const request=(path,headers={})=>({url:'https://fixture.invalid'+path,nextUrl:new URL('https://fixture.invalid'+path),headers:new Headers(headers),cookies:{get:()=>({value:'fixture-jwt'})}});

test('actual guard refuses controlled identity before local CLI and permissive dashboard authorization on every public prefix',async()=>{
 const before=authReads;
 for(const path of ['/v1/chat/completions','/api/v1/messages','/v1beta/models/x:generateContent','/api/v1beta/models/x:generateContent','/codex/responses','/responses']){
  for(const identity of [{'authorization':'Bearer controlled'},{'x-api-key':'controlled'},{'x-goog-api-key':'controlled'}]){
   const result=await proxy(request(path,{...identity,'x-9r-real-ip':'127.0.0.1','x-9r-cli-token':'fixture-cli'}));
   assert.equal(result.status,503);assert.equal(result.headers.get('cache-control'),'no-store');assert.equal((await result.text()).includes('controlled'),false);
  }
  assert.equal((await proxy(request(path+'?key=controlled',{'x-9r-real-ip':'127.0.0.1'}))).status,503);
 }
 assert.equal(authReads,before); // no CLI-token/key-validation shortcut reached
});

test('ordinary and no-key guard authorization outcomes remain local CLI remote semantics',async()=>{
 assert.equal((await proxy(request('/v1/messages',{'x-9r-real-ip':'127.0.0.1'}))).status,204);
 assert.equal((await proxy(request('/v1/messages',{'x-9r-cli-token':'fixture-cli'}))).status,204);
 assert.equal((await proxy(request('/v1/messages',{'authorization':'Bearer ordinary'}))).status,204);
 assert.equal((await proxy(request('/v1/messages'))).status,401);
 assert.equal((await proxy(request('/v1/messages',{'authorization':'Bearer invalid'}))).status,401);
});

test('actual guard uses authoritative credential precedence without granting shadowed-key identity',async()=>{
 assert.equal((await proxy(request('/v1/messages',{'authorization':'Bearer controlled','x-api-key':'ordinary'}))).status,503);
 // A lower-precedence credential does not change identity; selected ordinary
 // remains subject to original auth. Handler closure must use same extraction.
 assert.equal((await proxy(request('/v1/messages',{'authorization':'Bearer ordinary','x-api-key':'controlled'}))).status,204);
 assert.equal((await proxy(request('/v1/messages',{'x-api-key':'controlled','x-goog-api-key':'ordinary'}))).status,503);
});
