import { unavailable } from './attempt-payload.js';
import { faultAccounting } from './process-state.js';
import { createNodeOuterTransaction, quarantineNodeAccountingConnection } from './node-outer-transaction.js';
import { KEY_POLICY_AUDIT_DEFINITIONS, KEY_POLICY_SETUP_DEFINITIONS, createKeyPolicyReadValidator } from './node-key-policy.js';
import { LEDGER_AUDIT_DEFINITIONS, LEDGER_SETUP_DEFINITIONS, createLedgerReadValidator } from './node-attempt-ledger.js';

import { APP_SCHEMA_READ_DEFINITIONS, createAppSchemaReadValidator } from '../db/app-schema-work.js';

const standaloneSqlite = 'existing-sqlite-v1';
const readyLineage = new Set(['imported-v1', 'no-input-v1', standaloneSqlite]);
const lineage = Object.freeze({ importLineage: Object.freeze({ method: 'get',
  sql: "SELECT value FROM main._meta WHERE key = 'legacyImportState'" }) });

// Fixed immutable unions; only the identical accounting schema read is shared.
function auditDefinitions(...groups) {
  const definitions = Object.create(null);
  for (const group of [KEY_POLICY_AUDIT_DEFINITIONS, LEDGER_AUDIT_DEFINITIONS, ...groups]) {
    for (const [name, definition] of Object.entries(group)) {
      if (Object.hasOwn(definitions, name) && (name !== 'schema' ||
          definitions[name].method !== definition.method || definitions[name].sql !== definition.sql)) throw unavailable();
      definitions[name] = definition;
    }
  }
  return Object.freeze(definitions);
}
const definitions = auditDefinitions();
const startupDefinitions = auditDefinitions(APP_SCHEMA_READ_DEFINITIONS, lineage);
const recordExistingSqlite = Object.freeze({ recordExistingSqlite: Object.freeze({ method: 'run',
  sql: "INSERT INTO main._meta (key, value) VALUES ('legacyImportState', 'existing-sqlite-v1')" }) });
const provisionDefinitions = auditDefinitions(APP_SCHEMA_READ_DEFINITIONS, lineage, recordExistingSqlite,
  KEY_POLICY_SETUP_DEFINITIONS, LEDGER_SETUP_DEFINITIONS);
const project = (scope, group) => Object.freeze(Object.fromEntries(Object.keys(group).map(name => [name, scope[name]])));

function auditRows(adapter, scope) {
  const corrupt = () => {
    quarantineNodeAccountingConnection(adapter); faultAccounting(); throw unavailable();
  };
  const policy = createKeyPolicyReadValidator(corrupt);
  const ledger = createLedgerReadValidator(corrupt);
  const policyScope = project(scope, KEY_POLICY_AUDIT_DEFINITIONS);
  const bindings = policy.audit(policyScope);
  const attempts = ledger.audit(project(scope, LEDGER_AUDIT_DEFINITIONS),
    (keyId, generation) => policy.validateAttemptGeneration(policyScope, keyId, generation));
  return { ...bindings, ...attempts };
}

// Structural/row audit only; not app-schema work or dispatch authority.
export function auditExistingNodeAccounting(adapter) {
  const transact = createNodeOuterTransaction(adapter, definitions);
  return Object.freeze(transact(scope => auditRows(adapter, scope)).value);
}

// No migration, initializer, restore provenance or dispatch authority. Check
// app work, import completion and the full accounting audit in one snapshot.
export function auditMarkedNodeStartup(adapter) {
  createNodeOuterTransaction(adapter, startupDefinitions)(scope => {
    if (createAppSchemaReadValidator().classify(project(scope, APP_SCHEMA_READ_DEFINITIONS)).kind !== 'current' ||
        !readyLineage.has(scope.importLineage()?.value)) throw unavailable();
    auditRows(adapter, scope);
    return true;
  });
}

// Internal DDL operation for an offline instance without accounting state.
// No policy, profile or credential is created by this operation.
export function provisionEmptyNodeAccountingSchema(adapter, { existingSqlite = false } = {}) {
  createNodeOuterTransaction(adapter, provisionDefinitions)(scope => {
    const importState = scope.importLineage();
    if ((existingSqlite ? importState && !readyLineage.has(importState.value) : importState?.value !== 'no-input-v1') ||
        scope.appObjects().some(row => row.name.toLowerCase().startsWith('accounting_')) ||
        createAppSchemaReadValidator().classify(project(scope, APP_SCHEMA_READ_DEFINITIONS)).kind !== 'current') throw unavailable();
    if (existingSqlite && !importState) scope.recordExistingSqlite();
    scope.createPolicy(); scope.createGenerations(); scope.createEvents();
    scope.createAttempts(); scope.createTerminals();
    auditRows(adapter, scope);
    return true;
  });
}
