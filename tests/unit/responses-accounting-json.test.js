import { afterEach, describe, expect, it, vi } from 'vitest';
import { openResponsesFixture, responsesReply, rawResponsesUsage, gate, observe, reach } from '../fixtures/accounting/responses-loopback.js';

let fixture;
async function setup(engine, options) {
  for (const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy']) vi.stubEnv(key,'');
  fixture = await openResponsesFixture(engine, options); return fixture;
}
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); if (fixture) { await fixture.close(); fixture = null; } });
for (const engine of ['node','sqljs']) describe(`${engine} native Responses JSON characterization`, () => {
  it.each([false,true])('preserves associated native JSON and exact raw usage with client stream=%s', async stream => {
    const raw=responsesReply();const f=await setup(engine);
    const response=await f.request({stream});expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    const json=await response.json();expect(json).toEqual(raw);
    expect(f.posts).toBe(1);expect(f.requests[0].url).toBe('/v1/responses');
    expect(f.requests[0].headers.authorization).toBe('Bearer provider-secret');
    expect(f.requests[0].body.model).toBe('fixture');expect(f.requests[0].body).not.toHaveProperty('stream_options');
    const row=f.db.get('SELECT * FROM apiKeyAccounting');
    expect(row.state).toBe('settled');expect(String(row.costNanoUsd)).toBe('900000');expect(row.endpoint).toBe('chat');
    expect(JSON.parse(row.usageJson)).toMatchObject({input:1000,output:100,cacheRead:400,reasoning:20});
  });
  it('withholds JSON until its own intent and terminal ACK, not a read-visible row',async()=>{
    const intent=gate(),intentHold=gate(),terminal=gate(),terminalHold=gate();const f=await setup(engine);
    let returned=false;const outcome=observe(f.request({hooks:{intentAck:async()=>{intent.release();await intentHold.promise;},
      terminalAck:async()=>{terminal.release();await terminalHold.promise;}}}).then(response=>{returned=true;return response;}));
    try{await reach(intent,outcome);expect(f.posts).toBe(0);intentHold.release();await reach(terminal,outcome);
      expect(f.posts).toBe(1);expect(f.db.get('SELECT state FROM apiKeyAccounting').state).toBe('settled');expect(returned).toBe(false);
      terminalHold.release();const result=await outcome;if(!result.ok)throw result.error;expect((await result.value.json()).usage).toEqual(rawResponsesUsage());
    }finally{intentHold.release();terminalHold.release();await outcome;}
  });
  it.each(['background','previous_response_id','tools','input'])('refuses unsupported %s before actual POST',async field=>{
    const f=await setup(engine);const value={background:true,previous_response_id:'remote',tools:[{type:'web_search'}],
      input:[{role:'user',content:[{type:'input_image',image_url:'https://example.invalid/image'}]}]}[field];
    const response=await f.request({body:{[field]:value}});expect(response.status).toBe(503);expect(f.posts).toBe(0);
  });
  it.each(['failed','incomplete'])('settles native %s JSON without successful HTTP or account-success bookkeeping',async status=>{
    const raw={...responsesReply(),status,...(status==='failed'?{error:{code:'fixture_failure',message:'failed'}}:{incomplete_details:{reason:'max_output_tokens'}})};
    const f=await setup(engine,{respond:(_req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(raw));}});
    const response=await f.request();expect(response.status).toBe(502);expect(await response.json()).toEqual(raw);
    expect(f.posts).toBe(1);expect(f.db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({state:'settled',costNanoUsd:900000});
  });
  it.each([400,429])('settles exact failed HTTP %s before error/retry processing',async status=>{
    const f=await setup(engine,{respond:(_req,res)=>{res.statusCode=status;res.setHeader('content-type','application/json');
      res.end(JSON.stringify({error:{message:'fixture invalid'},usage:rawResponsesUsage()}));}});
    const response=await f.request();
    // Existing one-account cooldown maps exhausted 429 to 503; not a local accounting refusal.
    expect(response.status).toBe(status===429?503:status);expect(f.posts).toBe(1);
    if(status===429)expect((await response.json()).error.code).not.toBe('api_key_accounting_unavailable');
    const row=f.db.get('SELECT state,costNanoUsd FROM apiKeyAccounting');expect(row).toEqual({state:'settled',costNanoUsd:900000});
  });
  it('prices each actual native JSON attempt from original snapshot despite a later rate change',async()=>{
    const f=await setup(engine,{respond:(_req,res)=>{
      f.db.durableTransaction(()=>f.db.run("UPDATE kv SET value=? WHERE scope='pricing'",[JSON.stringify({fixture:{input:'9',output:'9',cached:'9'}})]));
      res.setHeader('content-type','application/json');res.end(JSON.stringify(responsesReply()));
    }});
    const response=await f.request({clock:()=> '2026-10-25T16:59:00.000Z'});expect(response.status).toBe(200);await response.text();
    const row=f.db.get('SELECT * FROM apiKeyAccounting');expect(row.costNanoUsd).toBe(900000);expect(row.startedAt).toBe('2026-10-25T16:59:00.000Z');
    expect(JSON.parse(row.priceSnapshotJson).rates.input).toBe('1');
  });
  it('keeps two native keys isolated on the cached executor',async()=>{
    const f=await setup(engine);const responses=await Promise.all([f.request(),f.request({key:'fixture-secret-two'})]);
    expect(responses.map(response=>response.status)).toEqual([200,200]);await Promise.all(responses.map(response=>response.text()));expect(f.posts).toBe(2);
    expect(f.db.all('SELECT apiKeyId,costNanoUsd FROM apiKeyAccounting ORDER BY apiKeyId')).toEqual([
      {apiKeyId:'key-one',costNanoUsd:900000},{apiKeyId:'key-two',costNanoUsd:900000}]);
  });
  it('does not dispatch without exact original pricing',async()=>{
    const f=await setup(engine,{rates:{input:'1'}});const response=await f.request();expect(response.status).toBe(503);expect(f.posts).toBe(0);
  });
  it('sends client function definitions and inline results without hosted execution',async()=>{
    const f=await setup(engine);const response=await f.request({body:{tools:[{type:'function',name:'lookup',parameters:{type:'object'}}],
      input:[{role:'user',content:'hello'},{type:'function_call',name:'lookup',call_id:'call_1',arguments:'{}'},
        {type:'function_call_output',call_id:'call_1',output:'inline result'}]}});
    expect(response.status).toBe(200);await response.text();expect(f.posts).toBe(1);expect(f.requests[0].body.tools[0].type).toBe('function');
    expect(f.db.get('SELECT costNanoUsd FROM apiKeyAccounting').costNanoUsd).toBe(900000);
  });
  it('preserves explicit zero counters/details without presentation defaults',async()=>{
    const raw=responsesReply({input_tokens:0,output_tokens:0,total_tokens:0,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}});
    const f=await setup(engine,{respond:(_req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(raw));}});
    const response=await f.request();expect(response.status).toBe(200);expect((await response.json()).usage).toEqual(raw.usage);
    expect(f.db.get('SELECT costNanoUsd FROM apiKeyAccounting').costNanoUsd).toBe(0);
  });
  it.each(['malformed','missing','status'])('does not publish successful JSON from %s evidence',async mode=>{
    const f=await setup(engine,{respond:(_req,res)=>{res.setHeader('content-type','application/json');const raw=responsesReply();
      if(mode==='malformed')raw.usage.input_tokens_details.audio_tokens=0;
      if(mode==='missing')delete raw.usage;
      if(mode==='status')raw.status='in_progress';
      res.end(JSON.stringify(raw));}});
    const response=await f.request();expect(response.status).toBe(503);expect(f.posts).toBe(1);
    expect(f.db.get('SELECT state FROM apiKeyAccounting').state).toBe('unresolved');
  });
  it.each(['media','hosted','unknown'])('refuses original Chat %s before lossy conversion or remote prefetch',async mode=>{
    const f=await setup(engine);const fetch=vi.spyOn(globalThis,'fetch');
    const body=mode==='media'?{messages:[{role:'user',content:[{type:'text',text:'hello'},{type:'image_url',image_url:{url:'https://example.invalid/media'}}]}]}:
      mode==='hosted'?{tools:[{type:'web_search'}]}:{unknown_billing_option:1};
    const response=await f.request({ingress:'chat',body});expect(response.status).toBe(503);expect(f.posts).toBe(0);
    expect(fetch).not.toHaveBeenCalled();expect(f.db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
  it('uses saved strict HTTP proxy for an intended native POST',async()=>{
    const f=await setup(engine,{proxy:true});const response=await f.request();expect(response.status).toBe(200);
    expect((await response.json()).usage).toEqual(rawResponsesUsage());expect(f.posts).toBe(1);expect(f.connects).toBeGreaterThan(0);
    expect(f.db.get('SELECT state FROM apiKeyAccounting').state).toBe('settled');
  });
  it('refuses configured credential header override before POST',async()=>{
    const f=await setup(engine,{settings:{providerOverrides:{'openai-compatible-chat-accounting-fixture':{headers:{Authorization:'Bearer changed'}}}}});
    const response=await f.request();expect(response.status).toBe(503);expect(f.posts).toBe(0);
  });
  it('does not activate from client-supplied accounting/profile/usage fields',async()=>{
    const f=await setup(engine);const response=await f.request({accounting:false,body:{apiKeyId:'key-two',profile:'openai-responses-explicit-details',
      accounting:true,usage:rawResponsesUsage()}});
    expect(response.status).toBe(200);await response.text();expect(f.posts).toBe(1);expect(f.db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
  it.each(['intent','terminal'])('does not trust a visible row after lost own %s ACK',async kind=>{
    const f=await setup(engine);const response=await f.request({hooks:{[`${kind}Ack`]:()=>{throw new Error('lost delivery');}}});
    expect(response.status).toBe(503);expect(f.posts).toBe(kind==='intent'?0:1);
    expect(f.db.get('SELECT state FROM apiKeyAccounting').state).toBe(kind==='intent'?'pending':'settled');
  });
  it.each([
    "UPDATE apiKeys SET isActive=0 WHERE id='key-one'",
    "UPDATE apiKeys SET key='rotated' WHERE id='key-one'",
    "UPDATE apiKeys SET accessRestricted=1,accessAllow='[]' WHERE id='key-one'",
    "UPDATE providerConnections SET isActive=0 WHERE id='connection-one'",
    "INSERT INTO kv(scope,key,value) VALUES('modelAliases','fixture-alias','\"fixture-node/other\"')",
    "UPDATE providerNodes SET data=json_set(data,'$.apiType','chat')",
    "UPDATE providerConnections SET data=json_set(data,'$.apiKey','changed')",
  ])('refuses persisted selection drift after own intent await: %s',async sql=>{
    const f=await setup(engine);const response=await f.request({hooks:{intentAck:()=>f.db.durableTransaction(()=>f.db.run(sql))}});
    expect(response.status).toBe(503);expect(f.posts).toBe(0);expect(f.db.get('SELECT state FROM apiKeyAccounting').state).toBe('not_dispatched');
  });
  it('refuses saved proxy pool drift after intent ACK before any CONNECT/POST',async()=>{
    const f=await setup(engine,{proxy:true});const response=await f.request({hooks:{intentAck:()=>f.db.durableTransaction(()=>
      f.db.run("UPDATE proxyPools SET isActive=0 WHERE id='pool-one'"))}});
    expect(response.status).toBe(503);expect(f.posts).toBe(0);expect(f.connects).toBe(0);
  });
  it('freezes unassociated native JSON presentation with no accounting authority', async () => {
    const f = await setup(engine);
    const response = await f.request({ accounting:false });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.object).toBe('response'); expect(json.usage.input_tokens).toBe(3000);
    expect(json.usage).not.toHaveProperty('total_tokens');
    expect(f.posts).toBe(1); expect(f.requests[0].url).toBe('/v1/responses');
    expect(f.db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
});
