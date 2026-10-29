import { timestamp, unavailable } from "../../accounting/attempt-payload.js";
import { TABLES, buildCreateTableSql } from "../schema.js";

export function verifyAccountingPolicySchema(db) {
  const row = db.get("SELECT type,name,sql FROM sqlite_master WHERE type='table' AND name='apiKeyBudgetPolicies'");
  verifyAccountingPolicySchemaRows(row ? [row] : []);
}

export function verifyAccountingPolicySchemaRows(rows) {
  const expected = buildCreateTableSql("apiKeyBudgetPolicies", TABLES.apiKeyBudgetPolicies).replace("IF NOT EXISTS ", "");
  if (rows.find(row => row.type === "table" && row.name === "apiKeyBudgetPolicies")?.sql !== expected) throw unavailable("Accounting policy schema unavailable");
}

// Missing policy is unavailable, never an implicit unlimited permission.
export function readAccountingPolicy(db, apiKeyId) {
  const row = db.get("SELECT * FROM apiKeyBudgetPolicies WHERE apiKeyId=?", [apiKeyId]);
  if (!row || !Number.isSafeInteger(row.version) || row.version < 1) throw unavailable("Accounting policy unavailable");
  for (const value of [row.weeklyLimitNanoUsd, row.monthlyLimitNanoUsd]) {
    if (value !== null && (!Number.isSafeInteger(value) || value < 0 || value > 9000000000000000)) throw unavailable("Invalid accounting policy limit");
  }
  timestamp(row.updatedAt);
  return Object.freeze({ ...row, unlimited: row.weeklyLimitNanoUsd === null && row.monthlyLimitNanoUsd === null });
}

// The caller owns auth/readiness/active identity. This helper never initializes
// absent policy and never touches ledger/history/coverage. ACK is the durable
// transaction's own return, not a subsequently visible row.
export function updateAccountingPolicy(db, apiKeyId, input, updatedAt) {
  return db.durableTransaction(() => updateAccountingPolicyMutation(db, apiKeyId, input, updatedAt));
}

// Internal mutation for composition with same-transaction management authority.
// Caller must own an outer durable transaction; no nested durable publication.
export function updateAccountingPolicyMutation(db, apiKeyId, input, updatedAt) {
  timestamp(updatedAt);
  if (!input || Object.keys(input).sort().join(',') !== 'expectedVersion,monthlyLimitNanoUsd,weeklyLimitNanoUsd' ||
      !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 || input.expectedVersion >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid budget policy update');
  for (const value of [input.weeklyLimitNanoUsd, input.monthlyLimitNanoUsd]) {
    if (value !== null && (!Number.isSafeInteger(value) || value < 0 || value > 9000000000000000)) throw new Error('Invalid budget policy amount');
  }
    const before = readAccountingPolicy(db, apiKeyId);
    const stale = () => Object.assign(new Error('Budget policy conflict'), { status: 409, code: 'budget_policy_conflict' });
    if (before.version !== input.expectedVersion) throw stale();
    if (before.weeklyLimitNanoUsd === input.weeklyLimitNanoUsd && before.monthlyLimitNanoUsd === input.monthlyLimitNanoUsd) return before;
    const result = db.run('UPDATE apiKeyBudgetPolicies SET weeklyLimitNanoUsd=?,monthlyLimitNanoUsd=?,version=version+1,updatedAt=? WHERE apiKeyId=? AND version=?',
      [input.weeklyLimitNanoUsd, input.monthlyLimitNanoUsd, updatedAt, apiKeyId, input.expectedVersion]);
    if (Number(result.changes) !== 1) throw stale();
    return readAccountingPolicy(db, apiKeyId);
}

// Used only when creating a new retained identity, or in the versioned backfill.
export function initializeAccountingPolicy(db, apiKeyId) {
  db.run("INSERT OR IGNORE INTO apiKeyBudgetPolicies(apiKeyId,weeklyLimitNanoUsd,monthlyLimitNanoUsd,version,updatedAt) VALUES(?,NULL,NULL,1,?)", [apiKeyId, new Date().toISOString()]);
  return readAccountingPolicy(db, apiKeyId);
}
