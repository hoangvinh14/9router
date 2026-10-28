import { TABLES, buildCreateTableSql } from "../schema.js";
import { initializeAccountingPolicy, verifyAccountingPolicySchema } from "../helpers/accounting-policy.js";

const accountingPolicyMigration = {
  version: 3,
  name: "accounting-policy",
  up(db) {
    db.exec(buildCreateTableSql("apiKeyBudgetPolicies", TABLES.apiKeyBudgetPolicies));
    verifyAccountingPolicySchema(db);
    for (const row of db.all("SELECT id AS apiKeyId FROM apiKeys UNION SELECT apiKeyId FROM apiKeyBindings")) initializeAccountingPolicy(db, row.apiKeyId);
    db.run("INSERT INTO _meta(key,value) VALUES('accountingPoliciesInitialized','1') ON CONFLICT(key) DO UPDATE SET value='1'");
  },
};

export default accountingPolicyMigration;
