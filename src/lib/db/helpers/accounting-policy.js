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

// Used only when creating a new retained identity, or in the versioned backfill.
export function initializeAccountingPolicy(db, apiKeyId) {
  db.run("INSERT OR IGNORE INTO apiKeyBudgetPolicies(apiKeyId,weeklyLimitNanoUsd,monthlyLimitNanoUsd,version,updatedAt) VALUES(?,NULL,NULL,1,?)", [apiKeyId, new Date().toISOString()]);
  return readAccountingPolicy(db, apiKeyId);
}
