// Exact persisted SQLite definitions, shared by installer and offline validator.
// Preserve body bytes: the legacy installer included IF NOT EXISTS/delimiters,
// which SQLite omits from sqlite_schema.sql. No generic SQL normalization.
export const ACCOUNTING_INVARIANT_TRIGGERS = Object.freeze([
  Object.freeze({ name: 'accounting_audit_no_update', table: 'apiKeyAccountingAudit', sql: `CREATE TRIGGER accounting_audit_no_update BEFORE UPDATE ON apiKeyAccountingAudit
      BEGIN SELECT RAISE(ABORT, 'accounting audit is append-only'); END` }),
  Object.freeze({ name: 'accounting_audit_no_delete', table: 'apiKeyAccountingAudit', sql: `CREATE TRIGGER accounting_audit_no_delete BEFORE DELETE ON apiKeyAccountingAudit
      BEGIN SELECT RAISE(ABORT, 'accounting audit is append-only'); END` }),
  Object.freeze({ name: 'accounting_audit_target', table: 'apiKeyAccountingAudit', sql: `CREATE TRIGGER accounting_audit_target BEFORE INSERT ON apiKeyAccountingAudit
      WHEN NEW.attemptId IS NULL AND NEW.gapId IS NULL
      BEGIN SELECT RAISE(ABORT, 'accounting audit target required'); END` }),
  Object.freeze({ name: 'accounting_cost_insert', table: 'apiKeyAccounting', sql: `CREATE TRIGGER accounting_cost_insert BEFORE INSERT ON apiKeyAccounting
      WHEN (NEW.state IN ('settled','waived') AND NEW.costNanoUsd IS NULL)
        OR (NEW.state IN ('pending','unresolved','not_dispatched') AND NEW.costNanoUsd IS NOT NULL)
        OR (NEW.state='waived' AND NEW.costNanoUsd != 0)
      BEGIN SELECT RAISE(ABORT, 'invalid accounting state cost'); END` }),
  Object.freeze({ name: 'accounting_cost_update', table: 'apiKeyAccounting', sql: `CREATE TRIGGER accounting_cost_update BEFORE UPDATE ON apiKeyAccounting
      WHEN (NEW.state IN ('settled','waived') AND NEW.costNanoUsd IS NULL)
        OR (NEW.state IN ('pending','unresolved','not_dispatched') AND NEW.costNanoUsd IS NOT NULL)
        OR (NEW.state='waived' AND NEW.costNanoUsd != 0)
      BEGIN SELECT RAISE(ABORT, 'invalid accounting state cost'); END` }),
]);

// Applied for fresh schema and repeated boot. Validation does not call installer.
export function installAccountingInvariants(db) {
  for (const { sql } of ACCOUNTING_INVARIANT_TRIGGERS) {
    db.exec(sql.replace(/^CREATE TRIGGER /, 'CREATE TRIGGER IF NOT EXISTS ') + ';');
  }
}
