import { readAccountingPolicy } from '../db/helpers/accounting-policy.js';
import { sumSpendSync } from '../db/repos/api-key-accounting-repo.js';
import { nanoUsdToDecimal } from '../pricing/decimalMoney.js';
import { budgetWindows } from './budget-windows.js';
import { budgetError } from './budget-errors.js';

// Call only inside the existing single-writer synchronous authority boundary.
// Pending is deliberately not a reservation; in-flight costs can overshoot.
export function assertBudgetEligibility(db, apiKeyId, now, {requestId, startedAt} = {}) {
  const policy = readAccountingPolicy(db,apiKeyId);
  const windows = budgetWindows(now);
  if(policy.unlimited)return {policy,windows};
  if(startedAt) {
    const original = budgetWindows(startedAt);
    for(const dimension of ['weekly','monthly']) {
      if(policy[`${dimension}LimitNanoUsd`]!==null && original[dimension].startAt!==windows[dimension].startAt) {
        throw budgetError('api_key_accounting_unavailable',{requestId,reason:'budget_window_changed'});
      }
    }
  }
  if(db.get("SELECT 1 AS found FROM apiKeyAccounting WHERE apiKeyId=? AND state='unresolved' LIMIT 1",[apiKeyId])) {
    throw budgetError('api_key_accounting_unresolved',{requestId});
  }
  const blockedWindows=[];
  for(const dimension of ['weekly','monthly']) {
    const limit=policy[`${dimension}LimitNanoUsd`];
    if(limit===null)continue;
    const window=windows[dimension],spent=sumSpendSync(db,apiKeyId,window.startAt,window.resetAt);
    if(BigInt(spent)>=BigInt(limit))blockedWindows.push({dimension,...window,limitUsd:nanoUsdToDecimal(String(limit)),spentUsd:nanoUsdToDecimal(spent)});
  }
  if(blockedWindows.length)throw budgetError('api_key_budget_exceeded',{requestId,now,blockedWindows});
  return {policy,windows};
}
