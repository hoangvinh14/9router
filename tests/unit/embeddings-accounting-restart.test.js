import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {describe,expect,it} from 'vitest';
import {embeddingsReply} from '../fixtures/accounting/embeddings-loopback.js';
const loader=new URL('../fixtures/accounting/chat-module-loader.mjs',import.meta.url).pathname;
const script=new URL('../fixtures/accounting/embeddings-process.mjs',import.meta.url).pathname;
for(const engine of ['node','sqljs'])describe(`${engine} actual Embeddings process durability`,()=>{
  it.each(['committed','intent','volatile'])('preserves recorded evidence after deterministic %s owner crash',async scenario=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'e1-process-')),file=path.join(root,'data.sqlite'),sockets=new Set();let posts=0,child,timer;
    const server=http.createServer(async(req,res)=>{for await(const _part of req){}posts++;expect(req.url).toBe('/v1/embeddings');
      res.setHeader('content-type','application/json');res.end(JSON.stringify(embeddingsReply()));});
    server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const start=mode=>{child=spawn(process.execPath,['--import',loader,script,engine,file,mode],{env:{...process.env,FIXTURE_UPSTREAM:`http://127.0.0.1:${server.address().port}/v1`},stdio:['ignore','pipe','pipe','ipc']});
      let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);return {process:child,output:()=>output};};
    try{
      const first=start(`write-${scenario}`),exited=once(child,'exit'),message=once(child,'message');timer=setTimeout(()=>child.kill('SIGKILL'),30000);
      const checkpoint=await Promise.race([message.then(([v])=>v),exited.then(()=>{throw new Error('Owner exited before checkpoint: '+first.output());})]);
      expect(checkpoint.phase).toBe({committed:'durable-terminal',intent:'durable-intent',volatile:'volatile-terminal'}[scenario]);
      expect(posts).toBe(scenario==='intent'?0:1);expect(checkpoint.rows).toEqual([{state:scenario==='committed'?'settled':'pending',costNanoUsd:scenario==='committed'?1000000:null}]);
      child.kill('SIGKILL');expect(await exited).toEqual([null,'SIGKILL']);clearTimeout(timer);
      const second=start(`read-${scenario}`);timer=setTimeout(()=>child.kill('SIGKILL'),30000);const [code,signal]=await once(child,'exit');clearTimeout(timer);
      if(code!==0)throw new Error(second.output());expect(signal).toBeNull();
      const result=JSON.parse(fs.readFileSync(path.join(root,`read-${scenario}.json`),'utf8'));
      expect(result.driver).toBe(engine==='node'?'node:sqlite':'sql.js');expect(result.rows.map(r=>r.state)).toEqual([scenario==='committed'?'settled':'unrecorded','settled']);
      expect(result.rows.map(r=>r.costNanoUsd)).toEqual([scenario==='committed'?1000000:null,1000000]);
      expect(posts).toBe(scenario==='intent'?1:2);expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);expect(result.coverageId).toBeTruthy();
    }finally{clearTimeout(timer);if(child&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}
      for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}
  },70000);
});
