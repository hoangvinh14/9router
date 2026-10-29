import { afterEach, describe, expect, it, vi } from 'vitest';
import { openChatFixture, jsonReply, gate, observe, reach } from '../fixtures/accounting/chat-loopback.js';
import { openFixture } from '../fixtures/accounting/test-database.js';
import { updateAccountingPolicy } from '../../src/lib/db/helpers/accounting-policy.js';
import { parseBudgetPolicy } from '../../src/lib/accounting/budget-policy.js';
import { sumSpendSync } from '../../src/lib/db/repos/api-key-accounting-repo.js';

let fixture;
afterEach(async()=>{vi.unstubAllEnvs();if(fixture){await fixture.close();fixture=null;}});
for(const engine of ['node','sqljs'])describe(`${engine} actual JSON calendar budget`,()=>{
  async function setup(options){for(const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'])vi.stubEnv(name,'');fixture=await openChatFixture(engine,options);let now='2026-10-25T16:00:00.000Z';const clock=()=>now;
    return {...fixture,request:options=>fixture.request({...options,clock}),setNow:value=>{now=value;},policy:(w,m=null,version=1)=>updateAccountingPolicy(fixture.db,'key-one',parseBudgetPolicy({weeklyLimitUsd:w,monthlyLimitUsd:m,expectedVersion:version}),now)};
  }
  it('actual debit→native429 headers→raise/null/re-enable without resetting spend',async()=>{
    const f=await setup();f.policy('0.0012');const first=await f.request();expect(first.status).toBe(200);await first.text();
    const denied=await f.request();expect(denied.status).toBe(429);const error=(await denied.json()).error;
    expect(error).toMatchObject({code:'api_key_budget_exceeded',timezone:'Asia/Ho_Chi_Minh',requiresPolicyChange:false,blockedWindows:[{dimension:'weekly',spentUsd:'0.0012'}]});
    expect(denied.headers.get('cache-control')).toBe('no-store');expect(denied.headers.get('x-request-id')).toBe(error.requestId);expect(Number(denied.headers.get('retry-after'))).toBeGreaterThan(0);expect(denied.headers.get('access-control-expose-headers')).toContain('Retry-After');expect(fixture.posts).toBe(1);
    f.policy('0.003',null,2);const raised=await f.request();expect(raised.status).toBe(200);await raised.text();expect(fixture.posts).toBe(2);
    f.policy(null,null,3);const unlimited=await f.request();expect(unlimited.status).toBe(200);await unlimited.text();f.policy('0.0012',null,4);
    expect((await f.request()).status).toBe(429);expect(fixture.posts).toBe(3);expect(f.db.all('SELECT costNanoUsd FROM apiKeyAccounting')).toHaveLength(3);
  });
  it('held ACK sees peer exhaustion and final not-dispatched own ACK',async()=>{
    const f=await setup();f.policy('0.0012');const entered=gate(),hold=gate();let terminals=0;
    const pending=observe(f.request({hooks:{intentAck:async()=>{entered.release();await hold.promise;},terminalAck:()=>{terminals++;}}}));
    try{await reach(entered,pending);const peer=await f.request();expect(peer.status).toBe(200);await peer.text();hold.release();const result=await pending;if(!result.ok)throw result.error;
      expect(result.value.status).toBe(429);expect((await result.value.json()).error.code).toBe('api_key_budget_exceeded');expect(fixture.posts).toBe(1);expect(terminals).toBe(1);expect(f.db.all('SELECT state FROM apiKeyAccounting').map(row=>row.state).sort()).toEqual(['not_dispatched','settled']);
    }finally{hold.release();await pending;}
  });
  it('held finite rollover refuses no POST; new request starts new window',async()=>{
    const f=await setup();f.policy('1');const denied=await f.request({hooks:{intentAck:()=>f.setNow('2026-10-25T17:00:00.000Z')}});
    expect(denied.status).toBe(503);expect((await denied.json()).error).toMatchObject({code:'api_key_accounting_unavailable',reason:'budget_window_changed'});expect(fixture.posts).toBe(0);expect(f.db.get('SELECT state,startedAt FROM apiKeyAccounting')).toMatchObject({state:'not_dispatched',startedAt:'2026-10-25T16:00:00.000Z'});
    const positive=await f.request();expect(positive.status).toBe(200);await positive.text();expect(fixture.posts).toBe(1);
  });
  it('late exact settlement stays in original startedAt window after reset',async()=>{
    let f;f=await setup({respond:(_req,res)=>{f.setNow('2026-10-25T17:00:00.000Z');res.setHeader('content-type','application/json');res.end(JSON.stringify(jsonReply()));}});f.policy('0.0012');
    const first=await f.request();expect(first.status).toBe(200);await first.text();expect(sumSpendSync(f.db,'key-one','2026-10-18T17:00:00.000Z','2026-10-25T17:00:00.000Z')).toBe('1200000');expect(sumSpendSync(f.db,'key-one','2026-10-25T17:00:00.000Z','2026-11-01T17:00:00.000Z')).toBe('0');
    const second=await f.request();expect(second.status).toBe(200);await second.text();expect(fixture.posts).toBe(2);expect((await f.request()).status).toBe(429);
  });
  it('unknown remains null and blocks finite after reset/reopen; key-two unaffected',async()=>{
    const f=await setup({respond:(_req,res)=>{const body=jsonReply();delete body.usage;res.setHeader('content-type','application/json');res.end(JSON.stringify(body));}});f.policy('1');const first=await f.request();expect(first.status).toBe(200);await first.text();
    f.setNow('2027-01-01T00:00:00.000Z');const denied=await f.request();expect(denied.status).toBe(503);expect((await denied.json()).error.code).toBe('api_key_accounting_unresolved');expect(denied.headers.get('retry-after')).toBeNull();expect(fixture.posts).toBe(1);
    expect(f.db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toMatchObject({state:'unresolved',costNanoUsd:null});const other=await f.request({key:'fixture-secret-two'});expect(other.status).toBe(200);await other.text();expect(fixture.posts).toBe(2);
    const file=f.file;f.db.close();const reopened=await openFixture(engine,file);try{expect(reopened.db.get("SELECT state FROM apiKeyAccounting WHERE apiKeyId='key-one'").state).toBe('unresolved');}finally{reopened.db.close();}
  });
  it('upstream lookalike budget code is not trusted local denial',async()=>{
    const f=await setup({respond:(_req,res)=>{res.statusCode=400;res.setHeader('content-type','application/json');res.end(JSON.stringify({error:{message:'upstream lookalike',code:'api_key_budget_exceeded'},usage:jsonReply().usage}));}});f.policy('1');const response=await f.request();expect(response.status).toBe(400);expect(fixture.posts).toBe(1);expect(f.db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toMatchObject({state:'settled',costNanoUsd:1200000});
  });
});
