import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openFixture, addKey, exactUsage } from '../fixtures/accounting/test-database.js';
import { createAccountingService } from '../../src/lib/accounting/service.js';
import { updateAccountingPolicy } from '../../src/lib/db/helpers/accounting-policy.js';
import { parseBudgetPolicy } from '../../src/lib/accounting/budget-policy.js';

let fixture;
afterEach(() => { vi.restoreAllMocks(); if (fixture) { fixture.db.close(); fs.rmSync(fixture.root,{recursive:true,force:true});fixture=null; } });
for (const engine of ['node','sqljs']) describe(`${engine} detected terminal failure survives restart`,()=>{
  it.each(['settled','unresolved'])('keeps a healthy rejected %s write separate from crash absence and isolates the key',async state=>{
    fixture=await openFixture(engine);let {db}=fixture;addKey(db);addKey(db,'key-two','fixture-second');
    const now='2026-10-25T16:00:00.000Z',candidate={provider:'openai',model:'fixture',endpoint:'chat'};
    db.durableTransaction(()=>db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','openai',?)",[JSON.stringify({fixture:{input:'1',output:'2'}})]));
    updateAccountingPolicy(db,'key-one',parseBudgetPolicy({weeklyLimitUsd:'1',monthlyLimitUsd:null,expectedVersion:1}),now);
    let service=createAccountingService(db),context=service.createContext({apiKeyId:'key-one',validateAuthoritySync:()=>true,clock:()=>now});
    const receipt=await service.beginAttempt(context,candidate);service.assertDispatchAuthority(receipt,context);
    const write=db.run.bind(db);let injected=false;
    const fault=vi.spyOn(db,'run').mockImplementation((sql,params)=>{if(!injected&&sql.startsWith('UPDATE apiKeyAccounting SET state=?')){injected=true;throw new Error('healthy terminal rejection');}return write(sql,params);});
    await expect(service.completeAttempt(receipt,{state,outcome:state==='settled'?'http_200':'invalid_usage',finishedAt:now,...(state==='settled'?{usage:exactUsage()}:{evidence:{kind:'malformed',interrupted:true}})})).rejects.toThrow('healthy terminal rejection');
    expect(injected).toBe(true);expect(db.health().healthy).toBe(true);expect(db.coverage.status('key-one').gaps).toHaveLength(1);fault.mockRestore();
    const file=fixture.file;db.close();fixture=await openFixture(engine,file);db=fixture.db;
    expect(db.get('SELECT state FROM apiKeyAccounting').state).toBe('unresolved');
    expect(db.coverage.status('key-one').gaps).toHaveLength(1);expect(db.coverage.status('key-two').gaps).toHaveLength(0);
    service=createAccountingService(db);context=service.createContext({apiKeyId:'key-one',validateAuthoritySync:()=>true,clock:()=>now});
    await expect(service.beginAttempt(context,candidate)).rejects.toThrow();
    const other=service.createContext({apiKeyId:'key-two',validateAuthoritySync:()=>true,clock:()=>now});
    await expect(service.beginAttempt(other,candidate)).resolves.toMatchObject({kind:'intent'});
  });
});
