import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { parseBudgetPolicy } from '../../src/lib/accounting/budget-policy.js';
import { updateAccountingPolicy, readAccountingPolicy } from '../../src/lib/db/helpers/accounting-policy.js';
import { openFixture, addKey } from '../fixtures/accounting/test-database.js';

let fixture;
afterEach(()=>{if(fixture){fixture.db.close();fs.rmSync(fixture.root,{recursive:true,force:true});fixture=null;}});
const body=(weeklyLimitUsd=null,monthlyLimitUsd=null,expectedVersion=1)=>({weeklyLimitUsd,monthlyLimitUsd,expectedVersion});
describe('exact complete budget ingress',()=>{
  it.each([[null,null],['0','0'],['0.000000001','1'],['9000000','9000000000000000'],['1.000000000','1000000000']])('parses %s exactly',(input,nano)=>{
    expect(parseBudgetPolicy(body(input))).toEqual({weeklyLimitNanoUsd:nano===null?null:Number(nano),monthlyLimitNanoUsd:null,expectedVersion:1});
  });
  it.each([0,1,-1,NaN,Infinity,{},[],true,'',' 1','1 ','-1','+1','.1','1.','01','1e2','0.0000000001','9000000.000000001','9000001'])('rejects invalid limit %s',value=>{expect(()=>parseBudgetPolicy(body(value))).toThrow();});
  it.each([null,{},[],{weeklyLimitUsd:null}, {...body(),extra:true},{...body(),apiKeyId:'key-one'},body(null,null,0),body(null,null,1.1),body(null,null,'1'),body(null,null,Number.MAX_SAFE_INTEGER)])('rejects incomplete/extra/version input %#',value=>{expect(()=>parseBudgetPolicy(value)).toThrow();});
});
for(const engine of ['node','sqljs'])describe(`${engine} budget policy CAS`,()=>{
  async function setup(){fixture=await openFixture(engine);addKey(fixture.db);return fixture.db;}
  it('changes only policy, preserves zero/null, no-op current version, stale conflict',async()=>{
    const db=await setup(), before=readAccountingPolicy(db,'key-one');
    expect(updateAccountingPolicy(db,'key-one',parseBudgetPolicy(body()),'2026-10-28T00:00:00.000Z').version).toBe(1);
    expect(readAccountingPolicy(db,'key-one').updatedAt).toBe(before.updatedAt);
    const changed=updateAccountingPolicy(db,'key-one',parseBudgetPolicy(body('0','1.000000001')),'2026-10-28T00:00:00.000Z');
    expect(changed).toMatchObject({weeklyLimitNanoUsd:0,monthlyLimitNanoUsd:1000000001,version:2,updatedAt:'2026-10-28T00:00:00.000Z',unlimited:false});
    expect(()=>updateAccountingPolicy(db,'key-one',parseBudgetPolicy(body('0','1.000000001')),'2026-10-28T01:00:00.000Z')).toThrow(/conflict/i);
    expect(readAccountingPolicy(db,'key-one')).toEqual(changed);
    expect(updateAccountingPolicy(db,'key-one',parseBudgetPolicy(body(null,null,2)),'2026-10-28T02:00:00.000Z')).toMatchObject({version:3,unlimited:true});
    expect(db.get('SELECT count(*) AS n FROM apiKeys').n).toBe(1);expect(db.get('SELECT count(*) AS n FROM apiKeyAccounting').n).toBe(0);
  });
  it('does not upsert missing initialized policy',async()=>{
    const db=await setup();db.durableTransaction(()=>db.run("DELETE FROM apiKeyBudgetPolicies WHERE apiKeyId='key-one'"));
    expect(()=>updateAccountingPolicy(db,'key-one',parseBudgetPolicy(body()),'2026-10-28T00:00:00.000Z')).toThrow(/policy unavailable/i);
    expect(db.get('SELECT count(*) AS n FROM apiKeyBudgetPolicies').n).toBe(0);
  });
  it('retains policy/identity through close and reopen',async()=>{
    const db=await setup();const saved=updateAccountingPolicy(db,'key-one',parseBudgetPolicy(body('9000000','0')),'2026-10-28T00:00:00.000Z');
    const binding=db.get('SELECT fingerprint FROM apiKeyBindings');db.close();fixture=await openFixture(engine,fixture.file);
    expect(readAccountingPolicy(fixture.db,'key-one')).toEqual(saved);expect(fixture.db.get('SELECT fingerprint FROM apiKeyBindings').fingerprint).toBe(binding.fingerprint);
  });
});
