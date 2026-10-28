import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dns from 'node:dns';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openFixture, addKey, backupFixture } from '../fixtures/accounting/test-database.js';
import { createAccountingService } from '../../src/lib/accounting/service.js';
import { createPersistedRequestAuthority } from '../../src/lib/accounting/persisted-request-authority.js';

const nativeFetch = globalThis.fetch;
let fixture;
const servers = [], sockets = new Set();
const envKeys = ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy','STRICT_SSL'];
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
  vi.doUnmock('undici');
  for (const socket of sockets) socket.destroy(); sockets.clear();
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); })));
  if (fixture) { fixture.db.beforeClose = undefined; fixture.db.close(); fs.rmSync(fixture.root, { recursive:true, force:true }); fixture = null; }
});
function hold() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }
const observe = pending => pending.then(value => ({ok:true,value}), error => ({ok:false,error}));
const reach = (gate, outcome) => Promise.race([gate.promise, outcome.then(result => { throw result.ok ? new Error('Execution ended before expected gate') : result.error; })]);
async function listen(server) {
  servers.push(server); server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return server.address().port;
}
async function network() {
  for (const key of envKeys) vi.stubEnv(key, '');
  vi.stubGlobal('fetch', nativeFetch); vi.resetModules();
  return { ...(await import('../../open-sse/utils/proxyFetch.js')), ...(await import('../../open-sse/executors/base.js')) };
}
async function setup(engine, url, options = {}) {
  fixture = await openFixture(engine); const { db } = fixture; addKey(db); backupFixture(db, fixture.file);
  db.durableTransaction(() => {
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','openai',?)", ['{"fixture":{"input":"1","output":"2"}}']);
    db.run('INSERT INTO providerConnections(id,provider,authType,data,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
      ['connection-one','openai','apikey','{"apiKey":"provider-secret"}','2026-10-27T00:00:00.000Z','2026-10-27T00:00:00.000Z']);
  });
  options.configure?.(db);
  backupFixture(db, fixture.file);
  const service = createAccountingService(db), authority = createPersistedRequestAuthority(db);
  function makeBoundary(keyId='key-one',credential='fixture-secret') {
  const initialProof = authority.prove({credential,provider:'openai',model:'fixture',connectionId:'connection-one'});
  const context = service.createContext({ apiKeyId:keyId, validateAuthoritySync:({apiKeyId,candidate}) => {
    const connection=db.get('SELECT * FROM providerConnections WHERE id=?',[candidate.connectionId]);
    return db.health().healthy && apiKeyId===keyId && candidate.provider==='openai' && candidate.model==='fixture' && candidate.endpoint==='chat' &&
      candidate.connectionId==='connection-one' && connection?.provider==='openai' && connection.isActive===1 && JSON.parse(connection.data).apiKey===request.credentials.apiKey;
  } });
  const boundary = { async prepare(wire) {
    const proof = authority.assertCurrent(initialProof);
    expect(wire.targetUrl).toBe(url);
    const receipt = await service.beginAttempt(context, {provider:'openai',model:'fixture',endpoint:'chat',connectionId:'connection-one'});
    await options.intent?.(receipt, wire);
    return {
      assertDispatch() { authority.assertCredentials(proof,request.credentials); return service.assertDispatchAuthority(receipt, context); },
      async response(response) {
        await options.response?.(receipt, response);
        await service.completeAttempt(receipt, {state:'unresolved',outcome:`HTTP ${response.status}`,finishedAt:new Date().toISOString()});
        return response;
      },
      async failed(error, {exposed}) {
        await options.failed?.(error, exposed);
        await service.completeAttempt(receipt, {state:exposed?'unresolved':'not_dispatched', outcome:error.message,
          ...(!exposed ? {notDispatchedEvidence:'transport refused before invocation'} : {}),finishedAt:new Date().toISOString()});
      },
    };
  }};
  return boundary;
  }
  return { db, service, boundary:makeBoundary(), makeBoundary };
}
const request = {model:'fixture',body:{messages:[{role:'user',content:'hello'}]},stream:false,credentials:{connectionId:'connection-one',apiKey:'provider-secret'}};
const retry = {502:{attempts:0},503:{attempts:0},504:{attempts:0},429:{attempts:0}};
for (const engine of ['node','sqljs']) describe(`${engine} actual POST admission`, () => {
  it('holds intent before direct POST and terminal ACK before returning', async () => {
    const {BaseExecutor} = await network(), intentGate=hold(), terminalGate=hold(), entered=hold(), terminal=hold(); let posts=0;
    const port=await listen(http.createServer((req,res) => { posts++;req.resume();res.end('{"ok":true}'); })), url=`http://127.0.0.1:${port}/chat`;
    const {db,boundary}=await setup(engine,url,{intent:async()=>{entered.release();await intentGate.promise;},response:async()=>{terminal.release();await terminalGate.promise;}});
    const executor=new BaseExecutor('openai',{baseUrl:url,retry,timeoutMs:1000});
    let returned=false;const result=observe(executor.execute({...request,accounting:boundary}).then(value=>{returned=true;return value;}));
    try {
      await reach(entered,result);expect(posts).toBe(0);intentGate.release();await reach(terminal,result);expect(posts).toBe(1);expect(returned).toBe(false);
      await new Promise(resolve=>setTimeout(resolve,1100));
      terminalGate.release();const outcome=await result;if(!outcome.ok)throw outcome.error;expect(await outcome.value.response.json()).toEqual({ok:true});
    } finally { intentGate.release();terminalGate.release();await result; }
    expect(db.all('SELECT state FROM apiKeyAccounting')).toEqual([{state:'unresolved'}]);
  });
  it('sends through an actual saved HTTP proxy with its own intent', async () => {
    const {BaseExecutor}=await network();let posts=0,connects=0;
    const upstream=await listen(http.createServer((req,res)=>{posts++;req.resume();res.end('proxied');}));
    const proxy=http.createServer();proxy.on('connect',(req,client,head)=>{
      connects++;const [host,port]=req.url.split(':');const outgoing=net.connect(Number(port),host,()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)outgoing.write(head);client.pipe(outgoing);outgoing.pipe(client);});
      sockets.add(outgoing);outgoing.on('error',()=>client.destroy());outgoing.on('close',()=>sockets.delete(outgoing));
    });
    const port=await listen(proxy), url=`http://127.0.0.1:${upstream}/chat`;
    const {db,boundary}=await setup(engine,url,{configure:db=>db.durableTransaction(()=>{
      db.run('INSERT INTO proxyPools(id,data,createdAt,updatedAt) VALUES(?,?,?,?)',
        ['pool-one',JSON.stringify({proxyUrl:`http://127.0.0.1:${port}`,strictProxy:true}),'2026-10-27T00:00:00.000Z','2026-10-27T00:00:00.000Z']);
      db.run("UPDATE providerConnections SET data=? WHERE id='connection-one'",[JSON.stringify({apiKey:'provider-secret',providerSpecificData:{proxyPoolId:'pool-one'}})]);
    })});
    const pool=JSON.parse(db.get("SELECT data FROM proxyPools WHERE id='pool-one'").data);
    const executor=new BaseExecutor('openai',{baseUrl:url,retry});
    const directFetch=vi.fn(()=>{throw new Error('custom direct transport must not override proxy');});
    const result=await executor.execute({...request,accounting:boundary,directFetch,proxyOptions:{enabled:true,url:pool.proxyUrl,strictProxy:pool.strictProxy}});
    expect(directFetch).not.toHaveBeenCalled();
    expect(await result.response.text()).toBe('proxied');expect(posts).toBe(1);expect(connects).toBe(1);expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(1);
  });
  it('refuses unsupported accounted custom direct transport without preparing, retrying or POSTing', async () => {
    const {BaseExecutor}=await network();let posts=0;
    const port=await listen(http.createServer((req,res)=>{posts++;req.resume();res.end();})),url=`http://127.0.0.1:${port}/chat`;
    const {db,boundary}=await setup(engine,url),prepare=vi.spyOn(boundary,'prepare');
    const directFetch=vi.fn((url,options)=>nativeFetch(url,options));
    const executor=new BaseExecutor('openai',{baseUrls:[url,url],retry:{...retry,502:{attempts:2,delayMs:0}}});
    await expect(executor.execute({...request,accounting:boundary,directFetch})).rejects.toThrow('Accounting custom direct transport unsupported');
    expect(directFetch).not.toHaveBeenCalled();expect(prepare).not.toHaveBeenCalled();expect(posts).toBe(0);
    expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
  it('retains custom direct transport for nonaccounted requests', async () => {
    const {BaseExecutor}=await network();let posts=0;
    const port=await listen(http.createServer((req,res)=>{posts++;req.resume();res.end('custom direct');})),url=`http://127.0.0.1:${port}/chat`;
    const directFetch=vi.fn((url,options)=>nativeFetch(url,options));
    const result=await new BaseExecutor('openai',{baseUrl:url,retry}).execute({...request,directFetch});
    expect(await result.response.text()).toBe('custom direct');expect(directFetch).toHaveBeenCalledTimes(1);expect(posts).toBe(1);
  });
  it.each(['key','credential','settings','environment'])('refuses %s drift while intent ACK is held without retry or POST', async change => {
    const {BaseExecutor}=await network(), gate=hold(),entered=hold();let posts=0;
    const port=await listen(http.createServer((req,res)=>{posts++;res.end();})), url=`http://127.0.0.1:${port}/chat`;
    const {db,boundary}=await setup(engine,url,{intent:async()=>{entered.release();await gate.promise;}});
    const executor=new BaseExecutor('openai',{baseUrl:url,retry:{...retry,502:{attempts:2,delayMs:0}}});
    const outcome=observe(executor.execute({...request,accounting:boundary}));
    try {
      await reach(entered,outcome);
      if(change==='environment') vi.stubEnv('HTTP_PROXY','http://127.0.0.1:1');
      else db.durableTransaction(()=>db.run(change==='key'?"UPDATE apiKeys SET isActive=0 WHERE id='key-one'":change==='credential'?"UPDATE providerConnections SET data='{}' WHERE id='connection-one'":"INSERT INTO settings(id,data) VALUES(1,'{}')"));
      gate.release();expect((await outcome).ok).toBe(false);expect(posts).toBe(0);expect(db.all('SELECT state FROM apiKeyAccounting')).toEqual([{state:'not_dispatched'}]);
    } finally { gate.release();await outcome; }
  });
  it('settles each status retry before the next POST and refuses redirect replay', async () => {
    const {BaseExecutor}=await network();let posts=0,redirects=0;
    const port=await listen(http.createServer((req,res)=>{req.resume();if(req.url==='/redirect'){redirects++;res.end();return;}posts++;res.statusCode=posts===1?503:307;res.setHeader('location','/redirect');res.end('retry');})),url=`http://127.0.0.1:${port}/chat`;
    const {db,boundary}=await setup(engine,url,{intent:()=>{if(posts===1)expect(db.all('SELECT state FROM apiKeyAccounting ORDER BY startedAt')[0].state).toBe('unresolved');}});
    const executor=new BaseExecutor('openai',{baseUrl:url,retry:{...retry,503:{attempts:1,delayMs:0}}});
    const result=await executor.execute({...request,accounting:boundary});expect(result.response.status).toBe(307);await result.response.text();
    expect(posts).toBe(2);expect(redirects).toBe(0);expect(db.all('SELECT state FROM apiKeyAccounting')).toEqual([{state:'unresolved'},{state:'unresolved'}]);
  });
  it('does not call failed or fallback when terminal observation rejects', async () => {
    const {BaseExecutor}=await network();let posts=0,failures=0;
    const port=await listen(http.createServer((req,res)=>{posts++;req.resume();res.end();})),url=`http://127.0.0.1:${port}/chat`;
    const {boundary}=await setup(engine,url,{response:()=>{throw new Error('own terminal ACK lost');},failed:()=>{failures++;}});
    const executor=new BaseExecutor('openai',{baseUrl:url,retry:{...retry,502:{attempts:2,delayMs:0}}});
    await expect(executor.execute({...request,accounting:boundary})).rejects.toThrow('own terminal ACK lost');expect(posts).toBe(1);expect(failures).toBe(0);
  });
  it('does not dispatch from a persisted intent whose own ACK was lost', async () => {
    const {BaseExecutor}=await network();let posts=0;
    const port=await listen(http.createServer((req,res)=>{posts++;req.resume();res.end();})),url=`http://127.0.0.1:${port}/chat`;
    const {db,boundary}=await setup(engine,url), durable=db.durableTransaction;
    vi.spyOn(db,'durableTransaction').mockImplementationOnce(work=>{durable(work);throw new Error('intent ACK lost');});
    const executor=new BaseExecutor('openai',{baseUrl:url,retry:{...retry,502:{attempts:2,delayMs:0}}});
    await expect(executor.execute({...request,accounting:boundary})).rejects.toThrow('intent ACK lost');
    expect(posts).toBe(0);expect(db.all('SELECT state FROM apiKeyAccounting')).toEqual([{state:'pending'}]);
  });
  it('keeps two keys independent on one executor while one intent is held', async () => {
    const {BaseExecutor}=await network(),entered=hold(),gate=hold();let posts=0;
    const port=await listen(http.createServer((req,res)=>{posts++;req.resume();res.end();})),url=`http://127.0.0.1:${port}/chat`;
    const {db,boundary,makeBoundary}=await setup(engine,url,{intent:async receipt=>{
      if(db.get('SELECT apiKeyId FROM apiKeyAccounting WHERE attemptId=?',[receipt.attemptId]).apiKeyId==='key-one'){entered.release();await gate.promise;}
    }});
    addKey(db,'key-two','second-secret');const second=makeBoundary('key-two','second-secret');
    const executor=new BaseExecutor('openai',{baseUrl:url,retry}), first=observe(executor.execute({...request,accounting:boundary}));
    try {
      await reach(entered,first);await (await executor.execute({...request,accounting:second})).response.text();expect(posts).toBe(1);
      gate.release();const result=await first;if(!result.ok)throw result.error;await result.value.response.text();expect(posts).toBe(2);
      expect(db.all('SELECT apiKeyId,state FROM apiKeyAccounting ORDER BY apiKeyId')).toEqual([{apiKeyId:'key-one',state:'unresolved'},{apiKeyId:'key-two',state:'unresolved'}]);
    } finally {gate.release();await first;}
  });
  it('owns the proxy failure and direct resend as distinct attempts', async () => {
    const {BaseExecutor}=await network();let posts=0;
    const upstream=await listen(http.createServer((req,res)=>{req.resume();req.on('end',()=>{posts++;if(posts===1)req.socket.destroy();else res.end('direct successor');});}));
    const proxy=http.createServer();proxy.on('connect',(req,client,head)=>{
      const [host,port]=req.url.split(':'),outgoing=net.connect(Number(port),host,()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)outgoing.write(head);client.pipe(outgoing);outgoing.pipe(client);});
      sockets.add(outgoing);outgoing.on('error',()=>client.destroy());outgoing.on('close',()=>{sockets.delete(outgoing);client.destroy();});
    });
    const port=await listen(proxy),url=`http://127.0.0.1:${upstream}/chat`;
    let predecessorId,intents=0;
    const {db,boundary}=await setup(engine,url,{intent:receipt=>{
      intents++;
      if(!predecessorId){predecessorId=receipt.attemptId;return;}
      expect(receipt.attemptId).not.toBe(predecessorId);expect(posts).toBe(1);
      expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?',[predecessorId])).toEqual({state:'unresolved'});
      expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?',[receipt.attemptId])).toEqual({state:'pending'});
    }});
    const executor=new BaseExecutor('openai',{baseUrl:url,retry});
    const result=await executor.execute({...request,accounting:boundary,proxyOptions:{enabled:true,url:`http://127.0.0.1:${port}`}});
    expect(await result.response.text()).toBe('direct successor');expect(posts).toBe(2);expect(intents).toBe(2);expect(db.all('SELECT state FROM apiKeyAccounting')).toEqual([{state:'unresolved'},{state:'unresolved'}]);
  });
  it('owns a TLS certificate fallback with a fresh intent before the actual successful POST', async () => {
    const {BaseExecutor}=await network(),{default:selfsigned}=await import('selfsigned');
    const cert=await selfsigned.generate([{name:'commonName',value:'localhost'}],{keySize:2048,extensions:[{name:'subjectAltName',altNames:[{type:7,ip:'127.0.0.1'}]}]});let posts=0;
    const port=await listen(https.createServer({key:cert.private,cert:cert.cert},(req,res)=>{posts++;req.resume();res.end('tls successor');})),url=`https://127.0.0.1:${port}/chat`;
    const {db,boundary}=await setup(engine,url),executor=new BaseExecutor('openai',{baseUrl:url,retry});
    const result=await executor.execute({...request,accounting:boundary});expect(await result.response.text()).toBe('tls successor');expect(posts).toBe(1);
    expect(db.all('SELECT state FROM apiKeyAccounting')).toEqual([{state:'unresolved'},{state:'unresolved'}]);
  });
  it.each(['key','credential','node','pool','settings','environment'])('refuses %s drift across the lazy dispatcher await', async change => {
    const {BaseExecutor}=await network(),entered=hold(),gate=hold();let connects=0;
    const proxy=http.createServer();proxy.on('connect',(_req,client)=>{connects++;client.destroy();});const port=await listen(proxy),proxyUrl=`http://127.0.0.1:${port}`,url='http://127.0.0.1:1/chat';
    const {db,boundary}=await setup(engine,url,{configure:db=>db.durableTransaction(()=>{
      db.run('INSERT INTO proxyPools(id,data,createdAt,updatedAt) VALUES(?,?,?,?)',['pool-one',JSON.stringify({proxyUrl}),'2026-10-27T00:00:00.000Z','2026-10-27T00:00:00.000Z']);
      db.run('INSERT INTO providerNodes(id,type,data,createdAt,updatedAt) VALUES(?,?,?,?,?)',['openai','openai-compatible','{"baseUrl":"http://127.0.0.1:1"}','2026-10-27T00:00:00.000Z','2026-10-27T00:00:00.000Z']);
      db.run("UPDATE providerConnections SET data=? WHERE id='connection-one'",['{"apiKey":"provider-secret","providerSpecificData":{"proxyPoolId":"pool-one"}}']);
    })});
    vi.doMock('undici',async importOriginal=>{const actual=await importOriginal();entered.release();await gate.promise;return actual;});
    const executor=new BaseExecutor('openai',{baseUrl:url,retry}),outcome=observe(executor.execute({...request,accounting:boundary,proxyOptions:{enabled:true,url:proxyUrl,strictProxy:true}}));
    try {
      await reach(entered,outcome);
      if(change==='environment')vi.stubEnv('NO_PROXY','*');
      else db.durableTransaction(()=>db.run(change==='key'?"UPDATE apiKeys SET isActive=0 WHERE id='key-one'":change==='node'?"UPDATE providerNodes SET data='{}' WHERE id='openai'":change==='credential'?"UPDATE providerConnections SET data='{}' WHERE id='connection-one'":change==='pool'?"UPDATE proxyPools SET isActive=0 WHERE id='pool-one'":"INSERT INTO settings(id,data) VALUES(1,'{}')"));
      gate.release();expect((await outcome).ok).toBe(false);expect(connects).toBe(0);expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
    } finally {gate.release();await outcome;}
  });
  it.each([false,true])('preserves abort before admission and after own intent with admitted=%s', async admitted => {
    const {BaseExecutor}=await network(),gate=hold(),entered=hold(),controller=new AbortController();let posts=0;
    const port=await listen(http.createServer((req,res)=>{posts++;req.resume();res.end();})),url=`http://127.0.0.1:${port}/chat`;
    const {db,boundary}=await setup(engine,url,{intent:async()=>{entered.release();await gate.promise;}});
    const executor=new BaseExecutor('openai',{baseUrl:url,retry});if(!admitted)controller.abort(new Error('client cancelled'));
    const outcome=observe(executor.execute({...request,signal:controller.signal,accounting:boundary}));
    try {
      if(admitted){await reach(entered,outcome);controller.abort(new Error('client cancelled'));}gate.release();
      const result=await outcome;expect(result.ok).toBe(false);expect(result.error.message).toBe('client cancelled');expect(posts).toBe(0);
      expect(db.all('SELECT state FROM apiKeyAccounting')).toEqual(admitted?[{state:'not_dispatched'}]:[]);
    } finally {gate.release();await outcome;}
  });
});
it('admits the actual relay POST without replaying redirects to the target', async () => {
  const {BaseExecutor}=await network();let posts=0,target,path;
  const port=await listen(http.createServer((req,res)=>{posts++;target=req.headers['x-relay-target'];path=req.headers['x-relay-path'];req.resume();res.end('relay');}));
  const url='http://no-upstream.invalid/v1/chat?x=1',{boundary}=await setup('node',url),executor=new BaseExecutor('openai',{baseUrl:url,retry});
  const result=await executor.execute({...request,accounting:boundary,proxyOptions:{vercelRelayUrl:`http://127.0.0.1:${port}/relay`}});
  expect(await result.response.text()).toBe('relay');expect(posts).toBe(1);expect(target).toBe('http://no-upstream.invalid');expect(path).toBe('/v1/chat?x=1');
});
it('uses the intended MITM bypass IP and certificate hostname for an actual TLS POST', async () => {
  const {proxyAwareFetch}=await network();
  const {default:selfsigned}=await import('selfsigned');
  const cert=await selfsigned.generate([{name:'commonName',value:'api2.cursor.sh'}],{days:1,keySize:2048,extensions:[{name:'subjectAltName',altNames:[{type:2,value:'api2.cursor.sh'}]}]});
  let posts=0,body='',servername;
  const port=await listen(https.createServer({key:cert.private,cert:cert.cert},(req,res)=>{posts++;servername=req.socket.servername;req.on('data',chunk=>{body+=chunk;});req.on('end',()=>res.end('tls'));}));
  vi.spyOn(dns.Resolver.prototype,'resolve4').mockImplementation((_host,callback)=>callback(null,['127.0.0.1']));
  const nativeRequest=https.request;
  vi.spyOn(https,'request').mockImplementation((options,callback)=>nativeRequest({...options,ca:cert.cert},callback));
  const url=`https://api2.cursor.sh:${port}/chat`,{boundary}=await setup('node',url);
  const response=await proxyAwareFetch(url,{method:'POST',body:'{"tls":true}',headers:{'content-type':'application/json'}},null,boundary);
  expect(await response.text()).toBe('tls');expect(posts).toBe(1);expect(body).toBe('{"tls":true}');expect(servername).toBe('api2.cursor.sh');
});
