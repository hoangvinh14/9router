import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openResponsesFixture, responsesReply, gate, observe, reach } from '../fixtures/accounting/responses-loopback.js';
import { openFixture } from '../fixtures/accounting/test-database.js';
let fixture;
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllEnvs();if(fixture){await fixture.close();fixture=null;}});
function failPublication(engine,f){
  let injected=false;
  if(engine==='sqljs'){
    const rename=fs.renameSync;vi.spyOn(fs,'renameSync').mockImplementation((source,target)=>{
      if(!injected&&target===f.file){injected=true;throw new Error('native terminal publication failed');}return rename(source,target);
    });
  }else{
    const exec=DatabaseSync.prototype.exec;vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(sql,...args){
      if(!injected&&sql.startsWith('RELEASE sp_0_')){injected=true;throw new Error('native terminal publication failed');}return exec.call(this,sql,...args);
    });
  }
  return ()=>expect(injected).toBe(true);
}
for(const engine of ['node','sqljs'])for(const flow of ['json','sse','forced-json'])describe(`${engine} native ${flow} publication safety`,()=>{
  it.each(['held','lost'])('requires own %s gap ACK after actual terminal publication failure',async mode=>{
    for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'])vi.stubEnv(key,'');
    let verify;
    const f=fixture=await openResponsesFixture(engine,{respond:(_req,res)=>{
      expect(f.db.get('SELECT state FROM apiKeyAccounting').state).toBe('pending');verify=failPublication(engine,f);
      const raw=responsesReply();res.setHeader('content-type',flow==='json'?'application/json':'text/event-stream');
      res.end(flow==='json'?JSON.stringify(raw):`event: response.completed\ndata: ${JSON.stringify({type:'response.completed',response:raw})}\n\n`);
    }});
    const entered=gate(),hold=gate();let delivered=false;
    const outcome=observe((async()=>{
      const response=await f.request({stream:flow==='sse',hooks:{gapAck:async()=>{
        entered.release();if(mode==='lost')throw new Error('native own gap ACK lost');await hold.promise;
      }}});const text=await response.text();delivered=true;return {status:response.status,text};
    })());
    try{
      await reach(entered,outcome);verify();expect(f.posts).toBe(1);expect(f.db.coverage.status('key-one').gaps).toHaveLength(1);
      expect(f.db.coverage.status('key-two').gaps).toHaveLength(0);if(mode==='held')expect(delivered).toBe(false);
      hold.release();const result=await outcome;if(!result.ok)throw result.error;
      if(mode==='held'){expect(result.value.status).toBe(200);expect(result.value.text).toContain(flow==='sse'?'response.completed':'"status":"completed"');}
      else{expect(result.value.text).toContain('api_key_accounting_unavailable');expect(result.value.text).not.toContain('response.completed');if(flow!=='sse')expect(result.value.status).toBe(503);}
      vi.restoreAllMocks();f.db.beforeClose=undefined;f.db.close();const reopened=await openFixture(engine,f.file);
      try{
        expect(reopened.db.get('SELECT apiKeyId,state,costNanoUsd FROM apiKeyAccounting')).toEqual({apiKeyId:'key-one',state:'unresolved',costNanoUsd:null});
        expect(reopened.db.coverage.status('key-one').gaps).toHaveLength(1);expect(reopened.db.coverage.status('key-two').gaps).toHaveLength(0);
        expect(reopened.db.all('SELECT apiKeyId FROM apiKeyBindings ORDER BY apiKeyId')).toEqual([{apiKeyId:'key-one'},{apiKeyId:'key-two'}]);
      }finally{reopened.db.close();}
    }finally{hold.release();await outcome;}
  });
});
