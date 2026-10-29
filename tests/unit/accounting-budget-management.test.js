import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { openFixture, addKey } from '../fixtures/accounting/test-database.js';
import { getBudgetManagement, putBudgetManagement, associateBudgetManagementFixture, captureBudgetManagement } from '../../src/lib/accounting/budget-management.js';
import { retireKeyBindings } from '../../src/lib/db/helpers/api-key-bindings.js';
let fixture;
afterEach(()=>{if(fixture){fixture.db.close();fs.rmSync(fixture.root,{recursive:true,force:true});fixture=null;}});
for(const engine of ['node','sqljs'])describe(`${engine} budget management composition`,()=>{
  const now='2026-10-25T16:00:00.000Z',body=(w=null,m=null,v=1)=>({weeklyLimitUsd:w,monthlyLimitUsd:m,expectedVersion:v});
  async function setup(){fixture=await openFixture(engine);addKey(fixture.db);return {db:fixture.db,clock:()=>now,coverageStartedAt:now,lifetime:fixture.db.ownerInstanceId};}
  it('production finite target refused without policy write; null-null disable/no-op truthful inactive',async()=>{
    const cap=await setup();cap.lifetime=null;cap.coverageStartedAt=null;
    expect(getBudgetManagement(cap,'key-one')).toMatchObject({version:1,enforcementActive:false,ledgerStartedAt:null,eligibility:{eligible:false,blockReason:'accounting_not_ready'}});
    for(const w of ['0','1'])expect(()=>putBudgetManagement(cap,'key-one',body(w))).toThrow(/not ready/);
    expect(putBudgetManagement(cap,'key-one',body())).toMatchObject({version:1,enforcementActive:false});
    expect(cap.db.get('SELECT version FROM apiKeyBudgetPolicies').version).toBe(1);
  });
  it('fixture saves exact policy, current no-op, stale conflict and zero projected exhausted',async()=>{
    const cap=await setup();const saved=putBudgetManagement(cap,'key-one',body('0','1.000000001'));
    expect(saved).toMatchObject({version:2,enforcementActive:true,canSetFinite:true,weekly:{limitUsd:'0',exhausted:true},monthly:{limitUsd:'1.000000001'},eligibility:{eligible:false,blockReason:'api_key_budget_exceeded'}});
    expect(putBudgetManagement(cap,'key-one',body('0','1.000000001',2)).version).toBe(2);
    expect(()=>putBudgetManagement(cap,'key-one',body())).toThrow(/conflict/);
    expect(JSON.stringify(saved)).not.toMatch(/fixture-secret|fingerprint|bindingKey|provider-secret/);
  });
  it('missing policy never repaired, unknown404, inactive/tombstone read-only',async()=>{
    const cap=await setup();expect(()=>getBudgetManagement(cap,'unknown')).toThrow(/not found/);
    cap.db.durableTransaction(()=>cap.db.run("UPDATE apiKeys SET isActive=0 WHERE id='key-one'"));expect(()=>putBudgetManagement(cap,'key-one',body())).toThrow(/inactive/);expect(getBudgetManagement(cap,'key-one').active).toBe(false);
    cap.db.durableTransaction(()=>{retireKeyBindings(cap.db,cap.db.coverage,[cap.db.get("SELECT * FROM apiKeys WHERE id='key-one'")]);cap.db.run("DELETE FROM apiKeys WHERE id='key-one'");});
    expect(getBudgetManagement(cap,'key-one')).toMatchObject({active:false,retired:true,version:1});expect(()=>putBudgetManagement(cap,'key-one',body())).toThrow(/inactive/);
    cap.db.durableTransaction(()=>cap.db.run("DELETE FROM apiKeyBudgetPolicies WHERE apiKeyId='key-one'"));expect(()=>getBudgetManagement(cap,'key-one')).toThrow(/policy unavailable/);expect(cap.db.get('SELECT count(*) AS n FROM apiKeyBudgetPolicies').n).toBe(0);
  });
  it('finite enable denies global/key gaps and maintenance without resetting policy',async()=>{
    const cap=await setup();cap.db.coverage.latchGap('key-one','Fixture unresolved gap');expect(()=>putBudgetManagement(cap,'key-one',body('1'))).toThrow(/coverage/);expect(putBudgetManagement(cap,'key-one',body()).version).toBe(1);
    expect(getBudgetManagement(cap,'key-one')).toMatchObject({canSetFinite:false,health:{gapCount:1}});
  });
  it('maintenance blocks even unlimited writes; retained retired rows are historical only',async()=>{
    const cap=await setup();cap.db.coverage.enterMaintenance('Fixture maintenance');
    expect(()=>putBudgetManagement(cap,'key-one',body())).toThrow(/maintenance/);expect(cap.db.get('SELECT version FROM apiKeyBudgetPolicies').version).toBe(1);
  });
  it('retired retained row remains readable but mismatch fails closed',async()=>{
    const cap=await setup();cap.db.durableTransaction(()=>retireKeyBindings(cap.db,cap.db.coverage,[cap.db.get("SELECT * FROM apiKeys WHERE id='key-one'")]));
    expect(getBudgetManagement(cap,'key-one')).toMatchObject({retired:true,active:false});expect(()=>putBudgetManagement(cap,'key-one',body())).toThrow(/inactive/);
    cap.db.durableTransaction(()=>cap.db.run("UPDATE apiKeys SET key='different-secret' WHERE id='key-one'"));expect(()=>getBudgetManagement(cap,'key-one')).toThrow(/mismatch/);
  });
  it('rechecks retirement inside actual transaction not prior projection',async()=>{
    const cap=await setup();expect(getBudgetManagement(cap,'key-one').active).toBe(true);
    const durable=cap.db.durableTransaction.bind(cap.db);let injected=false;
    cap.db.durableTransaction=fn=>durable(()=>{if(!injected){injected=true;cap.db.run("UPDATE apiKeys SET isActive=0 WHERE id='key-one'");}return fn();});
    expect(()=>putBudgetManagement(cap,'key-one',body('1'))).toThrow(/inactive/);expect(cap.db.get('SELECT version FROM apiKeyBudgetPolicies').version).toBe(1);
  });
  it('private association is one-shot, duplicate rejected, cloned request unready',async()=>{
    const cap=await setup(),request=new Request('http://localhost/api/keys/key-one/budget');associateBudgetManagementFixture(request,cap.db,{clock:cap.clock,coverageStartedAt:now});
    expect(()=>associateBudgetManagementFixture(request,cap.db,{clock:cap.clock,coverageStartedAt:now})).toThrow();
    const clone=request.clone();expect((await captureBudgetManagement(request)).lifetime).toBe(cap.db.ownerInstanceId);
    // Do not acquire the shared default DATA_DIR writer from a parallel test worker.
    const previous=global._dbAdapter.instance;global._dbAdapter.instance=cap.db;
    try{expect((await captureBudgetManagement(clone)).lifetime).toBeNull();expect((await captureBudgetManagement(request)).lifetime).toBeNull();}
    finally{global._dbAdapter.instance=previous;}
  });
});
