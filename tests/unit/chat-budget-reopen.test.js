import { afterEach, describe, expect, it, vi } from 'vitest';
import { openChatFixture, jsonReply } from '../fixtures/accounting/chat-loopback.js';
import { openFixture } from '../fixtures/accounting/test-database.js';
import { associateChatAccountingFixture } from '../../src/sse/services/chat-accounting.js';
import { handleChat } from '../../src/sse/handlers/chat.js';
import { updateAccountingPolicy } from '../../src/lib/db/helpers/accounting-policy.js';
import { parseBudgetPolicy } from '../../src/lib/accounting/budget-policy.js';
import { resolveAttemptSync } from '../../src/lib/db/repos/api-key-accounting-repo.js';

let fixture,reopened;
afterEach(async()=>{vi.unstubAllEnvs();if(reopened){global._dbAdapter.instance=fixture.db;reopened.db.close();reopened=null;}if(fixture){await fixture.close();fixture=null;}});
for(const engine of ['node','sqljs'])describe(`${engine} actual budget after adapter reopen`,()=>{
  const now='2026-10-25T16:00:00.000Z';
  async function setup(options){for(const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'])vi.stubEnv(name,'');fixture=await openChatFixture(engine,options);
    updateAccountingPolicy(fixture.db,'key-one',parseBudgetPolicy({weeklyLimitUsd:'0.0012',monthlyLimitUsd:null,expectedVersion:1}),now);return fixture;}
  async function reopen(){fixture.db.close();reopened=await openFixture(engine,fixture.file);global._dbAdapter.instance=reopened.db;}
  async function request(at=now){const req=new Request('http://localhost/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer fixture-secret','content-type':'application/json'},body:JSON.stringify({model:'fixture-node/fixture',stream:false,messages:[{role:'user',content:'hello'}]})});associateChatAccountingFixture(req,reopened.db,{}, {clock:()=>at});return handleChat(req);}
  it('same policy, identity and recorded threshold still refuse; new calendar window admits',async()=>{
    const f=await setup();const first=await f.request({clock:()=>now});expect(first.status).toBe(200);await first.text();const fingerprint=f.db.get("SELECT fingerprint FROM apiKeyBindings WHERE apiKeyId='key-one'").fingerprint;
    await reopen();const denied=await request();expect(denied.status).toBe(429);expect((await denied.json()).error.code).toBe('api_key_budget_exceeded');expect(f.posts).toBe(1);
    expect(reopened.db.get("SELECT fingerprint FROM apiKeyBindings WHERE apiKeyId='key-one'").fingerprint).toBe(fingerprint);expect(reopened.db.get("SELECT version FROM apiKeyBudgetPolicies WHERE apiKeyId='key-one'").version).toBe(2);
    const next=await request('2026-10-25T17:00:00.000Z');expect(next.status).toBe(200);await next.text();expect(f.posts).toBe(2);expect(reopened.db.all('SELECT costNanoUsd FROM apiKeyAccounting').map(row=>row.costNanoUsd)).toEqual([1200000,1200000]);
  });
  it('unknown blocks after reopen/reset until explicit audited waiver; successor actual POST then charges',async()=>{
    let unknown=true;const f=await setup({respond:(_req,res)=>{const body=jsonReply();if(unknown)delete body.usage;res.setHeader('content-type','application/json');res.end(JSON.stringify(body));}});
    const first=await f.request({clock:()=>now});expect(first.status).toBe(200);await first.text();await reopen();const denied=await request('2027-01-01T00:00:00.000Z');expect(denied.status).toBe(503);expect((await denied.json()).error.code).toBe('api_key_accounting_unresolved');expect(f.posts).toBe(1);
    const row=reopened.db.get('SELECT attemptId,resolutionVersion FROM apiKeyAccounting');resolveAttemptSync(reopened.db,row.attemptId,{action:'waive',operationId:'fixture-waiver',actor:'fixture-admin',reason:'Explicit test waiver',evidence:'Disposable integration control only',expectedVersion:row.resolutionVersion});
    unknown=false;const positive=await request('2027-01-01T00:00:00.000Z');expect(positive.status).toBe(200);await positive.text();expect(f.posts).toBe(2);expect(reopened.db.all('SELECT state,costNanoUsd FROM apiKeyAccounting').map(row=>({...row}))).toEqual([{state:'waived',costNanoUsd:0},{state:'settled',costNanoUsd:1200000}]);expect(reopened.db.get('SELECT count(*) AS n FROM apiKeyAccountingAudit').n).toBe(1);
  });
});
