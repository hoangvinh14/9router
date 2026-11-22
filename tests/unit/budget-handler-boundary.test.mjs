import fs from 'node:fs';
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
assert.equal(process.env.BUDGET_DRIVER_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
const {getAdapter}=await import('/app/src/lib/db/driver.js');
const {initializeNodeKeyPolicy,createNodeKeyPolicy}=await import('/app/src/lib/accounting/node-key-policy.js');
const {initializeNodeAttemptLedger}=await import('/app/src/lib/accounting/node-attempt-ledger.js');
const db=await getAdapter();
db.run('INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES(?,?,1,?)',['key-A','fixture-controlled','2026-11-16T00:00:00.000Z']);
initializeNodeKeyPolicy(db);initializeNodeAttemptLedger(db);createNodeKeyPolicy(db).save('key-A',0,{weekly:null,monthly:'1000'});
after(()=>db.close());
const entries=[['chat','handleChat'],['embeddings','handleEmbeddings'],['fetch','handleFetch'],['imageGeneration','handleImageGeneration'],
 ['search','handleSearch'],['stt','handleStt'],['systemone','handleSystemone'],['tts','handleTts'],['videoGeneration','handleVideoCreate'],['videoGeneration','handleVideoGet']];
const handlers=[];
for(const [file,name]of entries)handlers.push([name,(await import('/app/src/sse/handlers/'+file+'.js'))[name]]);
const request=headers=>({url:'https://fixture.invalid/v1/messages',headers:new Headers(headers),
 json:()=>assert.fail('body read before refusal'),text:()=>assert.fail('body read before refusal'),formData:()=>assert.fail('form read before refusal'),arrayBuffer:()=>assert.fail('bytes read before refusal')});

test('ten actual direct handler entries refuse controlled keys before body helper credentials or DNS',async()=>{
 for(const [name,handler]of handlers){
  for(const headers of [{'authorization':'Bearer fixture-controlled'},{'x-api-key':'fixture-controlled'},{'x-goog-api-key':'fixture-controlled'}]){
   const result=await handler(request(headers),'fixture');
   assert.equal(result.status,503,name);assert.equal(result.headers.get('cache-control'),'no-store',name);
  }
  const query=request({});query.url+='?key=fixture-controlled';
  assert.equal((await handler(query,'fixture')).status,503,name);
 }
});

test('ordinary no-key direct JSON and multipart entries reach their existing parser instead of forced accounting denial',async()=>{
 for(const [name,handler]of handlers){
  if(name.startsWith('handleVideo'))continue; // video auth precedes parser; not an ordinary video proof
  const response=await handler({url:'https://fixture.invalid/v1/messages',headers:new Headers(),json:async()=>{throw new Error('invalid JSON');},formData:async()=>{throw new Error('invalid multipart');}});
  assert.equal(response.status,400,name);
 }
});
