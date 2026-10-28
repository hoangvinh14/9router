import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

// Two measured repetitions of 100 per cell reconcile the plan's 4800 total
// with its 24 distinct cells. Every request counts; there is no warmup.
const started = performance.now();
const output = process.argv[2];
if (!output) throw new Error('A receipt path is required');
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), '9router-chat-measure-'));
process.env.DATA_DIR = dataRoot;
for (const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy']) delete process.env[name];
let logs = 0, errorLogs = 0;
console.log = () => { logs++; };
console.warn = () => { logs++; };
console.error = () => { errorLogs++; };
const receipt = { node: process.version, platform: process.platform, repetitions: 2, requestsPerCellPerRepetition: 100,
  wallBoundSeconds: 1200, warmup: 0, cells: [], completedRequests: 0, complete: false,
  workload: 'Actual app/core/Default/native localhost, fixed hello payload plus fixed-width trace user; cacheRead=400, rates input=1/output=2/cached=.25; observability disabled equally; analytics and authority guards unchanged.' };
let fixture = null, bounded = false;
const abort = new AbortController();
process.once('SIGTERM', () => {
  bounded = true;
  receipt.failure = { message: 'Measurement wall bound', bounded: true };
  receipt.elapsedAtBoundMs = performance.now()-started;
  receipt.activeResourcesAtBound = process.getActiveResourcesInfo();
  save();
  abort.abort(new Error('Measurement wall bound'));
});
const save = () => fs.writeFileSync(output, JSON.stringify(receipt, null, 2)+'\n');
const quantiles = values => {
  const sorted = [...values].sort((a,b)=>a-b);
  return {p50: sorted[Math.ceil(sorted.length*.5)-1] ?? null, p95: sorted[Math.ceil(sorted.length*.95)-1] ?? null};
};
try {
  const { openChatFixture, rawUsage, jsonReply } = await import('./chat-loopback.js');
  const { streamReply } = await import('./chat-stream.js');
  const { openFixture } = await import('./test-database.js');
  const { getWriteCoordinator } = await import('../../../src/lib/accounting/write-coordinator.js');
  receipt.coldImportMs = performance.now()-started;
  const json = JSON.stringify(jsonReply(rawUsage(400))), sse = streamReply(rawUsage(400));
  for (const repetition of [1,2]) for (const engine of ['node','sqljs']) for (const stream of [false,true]) for (const accounting of [false,true]) for (const concurrency of [1,4,16]) {
    if (bounded) throw new Error('Measurement wall bound');
    const upstreamTimes = new Map();
    const setupAt = performance.now();
    fixture = await openChatFixture(engine, {settings:{enableObservability:false}, respond:(_req,res,_count,wire)=>{
      res.setHeader('content-type', stream ? 'text/event-stream' : 'application/json');
      upstreamTimes.set(wire.body.user,performance.now());
      res.end(stream ? sse : json);
    }});
    const f = fixture, samples = [], groups = [], cell = {repetition,engine,protocol:stream?'sse':'json',accounting,concurrency,coldFixtureMs:performance.now()-setupAt};
    receipt.cells.push(cell); save();
    let activeGroup = null, queueHighAtAck = 0, index = 0, failure = null;
    const durable = f.db.durableTransaction.bind(f.db), run = f.db.run.bind(f.db);
    f.db.durableTransaction = (fn,...args) => {
      const previous = activeGroup, group = {intents:0,terminals:0}; activeGroup=group;
      try { const result=durable(fn,...args); if(group.intents||group.terminals)groups.push(group);return result; }
      finally { activeGroup=previous; }
    };
    f.db.run = (sql,...args) => {
      if(activeGroup){if(/INSERT INTO apiKeyAccounting\b/.test(sql))activeGroup.intents++;if(/UPDATE apiKeyAccounting\s+SET state/.test(sql))activeGroup.terminals++;}
      return run(sql,...args);
    };
    const sampleQueue = () => {queueHighAtAck=Math.max(queueHighAtAck,getWriteCoordinator(f.db,()=>{throw new Error('Uninitialized measurement lane');}).status().queued);};
    const cellAt = performance.now();
    await Promise.allSettled(Array.from({length:concurrency},async()=>{
      while(!failure&&!bounded){
        const id=index++;if(id>=100)return;
        const trace=`measure-${String(id).padStart(4,'0')}`, t0=performance.now();let first=null, terminal=null;
        try{
          const response=await f.request({stream,accounting,signal:abort.signal,body:{user:trace},hooks:accounting?{intentAck:sampleQueue,terminalAck:sampleQueue}:{}});
          assert.equal(response.status,200);
          const reader=response.body.getReader(),decoder=new TextDecoder();let text='';
          while(true){const part=await reader.read();if(part.done)break;if(first===null)first=performance.now();text+=decoder.decode(part.value,{stream:true});if(text.includes('"finish_reason":"stop"'))terminal??=performance.now();}
          text+=decoder.decode();
          const end=performance.now();
          if(stream){assert(text.includes('[DONE]'));assert(text.includes('"finish_reason":"stop"'));assert(!text.includes('"error"'));}
          else assert.equal(JSON.parse(text).choices[0].message.content,'hello');
          assert(upstreamTimes.has(trace));
          samples.push({totalMs:end-t0,ttftMs:first-t0,terminalDelayMs:(terminal??end)-upstreamTimes.get(trace)});
          receipt.completedRequests++;
        }catch(error){failure=error;}
      }
    }));
    await new Promise(resolve=>setImmediate(resolve));
    cell.completed=samples.length;
    cell.elapsedMs=performance.now()-cellAt;
    cell.requestsPerSecond=samples.length/(cell.elapsedMs/1000);
    cell.totalMs=quantiles(samples.map(s=>s.totalMs));cell.ttftMs=quantiles(samples.map(s=>s.ttftMs));cell.terminalDelayMs=quantiles(samples.map(s=>s.terminalDelayMs));
    cell.accountingGroupCommits=groups.length;cell.groupMembers=groups;cell.queueHighObservedAtAck=queueHighAtAck;
    cell.queueAfter=accounting?getWriteCoordinator(f.db,()=>{}).status():null;
    cell.nativePosts=f.posts;
    save();
    if(failure)throw failure;
    assert.equal(f.posts,100);assert.equal(samples.length,100);
    const rows=f.db.all('SELECT apiKeyId,state,costNanoUsd,usageJson FROM apiKeyAccounting');
    assert.equal(rows.length,accounting?100:0);
    for(const row of rows){assert.equal(row.apiKeyId,'key-one');assert.equal(row.state,'settled');assert.equal(String(row.costNanoUsd),'900000');assert.equal(JSON.parse(row.usageJson).cacheRead,400);}
    if(accounting){assert.equal(cell.queueAfter.queued,0);assert.equal(cell.queueAfter.bytes,0);assert.equal(cell.queueAfter.poisoned,false);}
    f.db.durableTransaction(()=>{});f.db.close();
    const reopened=await openFixture(engine,f.file);
    try{const reopenedRows=reopened.db.all('SELECT state,costNanoUsd FROM apiKeyAccounting');assert.equal(reopenedRows.length,rows.length);assert(reopenedRows.every(row=>row.state==='settled'&&String(row.costNanoUsd)==='900000'));assert.equal(reopened.db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'"),undefined);}finally{reopened.db.close();}
    cell.reopenVerified=true;
    await f.close();fixture=null;
    save();
    process.stdout.write(`${repetition} ${engine} ${cell.protocol} ${accounting?'on':'off'} c${concurrency}: ${samples.length} in ${Math.round(cell.elapsedMs)}ms\n`);
  }
  assert.equal(receipt.completedRequests,4800);
  receipt.complete=true;
}catch(error){receipt.failure={message:error.message,bounded};process.exitCode=1;}
finally{
  // Imports may initialize a separate disposable default adapter before the
  // per-cell fixture swaps it. Close it before removing its data directory.
  const cleanupFailures = [];
  for (const [resource, close] of [
    ['chat fixture', async () => { if(fixture)await fixture.close(); }],
    ['default adapter', () => global._dbAdapter?.instance?.close()],
  ]) {
    try { await close(); }
    catch(error) { cleanupFailures.push({resource,message:error.message}); }
  }
  if(cleanupFailures.length) {
    receipt.cleanupFailures = cleanupFailures;
    receipt.complete=false;process.exitCode=1;
  }
  for(const timer of Object.values(global._statsEmitTimers||{}))if(timer)clearTimeout(timer);
  for(const timer of Object.values(global._pendingTimers||{}))if(timer)clearTimeout(timer);
  receipt.elapsedMs=performance.now()-started;receipt.suppressedLogs=logs;receipt.errorLogs=errorLogs;
  receipt.activeResourcesBeforeExit=process.getActiveResourcesInfo();
  if(!cleanupFailures.length)fs.rmSync(dataRoot,{recursive:true,force:true});receipt.disposableDataRemoved=!fs.existsSync(dataRoot);
  save();process.stdout.write(JSON.stringify({complete:receipt.complete,completedRequests:receipt.completedRequests,elapsedMs:receipt.elapsedMs,failure:receipt.failure})+'\n');
}
