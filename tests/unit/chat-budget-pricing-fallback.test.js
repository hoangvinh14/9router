import { afterEach, describe, expect, it, vi } from 'vitest';
import { openChatFixture, fixtureProvider } from '../fixtures/accounting/chat-loopback.js';
import { updateAccountingPolicy } from '../../src/lib/db/helpers/accounting-policy.js';
import { parseBudgetPolicy } from '../../src/lib/accounting/budget-policy.js';
let fixture;
afterEach(async()=>{vi.unstubAllEnvs();if(fixture){await fixture.close();fixture=null;}});
for(const engine of ['node','sqljs'])describe(`${engine} price-only candidate fallback`,()=>{
  async function setup(limit){for(const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'])vi.stubEnv(name,'');fixture=await openChatFixture(engine);const f=fixture;
    updateAccountingPolicy(f.db,'key-one',parseBudgetPolicy({weeklyLimitUsd:limit,monthlyLimitUsd:null,expectedVersion:1}),'2026-10-25T16:00:00.000Z');
    f.db.durableTransaction(()=>f.db.run('INSERT INTO combos(id,name,models,createdAt,updatedAt) VALUES(?,?,?,?,?)',['budget-combo','BudgetCombo',JSON.stringify(['fixture-node/missing-price','fixture-node/fixture']),'2026-10-25T16:00:00.000Z','2026-10-25T16:00:00.000Z']));return f;
  }
  it('missing price skips candidate without POST/cooldown, priced member succeeds',async()=>{
    const f=await setup('1'),before=JSON.parse(f.db.get('SELECT data FROM providerConnections').data);const response=await f.request({model:'BudgetCombo',clock:()=> '2026-10-25T16:00:00.000Z'});
    expect(response.status).toBe(200);await response.text();expect(f.posts).toBe(1);expect(f.db.all('SELECT provider,model,state FROM apiKeyAccounting')).toMatchObject([{provider:fixtureProvider,model:'fixture',state:'settled'}]);
    const after=JSON.parse(f.db.get('SELECT data FROM providerConnections').data);expect(after.lastError).toBe(before.lastError);expect(after.modelLock_missing).toBeUndefined();
  });
  it('exhausted is terminal even when first candidate lacks price',async()=>{
    const f=await setup('0');const response=await f.request({model:'BudgetCombo',clock:()=> '2026-10-25T16:00:00.000Z'});
    expect(response.status).toBe(429);expect((await response.json()).error.code).toBe('api_key_budget_exceeded');expect(f.posts).toBe(0);expect(f.db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
  });
});
