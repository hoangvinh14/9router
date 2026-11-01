import { afterEach,describe,expect,it,vi } from 'vitest';
import { openEmbeddingsFixture,embeddingsReply,gate,observe,reach } from '../fixtures/accounting/embeddings-loopback.js';
import { updateAccountingPolicy } from '../../src/lib/db/helpers/accounting-policy.js';
import { parseBudgetPolicy } from '../../src/lib/accounting/budget-policy.js';
import { associateBudgetManagementFixture,captureBudgetManagement,getBudgetManagement } from '../../src/lib/accounting/budget-management.js';
import { projectBudget } from '../../src/lib/accounting/budget-projection.js';
let fixture;
async function setup(engine,options){
  for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'])vi.stubEnv(key,'');
  fixture=await openEmbeddingsFixture(engine,options);let now='2026-10-25T16:59:00.000Z';
  return {...fixture,request:options=>fixture.request({...options,clock:()=>now}),setNow:value=>now=value,
    policy:(weekly,monthly=null,version=1)=>updateAccountingPolicy(fixture.db,'key-one',parseBudgetPolicy({weeklyLimitUsd:weekly,monthlyLimitUsd:monthly,expectedVersion:version}),now),
    projection:()=>projectBudget(fixture.db,'key-one',{weeklyLimitNanoUsd:fixture.db.get("SELECT weeklyLimitNanoUsd FROM apiKeyBudgetPolicies WHERE apiKeyId='key-one'").weeklyLimitNanoUsd,
      monthlyLimitNanoUsd:fixture.db.get("SELECT monthlyLimitNanoUsd FROM apiKeyBudgetPolicies WHERE apiKeyId='key-one'").monthlyLimitNanoUsd},now)};
}
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllEnvs();if(fixture){await fixture.close();fixture=null;}});
for(const engine of ['node','sqljs'])describe(`${engine} actual Embeddings recorded-spend budget`,()=>{
  it.each([['0.001',null], [null,'0.001'],['0.001','0.001']])('enforces weekly=%s monthly=%s independently and raises without reset',async(w,m)=>{
    const f=await setup(engine);f.policy(w,m);const first=await f.request();expect(first.status).toBe(200);await first.text();
    const denied=await f.request();expect(denied.status).toBe(429);expect((await denied.json()).error.code).toBe('api_key_budget_exceeded');expect(fixture.posts).toBe(1);
    expect(f.projection().monthly.spentUsd).toBe('0.001');
    f.policy(w===null?null:'0.003',m===null?null:'0.003',2);const raised=await f.request();expect(raised.status).toBe(200);await raised.text();
    expect(f.projection().monthly.spentUsd).toBe('0.002');expect(fixture.posts).toBe(2);
  });
  it('batch is a single aggregate debit and raising only weekly cannot override exhausted monthly',async()=>{
    const f=await setup(engine);f.policy('0.001','0.001');const first=await f.request({body:{input:['one','two']}});expect(first.status).toBe(200);await first.text();
    expect(fixture.posts).toBe(1);expect(f.db.all('SELECT costNanoUsd FROM apiKeyAccounting')).toEqual([{costNanoUsd:1000000}]);
    f.policy('0.01','0.001',2);const denied=await f.request();expect(denied.status).toBe(429);expect(fixture.posts).toBe(1);expect(f.projection().monthly.spentUsd).toBe('0.001');
  });
  it('peer key settles while first key holds own intent; no cross-charge or reservation',async()=>{
    const f=await setup(engine),entered=gate(),hold=gate();const pending=observe(f.request({hooks:{intentAck:async()=>{entered.release();await hold.promise;}}}));
    try{await reach(entered,pending);const peer=await f.request({key:'fixture-secret-two'});expect(peer.status).toBe(200);await peer.text();
      expect(f.db.get("SELECT costNanoUsd FROM apiKeyAccounting WHERE apiKeyId='key-two'").costNanoUsd).toBe(1000000);hold.release();const result=await pending;if(!result.ok)throw result.error;expect(result.value.status).toBe(200);
      expect(f.db.all('SELECT apiKeyId,costNanoUsd FROM apiKeyAccounting ORDER BY apiKeyId')).toEqual([{apiKeyId:'key-one',costNanoUsd:1000000},{apiKeyId:'key-two',costNanoUsd:1000000}]);
    }finally{hold.release();await pending;}
  });
  it('management projection exposes actual embeddings recorded cost through the same verified capability',async()=>{
    const f=await setup(engine);f.policy('0.001');await (await f.request()).text();
    const request=new Request('http://localhost/api/keys/key-one/budget');associateBudgetManagementFixture(request,f.db,
      {clock:()=> '2026-10-25T16:59:00.000Z',coverageStartedAt:'2026-10-01T00:00:00.000Z'});
    const data=getBudgetManagement(await captureBudgetManagement(request),'key-one');
    expect(data.weekly.spentUsd).toBe('0.001');expect(data.weekly.remainingUsd).toBe('0');
    expect(data.eligibility).toEqual({eligible:false,blockReason:'api_key_budget_exceeded'});expect(data.enforcementActive).toBe(true);
    expect(JSON.stringify(data)).not.toContain('provider-secret');
  });
  it('guarded budget GET reads embeddings spend and rejects unauthenticated management access',async()=>{
    const f=await setup(engine);await (await f.request()).text();vi.stubEnv('JWT_SECRET','isolated-r1-dashboard-secret');
    const {NextRequest}=await import('next/server');const {createDashboardAuthToken}=await import('../../src/lib/auth/dashboardSession.js');
    const route=await import('../../src/app/api/keys/[id]/budget/route.js');const token=await createDashboardAuthToken();
    const origin='http://localhost:20128';const req=new NextRequest(origin+'/api/keys/key-one/budget',
      {headers:{host:'localhost:20128',cookie:`auth_token=${token}`}});
    associateBudgetManagementFixture(req,f.db,{clock:()=> '2026-10-25T16:59:00.000Z',coverageStartedAt:'2026-10-01T00:00:00.000Z'});
    const result=await route.GET(req,{params:Promise.resolve({id:'key-one'})});expect(result.status).toBe(200);
    expect((await result.json()).weekly.spentUsd).toBe('0.001');expect(result.headers.get('cache-control')).toBe('no-store');
    const denied=await route.GET(new NextRequest(origin+'/api/keys/key-one/budget',{headers:{host:'localhost:20128'}}),{params:Promise.resolve({id:'key-one'})});
    expect(denied.status).toBe(401);
  });
  it('OPTIONS is no inference and does not fabricate an attempt or debit',async()=>{
    const f=await setup(engine);const route=await import('../../src/app/api/v1/embeddings/route.js');const response=await route.OPTIONS();
    expect(response.status).toBe(200);expect(fixture.posts).toBe(0);expect(f.db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);expect(f.projection().monthly.spentUsd).toBe('0');
  });
  it('zero remains blocked after rollover while null still records; other key isolated',async()=>{
    const f=await setup(engine);f.policy('0','0');expect((await f.request()).status).toBe(429);f.setNow('2027-01-01T00:00:00.000Z');expect((await f.request()).status).toBe(429);expect(fixture.posts).toBe(0);
    const other=await f.request({key:'fixture-secret-two'});expect(other.status).toBe(200);await other.text();expect(fixture.posts).toBe(1);
    f.policy(null,null,2);const own=await f.request();expect(own.status).toBe(200);await own.text();expect(fixture.posts).toBe(2);expect(f.projection().monthly.spentUsd).toBe('0.001');
  });
  it('rolls Monday and month boundaries in HCM without deleting original costs',async()=>{
    const f=await setup(engine);f.policy('0.001','0.002');await (await f.request()).text();f.setNow('2026-10-25T17:00:00.000Z');await (await f.request()).text();
    expect(f.projection().previousWindows.weekly.spentUsd).toBe('0.001');expect(f.projection().weekly.spentUsd).toBe('0.001');expect(f.projection().monthly.spentUsd).toBe('0.002');
    expect((await f.request()).status).toBe(429);f.setNow('2026-11-01T17:00:00.000Z');const next=await f.request();expect(next.status).toBe(200);await next.text();
    expect(f.db.all('SELECT costNanoUsd FROM apiKeyAccounting')).toHaveLength(3);expect(f.projection().monthly.spentUsd).toBe('0.001');
  });
  it('allows in-flight overshoot without reservations but blocks next actual POST',async()=>{
    const both=gate(),hold=gate();let count=0;
    const f=await setup(engine,{respond:async(_req,res)=>{if(++count===2)both.release();await hold.promise;res.setHeader('content-type','application/json');res.end(JSON.stringify(embeddingsReply()));}});f.policy('0.001');
    const outcomes=observe(Promise.all([f.request(),f.request()]));
    try{await reach(both,outcomes);expect(fixture.posts).toBe(2);hold.release();const result=await outcomes;if(!result.ok)throw result.error;await Promise.all(result.value.map(r=>r.text()));
      expect(f.projection().weekly.spentUsd).toBe('0.002');expect(f.projection().weekly.overshootUsd).toBe('0.001');expect((await f.request()).status).toBe(429);expect(fixture.posts).toBe(2);
    }finally{hold.release();await outcomes;}
  });
  it('rechecks held intent after peer settles and records own not-dispatched ACK',async()=>{
    const f=await setup(engine);f.policy('0.001');const entered=gate(),hold=gate();
    const pending=observe(f.request({hooks:{intentAck:async()=>{entered.release();await hold.promise;}}}));
    try{await reach(entered,pending);await (await f.request()).text();hold.release();const result=await pending;if(!result.ok)throw result.error;
      expect(result.value.status).toBe(429);expect(fixture.posts).toBe(1);expect(f.db.all('SELECT state FROM apiKeyAccounting').map(r=>r.state).sort()).toEqual(['not_dispatched','settled']);
    }finally{hold.release();await pending;}
  });
});
