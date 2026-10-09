// Frozen historical installer for stored-schema compatibility evidence only.
// Never imported by application code or offline operator tools.
export function installLegacyAccountingInvariants(db) {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS accounting_audit_no_update BEFORE UPDATE ON apiKeyAccountingAudit
      BEGIN SELECT RAISE(ABORT, 'accounting audit is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS accounting_audit_no_delete BEFORE DELETE ON apiKeyAccountingAudit
      BEGIN SELECT RAISE(ABORT, 'accounting audit is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS accounting_audit_target BEFORE INSERT ON apiKeyAccountingAudit
      WHEN NEW.attemptId IS NULL AND NEW.gapId IS NULL
      BEGIN SELECT RAISE(ABORT, 'accounting audit target required'); END;
    CREATE TRIGGER IF NOT EXISTS accounting_cost_insert BEFORE INSERT ON apiKeyAccounting
      WHEN (NEW.state IN ('settled','waived') AND NEW.costNanoUsd IS NULL)
        OR (NEW.state IN ('pending','unresolved','not_dispatched') AND NEW.costNanoUsd IS NOT NULL)
        OR (NEW.state='waived' AND NEW.costNanoUsd != 0)
      BEGIN SELECT RAISE(ABORT, 'invalid accounting state cost'); END;
    CREATE TRIGGER IF NOT EXISTS accounting_cost_update BEFORE UPDATE ON apiKeyAccounting
      WHEN (NEW.state IN ('settled','waived') AND NEW.costNanoUsd IS NULL)
        OR (NEW.state IN ('pending','unresolved','not_dispatched') AND NEW.costNanoUsd IS NOT NULL)
        OR (NEW.state='waived' AND NEW.costNanoUsd != 0)
      BEGIN SELECT RAISE(ABORT, 'invalid accounting state cost'); END;
  `);
}
