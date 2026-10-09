import { TABLES, buildCreateTableSql } from "../schema.js";

const migration = {
  version: 2,
  name: "api-key-accounting",
  up(db) {
    for (const name of ["apiKeyBindings", "apiKeyBudgetPolicies", "apiKeyAccounting", "apiKeyAccountingAudit"]) {
      db.exec(buildCreateTableSql(name, TABLES[name]));
      for (const index of TABLES[name].indexes || []) db.exec(index);
    }
    if (db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='usageHistory'")) {
      const columns = new Set(db.all("PRAGMA table_info(usageHistory)").map(r => r.name));
      for (const name of ["apiKeyId", "attemptId"]) if (!columns.has(name)) db.exec(`ALTER TABLE usageHistory ADD COLUMN ${name} TEXT`);
    }
    db.run("INSERT OR IGNORE INTO _meta(key,value) VALUES('accountingSchemaInstalledAt',?)", [new Date().toISOString()]);
  },
};
export default migration;
