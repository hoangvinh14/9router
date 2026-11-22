import fs from 'node:fs';
import assert from 'node:assert/strict';
import {test,after} from 'node:test';
assert.equal(process.env.BUDGET_DRIVER_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
const {getAdapter}=await import('/app/src/lib/db/driver.js');
const {initializeNodeKeyPolicy,createNodeKeyPolicy}=await import('/app/src/lib/accounting/node-key-policy.js');
const {initializeNodeAttemptLedger}=await import('/app/src/lib/accounting/node-attempt-ledger.js');
const db=await getAdapter();
for(const [id,key]of [['key-A','controlled'],['key-B','ordinary']])db.run('INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES(?,?,1,?)',[id,key,'2026-11-16T00:00:00.000Z']);
initializeNodeKeyPolicy(db);initializeNodeAttemptLedger(db);createNodeKeyPolicy(db).save('key-A',0,{weekly:null,monthly:'1'});
after(()=>db.close());
const {POST:compact}=await import('/app/src/app/api/v1/responses/compact/route.js');
const {POST:gemini}=await import('/app/src/app/api/v1beta/models/[...path]/route.js');
const request=(headers={},query='')=>({url:'https://fixture.invalid/v1beta/models/gemini:generateContent'+query,headers:new Headers(headers),json:()=>assert.fail('body before refusal')});
const params={params:Promise.resolve({path:['gemini:generateContent']})};

test('actual compact and Gemini routes refuse all controlled credential forms before init parse or reconstruction',async()=>{
 for(const handler of [compact,gemini]){
  for(const headers of [{'authorization':'Bearer controlled'},{'x-api-key':'controlled'},{'x-goog-api-key':'controlled'}]){
   const result=await handler(request(headers),params);assert.equal(result.status,503);assert.equal(result.headers.get('cache-control'),'no-store');
  }
  assert.equal((await handler(request({},'?key=controlled'),params)).status,503);
 }
});

test('Gemini native key selection cannot hide controlled google or query key behind ordinary x-api-key',async()=>{
 for(const req of [request({'x-api-key':'ordinary','x-goog-api-key':'controlled'}),request({'x-api-key':'ordinary'},'?key=controlled')]){
  assert.equal((await gemini(req,params)).status,503);
 }
});

test('ordinary and no-key reconstruction routes reach existing init instead of manufactured accounting permission',async()=>{
 for(const handler of [compact,gemini]){
  for(const req of [request(),request({'authorization':'Bearer ordinary'})]){
   await assert.rejects(handler(req,params),/fixture route downstream reached/);
  }
 }
});
