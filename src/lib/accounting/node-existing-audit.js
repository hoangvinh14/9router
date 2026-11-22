import { unavailable } from './attempt-payload.js';
import { faultAccounting } from './process-state.js';
import { createNodeOuterTransaction, quarantineNodeAccountingConnection } from './node-outer-transaction.js';
import { KEY_POLICY_AUDIT_DEFINITIONS, KEY_POLICY_SETUP_DEFINITIONS, createKeyPolicyReadValidator } from './node-key-policy.js';
import { LEDGER_AUDIT_DEFINITIONS, LEDGER_SETUP_DEFINITIONS, createLedgerReadValidator } from './node-attempt-ledger.js';

import { APP_SCHEMA_READ_DEFINITIONS, createAppSchemaReadValidator } from '../db/app-schema-work.js';

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
const provisionDefinitions = auditDefinitions(APP_SCHEMA_READ_DEFINITIONS, lineage,
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
        !['imported-v1', 'no-input-v1'].includes(scope.importLineage()?.value)) throw unavailable();
    auditRows(adapter, scope);
    return true;
  });
}

// Internal DDL operation; only the offline bootstrap owns freshness provenance.
// No policy, profile or credential is created by this operation.
export function provisionEmptyNodeAccountingSchema(adapter) {
  createNodeOuterTransaction(adapter, provisionDefinitions)(scope => {
    if (scope.importLineage()?.value !== 'no-input-v1' ||
        scope.appObjects().some(row => row.name.toLowerCase().startsWith('accounting_')) ||
        createAppSchemaReadValidator().classify(project(scope, APP_SCHEMA_READ_DEFINITIONS)).kind !== 'current') throw unavailable();
    scope.createPolicy(); scope.createGenerations(); scope.createEvents();
    scope.createAttempts(); scope.createTerminals();
    auditRows(adapter, scope);
    return true;
  });
}
