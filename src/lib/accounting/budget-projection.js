import { budgetWindows } from './budget-windows.js';
import { sumSpendSync, countAttemptStatesSync } from '../db/repos/api-key-accounting-repo.js';
import { nanoUsdToDecimal } from '../pricing/decimalMoney.js';

// Pure synchronous ledger projection. Caller supplies a verified retained policy
// and owns storage/identity/health/readiness; this never grants POST permission.
export function projectBudget(db, apiKeyId, policy, now) {
  const windows = budgetWindows(now);
  const project = (dimension, window) => {
    const limit = policy[`${dimension}LimitNanoUsd`];
    if (limit !== null && (!Number.isSafeInteger(limit) || limit < 0 || limit > 9000000000000000)) throw new Error('Invalid budget projection policy');
    const spent = BigInt(sumSpendSync(db, apiKeyId, window.startAt, window.resetAt));
    const finite = limit !== null, bound = finite ? BigInt(limit) : null;
    const remaining = finite ? bound > spent ? bound - spent : 0n : null;
    const overshoot = finite && spent > bound ? spent - bound : 0n;
    return { ...window, limitUsd: finite ? nanoUsdToDecimal(String(limit)) : null,
      spentUsd: nanoUsdToDecimal(String(spent)), remainingUsd: remaining === null ? null : nanoUsdToDecimal(String(remaining)),
      overshootUsd: nanoUsdToDecimal(String(overshoot)), exhausted: finite && spent >= bound,
      ...countAttemptStatesSync(db, apiKeyId, window.startAt, window.resetAt) };
  };
  return { timezone: windows.timezone, serverNow: now, ...countAttemptStatesSync(db, apiKeyId),
    weekly: project('weekly', windows.weekly), monthly: project('monthly', windows.monthly),
    previousWindows: { weekly: project('weekly', windows.previousWindows.weekly), monthly: project('monthly', windows.previousWindows.monthly) } };
}
