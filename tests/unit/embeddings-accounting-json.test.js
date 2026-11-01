import {afterEach,describe,expect,it,vi} from 'vitest';
import {openEmbeddingsFixture,embeddingsReply,gate,observe,reach} from '../fixtures/accounting/embeddings-loopback.js';
let fixture;
async function setup(engine,options) {
  for (const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy']) vi.stubEnv(key,'');
  fixture = await openEmbeddingsFixture(engine,options); return fixture;
}
afterEach(async () => {vi.restoreAllMocks();vi.unstubAllEnvs();if (fixture) {await fixture.close();fixture=null;}});
for (const engine of ['node','sqljs']) describe(`${engine} E1 actual embeddings JSON`,() => {
  it.each([{label:'string',input:'hello'},{label:'strings',input:['a','b']},{label:'tokens',input:[1,2]},{label:'token-batches',input:[[1],[2,3]]}])('actual one POST and one priced aggregate for $label',async ({input}) => {
    const f=await setup(engine);const response=await f.request({body:{input,dimensions:2,encoding_format:'float',user:'ignored'}});
    expect(response.status).toBe(200);expect(await response.json()).toEqual(embeddingsReply());
    expect(f.posts).toBe(1);expect(f.requests[0].url).toBe('/v1/embeddings');expect(f.requests[0].headers.authorization).toBe('Bearer provider-secret');
    expect(f.requests[0].body).toEqual({model:'fixture',input,encoding_format:'float',dimensions:2});
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(f.db.get('SELECT state,costNanoUsd,endpoint FROM apiKeyAccounting')).toEqual({state:'settled',costNanoUsd:1000000,endpoint:'embeddings'});
  });
  it('settles original embeddings price/time after persisted rate changes during actual POST',async()=>{
    const f=await setup(engine,{respond:(_req,res)=>{
      f.db.durableTransaction(()=>f.db.run("UPDATE kv SET value=? WHERE scope='pricing'",[JSON.stringify({fixture:{input:'9',output:'0'}})]));
      res.setHeader('content-type','application/json');res.end(JSON.stringify(embeddingsReply()));
    }});
    const response=await f.request({clock:()=> '2026-10-25T16:59:00.000Z'});expect(response.status).toBe(200);expect(f.posts).toBe(1);
    const row=f.db.get('SELECT costNanoUsd,startedAt,priceSnapshotJson FROM apiKeyAccounting');expect(row.costNanoUsd).toBe(1000000);expect(row.startedAt).toBe('2026-10-25T16:59:00.000Z');expect(JSON.parse(row.priceSnapshotJson).rates.input).toBe('1');
  });
  it('retains exact raw base64 bytes, zero and unknown ordinary metadata',async () => {
    const text=' {"object":"list","metadata":{"native":true},"data":[{"embedding":"AQID","index":0}],"usage":{"prompt_tokens":0,"total_tokens":0}} ';
    const f=await setup(engine,{respond:(_req,res)=>{res.setHeader('content-type','application/json');res.end(text);}});
    const response=await f.request({body:{encoding_format:'base64'}});expect(response.status).toBe(200);expect(await response.text()).toBe(text);
    expect(f.db.get('SELECT costNanoUsd FROM apiKeyAccounting').costNanoUsd).toBe(0);
  });
  it.each([400,429,503])('preserves final selected HTTP %s bytes and strips unsafe headers after own ACK',async status => {
    const text=' {"error":{"message":"fixture invalid"},"usage":{"prompt_tokens":1000,"total_tokens":1000}} ';
    const f=await setup(engine,{respond:(_req,res)=>{res.statusCode=status;res.setHeader('content-type','application/json');res.setHeader('set-cookie','secret');res.setHeader('location','http://secret.invalid');res.end(text);}});
    const response=await f.request();expect(response.status).toBe(status);expect(await response.text()).toBe(text);expect(f.posts).toBe(1);
    for (const name of ['set-cookie','location','content-length','content-encoding','authorization']) expect(response.headers.has(name)).toBe(false);
    expect(f.db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({state:'settled',costNanoUsd:1000000});
  });
  it.each(['missing','malformed','duplicate'])('refuses complete %s without advancing account',async mode => {
    const text=mode==='missing'?'{}':mode==='malformed'?'{"usage":{"prompt_tokens":1,"total_tokens":2}}':'{"usage":{"prompt_tokens":1,"prompt\\u005ftokens":1,"total_tokens":1}}';
    const f=await setup(engine,{respond:(_req,res)=>{res.statusCode=503;res.end(text);}});
    const response=await f.request();expect(response.status).toBe(503);expect((await response.json()).error.code).toBe('api_key_accounting_unavailable');
    expect(f.posts).toBe(1);expect(f.db.get('SELECT state FROM apiKeyAccounting').state).toBe('unresolved');
  });
  it('withholds wire and client completion until own intent and terminal ACK',async () => {
    const intent=gate(),intentHold=gate(),terminal=gate(),terminalHold=gate();const f=await setup(engine);
    let returned=false;const outcome=observe(f.request({hooks:{intentAck:async()=>{intent.release();await intentHold.promise;},terminalAck:async()=>{terminal.release();await terminalHold.promise;}}}).then(response=>{returned=true;return response;}));
    try {await reach(intent,outcome);expect(f.posts).toBe(0);intentHold.release();await reach(terminal,outcome);expect(f.posts).toBe(1);expect(returned).toBe(false);
      terminalHold.release();const result=await outcome;if(!result.ok)throw result.error;expect(result.value.status).toBe(200);
    } finally {intentHold.release();terminalHold.release();await outcome;}
  });
  it.each(['intent','terminal'])('lost own %s ACK cannot be replaced by visible row',async kind => {
    const f=await setup(engine);const response=await f.request({hooks:{[`${kind}Ack`]:()=>{throw new Error('lost own delivery');}}});
    expect(response.status).toBe(503);expect(f.posts).toBe(kind==='intent'?0:1);
    expect(f.db.get('SELECT state FROM apiKeyAccounting').state).toBe(kind==='intent'?'pending':'settled');
  });
  it.each([{stream:true},{input:[]},{encoding_format:'binary'},{dimensions:'2'}])('refuses original invalid profile before adapter %j',async body => {
    const f=await setup(engine);expect((await f.request({body})).status).toBe(503);expect(f.posts).toBe(0);expect(f.db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
  it.each([
    "UPDATE apiKeys SET isActive=0 WHERE id='key-one'",
    "UPDATE apiKeys SET key='rotated' WHERE id='key-one'",
    "UPDATE apiKeys SET accessRestricted=1,accessAllow='[]' WHERE id='key-one'",
    "UPDATE providerConnections SET isActive=0 WHERE id='connection-one'",
    "UPDATE providerConnections SET data=json_set(data,'$.apiKey','changed')",
    "UPDATE providerNodes SET data=json_set(data,'$.baseUrl','http://127.0.0.1:1')",
    "INSERT INTO kv(scope,key,value) VALUES('modelAliases','other','\"fixture-node/other\"')",
  ])('refuses persisted mutation across intent ACK %s',async sql => {
    const f=await setup(engine);const response=await f.request({hooks:{intentAck:()=>f.db.durableTransaction(()=>f.db.run(sql))}});
    expect(response.status).toBe(503);expect(f.posts).toBe(0);expect(f.db.get('SELECT state FROM apiKeyAccounting').state).toBe('not_dispatched');
  });
  it.each([
    "UPDATE providerNodes SET data=json_remove(data,'$.baseUrl')",
    "UPDATE providerConnections SET data=json_remove(data,'$.providerSpecificData.baseUrl')",
    "UPDATE providerConnections SET authType='oauth'",
    "UPDATE providerConnections SET data=json_set(data,'$.accessToken','unsupported')",
    "UPDATE providerConnections SET data=json_set(data,'$.refreshToken','unsupported')",
    "UPDATE providerNodes SET type='custom-embedding'",
    "UPDATE kv SET value='{}' WHERE scope='pricing'",
    "UPDATE kv SET value='{\"fixture\":{\"input\":\"1\",\"output\":\"2\"}}' WHERE scope='pricing'",
    "UPDATE kv SET value='{\"fixture\":{\"input\":\"1\",\"output\":\"0\",\"cached\":\"0\"}}' WHERE scope='pricing'",
  ])('missing authority/profile/price refuses before any POST: %s',async sql=>{
    const f=await setup(engine);f.db.durableTransaction(()=>f.db.run(sql));expect((await f.request()).status).toBeGreaterThanOrEqual(400);expect(f.posts).toBe(0);expect(f.db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
  it.each(['/','///','/embeddings','/embeddings///'])('canonical selected base suffix %s reaches exact embeddings target',async suffix=>{
    const f=await setup(engine);f.db.durableTransaction(()=>{
      f.db.run("UPDATE providerNodes SET data=json_set(data,'$.baseUrl',json_extract(data,'$.baseUrl') || ?)",[suffix]);
      f.db.run("UPDATE providerConnections SET data=json_set(data,'$.providerSpecificData.baseUrl',json_extract(data,'$.providerSpecificData.baseUrl') || ?)",[suffix]);
    });
    const response=await f.request();expect(response.status).toBe(200);expect(f.posts).toBe(1);expect(f.requests[0].url).toBe('/v1/embeddings');
  });
  it.each(['chat','responses'])('node preference %s does not select embeddings protocol',async apiType=>{
    const f=await setup(engine,{apiType});expect((await f.request()).status).toBe(200);expect(f.requests[0].url).toBe('/v1/embeddings');
  });
  it('unassociated request ignores client enrollment fields and retains legacy user dropping',async () => {
    const f=await setup(engine);const response=await f.request({accounting:false,body:{accounting:true,profile:'openai-embeddings-input-only-v1',user:'ignored'}});
    expect(response.status).toBe(200);expect(await response.json()).toEqual(embeddingsReply());expect(f.requests[0].body).not.toHaveProperty('user');expect(f.db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
});
