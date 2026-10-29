import { decimalToNanoUsd, nanoUsdToDecimal } from '../../lib/pricing/decimalMoney.js';

export function budgetDraft(snapshot) {
  return {apiKeyId:snapshot.apiKeyId,expectedVersion:snapshot.version,
    weeklyUnlimited:snapshot.weekly.limitUsd===null,monthlyUnlimited:snapshot.monthly.limitUsd===null,
    weeklyLimitUsd:snapshot.weekly.limitUsd??'',monthlyLimitUsd:snapshot.monthly.limitUsd??''};
}
export function budgetDraftPayload(draft) {
  const amount=(dimension)=>draft[`${dimension}Unlimited`]?null:nanoUsdToDecimal(decimalToNanoUsd(draft[`${dimension}LimitUsd`]));
  return {weeklyLimitUsd:amount('weekly'),monthlyLimitUsd:amount('monthly'),expectedVersion:draft.expectedVersion};
}
export function budgetDraftDirty(draft,baseline) {
  if(!draft||!baseline)return false;
  try{const payload=budgetDraftPayload(draft);return payload.weeklyLimitUsd!==baseline.weekly.limitUsd||payload.monthlyLimitUsd!==baseline.monthly.limitUsd;}
  catch{return true;}
}
// Refresh can update spend/health, but never the dirty draft's base CAS version.
export function mergeBudgetRefresh(state,snapshot) {
  if(snapshot.apiKeyId!==state.apiKeyId)return state;
  const dirty=budgetDraftDirty(state.draft,state.baseline);
  if(dirty)return {...state,snapshot};
  return {...state,snapshot,baseline:snapshot,draft:budgetDraft(snapshot)};
}
