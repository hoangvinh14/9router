// Historical sidecar-first reproduction ONLY; never application/operator authority.
import { validateKeyBindings } from "../../src/lib/db/helpers/apiKeyBindings.js";
import { POLICY_FORMAT_KEY, POLICY_FORMAT_VERSION, validateExplicitPolicy } from "../../src/lib/db/explicitPolicy.js";
export { POLICY_FORMAT_KEY, POLICY_FORMAT_VERSION, validateExplicitPolicy } from "../../src/lib/db/explicitPolicy.js";

// UNUSED preactivation operation. No startup/import caller. External latch first;
// interrupted two-file initialization blocks instead of regenerating defaults.
export function initializeExplicitPoliciesSync(db) {
  if (!db.health().healthy) throw new Error("Policy initialization unavailable");
  const coverage = db.coverage.status();
  if (coverage.maintenance || coverage.gaps.some(g => !g.resolvedAt)) throw new Error("Policy initialization unavailable");
  const marker = db.get("SELECT value FROM _meta WHERE key=?", [POLICY_FORMAT_KEY]);
  if (marker && marker.value !== POLICY_FORMAT_VERSION) throw new Error("Policy initialization format unsupported");
  const keys = db.all("SELECT * FROM apiKeys");
  validateKeyBindings(db, db.coverage, keys);
  for (const key of keys) {
    const binding = db.get("SELECT * FROM apiKeyBindings WHERE apiKeyId=?", [key.id]);
    if (!binding || binding.retiredAt || binding.fingerprint !== db.coverage.fingerprint(key.key)) throw new Error("Policy initialization binding unavailable");
  }
  for (const row of db.all("SELECT * FROM apiKeyBudgetPolicies")) validateExplicitPolicy(row);
  if (marker) {
    for (const key of keys) validateExplicitPolicy(db.get("SELECT * FROM apiKeyBudgetPolicies WHERE apiKeyId=?", [key.id]));
    return { initialized: false, inserted: 0 };
  }
  if (db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'") || db.get("SELECT attemptId FROM apiKeyAccounting LIMIT 1") || coverage.generation !== 0 || db.coverage.retiredBindings().length) throw new Error("Policy initialization requires pristine preactivation state");
  // Synchronous single-owner sequence; no admission/policy callback can interleave.
  return db.coverage.initializePolicyFormat(() => db.durableTransaction(() => {
    let inserted = 0;
    for (const key of keys) {
      if (db.get("SELECT apiKeyId FROM apiKeyBudgetPolicies WHERE apiKeyId=?", [key.id])) continue;
      db.run("INSERT INTO apiKeyBudgetPolicies(apiKeyId,weeklyLimitNanoUsd,monthlyLimitNanoUsd,version,updatedAt) VALUES(?,NULL,NULL,0,?)", [key.id, new Date().toISOString()]);
      inserted++;
    }
    db.run("INSERT INTO _meta(key,value) VALUES(?,?)", [POLICY_FORMAT_KEY, POLICY_FORMAT_VERSION]);
    return { initialized: true, inserted };
  }));
}
