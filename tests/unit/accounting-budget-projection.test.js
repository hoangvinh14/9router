import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { openFixture, addKey, intent, exactUsage } from '../fixtures/accounting/test-database.js';
import { insertAttemptSync, finalizeAttemptSync } from '../../src/lib/db/repos/api-key-accounting-repo.js';
import { projectBudget } from '../../src/lib/accounting/budget-projection.js';

let fixture;
afterEach(()=>{if(fixture){fixture.db.close();fs.rmSync(fixture.root,{recursive:true,force:true});fixture=null;}});
for(const engine of ['node','sqljs'])describe(`${engine} ledger-derived calendar projection`,()=>{
  it('distinguishes exact spent, unlimited remaining, overshoot, lifetime unknown and previous window',async()=>{
    fixture=await openFixture(engine);const {db}=fixture;addKey(db);addKey(db,'key-two','other-secret');
    const settle=(id,startedAt)=>{insertAttemptSync(db,{...intent(db,id),startedAt});finalizeAttemptSync(db,id,{state:'settled',outcome:'success',finishedAt:'2026-10-26T00:00:00.000Z',usage:exactUsage()});};
    settle('previous','2026-10-25T16:00:00.000Z');settle('current','2026-10-25T17:00:00.000Z');
    insertAttemptSync(db,{...intent(db,'unknown'),startedAt:'2026-09-01T00:00:00.000Z'});finalizeAttemptSync(db,'unknown',{state:'unresolved',outcome:'network_unknown',finishedAt:'2026-09-01T00:00:00.000Z'});
    insertAttemptSync(db,{...intent(db,'pending'),startedAt:'2026-10-25T17:00:00.000Z'});
    insertAttemptSync(db,{...intent(db,'not-dispatched'),startedAt:'2026-10-25T17:00:00.000Z'});finalizeAttemptSync(db,'not-dispatched',{state:'not_dispatched',outcome:'local_refusal',finishedAt:'2026-10-26T00:00:00.000Z',notDispatchedEvidence:'No invocation'});
    const policy={weeklyLimitNanoUsd:1000000,monthlyLimitNanoUsd:null};
    const projection=projectBudget(db,'key-one',policy,'2026-10-26T00:00:00.000Z');
    expect(projection).toMatchObject({pendingCount:1,unresolvedCount:1,weekly:{limitUsd:'0.001',spentUsd:'0.0012',remainingUsd:'0',overshootUsd:'0.0002',exhausted:true,pendingCount:1,unresolvedCount:0},monthly:{limitUsd:null,remainingUsd:null,spentUsd:'0.0024',overshootUsd:'0',exhausted:false},previousWindows:{weekly:{spentUsd:'0.0012',overshootUsd:'0.0002'}}});
    expect(projectBudget(db,'key-two',policy,'2026-10-26T00:00:00.000Z')).toMatchObject({pendingCount:0,unresolvedCount:0,weekly:{spentUsd:'0'}});
  });
  it('aggregates money above Number safe bound with exact wire decimals',async()=>{
    fixture=await openFixture(engine);const {db}=fixture;addKey(db);
    // Focused overflow fixture, not E2E debit evidence: manual audited correction.
    for(const id of ['large-one','large-two']){
      insertAttemptSync(db,{...intent(db,id),startedAt:'2026-10-26T00:00:00.000Z'});
      finalizeAttemptSync(db,id,{state:'unresolved',outcome:'network_unknown',finishedAt:'2026-10-26T00:00:00.000Z'});
      const {resolveAttemptSync}=await import('../../src/lib/db/repos/api-key-accounting-repo.js');
      resolveAttemptSync(db,id,{operationId:`correction-${id}`,actor:'fixture',reason:'Overflow projection control',evidence:'Focused SQL fixture only',expectedVersion:1,action:'cost_correction',costNanoUsd:'9000000000000000'});
    }
    expect(projectBudget(db,'key-one',{weeklyLimitNanoUsd:9000000000000000,monthlyLimitNanoUsd:null},'2026-10-26T00:00:00.000Z').weekly).toMatchObject({spentUsd:'18000000',remainingUsd:'0',overshootUsd:'9000000'});
  });
});
