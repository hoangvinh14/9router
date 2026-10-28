import { TABLES, buildCreateTableSql } from "../schema.js";

export const ACCOUNTING_TABLES = ["apiKeyBindings", "apiKeyAccounting", "apiKeyAccountingAudit"];
const AUDIT_TRIGGERS = [
  "CREATE TRIGGER accounting_audit_no_update BEFORE UPDATE ON apiKeyAccountingAudit BEGIN SELECT RAISE(ABORT,'Accounting audit is append-only'); END",
  "CREATE TRIGGER accounting_audit_no_delete BEFORE DELETE ON apiKeyAccountingAudit BEGIN SELECT RAISE(ABORT,'Accounting audit is append-only'); END",
];
export function verifyAccountingSchema(db) {
  const rows = [];
  const read = (type, name) => {
    const row = db.get("SELECT sql FROM sqlite_master WHERE type=? AND name=?", [type, name]);
    if (row) rows.push({ type, name, sql: row.sql });
  };
  for (const name of ACCOUNTING_TABLES) {
    read("table", name);
    for (const sql of TABLES[name].indexes || []) read("index", sql.split(" ")[5]);
  }
  for (const sql of AUDIT_TRIGGERS) read("trigger", sql.split(" ")[2]);
  verifyAccountingSchemaRows(rows);
}
// Validate a freshly read synchronous schema image, also used by the persisted
// authority digest so validation and hashing observe the same rows.
export function verifyAccountingSchemaRows(rows) {
  const objects = new Map(rows.map(row => [`${row.type}:${row.name}`, row.sql]));
  for (const name of ACCOUNTING_TABLES) {
    const expected = buildCreateTableSql(name, TABLES[name]).replace("IF NOT EXISTS ", "");
    if (objects.get(`table:${name}`) !== expected) throw new Error("Accounting schema incomplete or incompatible");
    for (const sql of TABLES[name].indexes || []) {
      const index = sql.split(" ")[5];
      if (objects.get(`index:${index}`) !== sql.replace("IF NOT EXISTS ", "")) throw new Error("Accounting index unavailable");
    }
  }
  for (const sql of AUDIT_TRIGGERS) {
    const name = sql.split(" ")[2];
    if (objects.get(`trigger:${name}`) !== sql) throw new Error("Accounting audit protection unavailable");
  }
}
const migration = {
  version: 2,
  name: "accounting-foundation",
  up(db) {
    for (const name of ACCOUNTING_TABLES) {
      db.exec(buildCreateTableSql(name, TABLES[name]));
      for (const sql of TABLES[name].indexes || []) db.exec(sql);
    }
    for (const sql of AUDIT_TRIGGERS) db.exec(sql.replace("CREATE TRIGGER ", "CREATE TRIGGER IF NOT EXISTS "));
    verifyAccountingSchema(db);
  },
};
export default migration;
