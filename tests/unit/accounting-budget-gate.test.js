import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { openFixture, addKey, exactUsage } from '../fixtures/accounting/test-database.js';
import { createAccountingService } from '../../src/lib/accounting/service.js';
import { updateAccountingPolicy } from '../../src/lib/db/helpers/accounting-policy.js';
import { parseBudgetPolicy } from '../../src/lib/accounting/budget-policy.js';

let fixture;
afterEach(()=>{if(fixture){fixture.db.close();fs.rmSync(fixture.root,{recursive:true,force:true});fixture=null;}});
for(const engine of ['node','sqljs'])describe(`${engine} exact recorded-spend gate`,()=>{
  async function setup(weekly='0.0012',monthly=null){
    fixture=await openFixture(engine);const {db}=fixture;addKey(db);addKey(db,'key-two','other-secret');
    db.durableTransaction(()=>db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','openai',?)",[JSON.stringify({fixture:{input:'1',output:'2'}})]));
    let now='2026-10-25T16:00:00.000Z';
    const policy=(w,m,version=1)=>updateAccountingPolicy(db,'key-one',parseBudgetPolicy({weeklyLimitUsd:w,monthlyLimitUsd:m,expectedVersion:version}),now);
    policy(weekly,monthly);
    const service=createAccountingService(db),candidate={provider:'openai',model:'fixture',endpoint:'chat'};
    const context=(id='key-one')=>service.createContext({apiKeyId:id,validateAuthoritySync:()=>true,clock:()=>now});
    const begin=(id)=>service.beginAttempt(context(id),candidate);
    const finish=(receipt)=>service.completeAttempt(receipt,{state:'settled',outcome:'success',finishedAt:now,usage:exactUsage()});
    return {db,service,candidate,context,begin,finish,policy,setNow:value=>{now=value;}};
  }
  it('charges exact then refuses next before insert, other key unaffected',async()=>{
    const f=await setup();const receipt=await f.begin();await f.finish(receipt);
    await expect(f.begin()).rejects.toMatchObject({status:429,code:'api_key_budget_exceeded',metadata:{timezone:'Asia/Ho_Chi_Minh',requiresPolicyChange:false}});
    expect(f.db.get('SELECT count(*) AS n FROM apiKeyAccounting').n).toBe(1);
    const other=await f.begin('key-two');await f.finish(other);expect(f.db.get('SELECT count(*) AS n FROM apiKeyAccounting').n).toBe(2);
  });
  it('zero blocks with advisory reset, unlimited still records',async()=>{
    const f=await setup('0','0');await expect(f.begin()).rejects.toMatchObject({status:429,metadata:{requiresPolicyChange:true}});
    f.setNow('2027-01-01T00:00:00.000Z');await expect(f.begin()).rejects.toMatchObject({code:'api_key_budget_exceeded'});
    f.policy(null,null,2);const receipt=await f.begin();await f.finish(receipt);expect(f.db.get('SELECT costNanoUsd FROM apiKeyAccounting').costNanoUsd).toBe(1200000);
  });
  it('checks both windows and uses latest blocked reset',async()=>{
    const f=await setup('0','0');try{await f.begin();throw new Error('must deny');}catch(error){expect(error.metadata.blockedWindows.map(w=>w.dimension)).toEqual(['weekly','monthly']);expect(error.metadata.resetAt).toBe('2026-10-31T17:00:00.000Z');expect(error.retryAfter).toBe(522000);}
  });
  it('pending is not reservation; exact overshoot blocks successor',async()=>{
    const f=await setup();const receipts=await Promise.all([f.begin(),f.begin()]);expect(receipts).toHaveLength(2);
    await Promise.all(receipts.map(f.finish));expect(f.db.all('SELECT state,costNanoUsd FROM apiKeyAccounting').map(r=>r.costNanoUsd)).toEqual([1200000,1200000]);
    await expect(f.begin()).rejects.toMatchObject({code:'api_key_budget_exceeded'});
  });
  it('fresh final gate sees peer settlement after own intent',async()=>{
    const f=await setup();const heldContext=f.context(),held=await f.service.beginAttempt(heldContext,f.candidate),peer=await f.begin();await f.finish(peer);
    expect(()=>f.service.assertDispatchAuthority(held,heldContext)).toThrow();
    await f.service.completeAttempt(held,{state:'not_dispatched',outcome:'local_refusal',finishedAt:'2026-10-25T16:00:00.000Z',notDispatchedEvidence:'No invocation'});
    expect(f.db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?',[held.attemptId]).state).toBe('not_dispatched');
  });
  it('finite rollover refuses without redate; unlimited dimension can roll',async()=>{
    const f=await setup('10',null),context=f.context(),receipt=await f.service.beginAttempt(context,f.candidate);
    expect(f.db.get('SELECT startedAt FROM apiKeyAccounting').startedAt).toBe('2026-10-25T16:00:00.000Z');
    f.setNow('2026-10-25T17:00:00.000Z');try{f.service.assertDispatchAuthority(receipt,context);throw new Error('must refuse');}catch(error){expect(error).toMatchObject({code:'api_key_accounting_unavailable',metadata:{reason:'budget_window_changed'}});}
    f.policy(null,'10',2);const monthlyContext=f.context(),monthly=await f.service.beginAttempt(monthlyContext,f.candidate);
    f.setNow('2026-11-01T17:00:00.000Z');expect(()=>f.service.assertDispatchAuthority(monthly,monthlyContext)).toThrow();
    f.policy(null,null,3);const unlimitedContext=f.context(),unlimited=await f.service.beginAttempt(unlimitedContext,f.candidate);
    f.setNow('2027-01-01T00:00:00.000Z');expect(f.service.assertDispatchAuthority(unlimited,unlimitedContext)).toBe(true);
  });
  it('policy drift refuses held dispatch but terminal survives edits',async()=>{
    const f=await setup('10'),context=f.context(),receipt=await f.service.beginAttempt(context,f.candidate);f.policy(null,null,2);
    expect(()=>f.service.assertDispatchAuthority(receipt,context)).toThrow();await f.finish(receipt);
    expect(f.db.get('SELECT costNanoUsd FROM apiKeyAccounting').costNanoUsd).toBe(1200000);
  });
  it('all-lifetime unresolved blocks finite across reset/reopen but not unlimited',async()=>{
    const f=await setup('10'),receipt=await f.begin();await f.service.completeAttempt(receipt,{state:'unresolved',outcome:'network_unknown',finishedAt:'2026-10-25T16:00:00.000Z'});
    f.setNow('2027-01-01T00:00:00.000Z');await expect(f.begin()).rejects.toMatchObject({code:'api_key_accounting_unresolved'});
    f.policy(null,null,2);await f.finish(await f.begin());f.policy('10',null,3);await expect(f.begin()).rejects.toMatchObject({code:'api_key_accounting_unresolved'});
    const file=fixture.file;f.db.close();fixture=await openFixture(engine,file);
    const service=createAccountingService(fixture.db),context=service.createContext({apiKeyId:'key-one',validateAuthoritySync:()=>true,clock:()=> '2027-01-01T00:00:00.000Z'});
    await expect(service.beginAttempt(context,f.candidate)).rejects.toMatchObject({code:'api_key_accounting_unresolved'});
  });
  it('mutation captures admitted instant, not enqueue instant',async()=>{
    const f=await setup('10'),context=f.context(),pending=f.service.beginAttempt(context,f.candidate);
    f.setNow('2026-10-25T17:00:00.000Z');const receipt=await pending;
    expect(f.db.get('SELECT startedAt FROM apiKeyAccounting').startedAt).toBe('2026-10-25T17:00:00.000Z');expect(f.service.assertDispatchAuthority(receipt,context)).toBe(true);
  });
  it('queue member rechecks peer settlement committed after quick eligibility',async()=>{
    const f=await setup();const peer=await f.begin();
    const settlement=f.finish(peer),pending=f.begin();
    await settlement;await expect(pending).rejects.toMatchObject({code:'api_key_budget_exceeded'});
    expect(f.db.get('SELECT count(*) AS n FROM apiKeyAccounting').n).toBe(1);
  });
  it('retains original pricing after policy/reset/price edits and duplicate late evidence',async()=>{
    const f=await setup('10'),receipt=await f.begin();f.setNow('2026-11-01T17:00:00.000Z');f.policy(null,null,2);
    f.db.durableTransaction(()=>f.db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='openai'",[JSON.stringify({fixture:{input:'9',output:'9'}})]));
    await f.finish(receipt);await f.finish(receipt);
    const row=f.db.get('SELECT costNanoUsd,startedAt FROM apiKeyAccounting');expect(String(row.costNanoUsd)).toBe('1200000');expect(row.startedAt).toBe('2026-10-25T16:00:00.000Z');expect(f.db.get('SELECT count(*) AS n FROM apiKeyAccounting').n).toBe(1);
  });
  it('exhaustion/unresolved precedence before missing price',async()=>{
    const f=await setup('0');await expect(f.service.beginAttempt(f.context(),{...f.candidate,model:'missing-price'})).rejects.toMatchObject({code:'api_key_budget_exceeded'});
  });
});
