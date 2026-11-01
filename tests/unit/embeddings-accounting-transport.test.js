import {afterEach,describe,it,expect,vi} from 'vitest';
import http from 'node:http';
import {openEmbeddingsFixture,embeddingsReply,gate,observe,reach} from '../fixtures/accounting/embeddings-loopback.js';
import {createEmbeddingsBoundary} from '../../open-sse/handlers/embeddings-accounting.js';
import {ACCOUNTING_JSON_MAX_BYTES} from '../../open-sse/config/runtimeConfig.js';
import {EMBEDDINGS_USAGE_PROFILE} from '../../open-sse/utils/accounting-embeddings-usage.js';
let fixture;
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllEnvs();if(fixture){await fixture.close();fixture=null;}});
async function setup(engine,options){for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'])vi.stubEnv(key,'');fixture=await openEmbeddingsFixture(engine,options);return fixture;}
for(const engine of ['node','sqljs'])describe(`${engine} E1 effective transport`,()=>{
  it('intended strict HTTP proxy reaches actual embeddings POST',async()=>{
    const f=await setup(engine,{proxy:true});const response=await f.request();expect(response.status).toBe(200);expect(await response.json()).toEqual(embeddingsReply());expect(f.posts).toBe(1);expect(f.connects).toBeGreaterThan(0);
  });
  it.each(['disabled','deleted','unavailable'])('strict %s proxy cannot escape to direct',async mode=>{
    const f=await setup(engine,{proxy:true});f.db.durableTransaction(()=>f.db.run(mode==='disabled'?"UPDATE proxyPools SET isActive=0":mode==='deleted'?"DELETE FROM proxyPools":"UPDATE proxyPools SET data=json_set(data,'$.proxyUrl','http://127.0.0.1:1')"));
    expect((await f.request()).status).toBe(503);expect(f.posts).toBe(0);
  });
  it.each([307,308])('manual redirect %s never hits second listener or leaks credentials',async status=>{
    let hits=0;const listener=http.createServer((_req,res)=>{hits++;res.end('{}');});await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
    try{const f=await setup(engine,{respond:(_req,res)=>{res.statusCode=status;res.setHeader('location',`http://127.0.0.1:${listener.address().port}/leak`);res.end('{}');}});
      expect((await f.request()).status).toBe(503);expect(f.posts).toBe(1);expect(hits).toBe(0);expect(f.db.get('SELECT state FROM apiKeyAccounting').state).toBe('unresolved');
    }finally{await new Promise(resolve=>listener.close(resolve));}
  });
  it.each(['large-base64','large-float','above-cap','truncated','invalid-utf8'])('actual raw body resource/evidence control %s',async mode=>{
    const raw=embeddingsReply();
    if(mode==='large-base64')raw.data[0].embedding='A'.repeat(1024*1024);
    if(mode==='large-float')raw.data[0].embedding=Array(100000).fill(0.12345);
    const text=mode==='above-cap'?JSON.stringify({...raw,metadata:'A'.repeat(ACCOUNTING_JSON_MAX_BYTES)}):JSON.stringify(raw);
    const f=await setup(engine,{respond:(_req,res)=>{
      res.setHeader('content-type','application/json');
      if(mode==='truncated'){res.setHeader('content-length','1000');res.flushHeaders();res.write('{"usage":');setImmediate(()=>res.socket?.end());}
      else if(mode==='invalid-utf8')res.end(Buffer.from([0xff,0xfe]));
      else {res.write(text.slice(0,17));res.end(text.slice(17));}
    }});
    const response=await f.request();expect(f.posts).toBe(1);
    if(mode.startsWith('large-')){expect(response.status).toBe(200);expect(Buffer.from(await response.arrayBuffer()).equals(Buffer.from(text))).toBe(true);expect(f.db.get('SELECT costNanoUsd FROM apiKeyAccounting').costNanoUsd).toBe(1000000);}
    else{expect(response.status).toBe(503);expect(f.db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({state:'unresolved',costNanoUsd:null});}
  });
  it('pre-aborted request has no intent or POST',async()=>{
    const f=await setup(engine);const controller=new AbortController();controller.abort();expect((await f.request({signal:controller.signal})).status).toBe(503);expect(f.posts).toBe(0);expect(f.db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
  it('abort during held intent yields own not-dispatched terminal without wire',async()=>{
    const f=await setup(engine);const controller=new AbortController(),entered=gate(),hold=gate();const outcome=observe(f.request({signal:controller.signal,hooks:{intentAck:async()=>{entered.release();await hold.promise;}}}));
    try{await reach(entered,outcome);controller.abort();hold.release();const result=await outcome;if(!result.ok)throw result.error;expect(result.value.status).toBe(503);expect(f.posts).toBe(0);expect(f.db.get('SELECT state FROM apiKeyAccounting').state).toBe('not_dispatched');}
    finally{hold.release();await outcome;}
  });
  it.each(['headers-empty','mid-json','inside-usage','valid-before-abort'])('bounded actual body cancellation: %s',async mode=>{
    const ready=gate(),controller=new AbortController();const f=await setup(engine,{respond:(_req,res)=>{
      res.setHeader('content-type','application/json');res.flushHeaders();
      if(mode==='mid-json')res.write('{"data":[');
      if(mode==='inside-usage')res.write('{"usage":{"prompt_tokens":');
      if(mode==='valid-before-abort')res.write(JSON.stringify(embeddingsReply()));
      ready.release();
    }});
    const outcome=observe(f.request({signal:controller.signal}));await reach(ready,outcome);
    // The unit reader cases below establish deterministic observed-byte timing;
    // this real socket case asserts cancellation cannot hang or advance accounts.
    controller.abort();const result=await outcome;if(!result.ok)throw result.error;expect(result.value.status).toBe(503);expect(f.posts).toBe(1);
    const row=f.db.get('SELECT state,costNanoUsd,usageJson FROM apiKeyAccounting');
    if(mode==='headers-empty')expect(row.state).toBe('unrecorded');
    else if(mode!=='valid-before-abort')expect(['unrecorded','unresolved']).toContain(row.state);
    else if(row.state==='settled'){expect(row.costNanoUsd).toBe(1000000);expect(JSON.parse(row.usageJson).input).toBe(1000);}
    if(row.state!=='settled')expect(row.costNanoUsd).toBeNull();
  });
});

describe('E1 reader deterministic evidence and nonblocking cleanup',()=>{
  async function run(chunks,{abortAfter=false,cancel=()=>new Promise(()=>{}),readError=false}={}) {
    const controller=new AbortController(),finish=vi.fn(async()=>{});let index=0;
    const reader={read:async()=>{
      if(index<chunks.length)return {done:false,value:chunks[index++]};
      if(abortAfter){controller.abort();return new Promise(()=>{});}
      if(readError)throw new Error('premature EOF');
      return {done:true};
    },cancel:vi.fn(cancel),releaseLock:vi.fn()};
    const boundary=createEmbeddingsBoundary({profile:EMBEDDINGS_USAGE_PROFILE,signal:controller.signal,prepare:async()=>({finish})});
    const ticket=await boundary.prepare({});
    const outcome=await observe(ticket.response({body:{getReader:()=>reader},headers:new Headers({'content-type':'application/json'}),status:200,statusText:'OK'}));
    return {outcome,finish,reader};
  }
  const encode=text=>new TextEncoder().encode(text);
  it.each(['never','reject'])('zero-byte interrupted absence is unrecorded evidence despite %s cancel',async mode=>{
    const {outcome,finish,reader}=await run([],{abortAfter:true,cancel:mode==='reject'?()=>Promise.reject(new Error('cleanup')):undefined});
    expect(outcome.ok).toBe(false);expect(finish).toHaveBeenCalledWith(null,'http_200',{kind:'absent',interrupted:true});expect(reader.releaseLock).toHaveBeenCalled();
  });
  it.each(['{"data":[','{"usage":{"prompt_tokens":','{"usage":null}'])('observed partial or invalid prefix never becomes absent: %s',async text=>{
    const {finish}=await run([encode(text)],{abortAfter:true});expect(finish).toHaveBeenCalledWith(null,'http_200',{kind:'malformed',interrupted:true});
  });
  it('complete valid document before interrupted EOF still settles original exact usage',async()=>{
    const {outcome,finish}=await run([encode(JSON.stringify(embeddingsReply()))],{abortAfter:true});expect(outcome.ok).toBe(true);expect(finish.mock.calls[0][0]).toMatchObject({exact:true,input:1000});
  });
  it('premature EOF and local byte cap retain malformed precedence',async()=>{
    for(const [chunks,options] of [[[encode('{"data":[')],{readError:true}],[[new Uint8Array(ACCOUNTING_JSON_MAX_BYTES+1)],{}]]){
      const {finish,outcome}=await run(chunks,options);expect(outcome.ok).toBe(false);expect(finish.mock.calls[0][2].kind).toBe('malformed');
    }
  });
  it('large float/base64-like payload below cap is byte-exact without clone/tee',async()=>{
    const started=performance.now();
    const bytes=encode(JSON.stringify({...embeddingsReply(),metadata:'A'.repeat(1024*1024)}));
    const expected=Buffer.from(bytes), constructed=performance.now();
    const {outcome}=await run([bytes.subarray(0,31),bytes.subarray(31)]);expect(outcome.ok).toBe(true);
    const actual=Buffer.from(await outcome.value.arrayBuffer()),read=performance.now();
    expect(actual.length).toBe(expected.length);expect(actual.equals(expected)).toBe(true);
    console.info('E1 replay timings ms',{construct:constructed-started,read:read-constructed,compare:performance.now()-read});
  });
});
