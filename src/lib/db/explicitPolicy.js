import { MAX_NANO_USD } from "../../../open-sse/config/apiKeyBudgetConstants.js";
export const POLICY_FORMAT_KEY = "accountingPolicyFormat";
export const POLICY_FORMAT_VERSION = "1";
function unavailable() {
  const error = new Error("Explicit accounting policy unavailable");
  error.status = 503; error.code = "api_key_accounting_unavailable"; return error;
}
export function explicitPolicyFormat(db) {
  const coverage = db.coverage?.status();
  const marker = db.get("SELECT value FROM _meta WHERE key=?", [POLICY_FORMAT_KEY]);
  if (!marker) { if (coverage?.policyFormat !== undefined) throw unavailable(); return false; }
  if (marker.value !== POLICY_FORMAT_VERSION || coverage?.policyFormat !== POLICY_FORMAT_VERSION) throw unavailable();
  return true;
}
export function validateExplicitPolicy(row) {
  if (!row || !Number.isSafeInteger(row.version) || row.version < 0 || row.version === 0 && (row.weeklyLimitNanoUsd !== null || row.monthlyLimitNanoUsd !== null)) throw unavailable();
  for (const field of ["weeklyLimitNanoUsd", "monthlyLimitNanoUsd"]) {
    if (row[field] !== null && (!Number.isSafeInteger(row[field]) || row[field] < 0 || BigInt(row[field]) > MAX_NANO_USD)) throw unavailable();
  }
  if (typeof row.updatedAt !== "string" || !Number.isFinite(Date.parse(row.updatedAt)) || new Date(row.updatedAt).toISOString() !== row.updatedAt) throw unavailable();
  return row;
}
// Must run BEFORE retainKeyBindings/config replacement in the SAME transaction.
// Existing identities never acquire a default merely because a policy is lost.
export function prepareExplicitKeyPolicies(db, keys) {
  if (!explicitPolicyFormat(db)) return;
  for (const key of keys) {
    const binding = db.get("SELECT apiKeyId FROM apiKeyBindings WHERE apiKeyId=?", [key.id]);
    const policy = db.get("SELECT * FROM apiKeyBudgetPolicies WHERE apiKeyId=?", [key.id]);
    if (binding || policy) { validateExplicitPolicy(policy); continue; }
    db.run("INSERT INTO apiKeyBudgetPolicies(apiKeyId,weeklyLimitNanoUsd,monthlyLimitNanoUsd,version,updatedAt) VALUES(?,NULL,NULL,0,?)", [key.id, new Date().toISOString()]);
  }
}
