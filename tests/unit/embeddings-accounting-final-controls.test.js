import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {openEmbeddingsFixture,embeddingsReply,gate,observe,reach} from '../fixtures/accounting/embeddings-loopback.js';
import {openFixture} from '../fixtures/accounting/test-database.js';
let fixture;
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllEnvs();if(fixture){await fixture.close();fixture=null;}});
function failPublication(engine,f){
  let injected=false;
  if(engine==='sqljs'){
    const rename=fs.renameSync;vi.spyOn(fs,'renameSync').mockImplementation((source,target)=>{
      if(!injected&&target===f.file){injected=true;throw new Error('E1 terminal publication failed');}return rename(source,target);
    });
  }else{
    const exec=DatabaseSync.prototype.exec;vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(sql,...args){
      if(!injected&&sql.startsWith('RELEASE sp_0_')){injected=true;throw new Error('E1 terminal publication failed');}return exec.call(this,sql,...args);
    });
  }
  return ()=>expect(injected).toBe(true);
}
for(const engine of ['node','sqljs'])describe(`${engine} E1 terminal publication refusal`,()=>{
  it('failed intent publication and successful gap delivery never permit an unlimited POST',async()=>{
    for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'])vi.stubEnv(key,'');
    const f=fixture=await openEmbeddingsFixture(engine);const verify=failPublication(engine,f),gapAck=vi.fn();
    const response=await f.request({hooks:{gapAck}});verify();expect(response.status).toBe(503);expect(f.posts).toBe(0);expect(gapAck).toHaveBeenCalledTimes(1);
    expect(f.db.coverage.status('key-one').gaps).toHaveLength(1);expect(f.db.coverage.status('key-two').gaps).toHaveLength(0);
  });
  it('abort after own terminal publication preserves cost but cannot complete successfully',async()=>{
    for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'])vi.stubEnv(key,'');
    const f=fixture=await openEmbeddingsFixture(engine),controller=new AbortController();
    const response=await f.request({signal:controller.signal,hooks:{terminalAck:()=>controller.abort()}});
    expect(response.status).toBe(503);expect(f.posts).toBe(1);expect(f.db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({state:'settled',costNanoUsd:1000000});
  });
  it.each(['held','lost'])('own %s gap ACK preserves safety but never authorizes client replay or fallback',async mode=>{
    for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'])vi.stubEnv(key,'');
    let verify;const f=fixture=await openEmbeddingsFixture(engine,{respond:(_req,res)=>{
      expect(f.db.get('SELECT state FROM apiKeyAccounting').state).toBe('pending');verify=failPublication(engine,f);
      res.setHeader('content-type','application/json');res.end(JSON.stringify(embeddingsReply()));
    }});
    f.db.durableTransaction(()=>f.db.run("INSERT INTO providerConnections(id,provider,authType,priority,data,createdAt,updatedAt) SELECT 'connection-two',provider,authType,2,data,createdAt,updatedAt FROM providerConnections WHERE id='connection-one'"));
    const entered=gate(),hold=gate();let delivered=false;
    const outcome=observe((async()=>{const response=await f.request({hooks:{gapAck:async()=>{entered.release();if(mode==='lost')throw new Error('own gap ACK lost');await hold.promise;}}});
      const text=await response.text();delivered=true;return {status:response.status,text};})());
    try{
      await reach(entered,outcome);verify();expect(f.posts).toBe(1);expect(f.db.coverage.status('key-one').gaps).toHaveLength(1);expect(f.db.coverage.status('key-two').gaps).toHaveLength(0);
      if(mode==='held')expect(delivered).toBe(false);hold.release();const result=await outcome;if(!result.ok)throw result.error;
      expect(result.value.status).toBe(503);expect(result.value.text).toContain('api_key_accounting_unavailable');expect(result.value.text).not.toContain('"embedding"');
      vi.restoreAllMocks();f.db.beforeClose=undefined;f.db.close();const reopened=await openFixture(engine,f.file);
      try{expect(reopened.db.get('SELECT apiKeyId,state,costNanoUsd FROM apiKeyAccounting')).toEqual({apiKeyId:'key-one',state:'unresolved',costNanoUsd:null});
        expect(reopened.db.coverage.status('key-one').gaps).toHaveLength(1);expect(reopened.db.coverage.status('key-two').gaps).toHaveLength(0);
        expect(reopened.db.all('SELECT apiKeyId FROM apiKeyBindings ORDER BY apiKeyId')).toEqual([{apiKeyId:'key-one'},{apiKeyId:'key-two'}]);
      }finally{reopened.db.close();}
    }finally{hold.release();await outcome;}
  });
});
