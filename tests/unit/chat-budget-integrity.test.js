import { afterEach, describe, expect, it, vi } from 'vitest';
import { openChatFixture } from '../fixtures/accounting/chat-loopback.js';
import { updateAccountingPolicy } from '../../src/lib/db/helpers/accounting-policy.js';
import { parseBudgetPolicy } from '../../src/lib/accounting/budget-policy.js';
let fixture;
afterEach(async()=>{vi.unstubAllEnvs();if(fixture){await fixture.close();fixture=null;}});
for(const engine of ['node','sqljs'])describe(`${engine} finite authority integrity`,()=>{
  async function setup(){for(const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'])vi.stubEnv(name,'');fixture=await openChatFixture(engine);updateAccountingPolicy(fixture.db,'key-one',parseBudgetPolicy({weeklyLimitUsd:'1',monthlyLimitUsd:null,expectedVersion:1}),'2026-10-25T16:00:00.000Z');return fixture;}
  const clock=()=> '2026-10-25T16:00:00.000Z';
  it.each(['missing-policy','missing-binding','maintenance','global-gap','key-gap'])('%s never permits finite upstream or a clean replacement',async mode=>{
    const f=await setup();
    if(mode==='missing-policy')f.db.durableTransaction(()=>f.db.run("DELETE FROM apiKeyBudgetPolicies WHERE apiKeyId='key-one'"));
    else if(mode==='missing-binding')f.db.durableTransaction(()=>f.db.run("DELETE FROM apiKeyBindings WHERE apiKeyId='key-one'"));
    else if(mode==='maintenance')f.db.coverage.enterMaintenance('Fixture authority control');
    else f.db.coverage.latchGap(mode==='global-gap'?null:'key-one','Fixture unresolved coverage');
    const response=await f.request({clock});expect(response.status).toBe(503);expect((await response.json()).error.code).toBe('api_key_accounting_unavailable');expect(f.posts).toBe(0);expect(f.db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
    if(mode==='missing-policy')expect(f.db.get("SELECT * FROM apiKeyBudgetPolicies WHERE apiKeyId='key-one'")).toBeUndefined();
  });
  it('toggle/re-enable and ACL edits do not reset retained spend',async()=>{
    const f=await setup();const first=await f.request({clock});expect(first.status).toBe(200);await first.text();const binding=f.db.get("SELECT fingerprint FROM apiKeyBindings WHERE apiKeyId='key-one'").fingerprint;
    f.db.durableTransaction(()=>f.db.run("UPDATE apiKeys SET isActive=0 WHERE id='key-one'"));expect((await f.request({clock})).status).toBe(503);
    f.db.durableTransaction(()=>f.db.run("UPDATE apiKeys SET isActive=1,accessRestricted=1,accessAllow=? WHERE id='key-one'",[JSON.stringify(['fixture-node/other'])]));expect((await f.request({clock})).status).toBe(503);
    f.db.durableTransaction(()=>f.db.run("UPDATE apiKeys SET accessRestricted=0,accessAllow=NULL WHERE id='key-one'"));
    const positive=await f.request({clock});expect(positive.status).toBe(200);await positive.text();expect(f.posts).toBe(2);expect(f.db.get("SELECT fingerprint FROM apiKeyBindings WHERE apiKeyId='key-one'").fingerprint).toBe(binding);expect(f.db.all("SELECT costNanoUsd FROM apiKeyAccounting WHERE apiKeyId='key-one'").map(row=>row.costNanoUsd)).toEqual([1200000,1200000]);
  });
});
