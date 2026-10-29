// Bounded smoke measurement, not a capacity benchmark or browser acceptance.
// Copy these exact runner bytes into the immutable comparison revision.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';

const output=process.argv[2];if(!output)throw new Error('Receipt path required');
const repo=fileURLToPath(new URL('../../../',import.meta.url));
const selected=process.env.MEASURE_CELLS?JSON.parse(process.env.MEASURE_CELLS):null;
if(selected&&(!Array.isArray(selected)||selected.length===0||selected.some(key=>!/^\b(node|sqljs)\/(json|sse)\/(true|false)\/(1|4|16)\/(0|1000)$/.test(key))||new Set(selected).size!==selected.length))throw new Error('Invalid measurement cell selection');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'9router-budget-measure-'));
Object.assign(process.env,{DATA_DIR:path.join(root,'data'),HOME:path.join(root,'home'),APPDATA:path.join(root,'appdata')});
for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'])delete process.env[key];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceFiles=['src/lib/accounting','src/lib/db','src/sse','open-sse/utils','open-sse/handlers','open-sse/executors'].flatMap(dir=>fs.readdirSync(path.join(repo,dir),{recursive:true}).map(name=>path.join(dir,name))).filter(name=>fs.statSync(path.join(repo,name)).isFile()).sort();
const sourceHash=digest(sourceFiles.map(name=>name+'\0'+digest(fs.readFileSync(path.join(repo,name)))).join('\n'));
const receipt={complete:false,node:process.version,revision:process.env.MEASURE_REVISION||execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),sourceSha256:sourceHash,runnerSha256:digest(fs.readFileSync(fileURLToPath(import.meta.url))),
  finiteEnforcement:fs.existsSync(path.join(repo,'src/lib/accounting/budget-gate.js'))?'selected fixture finite gate':'absent (finite policy configured only)',plannedCells:selected?.length??48,requestsPerCell:20,plannedRequests:(selected?.length??48)*20,completedRequests:0,warmup:0,wallBoundSeconds:900,cells:[],
  scope:'actual app/core selected JSON/SSE localhost; smoke samples only; finite policy generous USD1000 each window; baseline configured finite has no enforcement; all seeded history current-week/current-month, key-one, exact USD0.0012 per row, synthetic setup excluded from measured traffic',
  quantiles:'nearest-rank; n20 tail only; no strong capacity/p95 conclusion',hostStart:{cpus:os.availableParallelism(),load:os.loadavg(),freeMemory:os.freemem(),totalMemory:os.totalmem()},instrumentation:'SQL category counts/time and durable group duration overlap end-to-end/ACK times; never sum overlapping stages. Exact service enqueue/authority JS times unavailable; not zero.'};
let fixture,logs=0;const started=performance.now(),save=()=>fs.writeFileSync(output,JSON.stringify(receipt,null,2)+'\n');
console.log=console.warn=console.error=()=>{logs++;};
const quantiles=values=>{const s=[...values].sort((a,b)=>a-b);return {p50:s[Math.ceil(s.length*.5)-1]??null,p95:s[Math.ceil(s.length*.95)-1]??null};};
const abort=new AbortController();process.once('SIGTERM',()=>{receipt.failure={message:'External wall bound exceeded'};save();abort.abort(new Error('Measurement bounded'));});
try{
  const {openChatFixture,jsonReply,rawUsage}=await import('./chat-loopback.js');
  const {streamReply}=await import('./chat-stream.js');
  const {intent,exactUsage}=await import('./test-database.js');
  const {insertAttemptMutation,finalizeAttemptMutation}=await import('../../../src/lib/db/repos/api-key-accounting-repo.js');
  const {getWriteCoordinator}=await import('../../../src/lib/accounting/write-coordinator.js');
  for(const engine of ['node','sqljs'])for(const stream of [false,true])for(const finite of [false,true])for(const concurrency of [1,4,16])for(const population of [0,1000]){
    const cellKey=[engine,stream?'sse':'json',finite,concurrency,population].join('/');if(selected&&!selected.includes(cellKey))continue;
    assert(!abort.signal.aborted);const setup=performance.now(),now=new Date().toISOString(),seedAt=now;
    fixture=await openChatFixture(engine,{settings:{enableObservability:false},respond:(_req,res)=>{res.setHeader('content-type',stream?'text/event-stream':'application/json');res.end(stream?streamReply(rawUsage()):JSON.stringify(jsonReply()));}});
    const f=fixture;f.db.durableTransaction(()=>{
      f.db.run("UPDATE apiKeyBudgetPolicies SET weeklyLimitNanoUsd=?,monthlyLimitNanoUsd=? WHERE apiKeyId='key-one'",[finite?1000000000000:null,finite?1000000000000:null]);
      for(let i=0;i<population;i++){
        const row={...intent(f.db,`seed-${i}`),startedAt:seedAt};insertAttemptMutation(f.db,row);
        finalizeAttemptMutation(f.db,row.attemptId,{state:'settled',outcome:'synthetic_measurement_seed',finishedAt:seedAt,usage:exactUsage()});
      }
    });
    const cell={engine,protocol:stream?'sse':'json',finite,concurrency,population,currentWindowSeedRows:population,seedStartedAt:seedAt,domainNow:now,setupMs:performance.now()-setup,samples:[],transactions:[],databaseStages:{},hostStart:{load:os.loadavg(),freeMemory:os.freemem()},cpuStart:process.cpuUsage()};receipt.cells.push(cell);save();
    let measuring=true;
    const classify=sql=>/apiKeyAccounting/.test(sql)?/INSERT INTO apiKeyAccounting\b/.test(sql)?'intent-write':/UPDATE apiKeyAccounting\s+SET state/.test(sql)?'terminal-write':/SUM|costNanoUsd/.test(sql)?'ledger-cost-read':'ledger-state-read':/apiKeyBudgetPolicies/.test(sql)?'policy-read':/sqlite_master|PRAGMA/.test(sql)?'schema-read':'other-authority-read';
    const instrument=reader=>{
      for(const method of ['get','all','run']){if(typeof reader[method]!=='function')continue;const original=reader[method].bind(reader);reader[method]=(sql,...args)=>{const t=performance.now();try{return original(sql,...args);}finally{if(measuring){const key=classify(sql),stage=cell.databaseStages[key]??={calls:0,ms:0};stage.calls++;stage.ms+=performance.now()-t;}}};}
      return reader;
    };
    instrument(f.db);
    const persisted=f.db.withPersistedAccountingAuthority.bind(f.db);f.db.withPersistedAccountingAuthority=fn=>persisted(reader=>{
      const wrapped={};for(const method of ['get','all','run'])if(typeof reader[method]==='function')wrapped[method]=reader[method].bind(reader);
      return fn(instrument(wrapped));
    });
    const durable=f.db.durableTransaction.bind(f.db);f.db.durableTransaction=(fn,...args)=>{const t=performance.now();try{return durable(fn,...args);}finally{if(measuring)cell.transactions.push(performance.now()-t);}};
    let index=0,failure;const t0=performance.now();
    await Promise.allSettled(Array.from({length:concurrency},async()=>{
      while(!failure&&!abort.signal.aborted){const id=index++;if(id>=20)return;const begin=performance.now();let intentAck=null,terminalAck=null,first=null;
        try{
          const response=await f.request({stream,clock:()=>now,signal:AbortSignal.any([abort.signal,AbortSignal.timeout(10000)]),hooks:{intentAck:()=>{intentAck=performance.now();},terminalAck:()=>{terminalAck=performance.now();}}});assert.equal(response.status,200);
          const reader=response.body.getReader(),decoder=new TextDecoder();let text='';while(true){const chunk=await reader.read();if(chunk.done)break;first??=performance.now();text+=decoder.decode(chunk.value,{stream:true});}text+=decoder.decode();
          if(stream){assert(text.includes('[DONE]'));assert(text.includes('"finish_reason":"stop"'));assert(!text.includes('"error"'));}else assert.equal(JSON.parse(text).choices[0].message.content,'hello');
          assert.notEqual(intentAck,null);assert.notEqual(terminalAck,null);
          cell.samples.push({requestIndex:id,totalMs:performance.now()-begin,ttftMs:first-begin,intentAckMs:intentAck-begin,terminalAckMs:terminalAck-begin});receipt.completedRequests++;
        }catch(error){failure=error;}
      }
    }));
    measuring=false;cell.elapsedMs=performance.now()-t0;cell.completed=cell.samples.length;cell.requestsPerSecond=cell.completed/(cell.elapsedMs/1000);cell.totalMs=quantiles(cell.samples.map(s=>s.totalMs));cell.intentAckMs=quantiles(cell.samples.map(s=>s.intentAckMs));cell.terminalAckMs=quantiles(cell.samples.map(s=>s.terminalAckMs));cell.transactionMs=quantiles(cell.transactions);cell.nativePosts=f.posts;cell.cpuUsage=process.cpuUsage(cell.cpuStart);cell.hostEnd={load:os.loadavg(),freeMemory:os.freemem(),rss:process.memoryUsage().rss};cell.firstRequest=cell.samples.find(sample=>sample.requestIndex===0);save();if(failure)throw failure;
    assert.equal(f.posts,20);assert.equal(cell.completed,20);
    const rows=f.db.all('SELECT apiKeyId,state,costNanoUsd FROM apiKeyAccounting');assert.equal(rows.length,population+20);assert(rows.every(row=>row.apiKeyId==='key-one'&&row.state==='settled'&&String(row.costNanoUsd)==='1200000'));
    const status=getWriteCoordinator(f.db,()=>{throw new Error('Uninitialized measurement lane');}).status();assert.equal(status.queued,0);assert.equal(status.bytes,0);assert.equal(status.poisoned,false);cell.correctness={rows:rows.length,knownCostNanoUsd:String(BigInt(rows.length)*1200000n),pending:0,posts:f.posts,ownAcks:20};
    f.db.withPersistedAccountingAuthority(reader=>assert.equal(reader.get('SELECT count(*) AS n FROM apiKeyAccounting').n,rows.length));cell.persistedImageVerified=true;
    await f.close();fixture=null;save();process.stdout.write(`${engine} ${cell.protocol} ${finite?'finite':'unlimited'} c${concurrency} pop${population}: ${cell.completed} ${Math.round(cell.elapsedMs)}ms\n`);
  }
  assert.equal(receipt.completedRequests,receipt.plannedRequests);receipt.complete=true;
}catch(error){receipt.failure={message:error.message,stack:error.stack};process.exitCode=1;}
finally{
  try{await fixture?.close();global._dbAdapter?.instance?.close();}catch(error){receipt.cleanupFailure=error.message;receipt.complete=false;process.exitCode=1;}
  for(const timer of Object.values(global._statsEmitTimers||{}))if(timer)clearTimeout(timer);for(const timer of Object.values(global._pendingTimers||{}))if(timer)clearTimeout(timer);
  receipt.elapsedMs=performance.now()-started;receipt.hostEnd={load:os.loadavg(),freeMemory:os.freemem(),resourceUsage:process.resourceUsage()};receipt.suppressedLogs=logs;if(receipt.complete)fs.rmSync(root,{recursive:true,force:true});else receipt.retainedData=root;save();process.stdout.write(JSON.stringify({complete:receipt.complete,completedRequests:receipt.completedRequests,failure:receipt.failure})+'\n');
}
