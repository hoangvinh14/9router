import { afterEach, describe, expect, it, vi } from 'vitest';
import { openChatFixture, jsonReply, gate, observe, reach } from '../fixtures/accounting/chat-loopback.js';
import { updateAccountingPolicy } from '../../src/lib/db/helpers/accounting-policy.js';
import { parseBudgetPolicy } from '../../src/lib/accounting/budget-policy.js';

let fixture;
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllEnvs();if(fixture){await fixture.close();fixture=null;}});
for(const engine of ['node','sqljs'])describe(`${engine} actual budget failure controls`,()=>{
  async function setup(options){for(const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'])vi.stubEnv(name,'');fixture=await openChatFixture(engine,options);let now='2026-10-31T16:59:59.999Z';return {f:fixture,clock:()=>now,setNow:value=>{now=value;},policy:(w,m=null,v=1)=>updateAccountingPolicy(fixture.db,'key-one',parseBudgetPolicy({weeklyLimitUsd:w,monthlyLimitUsd:m,expectedVersion:v}),now)};}
  it.each([['weekly','1',null,'2026-11-01T17:00:00.000Z'],['monthly',null,'1','2026-10-31T17:00:00.000Z'],['both','1','1','2026-11-01T17:00:00.000Z']])('refuses held %s rollover and preserves local ACK',async(_dimension,w,m,after)=>{
    const {f,clock,setNow,policy}=await setup();policy(w,m);let acknowledgements=0;
    const response=await f.request({clock,hooks:{intentAck:()=>setNow(after),terminalAck:()=>{acknowledgements++;}}});
    expect(response.status).toBe(503);expect((await response.json()).error.reason).toBe('budget_window_changed');expect(f.posts).toBe(0);expect(acknowledgements).toBe(1);expect(f.db.get('SELECT state FROM apiKeyAccounting').state).toBe('not_dispatched');
    const positive=await f.request({clock});expect(positive.status).toBe(200);await positive.text();expect(f.posts).toBe(1);
  });
  it.each([['monthly','1','0.0012',['monthly']],['both','0.0012','0.0012',['weekly','monthly']]])('durable spend exhausts %s windows before next actual POST',async(_name,w,m,dimensions)=>{
    const {f,clock,setNow,policy}=await setup();setNow('2026-10-25T16:00:00.000Z');policy(w,m);
    const positive=await f.request({clock});expect(positive.status).toBe(200);await positive.text();expect(f.posts).toBe(1);
    const denied=await f.request({clock});expect(denied.status).toBe(429);const error=(await denied.json()).error;
    expect(error.code).toBe('api_key_budget_exceeded');expect(error.blockedWindows.map(window=>window.dimension)).toEqual(dimensions);
    expect(error.resetAt).toBe('2026-10-31T17:00:00.000Z');expect(denied.headers.get('retry-after')).toBe('522000');
    expect(f.posts).toBe(1);expect(f.db.all('SELECT costNanoUsd FROM apiKeyAccounting').map(row=>row.costNanoUsd)).toEqual([1200000]);
  });
  it('unsupported compatible profile returns typed native error before POST',async()=>{
    const {f,clock,policy}=await setup();policy('1');
    f.db.durableTransaction(()=>f.db.run("UPDATE providerNodes SET data=json_set(data,'$.apiType','responses')"));
    const denied=await f.request({clock});expect(denied.status).toBe(503);expect((await denied.json()).error.code).toBe('model_accounting_unsupported');expect(f.posts).toBe(0);expect(f.db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
  });
  it('rollover in unlimited dimension alone does not calendar-refuse',async()=>{
    const {f,clock,setNow,policy}=await setup();policy('1',null);
    const response=await f.request({clock,hooks:{intentAck:()=>setNow('2026-10-31T17:00:00.000Z')}});expect(response.status).toBe(200);await response.text();expect(f.posts).toBe(1);
  });
  it('durability failure in no-exposure cleanup supersedes budget denial safely',async()=>{
    const {f,clock,policy}=await setup();policy('0.0012');const entered=gate(),hold=gate();
    const pending=observe(f.request({clock,hooks:{intentAck:async()=>{entered.release();await hold.promise;},terminalAck:()=>{throw new Error('own cleanup ACK unavailable');}}}));
    try{await reach(entered,pending);const peer=await f.request({clock});expect(peer.status).toBe(200);await peer.text();hold.release();const result=await pending;if(!result.ok)throw result.error;expect(result.value.status).toBe(503);expect((await result.value.json()).error.code).toBe('api_key_accounting_unavailable');expect(f.posts).toBe(1);}
    finally{hold.release();await pending;}
  });
  it('failed HTTP exact usage charges before actual account successor gate',async()=>{
    const {f,clock,policy}=await setup({respond:(_req,res)=>{res.statusCode=402;res.setHeader('content-type','application/json');res.end(JSON.stringify({error:{message:'credit exhausted'},usage:jsonReply().usage}));}});policy('0.0012');
    f.db.durableTransaction(()=>f.db.run("INSERT INTO providerConnections SELECT 'connection-two',provider,authType,name,email,2,isActive,data,createdAt,updatedAt FROM providerConnections WHERE id='connection-one'"));
    const response=await f.request({clock});expect(response.status).toBe(429);expect((await response.json()).error.code).toBe('api_key_budget_exceeded');expect(f.posts).toBe(1);expect(f.db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toMatchObject({state:'settled',costNanoUsd:1200000});
  });
  it('finite policy edit held after intent refuses without new allowance; new policy can admit',async()=>{
    const {f,clock,policy}=await setup();policy('1');const response=await f.request({clock,hooks:{intentAck:()=>policy('2',null,2)}});
    expect(response.status).toBe(503);expect(f.posts).toBe(0);expect(f.db.get('SELECT state FROM apiKeyAccounting').state).toBe('not_dispatched');
    const positive=await f.request({clock});expect(positive.status).toBe(200);await positive.text();expect(f.posts).toBe(1);
  });
});
