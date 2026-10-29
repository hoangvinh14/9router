import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openFixture, addKey } from '../fixtures/accounting/test-database.js';
import { putBudgetManagement } from '../../src/lib/accounting/budget-management.js';
let fixture;
afterEach(()=>{vi.restoreAllMocks();if(fixture){fixture.db.beforeClose=undefined;fixture.db.close();fs.rmSync(fixture.root,{recursive:true,force:true});fixture=null;}});
for(const engine of ['node','sqljs'])describe(`${engine} budget own durable save`,()=>{
  it('does not return policy success from uncertain durable publication',async()=>{
    fixture=await openFixture(engine);const {db}=fixture;addKey(db);let injected=false;
    if(engine==='sqljs'){
      const rename=fs.renameSync;vi.spyOn(fs,'renameSync').mockImplementation((source,target)=>{if(!injected&&target===fixture.file){injected=true;throw new Error('Publication fault');}return rename(source,target);});
    }else{
      const exec=DatabaseSync.prototype.exec;vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(sql,...args){if(!injected&&sql.startsWith('RELEASE sp_0_')){injected=true;throw new Error('Publication fault');}return exec.call(this,sql,...args);});
    }
    expect(()=>putBudgetManagement({db,clock:()=> '2026-10-25T16:00:00.000Z',coverageStartedAt:'2026-10-25T16:00:00.000Z',lifetime:db.ownerInstanceId},'key-one',{weeklyLimitUsd:'1',monthlyLimitUsd:null,expectedVersion:1})).toThrow('Publication fault');
    expect(injected).toBe(true);expect(db.health().healthy).toBe(false);expect(()=>db.get('SELECT * FROM apiKeyBudgetPolicies')).toThrow();
  });
});
