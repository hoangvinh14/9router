import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { jsonReply } from '../fixtures/accounting/chat-loopback.js';
const loader=fileURLToPath(new URL('../fixtures/accounting/budget-web-loader.mjs',import.meta.url));
const childScript=fileURLToPath(new URL('../fixtures/accounting/budget-restart-process.mjs',import.meta.url));
for(const engine of ['node','sqljs'])describe(`${engine} actual process restart budget`,()=>{
  it('retains exact threshold/identity and new calendar allowance in a new writer process',async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'9router-budget-restart-'));let posts=0;const sockets=new Set();
    const server=http.createServer(async(req,res)=>{for await(const _part of req){}posts++;res.setHeader('content-type','application/json');res.end(JSON.stringify(jsonReply()));});
    server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
      for(const mode of ['write','read']){
        const child=spawn(process.execPath,['--import',loader,childScript,engine,path.join(root,'data.sqlite'),mode],{env:{...process.env,FIXTURE_UPSTREAM:`http://127.0.0.1:${server.address().port}/v1`},stdio:['ignore','pipe','pipe']});
        const output=fs.createWriteStream(path.join(root,`${mode}.log`));child.stdout.pipe(output);child.stderr.pipe(output);
        const timer=setTimeout(()=>child.kill('SIGKILL'),45000);const [code,signal]=await once(child,'exit');clearTimeout(timer);expect({code,signal}).toEqual({code:0,signal:null});
        expect(posts).toBe(mode==='write'?1:2);
      }
      const first=JSON.parse(fs.readFileSync(path.join(root,`${engine}-write-result.json`),'utf8')),second=JSON.parse(fs.readFileSync(path.join(root,`${engine}-read-result.json`),'utf8'));
      expect(second).toMatchObject({driver:first.driver,fingerprint:first.fingerprint,coverageId:first.coverageId,policyVersion:2,deniedStatus:429,nextWindowStatus:200});
      expect(second.rows.map(row=>row.costNanoUsd)).toEqual([1200000,1200000]);expect(second.rows.map(row=>row.startedAt)).toEqual(['2026-10-25T16:00:00.000Z','2026-10-25T17:00:00.000Z']);
    }finally{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});}
  },100000);

  it('dead owner absent intent is nonblocking across reset and policy edits without waiver',async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'9router-budget-crash-'));let posts=0,child,bound;const sockets=new Set();
    const server=http.createServer(async(req,res)=>{for await(const _part of req){}posts++;res.setHeader('content-type','application/json');res.end(JSON.stringify(jsonReply()));});
    server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const start=mode=>{
      child=spawn(process.execPath,['--import',loader,childScript,engine,path.join(root,'data.sqlite'),mode],{env:{...process.env,FIXTURE_UPSTREAM:`http://127.0.0.1:${server.address().port}/v1`},stdio:['ignore','pipe','pipe','ipc']});
      const output=fs.createWriteStream(path.join(root,`${mode}.log`));child.stdout.pipe(output);child.stderr.pipe(output);return child;
    };
    try{
      start('crash-write');
      const exited=once(child,'exit');const message=once(child,'message');bound=setTimeout(()=>child.kill('SIGKILL'),45000);
      const checkpoint=await Promise.race([message.then(([value])=>value),exited.then(()=>{throw new Error('Owner exited before durable intent checkpoint');})]);
      expect(checkpoint.phase).toBe('durable-intent');expect(posts).toBe(0);child.kill('SIGKILL');expect(await exited).toEqual([null,'SIGKILL']);clearTimeout(bound);
      start('crash-read');bound=setTimeout(()=>child.kill('SIGKILL'),45000);const [code,signal]=await once(child,'exit');clearTimeout(bound);if(code!==0)throw new Error(fs.readFileSync(path.join(root,'crash-read.log'),'utf8'));expect({code,signal}).toEqual({code:0,signal:null});expect(posts).toBe(3);
      const result=JSON.parse(fs.readFileSync(path.join(root,`${engine}-crash-read-result.json`),'utf8'));
      expect(result).toMatchObject({fingerprint:checkpoint.fingerprint,coverageId:checkpoint.coverageId,policyVersion:4,admittedStatus:200,unlimitedStatus:200,reenabledStatus:200,auditCount:0});
      expect(result.rows.map(row=>row.state)).toEqual(['unrecorded','settled','settled','settled']);expect(result.rows.map(row=>row.costNanoUsd)).toEqual([null,1200000,1200000,1200000]);
    }finally{
      clearTimeout(bound);
      if(child&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}
      for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});
    }
  },100000);
});
