import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { openFixture, addKey } from '../fixtures/accounting/test-database.js';
let fixture,route,keys,key,session,management,previous;
const origin='http://localhost:20128';
beforeEach(async()=>{
  vi.stubEnv('JWT_SECRET','disposable-budget-management-session');vi.stubEnv('NINEROUTER_PEER_TOKEN','fixture-peer');vi.stubEnv('NINEROUTER_MANAGEMENT_ORIGIN','');
  route=await import('../../src/app/api/keys/[id]/budget/route.js');keys=await import('../../src/app/api/keys/route.js');key=await import('../../src/app/api/keys/[id]/route.js');session=await import('../../src/lib/auth/dashboardSession.js');management=await import('../../src/lib/accounting/budget-management.js');
  previous=global._dbAdapter.instance;
});
afterEach(()=>{vi.restoreAllMocks();if(fixture){global._dbAdapter.instance=previous;fixture.db.close();fs.rmSync(fixture.root,{recursive:true,force:true});fixture=null;}vi.unstubAllEnvs();});
const context=(id='key-one')=>({params:Promise.resolve({id})});
function request(method,{token,body,headers={},path='/api/keys/key-one/budget',local=false,requestOrigin=origin}={}){
  return new NextRequest(origin+path,{method,headers:{host:'localhost:20128',...(token?{cookie:`auth_token=${token}`}:{ }),...(requestOrigin===null?{}:{origin:requestOrigin}),...(local?{'x-9r-peer-token':'fixture-peer','x-9r-real-ip':'127.0.0.1'}:{}),...headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
}
const body=(w=null,m=null,v=1)=>({weeklyLimitUsd:w,monthlyLimitUsd:m,expectedVersion:v});
for(const engine of ['node','sqljs'])describe(`${engine} actual key/budget route management security`,()=>{
  async function setup(){fixture=await openFixture(engine);addKey(fixture.db);global._dbAdapter.instance=fixture.db;fixture.db.durableTransaction(()=>fixture.db.run('INSERT INTO settings(id,data) VALUES(1,?)',[JSON.stringify({requireLogin:true})]));return fixture.db;}
  function associate(req){management.associateBudgetManagementFixture(req,fixture.db,{clock:()=> '2026-10-25T16:00:00.000Z',coverageStartedAt:'2026-10-01T00:00:00.000Z'});return req;}
  it('auth before params/body/privileged reads for budget and every key CRUD route',async()=>{
    const db=await setup(),get=vi.spyOn(db,'get'),run=vi.spyOn(db,'run');let paramsRead=false;
    const poisoned={params:{then(){paramsRead=true;throw new Error('must not resolve');}}};
    const handlers=[[route.GET,'GET'],[route.PUT,'PUT'],[keys.GET,'GET'],[keys.POST,'POST'],[key.GET,'GET'],[key.PUT,'PUT'],[key.DELETE,'DELETE']];
    for(const [handler,method]of handlers){const req=request(method,{body:['GET','DELETE'].includes(method)?undefined:'bad-json',headers:{authorization:'Bearer fixture-secret','x-9r-cli-token':'inference-token'}});const read=req.body?vi.spyOn(req.body,'getReader'):null;const json=vi.spyOn(req,'json');const response=await handler(req,poisoned);expect(response.status).toBe(401);expect(response.headers.get('cache-control')).toBe('no-store');expect(json).not.toHaveBeenCalled();if(read)expect(read).not.toHaveBeenCalled();}
    expect(paramsRead).toBe(false);expect(get).not.toHaveBeenCalled();expect(run).not.toHaveBeenCalled();
  });
  it('JWT requires same Origin before any budget body read; production finite target409 no mutation',async()=>{
    const db=await setup(),token=await session.createDashboardAuthToken();
    for(const options of [{requestOrigin:null},{requestOrigin:'https://hostile.invalid'},{headers:{'sec-fetch-site':'cross-site'}}]){const req=request('PUT',{token,body:body('1'),...options}),read=vi.spyOn(req.body,'getReader');const response=await route.PUT(req,context());expect(response.status).toBe(403);expect(read).not.toHaveBeenCalled();expect(response.headers.get('cache-control')).toBe('no-store');}
    const denied=await route.PUT(request('PUT',{token,body:body('0')}),context());expect(denied.status).toBe(409);expect((await denied.json()).code).toBe('accounting_not_ready');expect(db.get('SELECT version FROM apiKeyBudgetPolicies').version).toBe(1);
    const get=await route.GET(request('GET',{token}),context());expect(get.status).toBe(200);expect(await get.json()).toMatchObject({enforcementActive:false,ledgerStartedAt:null,weekly:{limitUsd:null,remainingUsd:null}});
  });
  it('fixture exact finite PUT/GET, stale409, invalid400, unknown404, no-store/no secrets',async()=>{
    await setup();const token=await session.createDashboardAuthToken();
    const saved=await route.PUT(associate(request('PUT',{token,body:body('0.000000001','0')})),context());expect(saved.status).toBe(200);expect(saved.headers.get('cache-control')).toBe('no-store');const data=await saved.json();expect(data).toMatchObject({version:2,enforcementActive:true,weekly:{limitUsd:'0.000000001'},monthly:{limitUsd:'0'}});expect(JSON.stringify(data)).not.toMatch(/fixture-secret|bindingKey|fingerprint/);
    expect((await route.PUT(associate(request('PUT',{token,body:body('1')})),context())).status).toBe(409);
    for(const invalid of [body(1),{...body(),extra:true},'bad-json',body('1e2')])expect((await route.PUT(request('PUT',{token,body:invalid}),context())).status).toBe(400);
    expect((await route.GET(request('GET',{token}),context('unknown'))).status).toBe(404);
  });
  it('only verified direct loopback with persisted login-disabled is allowed',async()=>{
    const db=await setup();db.durableTransaction(()=>db.run('UPDATE settings SET data=? WHERE id=1',[JSON.stringify({requireLogin:false})]));
    expect((await route.GET(request('GET',{local:true}),context())).status).toBe(200);
    for(const headers of [{'x-9r-peer-token':'forged','x-9r-real-ip':'127.0.0.1'},{'x-9r-peer-token':'fixture-peer','x-9r-real-ip':'203.0.113.1'},{'x-9r-peer-token':'fixture-peer','x-9r-real-ip':'127.0.0.1','x-9r-via-proxy':'1'}])expect((await route.GET(request('GET',{headers}),context())).status).toBe(401);
    expect((await route.GET(request('GET'),context())).status).toBe(401);
  });
});
