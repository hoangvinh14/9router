import { TABLES } from '../schema.js';

// Frozen version-2 accounting definitions: historical migrations must not
// silently create new constraints as the declarative current schema evolves.
export const LEGACY_ACCOUNTING_TABLE = {
  columns: {
    attemptId: 'TEXT PRIMARY KEY', requestId: 'TEXT NOT NULL', apiKeyId: 'TEXT NOT NULL', ownerInstanceId: 'TEXT NOT NULL',
    startedAt: 'TEXT NOT NULL', finishedAt: 'TEXT', provider: 'TEXT NOT NULL', model: 'TEXT NOT NULL', endpoint: 'TEXT NOT NULL', connectionId: 'TEXT',
    state: "TEXT NOT NULL CHECK(state IN ('pending','settled','unresolved','not_dispatched','waived'))", outcome: 'TEXT',
    usageJson: 'TEXT', priceSnapshotJson: 'TEXT NOT NULL', intentJson: 'TEXT NOT NULL', terminalJson: 'TEXT',
    costNanoUsd: "INTEGER CHECK(costNanoUsd IS NULL OR (typeof(costNanoUsd)='integer' AND costNanoUsd>=0 AND costNanoUsd<=9000000000000000))",
    resolutionVersion: 'INTEGER NOT NULL DEFAULT 0', manuallyResolved: 'INTEGER NOT NULL DEFAULT 0',
  },
  indexes: [
    'CREATE INDEX IF NOT EXISTS idx_accounting_key_time_state ON apiKeyAccounting(apiKeyId,startedAt,state)',
    'CREATE INDEX IF NOT EXISTS idx_accounting_key_state ON apiKeyAccounting(apiKeyId,state)',
  ],
};
export const LEGACY_TABLES = { ...TABLES,
  apiKeyBindings: { columns: { apiKeyId: 'TEXT PRIMARY KEY', fingerprint: 'TEXT UNIQUE NOT NULL', createdAt: 'TEXT NOT NULL', retiredAt: 'TEXT' } },
  apiKeyAccounting: LEGACY_ACCOUNTING_TABLE,
  apiKeyAccountingAudit: { columns: {
    id: 'TEXT PRIMARY KEY', attemptId: 'TEXT', apiKeyId: 'TEXT', gapId: 'TEXT', operationId: 'TEXT UNIQUE NOT NULL',
    actor: 'TEXT NOT NULL', reason: 'TEXT NOT NULL', action: 'TEXT NOT NULL', beforeJson: 'TEXT NOT NULL', afterJson: 'TEXT NOT NULL', createdAt: 'TEXT NOT NULL',
  } },
};
