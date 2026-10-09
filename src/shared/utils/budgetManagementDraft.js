import { decimalToNanoUsd } from "../../lib/pricing/money.js";
const USD = /^(0|[1-9]\d{0,6})(\.\d{1,9})?$/;
export function budgetPolicyDraft(status) {
  return { weeklyLimitUsd: status.weekly.limitUsd, monthlyLimitUsd: status.monthly.limitUsd, expectedVersion: status.version };
}
export function validateBudgetPolicyDraft(draft) {
  if (!draft || !Number.isSafeInteger(draft.expectedVersion) || draft.expectedVersion < 0) throw new Error("Invalid policy version");
  for (const field of ["weeklyLimitUsd", "monthlyLimitUsd"]) if (draft[field] !== null) decimalToNanoUsd(draft[field]);
  return { weeklyLimitUsd: draft.weeklyLimitUsd, monthlyLimitUsd: draft.monthlyLimitUsd, expectedVersion: draft.expectedVersion };
}
function text(value, field, max = 512) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${field} is required and must be bounded`);
  return value;
}
function version(value) { if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid recovery version"); return value; }
export function attemptRecoveryDraft(attempt, { action, reason, evidence, costUsd, usageJson }, operationId) {
  const result = { action, reason: text(reason, "Reason"), evidence: text(evidence, "Evidence"), operationId: text(operationId, "Operation ID"), expectedVersion: version(attempt.resolutionVersion) };
  if (action === "cost_correction") {
    if (typeof costUsd !== "string" || !USD.test(costUsd)) throw new Error("Exact decimal USD adjustment required");
    result.costNanoUsd = decimalToNanoUsd(costUsd);
  } else if (action === "exact_usage") {
    let usage; try { usage = JSON.parse(usageJson); } catch { throw new Error("Exact usage must be valid JSON"); }
    const fields = ["exact", "input", "output", "cacheRead", "cacheWrite", "reasoning", "reasoningIncludedInOutput"];
    if (!usage || Array.isArray(usage) || Object.keys(usage).length !== fields.length || Object.keys(usage).some(key => !fields.includes(key)) || usage.exact !== true || typeof usage.reasoningIncludedInOutput !== "boolean" || fields.slice(1, 6).some(field => !Number.isSafeInteger(usage[field]) || usage[field] < 0)) throw new Error("Complete exact usage and inclusion provenance required");
    if (usage.cacheRead + usage.cacheWrite > usage.input || usage.reasoningIncludedInOutput && usage.reasoning > usage.output) throw new Error("Invalid cache/reasoning subsets");
    result.usage = usage;
  } else if (action !== "waive") throw new Error("Invalid recovery action");
  return result;
}
export function gapRecoveryDraft(gap, { reason, evidence }, operationId) {
  if (!gap?.apiKeyId || gap.resolvedAt) throw new Error("Only an unresolved key-specific gap can be waived here");
  return { gapId: gap.id, expectedGeneration: version(gap.generation), operationId: text(operationId, "Operation ID", 200), reason: text(reason, "Reason"), evidence: text(evidence, "Evidence", 4000) };
}
// Keep this bounded contract in tab-local sessionStorage so a route change
// cannot lose an uncertain mutation's identity. Evidence is user-entered: warn
// against secrets/prompts, never log/export it, and never auto-submit a retry.
export function retainedRecoveryMutation(apiKeyId, path, payload) {
  if (typeof apiKeyId !== "string" || !apiKeyId || !["attempt", "gap"].includes(path?.kind) || path.kind === "attempt" && (typeof path.attemptId !== "string" || !path.attemptId)) throw new Error("Invalid recovery target");
  const suffix = path.kind === "gap" ? "gaps/resolve" : `${encodeURIComponent(path.attemptId)}/resolve`;
  const value = { url: `/api/keys/${encodeURIComponent(apiKeyId)}/accounting/${suffix}`, payload };
  if (JSON.stringify(value).length > 16384) throw new Error("Recovery request too large");
  return Object.freeze({ ...value, payload: Object.freeze(structuredClone(payload)) });
}
export function validateRecoveryAcknowledgement(result, retained, apiKeyId) {
  const receipt = result?.recoveryReceipt, input = retained.payload;
  const reject = () => { throw new Error("Recovery acknowledgement is incomplete or mismatched. Retry the unchanged operation; do not assume rollback."); };
  if (!receipt || receipt.version !== 1 || receipt.apiKeyId !== apiKeyId || receipt.operationId !== input.operationId) reject();
  const prefix = `/api/keys/${encodeURIComponent(apiKeyId)}/accounting/`;
  if (Object.hasOwn(input, "gapId")) {
    if (retained.url !== `${prefix}gaps/resolve` || receipt.kind !== "gap" || receipt.targetId !== input.gapId || receipt.action !== "coverage_waiver" || receipt.generation !== input.expectedGeneration) reject();
  } else {
    if (receipt.kind !== "attempt" || typeof receipt.targetId !== "string" || retained.url !== `${prefix}${encodeURIComponent(receipt.targetId)}/resolve` || receipt.action !== input.action || receipt.resolutionVersion !== input.expectedVersion + 1 || receipt.state !== (input.action === "waive" ? "waived" : "settled")) reject();
    try { decimalToNanoUsd(receipt.costUsd); } catch { reject(); }
    if (input.action === "waive" && decimalToNanoUsd(receipt.costUsd) !== "0" || input.action === "cost_correction" && decimalToNanoUsd(receipt.costUsd) !== input.costNanoUsd) reject();
  }
  return receipt;
}
