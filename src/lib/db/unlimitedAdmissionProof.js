import { SCHEMA_VERSION } from "./schema.js";
import { POLICY_FORMAT_KEY, POLICY_FORMAT_VERSION, validateExplicitPolicy } from "./explicitPolicy.js";

// Strict admission validator, NOT the permissive preactivation artifact checker.
// Called only over an adapter-owned fresh persisted image after a new durability
// acknowledgement. Missing/ambiguous policy rows conservatively deny for now.
export function validatePersistedUnlimited(get, coverage, apiKeyId) {
  if (typeof apiKeyId !== "string" || !apiKeyId || apiKeyId.length > 200) throw new Error("Unlimited admission proof unavailable");
  const before = coverage.status(apiKeyId);
  if (before.maintenance || before.policyFormat !== POLICY_FORMAT_VERSION) throw new Error("Unlimited admission proof unavailable");
  const meta = key => get("SELECT value FROM _meta WHERE key=?", [key])?.value;
  const started = meta("ledgerStartedAt");
  if (meta(POLICY_FORMAT_KEY) !== POLICY_FORMAT_VERSION || meta("schemaVersion") !== String(SCHEMA_VERSION) || meta("accountingCoverageId") !== before.id || meta("accountingBindingKeyId") !== before.bindingKeyId || typeof started !== "string" || !Number.isFinite(Date.parse(started)) || new Date(started).toISOString() !== started) throw new Error("Unlimited admission proof unavailable");
  const key = get("SELECT id,key,isActive FROM apiKeys WHERE id=?", [apiKeyId]);
  const binding = get("SELECT apiKeyId,fingerprint,retiredAt FROM apiKeyBindings WHERE apiKeyId=?", [apiKeyId]);
  if (!key || key.isActive !== 1 || !binding || binding.retiredAt !== null || binding.fingerprint !== coverage.fingerprint(key.key) || coverage.retiredBindings().some(row => row.apiKeyId === apiKeyId || row.fingerprint === binding.fingerprint)) throw new Error("Unlimited admission proof unavailable");
  const policy = get("SELECT * FROM apiKeyBudgetPolicies WHERE apiKeyId=?", [apiKeyId]);
  validateExplicitPolicy(policy);
  if (policy.weeklyLimitNanoUsd !== null || policy.monthlyLimitNanoUsd !== null) throw new Error("Unlimited admission proof unavailable");
  const after = coverage.status(apiKeyId);
  if (after.maintenance || after.id !== before.id || after.bindingKeyId !== before.bindingKeyId || after.policyFormat !== before.policyFormat || after.generation !== before.generation) throw new Error("Unlimited admission proof unavailable");
  return Object.freeze({ apiKeyId, policyVersion: policy.version, coverageId: after.id, coverageGeneration: after.generation, ledgerStartedAt: started });
}
