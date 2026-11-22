import fs from 'node:fs';
import assert from 'node:assert/strict';
import https from 'node:https';
import { test, after } from 'node:test';
import { spawn } from 'node:child_process';
import { prepareAccountedDirectPost, proxyAwareFetch, getDirectDispatcher, getAccountedDirectDispatcher } from '../../open-sse/utils/proxyFetch.js';
import { createNodeSqliteAdapter } from '../../src/lib/db/adapters/nodeSqliteAdapter.js';
import { initializeNodeAttemptLedger, createNodeAttemptLedger } from '../../src/lib/accounting/node-attempt-ledger.js';
import { initializeNodeKeyPolicy, createNodeKeyPolicy } from '../../src/lib/accounting/node-key-policy.js';
import { anthropicJsonUsage } from '../../src/lib/accounting/anthropic-usage.js';
assert.equal(process.env.BUDGET_TRANSPORT_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
assert.notEqual(fs.readlinkSync('/proc/self/ns/user'),process.env.BUDGET_OUTER_USER);
const status=fs.readFileSync('/proc/self/status','utf8');
for(const name of ['CapInh','CapPrm','CapEff','CapBnd','CapAmb'])assert.equal(BigInt('0x'+status.split('\n').find(line=>line.startsWith(name+':')).split(':')[1].trim()),0n);
assert.match(status,/^NoNewPrivs:\s+1$/m);
for(const hidden of ['/home/gmo','/app/.env','/app/.git','/app/src/lib/db/driver.js']) assert.equal(fs.existsSync(hidden),false);
const key=fs.readFileSync('/tmp/test-key.pem');const cert=fs.readFileSync('/tmp/test-cert.pem');
const posts=[];
let misdirectedRequests=0;
const server=https.createServer({key,cert},async(req,res)=>{
  if(req.url==='/misdirected')misdirectedRequests++;
  const chunks=[];for await(const chunk of req) chunks.push(chunk);
  posts.push({path:req.url,method:req.method,body:Buffer.concat(chunks).toString(),snapshot:req.headers['x-snapshot']});
  if(req.url==='/redirect'){res.writeHead(307,{location:'/replayed'});res.end();return;}
  if(req.url==='/status'){res.writeHead(503,{'content-type':'application/json'});res.end('{}');return;}
  if(req.url==='/misdirected'){
    posts.at(-1).length=req.headers['content-length'];
    posts.at(-1).transferEncoding=req.headers['transfer-encoding'];
    res.writeHead(421,{'content-type':'application/json'});res.end('{"type":"error"}');return;
  }
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({usage:{input_tokens:1000,output_tokens:1000,cache_read_input_tokens:0,cache_creation_input_tokens:0,cache_creation:{ephemeral_5m_input_tokens:0,ephemeral_1h_input_tokens:0}}}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=path=>`https://127.0.0.1:${server.address().port}${path}`;
function seedPolicy(db,keyId,limits){
  db.exec('CREATE TABLE apiKeys (id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, isActive INTEGER NOT NULL)');
  db.run('INSERT INTO apiKeys VALUES (?,?,1)',[keyId,'fixture-'+keyId]);
  initializeNodeKeyPolicy(db);createNodeKeyPolicy(db).save(keyId,0,limits);
}
const options={method:'POST',headers:{'content-type':'application/json'},body:'{"fixture":true}'};
after(async()=>{await(await getDirectDispatcher(false)).close();await(await getAccountedDirectDispatcher()).close();await new Promise(resolve=>server.close(resolve));});

test('actual strict HTTPS POST occurs only after own ledger ACK and next equality threshold has zero POST',async()=>{
  const db=await createNodeSqliteAdapter('/tmp/native-ledger.sqlite');
  try{
    initializeNodeAttemptLedger(db);const store=createNodeAttemptLedger(db);
    const price={currency:'USD',unit:'USD/1M tokens',revision:'native-fixture',rates:{input:'3',output:'15',cached:'0.30',cache_creation:'3.75',cache_creation_1h:'6'}};
    const now='2026-11-16T10:00:00.000Z';
    const command=id=>({attemptId:id,keyId:'key-A',bindingGeneration:'1',provider:'anthropic',model:'fixture',startedAt:now,price});
    seedPolicy(db,'key-A',{weekly:'18000000',monthly:'18000000'});
    const context={presentedSecret:'fixture-key-A',now};
    const attempt=store.prepare(command('first'));const initiate=await prepareAccountedDirectPost(url('/messages'),options);
    const before=posts.length;
    const response=await store.dispatch(attempt.ack,context,initiate);
    const parsed=await response.json();attempt.settle(anthropicJsonUsage(parsed.usage));
    assert.equal(posts.length,before+1);assert.equal(posts.at(-1).method,'POST');assert.equal(posts.at(-1).body,options.body);
    assert.equal(store.totals('key-A',now).monthly,'18000000');
    const next=store.prepare(command('next'));const successor=await prepareAccountedDirectPost(url('/messages'),options);
    assert.throws(()=>store.dispatch(next.ack,context,successor));assert.equal(posts.length,before+1);
    assert.throws(()=>store.dispatch(attempt.ack,context,initiate));
  }finally{db.close();}
});

test('accounted direct redirect and status failures never cause hidden second POST; invocation is one use',async()=>{
  const before=posts.length;const redirect=await prepareAccountedDirectPost(url('/redirect'),options);
  await assert.rejects(redirect());assert.throws(redirect);
  assert.equal(posts.length,before+1);assert.equal(posts.at(-1).path,'/redirect');
  const once=await prepareAccountedDirectPost(url('/status'),options);const response=await once();
  assert.equal(response.status,503);await response.text();assert.throws(once);assert.equal(posts.length,before+2);
  assert.equal(posts.filter(p=>p.path==='/replayed').length,0);
});

test('accounted direct transport returns 421 after exactly one fixed-length UTF-8 POST',async()=>{
  const before=posts.length;
  const body='{"message":"tiếng Việt"}';
  const initiate=await prepareAccountedDirectPost(url('/misdirected'),{...options,body});
  const response=await initiate();
  const payload=await response.json();
  assert.equal(misdirectedRequests,1,'one invocation must not reach TLS ingress a second time');
  assert.equal(posts.length,before+1);
  assert.equal(response.status,421);
  assert.deepEqual(payload,{type:'error'});
  assert.deepEqual(posts.at(-1),{path:'/misdirected',method:'POST',body,snapshot:undefined,
    length:String(Buffer.byteLength(body)),transferEncoding:undefined});
  assert.throws(initiate);
});

test('unproven proxy/relay, TLS disabling, dynamic transport and insecure destinations refuse before POST',async()=>{
  const before=posts.length;
  for(const proxy of [{url:'http://127.0.0.1:1'},{vercelRelayUrl:'https://example.test'},{strictProxy:true}])
    await assert.rejects(prepareAccountedDirectPost(url('/messages'),options,proxy));
  for(const patch of [{directFetch:()=>assert.fail('custom transport')},{redirect:'follow'},{dispatcher:{}}])
    await assert.rejects(prepareAccountedDirectPost(url('/messages'),{...options,...patch}));
  await assert.rejects(prepareAccountedDirectPost('http://127.0.0.1/messages',options));
  process.env.HTTPS_PROXY='http://127.0.0.1:1';
  try{await assert.rejects(prepareAccountedDirectPost(url('/messages'),options));}finally{delete process.env.HTTPS_PROXY;}
  process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';
  try{await assert.rejects(prepareAccountedDirectPost(url('/messages'),options));}finally{delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;}
  assert.equal(posts.length,before);
});

test('native TLS refuses missing fixture trust and mismatched peer identity before any HTTP request',async()=>{
  const before=posts.length;
  const rejected=options=>new Promise((resolve,reject)=>{
    const req=https.get(url('/tls-negative'),options,response=>{response.resume();reject(new Error('unverified handshake accepted'));});
    req.on('error',resolve);
  });
  const untrusted=await rejected({ca:[]});
  assert.ok(['DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(untrusted.code),untrusted.code);
  const mismatch=await rejected({ca:cert,servername:'wrong.invalid'});
  assert.equal(mismatch.code,'ERR_TLS_CERT_ALTNAME_INVALID');assert.equal(posts.length,before);
});

test('prepared transport captures original headers body signal and destination before its first await',async()=>{
 const before=posts.length;const original={method:'POST',headers:{'content-type':'application/json','x-snapshot':'original'},body:'original'};
 const target=new URL(url('/snapshot'));const proxy={connectionProxyEnabled:false};
 const pending=prepareAccountedDirectPost(target,original,proxy);
 original.body='mutated';original.headers['x-snapshot']='mutated';original.signal=AbortSignal.abort();
 target.pathname='/mutated';proxy.connectionProxyUrl='https://unsupported.invalid';
 const initiate=await pending;const response=await initiate();await response.text();
 assert.equal(posts.length,before+1);assert.equal(posts.at(-1).path,'/snapshot');assert.equal(posts.at(-1).body,'original');assert.equal(posts.at(-1).snapshot,'original');
});

test('prohibited ambient drift after preparation consumes invocation with zero POST and no fabricated terminal',async()=>{
 const db=await createNodeSqliteAdapter('/tmp/ambient-drift.sqlite');
 try{
  initializeNodeAttemptLedger(db);const store=createNodeAttemptLedger(db);const now='2026-11-16T10:00:00.000Z';let index=0;
  seedPolicy(db,'key-drift',{weekly:null,monthly:null});
  for(const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy','NODE_TLS_REJECT_UNAUTHORIZED']){
   const initiate=await prepareAccountedDirectPost(url('/ambient'),options);const before=posts.length;
   const a=store.prepare({attemptId:'ambient-'+(++index),keyId:'key-drift',bindingGeneration:'1',provider:'fixture',model:'fixture',startedAt:now,
    price:{currency:'USD',unit:'USD/1M tokens',revision:'fixture',rates:{input:'1',output:'2'}}});
   process.env[name]=name==='NODE_TLS_REJECT_UNAUTHORIZED'?'0':'http://unsupported.invalid';
   try{assert.throws(()=>store.dispatch(a.ack,{presentedSecret:'fixture-key-drift',now},initiate));}
   finally{delete process.env[name];}
   assert.throws(initiate);assert.equal(posts.length,before);
  }
  assert.equal(db.get('SELECT COUNT(*) AS n FROM accounting_terminals_v1').n,0);
 }finally{db.close();}
});

test('actual accounted package dispatcher rejects untrusted CA and mismatched IP certificate',async()=>{
 const before=posts.length;
 const {NODE_EXTRA_CA_CERTS:_fixtureTrust,...withoutTrust}=process.env;
 await new Promise((resolve,reject)=>{
  const child=spawn('/runtime/node',['--input-type=module','--eval',`
   import assert from 'node:assert/strict';
   import {prepareAccountedDirectPost,getAccountedDirectDispatcher} from '/app/open-sse/utils/proxyFetch.js';
   try{const initiate=await prepareAccountedDirectPost(${JSON.stringify(url('/untrusted'))},{method:'POST',body:'fixture'});
    await assert.rejects(initiate(),e=>['DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(e.cause?.code));}
   finally{await(await getAccountedDirectDispatcher()).close();}
  `],{env:withoutTrust,stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',x=>{output+=x;});child.stderr.on('data',x=>{output+=x;});child.on('error',reject);
  child.on('exit',(code,signal)=>code===0&&!signal?resolve():reject(new Error(output)));
 });
 const wrong=https.createServer({key,cert},(_req,res)=>{posts.push({path:'/unexpected-wrong-ip'});res.end('{}');});
 await new Promise(resolve=>wrong.listen(0,'127.0.0.2',resolve));
 try{
  const initiate=await prepareAccountedDirectPost(`https://127.0.0.2:${wrong.address().port}/mismatch`,options);
  await assert.rejects(initiate(),e=>e.cause?.code==='ERR_TLS_CERT_ALTNAME_INVALID');
 }finally{await new Promise(resolve=>wrong.close(resolve));}
 assert.equal(posts.length,before);
});

test('ordinary proxyAwareFetch behavior still performs its normal native direct request',async()=>{
  const before=posts.length;const response=await proxyAwareFetch(url('/ordinary'),options);
  assert.equal(response.status,200);await response.text();assert.equal(posts.length,before+1);
});
