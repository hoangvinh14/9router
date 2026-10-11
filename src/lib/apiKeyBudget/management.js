import { getAdapter } from "../db/driver.js";
import { getPolicySync, putPolicySync, sumSpendSync, countStatesSync, getAttemptSync, resolveAttemptSync } from "../db/repos/apiKeyAccountingRepo.js";
import { explicitPolicyFormat } from "../db/explicitPolicy.js";
import { decimalToNanoUsd, nanoUsdToDecimal } from "../pricing/money.js";
import { projectAccountingUsageSync } from "../db/repos/usageRepo.js";
import { budgetWindows } from "./windows.js";
import { BUDGET_SCOPE } from "../../../open-sse/config/apiKeyBudgetConstants.js";
import { recoveryReceiptSync } from "./recoveryReceipt.js";
import { ACCOUNTING_CACHE_TIER_FIELDS } from '../../../open-sse/config/accountingCacheTiers.js';

function failure(status, code) { const error = new Error(code); error.status = status; error.code = code; throw error; }
export function managementId(value) {
  if (typeof value !== "string" || !value || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) failure(400, "invalid_accounting_identifier");
  return value;
}
function ready(db) {
  if (!db.health().healthy) failure(503, "api_key_accounting_unavailable");
  return db.coverage.status();
}
function identity(db, id, active = false) {
  managementId(id);
  const key = db.get("SELECT id,isActive FROM apiKeys WHERE id=?", [id]);
  const binding = db.get("SELECT apiKeyId,retiredAt FROM apiKeyBindings WHERE apiKeyId=?", [id]);
  if (!key && !binding) failure(404, "api_key_not_found");
  if (active && (!key || ![1, true].includes(key.isActive) || !binding || binding.retiredAt)) failure(409, "api_key_inactive");
  return { retired: !key || Boolean(binding?.retiredAt), active: Boolean(key && [1, true].includes(key.isActive) && !binding?.retiredAt) };
}
function windowStatus(spent, limit, window) {
  const remainder = limit === null ? null : BigInt(limit) - BigInt(spent);
  return { startAt: window.start, resetAt: window.end, spentUsd: nanoUsdToDecimal(spent), limitUsd: limit === null ? null : nanoUsdToDecimal(String(limit)),
    remainingUsd: remainder === null ? null : nanoUsdToDecimal((remainder > 0n ? remainder : 0n).toString()),
    overshootUsd: nanoUsdToDecimal((remainder !== null && remainder < 0n ? -remainder : 0n).toString()), exhausted: remainder !== null && remainder <= 0n };
}
function activation(db) {
  const started = db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")?.value;
  // This preparation slice has no inference hooks. A timestamp alone is not
  // activation authority; integration must replace this gate after rollout.
  // No API in this module initializes a ledger or enables enforcement.
  return { ledgerStartedAt: started || null, enforcementActive: false, explicitPolicyReady: explicitPolicyFormat(db) };
}
function policyStatus(db, id, now) {
  const health = ready(db); const key = identity(db, id);
  const policy = getPolicySync(db, id), windows = budgetWindows(now), counts = countStatesSync(db, id), active = activation(db);
  const coverage = db.coverage.status(id);
  const weekly = windowStatus(sumSpendSync(db, id, windows.weekly.start, windows.weekly.end), policy.weeklyLimitNanoUsd, windows.weekly);
  const monthly = windowStatus(sumSpendSync(db, id, windows.monthly.start, windows.monthly.end), policy.monthlyLimitNanoUsd, windows.monthly);
  return { apiKeyId: id, ...key, version: policy.version, updatedAt: policy.updatedAt, timezone: windows.timezone, scope: BUDGET_SCOPE, virtualReference: true,
    ...active, weekly, monthly, counts, coverage: { generation: coverage.generation, gaps: coverage.gaps, maintenance: health.maintenance },
    status: health.maintenance ? "maintenance" : !active.enforcementActive ? "inactive" : coverage.gaps.some(g => !g.resolvedAt) ? "coverage_gap" : counts.unresolved ? "accounting_unresolved" : weekly.exhausted || monthly.exhausted ? "budget_exceeded" : "allowed" };
}
export async function getBudgetManagement(id, { clock = () => new Date() } = {}) { return policyStatus(await getAdapter(), id, clock()); }
export async function putBudgetManagement(id, input) {
  const keys = ["weeklyLimitUsd", "monthlyLimitUsd", "expectedVersion"];
  if (!input || Array.isArray(input) || Object.keys(input).length !== keys.length || Object.keys(input).some(key => !keys.includes(key)) || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) failure(400, "invalid_budget_policy");
  let limits;
  try { limits = { weeklyLimitNanoUsd: input.weeklyLimitUsd === null ? null : decimalToNanoUsd(input.weeklyLimitUsd), monthlyLimitNanoUsd: input.monthlyLimitUsd === null ? null : decimalToNanoUsd(input.monthlyLimitUsd) }; }
  catch { failure(400, "invalid_budget_policy"); }
  const db = await getAdapter(); ready(db);
  putPolicySync(db, id, limits, input.expectedVersion, () => {
    const coverage = ready(db); identity(db, id, true);
    if (coverage.maintenance) failure(503, "api_key_accounting_unavailable");
    if (limits.weeklyLimitNanoUsd !== null || limits.monthlyLimitNanoUsd !== null) {
      if (!activation(db).enforcementActive) failure(409, "accounting_not_ready");
      if (db.coverage.status(id).gaps.some(g => !g.resolvedAt)) failure(409, "accounting_coverage_gap");
    }
  });
  return policyStatus(db, id, new Date());
}
function publicAttempt(row) {
  return { attemptId: row.attemptId, requestId: row.requestId, apiKeyId: row.apiKeyId, startedAt: row.startedAt, finishedAt: row.finishedAt,
    provider: row.provider, model: row.model, endpoint: row.endpoint, state: row.state, outcome: row.outcome,
    costUsd: row.costNanoUsd === null ? null : nanoUsdToDecimal(row.costNanoUsd), resolutionVersion: row.resolutionVersion,
    usage: row.usage ? Object.fromEntries(["exact", "input", "output", "cacheRead", "cacheWrite", "reasoning", "reasoningIncludedInOutput", ...ACCOUNTING_CACHE_TIER_FIELDS].filter(key => Object.hasOwn(row.usage, key)).map(key => [key, row.usage[key]])) : null,
    manuallyResolved: Boolean(row.manuallyResolved) };
}
export async function listAccountingManagement(id, { limit = 50, afterAttemptId = null, state = null } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 || state !== null && !["pending", "unresolved", "settled", "waived", "not_dispatched"].includes(state)) failure(400, "invalid_accounting_query");
  if (afterAttemptId !== null) managementId(afterAttemptId);
  const db = await getAdapter(); ready(db); identity(db, id);
  const rows = db.all(`SELECT attemptId FROM apiKeyAccounting WHERE apiKeyId=? AND (? IS NULL OR attemptId>?) AND (? IS NULL OR state=?) ORDER BY attemptId LIMIT ?`, [id, afterAttemptId, afterAttemptId, state, state, limit + 1]);
  const selected = rows.slice(0, limit).map(row => publicAttempt(getAttemptSync(db, row.attemptId)));
  return { apiKeyId: id, attempts: selected, nextCursor: rows.length > limit ? selected.at(-1).attemptId : null };
}
export async function getUsageManagement(id, options = {}) {
  const page = await listAccountingManagement(id, options);
  const groups = new Map();
  for (const row of page.attempts) {
    const key = JSON.stringify([row.provider, row.model, row.endpoint]);
    if (!groups.has(key)) groups.set(key, { provider: row.provider, model: row.model, endpoint: row.endpoint, attempts: 0, chargedAttempts: 0, unresolved: 0, pending: 0, knownCostNanoUsd: 0n });
    const group = groups.get(key); group.attempts++;
    if (row.state === "pending") group.pending++;
    if (row.state === "unresolved") group.unresolved++;
    if (["settled", "waived"].includes(row.state) && row.costUsd !== null) {
      // Ledger rows are each bounded, but page aggregates may exceed ingress
      // limits. Parse exact lexical wire cost without bounded ingress coercion.
      const [whole, fraction = ""] = row.costUsd.split(".");
      group.knownCostNanoUsd += BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, "0")); group.chargedAttempts++;
    }
  }
  return { ...page, virtualReference: true, aggregateScope: "page", breakdown: [...groups.values()].map(({ knownCostNanoUsd, ...group }) => ({ ...group, knownCostUsd: nanoUsdToDecimal(String(knownCostNanoUsd)), totalCostUsd: group.unresolved || group.pending ? null : nanoUsdToDecimal(String(knownCostNanoUsd)) })) };
}
export async function resolveAccountingManagement(id, attemptId, input, actor) {
  managementId(attemptId);
  if (!input || Array.isArray(input) || Object.hasOwn(input, "actor")) failure(400, "invalid_accounting_recovery");
  const db = await getAdapter(); ready(db); identity(db, id);
  if (db.coverage.status(id).maintenance) failure(503, "api_key_accounting_unavailable");
  if (getAttemptSync(db, attemptId)?.apiKeyId !== id) failure(404, "accounting_attempt_not_found");
  let result;
  try { result = resolveAttemptSync(db, attemptId, { ...input, actor }); }
  catch (error) {
    if (error.status === 409 || error.status === 503) throw error;
    // Adapter/commit errors are infrastructure, not invalid client input. Only
    // the repository's bounded validation errors are classified as 400.
    let healthy = false; try { healthy = db.health().healthy; } catch { /* Unavailable. */ }
    if (!healthy || !/^(Invalid |Exact usage |Original price snapshot |Recovery cost required|Attempt cost range exceeded|USD range exceeded|Accounting payload )/.test(error.message || "")) failure(503, "api_key_accounting_unavailable");
    failure(400, "invalid_accounting_recovery");
  }
  try { projectAccountingUsageSync(db, attemptId); } catch { console.warn("[Accounting] recovery analytics projection deferred"); }
  return { ...publicAttempt(result), recoveryReceipt: recoveryReceiptSync(db, id, { kind: "attempt", id: attemptId }, { ...input, actor }) };
}
export async function resolveGapManagement(id, input, actor) {
  const fields = ["gapId", "expectedGeneration", "operationId", "reason", "evidence"];
  if (!input || Array.isArray(input) || Object.keys(input).length !== fields.length || Object.keys(input).some(key => !fields.includes(key)) || !Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 0) failure(400, "invalid_gap_recovery");
  const db = await getAdapter(); ready(db); identity(db, id);
  if (db.coverage.status(id).maintenance) failure(503, "api_key_accounting_unavailable");
  const gap = db.coverage.status(id).gaps.find(g => g.id === input.gapId && g.apiKeyId === id);
  if (!gap) failure(404, "accounting_gap_not_found");
  try { db.coverage.reconcileGap({ ...input, apiKeyId: id, actor }); }
  catch (error) { if (error.status === 409) throw error; failure(503, "api_key_accounting_unavailable"); }
  return { ...policyStatus(db, id, new Date()), recoveryReceipt: recoveryReceiptSync(db, id, { kind: "gap", id: input.gapId }, { ...input, apiKeyId: id, actor }) };
}
