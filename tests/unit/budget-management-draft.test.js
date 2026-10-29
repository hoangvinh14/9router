import { describe, expect, it } from 'vitest';
import { budgetDraft, budgetDraftPayload, budgetDraftDirty, mergeBudgetRefresh } from '../../src/shared/utils/budgetManagementDraft.js';
const snapshot=(version=1,id='key-one')=>({apiKeyId:id,version,weekly:{limitUsd:null},monthly:{limitUsd:'0'}});
describe('key-specific exact budget drafts',()=>{
  it('keeps zero distinct from unlimited and empty invalid',()=>{
    const baseline=snapshot(),draft=budgetDraft(baseline);expect(draft).toMatchObject({weeklyUnlimited:true,monthlyUnlimited:false,monthlyLimitUsd:'0',expectedVersion:1});
    expect(budgetDraftPayload(draft)).toEqual({weeklyLimitUsd:null,monthlyLimitUsd:'0',expectedVersion:1});expect(budgetDraftDirty(draft,baseline)).toBe(false);
    expect(()=>budgetDraftPayload({...draft,monthlyLimitUsd:''})).toThrow();expect(budgetDraftDirty({...draft,monthlyLimitUsd:''},baseline)).toBe(true);
  });
  it('canonicalizes lexical exact amounts without float',()=>{
    expect(budgetDraftPayload({...budgetDraft(snapshot()),weeklyUnlimited:false,weeklyLimitUsd:'1.000000001',monthlyLimitUsd:'0.000000000'})).toEqual({weeklyLimitUsd:'1.000000001',monthlyLimitUsd:'0',expectedVersion:1});
  });
  it('dirty refresh preserves original CAS version and draft while updating projection',()=>{
    const baseline=snapshot(),draft={...budgetDraft(baseline),monthlyLimitUsd:'2'},state={apiKeyId:'key-one',baseline,snapshot:baseline,draft};
    const latest={...snapshot(2),monthly:{limitUsd:'3'}};const next=mergeBudgetRefresh(state,latest);
    expect(next.snapshot).toBe(latest);expect(next.baseline).toBe(baseline);expect(next.draft).toBe(draft);expect(budgetDraftPayload(next.draft).expectedVersion).toBe(1);
  });
  it('clean refresh advances version and late key-A cannot update key-B',()=>{
    const baseline=snapshot(),state={apiKeyId:'key-one',baseline,snapshot:baseline,draft:budgetDraft(baseline)};
    expect(mergeBudgetRefresh(state,snapshot(2)).draft.expectedVersion).toBe(2);expect(mergeBudgetRefresh(state,snapshot(9,'key-two'))).toBe(state);
  });
});
