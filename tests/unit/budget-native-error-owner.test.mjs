import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { parseUpstreamError } from '../../open-sse/utils/error.js';
import { createNodeSqliteAdapter } from '../../src/lib/db/adapters/nodeSqliteAdapter.js';
import { initializeNodeAttemptLedger,createNodeAttemptLedger } from '../../src/lib/accounting/node-attempt-ledger.js';
import { anthropicJsonUsage } from '../../src/lib/accounting/anthropic-usage.js';
assert.equal(process.env.BUDGET_PURE_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);

test('existing native error body owner reads once, awaits terminal evidence ACK and preserves upstream status',async()=>{
 const db=await createNodeSqliteAdapter('/tmp/error-owner.sqlite');
 try{
  initializeNodeAttemptLedger(db);const store=createNodeAttemptLedger(db);
  const now='2026-11-16T10:00:00.000Z';
  const attempt=store.prepare({attemptId:'error',keyId:'key-A',bindingGeneration:'1',provider:'anthropic',model:'fixture',startedAt:now,
   price:{currency:'USD',unit:'USD/1M tokens',revision:'fixture',rates:{input:'3',output:'15'}}});
  const response=new Response(JSON.stringify({error:{message:'upstream unavailable'},usage:{input_tokens:1000,output_tokens:0}}),{status:503});
  let reads=0;const text=response.text.bind(response);response.text=()=>{reads++;return text();};
  const parsed=await parseUpstreamError(response,null,body=>attempt.settle(anthropicJsonUsage(body?.usage)));
  assert.equal(reads,1);assert.equal(parsed.statusCode,503);assert.equal(parsed.message,'upstream unavailable');
  assert.equal(store.totals('key-A',now).monthly,'3000000');
 }finally{db.close();}
});

test('completed malformed and empty error JSON each settle unknown once without inventing reported zero',async()=>{
 const db=await createNodeSqliteAdapter('/tmp/error-malformed.sqlite');
 try{
  initializeNodeAttemptLedger(db);const store=createNodeAttemptLedger(db);const now='2026-11-16T10:00:00.000Z';
  for(const [index,body] of ['{',''].entries()){
   const attempt=store.prepare({attemptId:'malformed-'+index,keyId:'key-A',bindingGeneration:'1',provider:'anthropic',model:'fixture',startedAt:now,
    price:{currency:'USD',unit:'USD/1M tokens',revision:'fixture',rates:{input:'3',output:'15'}}});
   let reads=0,calls=0;
   const response={status:502,text:async()=>{reads++;return body;}};
   const parsed=await parseUpstreamError(response,null,native=>{calls++;assert.equal(native,null);attempt.settle(anthropicJsonUsage(native?.usage));});
   assert.equal(reads,1);assert.equal(calls,1);assert.equal(parsed.statusCode,502);
  }
  assert.deepEqual(store.totals('key-A',now),{weekly:'0',monthly:'0',unknown:2});
 }finally{db.close();}
});

test('SyntaxError from interrupted error-body read remains E2, not a completed JSON parse failure',async()=>{
 const interrupted=new SyntaxError('reader rejection');let calls=0;
 await assert.rejects(parseUpstreamError({status:502,text:async()=>{throw interrupted;}},null,()=>{calls++;}),e=>e===interrupted);
 assert.equal(calls,0);
});

test('native error parsing waits for asynchronous terminal ACK and propagates its exact rejection once',async()=>{
 let release;let calls=0;let done=false;const fault=new Error('ACK unavailable');
 const ack=new Promise((_resolve,reject)=>{release=()=>reject(fault);});
 const response={status:503,text:async()=>'{'};
 const result=parseUpstreamError(response,null,()=>{calls++;return ack;});
 const observed=result.then(()=>{done=true;},error=>{done=true;throw error;});
 await Promise.resolve();await Promise.resolve();assert.equal(calls,1);assert.equal(done,false);
 release();await assert.rejects(observed,error=>error===fault);assert.equal(calls,1);
});

test('native error owner never swallows recording failure or defaults interrupted body as completed usage',async()=>{
 let calls=0;
 await assert.rejects(parseUpstreamError(new Response('{}',{status:400}),null,()=>{calls++;throw new Error('recording fault');}),/recording fault/);
 assert.equal(calls,1);
 const interrupted={status:502,text:async()=>{throw new Error('stream interrupted');}};
 await assert.rejects(parseUpstreamError(interrupted,null,()=>{calls++;}),/stream interrupted/);
 assert.equal(calls,1);
 const ordinary=await parseUpstreamError(interrupted);assert.equal(ordinary.statusCode,502);
});
