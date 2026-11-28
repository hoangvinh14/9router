import { hasOpaqueOrdinaryDispatch } from '../../../open-sse/utils/ordinary-dispatch.js';
import { createHash } from 'node:crypto';
import { conflict, snapshotPayload, timestamp, unavailable } from './attempt-payload.js';
import { nanoUsd } from './exact-money.js';
import { assertAccountingHealthy, faultAccounting } from './process-state.js';
import { createNodeOuterTransaction, quarantineNodeAccountingConnection } from './node-outer-transaction.js';
import { createSqlOperationScope } from './sql-operation-scope.js';

// Existing apiKeys is the authentication source of truth. This internal layer
// stores only stable IDs/fingerprints/generation/policy; never plaintext secrets.
// Explicit setup, not called by startup. Rotation/import/delete hooks still must
// preserve or refuse binding changes; unexpected secret change always refuses.
const DDL = 'CREATE TABLE accounting_key_policy_v1 (key_id TEXT PRIMARY KEY NOT NULL, fingerprint TEXT NOT NULL UNIQUE, generation INTEGER NOT NULL, version INTEGER NOT NULL, retired INTEGER NOT NULL CHECK(retired IN (0,1)), weekly TEXT, monthly TEXT)';
const GENERATIONS = 'CREATE TABLE accounting_key_generations_v1 (key_id TEXT NOT NULL REFERENCES accounting_key_policy_v1(key_id), generation INTEGER NOT NULL, fingerprint TEXT NOT NULL UNIQUE, retired INTEGER NOT NULL CHECK(retired IN (0,1)), PRIMARY KEY (key_id, generation))';
const EVENTS = "CREATE TABLE accounting_admin_events_v1 (key_id TEXT PRIMARY KEY NOT NULL REFERENCES accounting_key_policy_v1(key_id), version INTEGER NOT NULL, previous_version INTEGER NOT NULL, generation INTEGER NOT NULL, action TEXT NOT NULL CHECK(action = 'retire'), actor_class TEXT NOT NULL CHECK(actor_class = 'dashboard-session'), occurred_at TEXT NOT NULL)";
const DEFS = {
  schema: { method: 'get', sql: 'SELECT sql FROM sqlite_schema WHERE type = ? AND name = ?' },
  keyById: { method: 'get', sql: 'SELECT id, key, isActive FROM apiKeys WHERE id = ?' },
  keyBySecret: { method: 'get', sql: 'SELECT id, key, isActive FROM apiKeys WHERE key = ?' },
  binding: { method: 'get', sql: 'SELECT * FROM accounting_key_policy_v1 WHERE key_id = ?' },
  emptyBinding: { method: 'get', sql: "SELECT key_id FROM accounting_key_policy_v1 WHERE key_id = '' LIMIT 1" },
  bindingPage: { method: 'all', sql: 'SELECT key_id FROM accounting_key_policy_v1 WHERE key_id > ? ORDER BY key_id LIMIT 3' },
  generation: { method: 'get', sql: 'SELECT key_id, generation FROM accounting_key_generations_v1 WHERE key_id = ? AND generation = ?' },
  generationPage: { method: 'all', sql: 'SELECT generation, fingerprint, retired FROM accounting_key_generations_v1 WHERE key_id = ? AND generation > ? ORDER BY generation LIMIT 3' },
  orphanGeneration: { method: 'get', sql: 'SELECT g.key_id FROM accounting_key_generations_v1 g LEFT JOIN accounting_key_policy_v1 p ON p.key_id = g.key_id WHERE p.key_id IS NULL OR typeof(g.generation) <> \'integer\' OR g.generation < 1 LIMIT 1' },
  invalidGeneration: { method: 'get', sql: 'SELECT key_id FROM accounting_key_generations_v1 WHERE key_id = ? AND (typeof(generation) <> \'integer\' OR generation < 1) LIMIT 1' },
  fingerprint: { method: 'get', sql: 'SELECT key_id FROM accounting_key_generations_v1 WHERE fingerprint = ?' },
  insertGeneration: { method: 'run', sql: 'INSERT INTO accounting_key_generations_v1 VALUES (?, ?, ?, 0)' },
  insertRetirementEvent: { method: 'run', sql: "INSERT INTO accounting_admin_events_v1 VALUES (?, ?, ?, ?, 'retire', 'dashboard-session', ?)" },
  eventPage: { method: 'all', sql: 'SELECT * FROM accounting_admin_events_v1 WHERE key_id > ? ORDER BY key_id, version LIMIT 3' },
  eventByKey: { method: 'get', sql: 'SELECT * FROM accounting_admin_events_v1 WHERE key_id = ?' },
  rotationReceipt: { method: 'get', sql: "SELECT value FROM kv WHERE scope = 'budgetKeyRotation' AND key = ?" },
  insertRotationReceipt: { method: 'run', sql: "INSERT INTO kv(scope, key, value) VALUES ('budgetKeyRotation', ?, ?)" },
  invalidEventId: { method: 'get', sql: "SELECT 1 AS invalid FROM accounting_admin_events_v1 WHERE typeof(key_id) <> 'text' OR key_id <= '' LIMIT 1" },
  retireGeneration: { method: 'run', sql: 'UPDATE accounting_key_generations_v1 SET retired = 1 WHERE key_id = ? AND generation = ? AND retired = 0' },
  rotateKey: { method: 'run', sql: 'UPDATE apiKeys SET key = ? WHERE id = ? AND key = ? AND isActive = 1' },
  rotatePolicy: { method: 'run', sql: 'UPDATE accounting_key_policy_v1 SET fingerprint = ?, generation = ?, version = version + 1 WHERE key_id = ? AND version = ? AND retired = 0' },
  retirePolicy: { method: 'run', sql: 'UPDATE accounting_key_policy_v1 SET retired = 1, version = version + 1 WHERE key_id = ? AND version = ? AND retired = 0' },
  disableKey: { method: 'run', sql: 'UPDATE apiKeys SET isActive = 0 WHERE id = ?' },
  insert: { method: 'run', sql: 'INSERT INTO accounting_key_policy_v1 VALUES (?, ?, 1, 1, 0, ?, ?)' },
  update: { method: 'run', sql: 'UPDATE accounting_key_policy_v1 SET weekly = ?, monthly = ?, version = version + 1 WHERE key_id = ? AND version = ? AND retired = 0' },
};
const digest = secret => createHash('sha256').update(secret).digest('hex');
export const isRotationOperationId = value => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
function id(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw unavailable();
  return value;
}
function assertPresentedSecret(secret) {
  if (typeof secret !== 'string' || !secret || secret.includes('\0')) throw unavailable();
}
function limits(value) {
  const copy = snapshotPayload(value);
  if (!copy || Object.keys(copy).sort().join(',') !== 'monthly,weekly') throw unavailable();
  for (const amount of Object.values(copy)) if (amount !== null) nanoUsd(amount);
  return copy;
}
function check(scope) {
  if (scope.schema(['table', 'accounting_key_policy_v1'])?.sql !== DDL ||
      scope.schema(['table', 'accounting_key_generations_v1'])?.sql !== GENERATIONS ||
      scope.schema(['table', 'accounting_admin_events_v1'])?.sql !== EVENTS) throw unavailable();
}
export const KEY_POLICY_EVENT_BY_KEY = Object.freeze({ eventByKey: Object.freeze(DEFS.eventByKey) });
export const KEY_POLICY_SETUP_DEFINITIONS = Object.freeze({
  createPolicy: Object.freeze({ method: 'run', sql: DDL }),
  createGenerations: Object.freeze({ method: 'run', sql: GENERATIONS }),
  createEvents: Object.freeze({ method: 'run', sql: EVENTS }),
});
function setupKeyPolicy(scope) {
  scope.createPolicy(); scope.createGenerations(); scope.createEvents(); check(scope);
}
export function initializeNodeKeyPolicy(adapter) {
  return createNodeOuterTransaction(adapter, { schema: DEFS.schema, ...KEY_POLICY_SETUP_DEFINITIONS })(setupKeyPolicy);
}
// Fixed read-only capability set for a trusted single-snapshot audit owner.
export const KEY_POLICY_AUDIT_DEFINITIONS = Object.freeze(Object.fromEntries(
  ['schema', 'keyById', 'binding', 'bindingPage', 'generationPage', 'orphanGeneration', 'invalidGeneration', 'generation', 'emptyBinding', 'eventPage', 'invalidEventId'].map(name => [name, Object.freeze({ ...DEFS[name] })])
));
// The final dispatch transaction reads the same binding facts as resolve().
export const KEY_POLICY_RESOLVE_DEFINITIONS = Object.freeze({
  ...Object.fromEntries(['schema', 'keyBySecret', 'binding', 'generationPage', 'invalidGeneration']
    .map(name => [name, Object.freeze({ ...DEFS[name] })])),
});

// Existing repository mutation owns the transaction. Fixed reads only: never
// nest an outer accounting transaction or create schema/dispatch authority.
export function assertAccountingKeyActivationAllowed(adapter, keyId) {
  let allowed;
  try {
    assertAccountingHealthy();
    const execute = createSqlOperationScope(adapter, {
      ...KEY_POLICY_AUDIT_DEFINITIONS,
      markers: { method: 'all', sql: 'SELECT name, type FROM sqlite_schema WHERE name IN (?, ?, ?, ?, ?)' },
    });
    allowed = execute(scope => {
      const names = ['accounting_attempts_v1', 'accounting_terminals_v1', 'accounting_key_policy_v1', 'accounting_key_generations_v1', 'accounting_admin_events_v1'];
      const markers = scope.markers(names);
      if (markers.length === 0) return true; // observed ordinary schema only
      id(keyId);
      if (adapter.raw?.isTransaction !== true) throw unavailable();
      if (markers.length !== names.length || names.some(name => !markers.some(row => row.name === name && row.type === 'table'))) throw unavailable();
      const validator = createKeyPolicyReadValidator(() => { throw unavailable(); });
      validator.check(scope);
      if (scope.orphanGeneration()) throw unavailable();
      const key = scope.keyById([keyId]);
      if (!key || ![0, 1].includes(key.isActive) || typeof key.key !== 'string' || !key.key || key.key.includes('\0')) throw unavailable();
      // This mode skips ONLY the final business refusal of retired identities;
      // it still verifies current secret/fingerprint, version and full history.
      const binding = validator.readBinding(scope, key, true);
      return binding?.retired !== 1;
    });
  } catch {
    faultAccounting();
    try { quarantineNodeAccountingConnection(adapter); } catch {}
    throw unavailable();
  }
  // Expected lifecycle denial is not a SQL fault and must not poison the owner.
  if (!allowed) throw unavailable();
}

// Shared interpretation for whole-history integrity and addressed management
// observation. Presence validates a recorded fact, never completeness or ACK.
function validateRetirementEvent(event, binding) {
  id(event.key_id); timestamp(event.occurred_at);
  if (event.action !== 'retire' || event.actor_class !== 'dashboard-session' ||
      !Number.isSafeInteger(event.version) || !Number.isSafeInteger(event.previous_version) ||
      event.previous_version < 1 || event.version !== event.previous_version + 1 ||
      !Number.isSafeInteger(event.generation) || event.generation < 1 ||
      !binding || binding.key_id !== event.key_id || binding.retired !== 1 ||
      binding.version !== event.version || binding.generation !== event.generation) throw unavailable();
}

const publicPolicy = row => Object.freeze({ keyId: row.key_id, bindingGeneration: String(row.generation), version: row.version,
    limits: Object.freeze({ weekly: row.weekly, monthly: row.monthly }) });

const inactiveKey = () => Object.assign(new Error('API key is inactive'), { code: 'budget_key_inactive', status: 409 });

export function createKeyPolicyReadValidator(corrupt) {
  // One retirement event per stable identity: retirement is irreversible in
  // this profile. Internal primitive retirement may have no admin event; public
  // retirement MUST insert one. Existing events never prove delivered ACK.
  const auditEvents = scope => {
    if (scope.invalidEventId()) corrupt();
    let after = '';
    for (let pages = 0; pages < 33334; pages++) {
      const rows = scope.eventPage([after]);
      for (const event of rows) {
        try {
          if (event.key_id <= after) throw unavailable();
          validateRetirementEvent(event, scope.binding([event.key_id]));
        } catch { corrupt(); }
        after = event.key_id;
      }
      if (rows.length < 3) return;
    }
    throw unavailable();
  };
  const readBinding = (scope, key, historical = false) => {
    check(scope);
    const row = scope.binding([key.id]);
    if (!row) return null;
    try {
      id(row.key_id);
      if (row.key_id !== key.id || row.fingerprint !== digest(key.key) || ![0, 1].includes(row.retired) ||
          (row.retired === 1 && key.isActive !== 0) ||
          !Number.isSafeInteger(row.version) || row.version < 1 || !Number.isSafeInteger(row.generation) || row.generation < 1 ||
          row.version < row.generation || (row.retired === 1 && row.version <= row.generation)) throw unavailable();
      limits({ weekly: row.weekly, monthly: row.monthly });
      if (scope.invalidGeneration([row.key_id])) throw unavailable();
      let after = 0; let complete = false;
      for (let pages = 0; pages < 33334; pages++) {
        const generations = scope.generationPage([row.key_id, after]);
        for (const generation of generations) {
          if (!Number.isSafeInteger(generation.generation) || generation.generation !== after + 1 ||
              generation.generation > row.generation || typeof generation.fingerprint !== 'string' ||
              !/^[a-f0-9]{64}$/.test(generation.fingerprint) ||
              generation.retired !== (generation.generation === row.generation ? row.retired : 1)) throw unavailable();
          if (generation.generation === row.generation && generation.fingerprint !== row.fingerprint) throw unavailable();
          after = generation.generation;
        }
        if (generations.length < 3) { complete = true; break; }
      }
      if (!complete || after !== row.generation) throw unavailable();
    } catch { corrupt(); }
    if (row.retired && !historical) throw unavailable();
    return row;
  };
  const resolve = (scope, presentedSecret) => {
    assertPresentedSecret(presentedSecret);
    const key = scope.keyBySecret([presentedSecret]);
    if (!key || key.isActive !== 1) throw unavailable();
    return readBinding(scope, key);
  };
  return Object.freeze({
    check, readBinding, resolve,
    inspectPolicy(scope, keyId, allowNew = false) {
      check(scope);
      if (scope.emptyBinding() || scope.orphanGeneration()) corrupt();
      const key = scope.keyById([keyId]);
      if (!key) throw unavailable();
      if (key.id !== keyId || ![0, 1].includes(key.isActive) || typeof key.key !== 'string' ||
          !key.key || key.key.includes('\0')) corrupt();
      // Skip ONLY retired-business refusal, not secret/history invariants.
      const binding = readBinding(scope, key, true);
      if (!binding) {
        if (allowNew && !scope.eventByKey([keyId])) return null;
        throw unavailable();
      }
      return { ...publicPolicy(binding), lifecycle: binding.retired ? 'retired' : key.isActive ? 'active' : 'disabled' };
    },
    // Historical linkage only: current admission was validated independently.
    // Retired generations remain valid original-attempt provenance, not rights.
    validateAttemptGeneration(scope, keyId, generation) {
      try {
        id(keyId);
        if (typeof generation !== 'string' || !/^[1-9]\d{0,15}$/.test(generation) ||
            !Number.isSafeInteger(Number(generation))) throw unavailable();
        const row = scope.generation([keyId, Number(generation)]);
        if (!row || row.key_id !== keyId || String(row.generation) !== generation) throw unavailable();
      } catch { corrupt(); }
    },
    audit(scope) {
      check(scope);
      if (scope.emptyBinding() || scope.orphanGeneration()) corrupt();
      auditEvents(scope);
      let count = 0; let after = '';
      for (let pages = 0; pages < 33334; pages++) {
        const rows = scope.bindingPage([after]);
        for (const row of rows) {
          let key;
          try {
            id(row.key_id);
            if (row.key_id <= after) throw unavailable();
            key = scope.keyById([row.key_id]);
            if (!key || key.id !== row.key_id || ![0, 1].includes(key.isActive) ||
                typeof key.key !== 'string' || !key.key || key.key.includes('\0')) throw unavailable();
          } catch { corrupt(); }
          if (!readBinding(scope, key, true)) corrupt();
          after = row.key_id; count++;
        }
        if (rows.length < 3) return Object.freeze({ validatedBindings: count });
      }
      throw unavailable();
    },
  });
}
export function createNodeKeyPolicy(adapter) {
  const transact = createNodeOuterTransaction(adapter, DEFS);
  transact(check);
  const corrupt = () => { quarantineNodeAccountingConnection(adapter); faultAccounting(); throw unavailable(); };
  const { readBinding, resolve, audit, inspectPolicy } = createKeyPolicyReadValidator(corrupt);
  const readRotationReceipt = (scope, operationId) => {
    const row = scope.rotationReceipt([operationId]);
    if (!row) return null;
    try {
      const { operationId: recordedId, keyId, previousVersion, version, bindingGeneration, occurredAt, action, actorClass } = JSON.parse(row.value);
      id(keyId);
      timestamp(occurredAt);
      const generation = Number(bindingGeneration);
      const binding = scope.binding([keyId]);
      if (recordedId !== operationId || action !== 'rotate' || actorClass !== 'dashboard-session' ||
          !Number.isSafeInteger(previousVersion) || previousVersion < 1 ||
          !Number.isSafeInteger(version) || version !== previousVersion + 1 ||
          !Number.isSafeInteger(generation) || generation < 2 || String(generation) !== bindingGeneration ||
          generation > version || !binding || binding.version < version || binding.generation < generation ||
          !scope.generation([keyId, generation])) throw unavailable();
      return { operationId, keyId, previousVersion, version, bindingGeneration, occurredAt, action, actorClass };
    } catch { corrupt(); }
  };
  // Both management projections reuse ONE target/history snapshot. Optional
  // event absence means only no recorded event, never never-retired/completeness.
  const inspect = (keyId, includeEvent) => {
    assertAccountingHealthy();
    id(keyId);
    const result = transact(scope => {
      const policy = inspectPolicy(scope, keyId);
      if (!includeEvent) return { policy };
      const event = scope.eventByKey([keyId]);
      if (event) {
        try { validateRetirementEvent(event, scope.binding([keyId])); } catch { corrupt(); }
      }
      return { policy, retirementEvent: event ? { action: event.action, actorClass: event.actor_class,
        occurredAt: event.occurred_at, version: event.version, previousVersion: event.previous_version,
        bindingGeneration: String(event.generation) } : null };
    }).value;
    Object.freeze(result.policy.limits); Object.freeze(result.policy);
    if (result.retirementEvent) Object.freeze(result.retirementEvent);
    return Object.freeze(result);
  };
  // Single transition implementation shared by trusted internal fixtures and
  // authenticated public management. No method derives an actor from clients.
  const retire = (keyId, expectedVersion, audited) => {
    assertAccountingHealthy();
    id(keyId);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw unavailable();
    const occurredAt = audited ? new Date().toISOString() : null;
    let collision = false;
    transact(scope => {
      const key = scope.keyById([keyId]);
      if (!key) throw unavailable();
      const previous = readBinding(scope, key);
      if (!previous || previous.version !== expectedVersion) { collision = true; return; }
      if (previous.version >= Number.MAX_SAFE_INTEGER) throw unavailable();
      if (audited) timestamp(occurredAt);
      if (scope.retireGeneration([keyId, previous.generation]).changes !== 1 ||
          scope.retirePolicy([keyId, expectedVersion]).changes !== 1 || scope.disableKey([keyId]).changes !== 1) corrupt();
      if (audited && scope.insertRetirementEvent([keyId, expectedVersion + 1, expectedVersion, previous.generation, occurredAt]).changes !== 1) corrupt();
      readBinding(scope, scope.keyById([keyId]), true);
    });
    if (collision) throw conflict();
    return Object.freeze({ retired: true });
  };
  const rotate = (keyId, expectedVersion, expectedSecret, replacementSecret, operationId) => {
    assertAccountingHealthy();
    id(keyId);
    assertPresentedSecret(replacementSecret);
    if (operationId === null) assertPresentedSecret(expectedSecret);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw unavailable();
    const { value } = transact(scope => {
      if (operationId !== null) {
        const receipt = readRotationReceipt(scope, operationId);
        if (receipt) return receipt.keyId === keyId && receipt.previousVersion === expectedVersion ? { receipt } : null;
      }
      const key = scope.keyById([keyId]);
      if (!key || key.isActive !== 1) throw unavailable();
      const previous = readBinding(scope, key);
      if (!previous || previous.version !== expectedVersion ||
          (operationId === null && key.key !== expectedSecret)) return null;
      if (previous.generation >= Number.MAX_SAFE_INTEGER || previous.version >= Number.MAX_SAFE_INTEGER) throw unavailable();
      const fingerprint = digest(replacementSecret);
      if (scope.fingerprint([fingerprint]) || scope.keyBySecret([replacementSecret])) return null;
      if (scope.retireGeneration([keyId, previous.generation]).changes !== 1 ||
          scope.rotateKey([replacementSecret, keyId, key.key]).changes !== 1) corrupt();
      scope.insertGeneration([keyId, previous.generation + 1, fingerprint]);
      if (scope.rotatePolicy([fingerprint, previous.generation + 1, keyId, expectedVersion]).changes !== 1) corrupt();
      const policy = publicPolicy(readBinding(scope, scope.keyById([keyId])));
      if (operationId === null) return { policy };
      const receipt = { operationId, keyId, previousVersion: expectedVersion, version: policy.version,
        bindingGeneration: policy.bindingGeneration, occurredAt: new Date().toISOString(),
        action: 'rotate', actorClass: 'dashboard-session' };
      if (scope.insertRotationReceipt([operationId, JSON.stringify(receipt)]).changes !== 1) corrupt();
      return { policy, receipt };
    });
    if (!value) throw conflict();
    return value;
  };
  return Object.freeze({
    // Read-only prerequisite for enrolled restart, NOT restart admission. Use
    // the same runtime binding validator for every key, including disabled
    // keys. No presented secret needed and no secret/fingerprint returned.
    validateExistingBindings() {
      assertAccountingHealthy();
      // Scope returns a detached JSON copy; freeze at the public boundary.
      return Object.freeze(transact(audit).value);
    },
    // Management observation of an EXISTING bound identity only. Same snapshot,
    // no schema setup, permission/ACK, no absent-policy downgrade or recovery.
    inspect(keyId) { return inspect(keyId, false).policy; },
    // Recorded retirement event only, NOT full admin history, ACK or recovery.
    inspectRetirement(keyId) { return inspect(keyId, true); },
    save(keyId, expectedVersion, requestedLimits) {
      id(keyId); const copied = limits(requestedLimits);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw unavailable();
      let collision = false; let inactive = false; let result;
      transact(scope => {
        const key = scope.keyById([keyId]);
        if (key?.isActive === 0) { inactive = true; return; }
        if (!key || key.isActive !== 1 || typeof key.key !== 'string' || !key.key || key.key.includes('\0')) throw unavailable();
        const previous = readBinding(scope, key);
        if ((previous?.version ?? 0) !== expectedVersion) { collision = true; return; }
        if (previous?.version >= Number.MAX_SAFE_INTEGER) throw unavailable();
        if (!previous) {
          if (hasOpaqueOrdinaryDispatch(key.key)) { collision = true; return; }
          const fingerprint = digest(key.key);
          if (scope.fingerprint([fingerprint])) { collision = true; return; }
          scope.insert([keyId, fingerprint, copied.weekly, copied.monthly]);
          scope.insertGeneration([keyId, 1, fingerprint]);
        }
        else if (scope.update([copied.weekly, copied.monthly, keyId, expectedVersion]).changes !== 1) { corrupt(); }
        result = publicPolicy(readBinding(scope, key));
      });
      if (inactive) throw inactiveKey();
      if (collision) throw conflict();
      return result;
    },
    rotate(keyId, expectedVersion, expectedSecret, replacementSecret) {
      return rotate(keyId, expectedVersion, expectedSecret, replacementSecret, null).policy;
    },
    rotateAudited(keyId, expectedVersion, operationId, replacementSecret) {
      if (!isRotationOperationId(operationId)) throw unavailable();
      return rotate(keyId, expectedVersion, null, replacementSecret, operationId);
    },
    inspectRotation(keyId, operationId) {
      id(keyId);
      if (!isRotationOperationId(operationId)) throw unavailable();
      return transact(scope => {
        const receipt = readRotationReceipt(scope, operationId);
        return receipt?.keyId === keyId ? receipt : null;
      }).value;
    },
    // Trusted internal primitive only; no production public caller may use this
    // unaudited seam. Route uses retireAudited after strict session/Origin gate.
    retire(keyId, expectedVersion) { return retire(keyId, expectedVersion, false); },
    retireAudited(keyId, expectedVersion) { return retire(keyId, expectedVersion, true); },
    resolve(presentedSecret) {
      assertAccountingHealthy();
      assertPresentedSecret(presentedSecret);
      let result = null;
      transact(scope => {
        const row = resolve(scope, presentedSecret);
        if (row) result = publicPolicy(row);
      });
      return result; // genuine ordinary key has no accounting policy
    },
    // Final gate caller resolves again synchronously from server-held original
    // secret. Never accepts a client keyId or limits as authorization.
    current(presentedSecret, expected) {
      const result = this.resolve(presentedSecret);
      if (!result || result.keyId !== expected.keyId || result.bindingGeneration !== expected.bindingGeneration) throw unavailable();
      return result;
    },
  });
}
