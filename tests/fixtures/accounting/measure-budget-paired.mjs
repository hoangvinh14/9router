// A-B-B-A bounded diagnostic over six cells, no overlapping runs.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [base,current,output]=process.argv.slice(2);if(!base||!current||!output)throw new Error('Base directory, current directory, receipt required');
const runner='tests/fixtures/accounting/measure-budget-accounting.mjs',fixture='tests/fixtures/accounting/chat-loopback.js';
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for(const file of [runner,fixture])assert.equal(sha(path.join(base,file)),sha(path.join(current,file)),`Different comparison bytes: ${file}`);
const cells=['node/json/true/4/0','node/json/false/4/0','node/sse/false/16/1000','node/sse/true/16/1000','sqljs/json/true/4/1000','sqljs/json/false/4/1000'];
const receipt={complete:false,order:['base','current','current','base'],cells,plannedRequests:480,runs:[],instrumentation:'identical runner bytes; fresh process/fixtures per run; no warmup; 20 samples/cell; overlapping SQL/commit/ACK times not additive',hostStart:{load:os.loadavg(),freeMemory:os.freemem()}};
const save=()=>fs.writeFileSync(output,JSON.stringify(receipt,null,2)+'\n');
try{
  for(const [index,which] of receipt.order.entries()){
    const cwd=which==='base'?base:current,report=output+`.${index}-${which}.json`,log=fs.createWriteStream(report+'.log');
    const child=spawn('timeout',['--signal=TERM','--kill-after=5s','900s',process.execPath,'--import','./tests/fixtures/accounting/chat-module-loader.mjs',runner,report],{cwd,env:{...process.env,MEASURE_CELLS:JSON.stringify(cells),...(which==='base'?{MEASURE_REVISION:'b41dca0a791bd464070e4d65c667381613ed5c8d'}:{})},stdio:['ignore','pipe','pipe']});
    child.stdout.pipe(log);child.stderr.pipe(log);const [code,signal]=await once(child,'exit');const run={which,index,report,code,signal};receipt.runs.push(run);save();assert.equal(code,0);assert.equal(signal,null);
    const data=JSON.parse(fs.readFileSync(report));assert(data.complete);assert.equal(data.completedRequests,120);run.completedRequests=data.completedRequests;run.runnerSha256=data.runnerSha256;run.sourceSha256=data.sourceSha256;save();
  }
  receipt.complete=true;
}catch(error){receipt.failure={message:error.message,stack:error.stack};process.exitCode=1;}
finally{receipt.hostEnd={load:os.loadavg(),freeMemory:os.freemem()};save();console.log(JSON.stringify(receipt));}
