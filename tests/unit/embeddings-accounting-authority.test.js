import {afterEach,describe,it,expect,vi} from 'vitest';
import {openEmbeddingsFixture,fixtureProvider} from '../fixtures/accounting/embeddings-loopback.js';
import {associateEmbeddingsAccountingFixture,captureEmbeddingsAccounting} from '../../src/sse/services/embeddings-accounting.js';
import {embeddingsTarget} from '../../src/lib/accounting/persisted-embeddings-authority.js';
let fixture;
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllEnvs();vi.useRealTimers();if(fixture){await fixture.close();fixture=null;}});
async function session(engine,hooks={}){
  for(const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'])vi.stubEnv(name,'');
  fixture=await openEmbeddingsFixture(engine);const controller=new AbortController();const request=new Request('http://localhost/v1/embeddings',{headers:{authorization:'Bearer fixture-secret'},signal:controller.signal});
  associateEmbeddingsAccountingFixture(request,fixture.db,hooks);const owner=captureEmbeddingsAccounting(request);
  owner.authorizeTarget('fixture-node/fixture',{model:'fixture-node/fixture',input:'hello'});
  const credentials=owner.credentials(fixtureProvider,'fixture'),candidate={provider:fixtureProvider,model:'fixture',endpoint:'embeddings',connectionId:credentials.connectionId};
  const binding=owner.bind(candidate,credentials),targetUrl=`${credentials.providerSpecificData.baseUrl}/embeddings`;
  const wire={targetUrl,url:targetUrl,route:{kind:'direct',proxyUrl:null,insecure:false},method:'POST',body:JSON.stringify({model:'fixture',input:'hello',encoding_format:'float'}),headers:JSON.stringify([['authorization','Bearer provider-secret']])};
  return {owner,binding,wire,credentials,candidate,controller};
}
for(const engine of ['node','sqljs'])describe(`${engine} E1 private dispatch authority`,()=>{
  it('copied ticket/receipt from a peer does not mint a new dispatch and consumed permission stays consumed',async()=>{
    let receipt;const {owner,binding,wire}=await session(engine,{intentAck:value=>{receipt=value;}});
    try {const ticket=await binding.prepare(wire);expect(ticket.assertDispatch(wire)).toBe(true);expect(()=>ticket.assertDispatch(wire)).toThrow();
      const {createAccountingService}=await import('../../src/lib/accounting/service.js');
      await expect(createAccountingService(fixture.db).completeAttempt({...receipt},{state:'unrecorded',outcome:'network_unknown',finishedAt:new Date().toISOString(),evidence:{kind:'absent',interrupted:true}})).rejects.toThrow('Own intent ACK');
      await ticket.finish(null,'network_unknown',{kind:'absent',interrupted:true});expect(fixture.posts).toBe(0);
    } finally {owner.dispose();}
  });
  it.each(['input','model','header','route','profile-price'])('rejects final wire %s drift before intent',async mode=>{
    const {owner,binding,wire}=await session(engine);
    try {
      if(mode==='input')wire.body=JSON.stringify({model:'fixture',input:'changed',encoding_format:'float'});
      if(mode==='model')wire.body=JSON.stringify({model:'other',input:'hello',encoding_format:'float'});
      if(mode==='header')wire.headers=JSON.stringify([['authorization','Bearer attacker']]);
      if(mode==='route')wire.route={kind:'relay'};
      if(mode==='profile-price')fixture.db.durableTransaction(()=>fixture.db.run("UPDATE kv SET value=? WHERE scope='pricing'",[JSON.stringify({fixture:{input:'1',output:'0',cached:'0'}})]));
      await expect(binding.prepare(wire)).rejects.toThrow();expect(fixture.db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);expect(fixture.posts).toBe(0);
    }finally{owner.dispose();}
  });
  it('abort during withheld own terminal delivery retains exact durable cost without resurrecting success',async()=>{
    const {owner,binding,wire,controller}=await session(engine,{terminalAck:()=>new Promise(()=>{})});
    try {
      const ticket=await binding.prepare(wire);ticket.assertDispatch(wire);
      const {normalizeEmbeddingsUsage}=await import('../../open-sse/utils/accounting-embeddings-usage.js');
      const {observe}=await import('../fixtures/accounting/embeddings-loopback.js');
      const finish=observe(ticket.finish(normalizeEmbeddingsUsage({prompt_tokens:1000,total_tokens:1000}),'http_200',{kind:'valid',interrupted:false}));
      await new Promise(resolve=>setImmediate(resolve));
      expect(fixture.db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({state:'settled',costNanoUsd:1000000});
      controller.abort();expect((await finish).ok).toBe(false);expect(()=>ticket.assertDispatch(wire)).toThrow();
    } finally {owner.dispose();}
  });
  it('stalled ingress body waiting exits on caller abort; late completion cannot create intent',async()=>{
    const {owner,controller}=await session(engine);
    try {
      let release;const delayed=new Promise(resolve=>{release=resolve;});
      const {observe}=await import('../fixtures/accounting/embeddings-loopback.js');
      const waiting=observe(owner.wait(delayed));controller.abort();expect((await waiting).ok).toBe(false);
      release({model:'fixture-node/fixture',input:'hello'});await Promise.resolve();expect(()=>owner.authorizeTarget('fixture-node/fixture',{model:'fixture-node/fixture',input:'hello'})).toThrow();
      expect(fixture.db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);expect(fixture.posts).toBe(0);
    }finally{owner.dispose();}
  });
  it('queued cancellation removes intent before durable group publication',async()=>{
    const {owner,binding,wire}=await session(engine);
    try {
      const {createAccountingService}=await import('../../src/lib/accounting/service.js');
      const service=createAccountingService(fixture.db),candidate={provider:fixtureProvider,model:'fixture',endpoint:'embeddings',connectionId:'connection-one'};
      const context=service.createContext({apiKeyId:'key-one',validateAuthoritySync:()=>true}),controller=new AbortController();
      const queued=service.beginAttempt(context,candidate,{signal:controller.signal});controller.abort();await expect(queued).rejects.toThrow();
      expect(fixture.db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);expect(binding.signal.aborted).toBe(false);expect(wire.method).toBe('POST');
      service.disposeContext(context);
    }finally{owner.dispose();}
  });
  it('original request deadline aborts a held intent delivery without resetting per attempt',async()=>{
    const {FETCH_CONNECT_TIMEOUT_MS}=await import('../../open-sse/config/runtimeConfig.js');
    // Fake only the deadline timer, not the SQLite coordinator's scheduling.
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
    const {owner,binding,wire}=await session(engine,{intentAck:()=>new Promise(()=>{})});
    try {
      const {observe}=await import('../fixtures/accounting/embeddings-loopback.js');
      const pending=observe(binding.prepare(wire));
      // Flush the real queued coordinator before advancing the deadline.
      await new Promise(resolve=>setImmediate(resolve));
      await vi.advanceTimersByTimeAsync(FETCH_CONNECT_TIMEOUT_MS);
      const outcome=await pending;expect(outcome.ok).toBe(false);expect(binding.signal.aborted).toBe(true);expect(fixture.posts).toBe(0);
      expect(fixture.db.get('SELECT state FROM apiKeyAccounting').state).toBe('not_dispatched');
    }finally{owner.dispose();}
  });
});
describe('E1 explicit target equivalence',()=>{
  it.each(['http://localhost/v1','http://localhost/v1/','http://localhost/v1///','http://localhost/v1/embeddings/'])('canonicalizes only declared suffix %s',base=>expect(embeddingsTarget(base)).toBe('http://localhost/v1/embeddings'));
  it.each(['','http://user:secret@localhost/v1','http://localhost/v1?key=secret','http://localhost/v1#x','http://localhost/v1/embeddings/embeddings','http://localhost/v1//path','http://localhost/v1%2fother','file:///tmp/target'])('refuses unsupported target %s',base=>expect(()=>embeddingsTarget(base)).toThrow());
});
