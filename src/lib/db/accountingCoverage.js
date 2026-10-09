import fs from "node:fs";
import path from "node:path";
import { createHmac, createHash, randomBytes, randomUUID } from "node:crypto";
import { atomicDurableWrite, synchronousResult } from "./durableFile.js";
import { MAINTENANCE_RELEASE_MAX_RECEIPTS, maintenanceReleasePayloadHash, validateMaintenanceReleaseAcknowledgements } from './maintenanceReleaseAcknowledgement.js';
import { POLICY_FORMAT_KEY, POLICY_FORMAT_VERSION } from "./explicitPolicy.js";

export const COVERAGE_FILE = ".accounting-coverage.json";
function unavailable() {
  const error = new Error("Accounting coverage artifacts unavailable or mismatched; operator recovery required");
  error.status = 503;
  error.code = "api_key_accounting_unavailable";
  return error;
}
function validate(state) {
  if (!state || state.version !== 1 || typeof state.id !== "string" || !/^[a-f0-9]{64}$/.test(state.bindingKey || "") ||
      !Number.isSafeInteger(state.generation) || state.generation < 0 || !Array.isArray(state.gaps) || !Array.isArray(state.retiredBindings)) throw unavailable();
  if (state.gaps.some(g => !g || typeof g.id !== "string" || !Number.isSafeInteger(g.generation) || typeof g.reason !== "string" ||
      !(g.apiKeyId === null || typeof g.apiKeyId === "string"))) throw unavailable();
  if (state.retiredBindings.some(b => !b || typeof b.apiKeyId !== "string" || !/^[a-f0-9]{64}$/.test(b.fingerprint || "") || typeof b.retiredAt !== "string")) throw unavailable();
  if (state.maintenance !== null && (!state.maintenance || !Number.isSafeInteger(state.maintenance.generation) || state.maintenance.generation > state.generation || typeof state.maintenance.reason !== "string")) throw unavailable();
  if (state.policyFormat !== undefined && state.policyFormat !== POLICY_FORMAT_VERSION) throw unavailable();
  if (state.gaps.some(g => g.generation < 1 || g.generation > state.generation || typeof g.startedAt !== "string" || g.resolvedAt !== undefined && (typeof g.resolvedAt !== "string" || typeof g.operationId !== "string"))) throw unavailable();
  try { validateMaintenanceReleaseAcknowledgements(state); } catch { throw unavailable(); }
  return state;
}
function read(file) {
  try {
    if (fs.statSync(file).size > 4 * 1024 * 1024) throw unavailable();
    return validate(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch { throw unavailable(); }
}
function requiredText(value, name, max = 2000) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Invalid ${name}`);
  return value.trim();
}

// Called by adapters before PRAGMA changes, timers or migrations. A mismatch
// must not cause even schema-only writes or SQL.js shutdown export.
export function validateAccountingArtifacts(get, directory) {
  const hasMeta = get("SELECT name FROM sqlite_master WHERE type='table' AND name='_meta'");
  const reference = hasMeta ? get("SELECT value FROM _meta WHERE key='accountingCoverageId'")?.value : null;
  const keyId = hasMeta ? get("SELECT value FROM _meta WHERE key='accountingBindingKeyId'")?.value : null;
  const activated = hasMeta ? get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")?.value : null;
  const policyFormat = hasMeta ? get("SELECT value FROM _meta WHERE key='accountingPolicyFormat'")?.value : undefined;
  const file = path.join(directory, COVERAGE_FILE);
  if (!fs.existsSync(file)) { if (reference || keyId || activated || policyFormat !== undefined) throw unavailable(); return; }
  const state = read(file);
  if (policyFormat !== state.policyFormat || policyFormat !== undefined && policyFormat !== POLICY_FORMAT_VERSION) throw unavailable();
  if (!reference && (state.generation > 0 || state.maintenance || state.gaps.length || state.retiredBindings.length)) throw unavailable();
  if (reference && reference !== state.id || keyId && keyId !== createHash("sha256").update(state.bindingKey).digest("hex") || activated && (!reference || !keyId)) throw unavailable();
  if (policyFormat === POLICY_FORMAT_VERSION) {
    // Matching markers alone are not policy integrity. Reject restored damage
    // before PRAGMA/migration/retired-key merge can perform any writes.
    if (get(`SELECT k.id FROM apiKeys k LEFT JOIN apiKeyBudgetPolicies p ON p.apiKeyId=k.id WHERE p.apiKeyId IS NULL LIMIT 1`)) throw unavailable();
    if (get(`SELECT apiKeyId FROM apiKeyBudgetPolicies WHERE
      typeof(version)!='integer' OR version<0 OR
      (version=0 AND (weeklyLimitNanoUsd IS NOT NULL OR monthlyLimitNanoUsd IS NOT NULL)) OR
      (weeklyLimitNanoUsd IS NOT NULL AND (typeof(weeklyLimitNanoUsd)!='integer' OR weeklyLimitNanoUsd<0 OR weeklyLimitNanoUsd>9000000000000000)) OR
      (monthlyLimitNanoUsd IS NOT NULL AND (typeof(monthlyLimitNanoUsd)!='integer' OR monthlyLimitNanoUsd<0 OR monthlyLimitNanoUsd>9000000000000000)) OR
      typeof(updatedAt)!='text' OR strftime('%Y-%m-%dT%H:%M:%fZ',updatedAt) IS NULL OR
      strftime('%Y-%m-%dT%H:%M:%fZ',updatedAt)!=updatedAt LIMIT 1`)) throw unavailable();
  }
}

// Only caller with acquired writer ownership may initialize or mutate this store.
// The sidecar is written BEFORE its database reference; a crash in between is
// resumable only pre-activation, using the existing same sidecar, never regeneration.
export function openAccountingCoverage(db, owner) {
  owner.assertOwned();
  const file = path.join(owner.directory, COVERAGE_FILE);
  const reference = db.get("SELECT value FROM _meta WHERE key='accountingCoverageId'")?.value;
  const activated = db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")?.value;
  let state;
  if (fs.existsSync(file)) state = read(file);
  else {
    if (reference || activated) throw unavailable();
    state = { version: 1, id: randomUUID(), bindingKey: randomBytes(32).toString("hex"), generation: 0, gaps: [], maintenance: null, retiredBindings: [] };
    atomicDurableWrite(file, JSON.stringify(state));
  }
  if (reference && reference !== state.id) throw unavailable();
  if (!reference) {
    if (activated || state.generation > 0 || state.maintenance || state.gaps.length || state.retiredBindings.length) throw unavailable();
    db.durableTransaction(() => db.run("INSERT INTO _meta(key,value) VALUES('accountingCoverageId',?)", [state.id]));
  }
  const keyId = createHash("sha256").update(state.bindingKey).digest("hex");
  const previousKeyId = db.get("SELECT value FROM _meta WHERE key='accountingBindingKeyId'")?.value;
  if (previousKeyId && previousKeyId !== keyId) throw unavailable();
  if (!previousKeyId) db.durableTransaction(() => db.run("INSERT INTO _meta(key,value) VALUES('accountingBindingKeyId',?)", [keyId]));

  let unhealthy = false;
  let policyTransition = false;
  function current() {
    owner.assertOwned();
    if (unhealthy) throw unavailable();
    const next = read(file);
    if (next.id !== state.id || next.bindingKey !== state.bindingKey || next.generation < state.generation || state.policyFormat !== undefined && next.policyFormat !== state.policyFormat) throw unavailable();
    // An existing handle cannot accept dropped/redefined acknowledgement history.
    // Whole-bundle rollback after process death remains outside v1 protection.
    // read() has already rejected duplicate operation IDs. Index serialized
    // rows once: retain exact row comparison without quadratic history scans.
    const acknowledgements = new Map((next.maintenanceReleases || []).map(row => [row.operationId, JSON.stringify(row)]));
    for (const receipt of state.maintenanceReleases || []) {
      if (acknowledgements.get(receipt.operationId) !== JSON.stringify(receipt)) throw unavailable();
    }
    if (!policyTransition && db.health().healthy) {
      const marker = db.get("SELECT value FROM _meta WHERE key=?", [POLICY_FORMAT_KEY])?.value;
      if (marker !== next.policyFormat) throw unavailable();
    }
    state = next;
    return next;
  }
  function mutate(fn) {
    const next = structuredClone(current());
    fn(next);
    const serialized = JSON.stringify(validate(next));
    if (Buffer.byteLength(serialized) > 4 * 1024 * 1024) throw unavailable();
    try { atomicDurableWrite(file, serialized); }
    catch (error) { unhealthy = true; throw error; }
    state = next;
    return status();
  }
  function status(apiKeyId = null) {
    const s = current();
    return { id: s.id, generation: s.generation, maintenance: s.maintenance,
      gaps: s.gaps.filter(g => apiKeyId === null || g.apiKeyId === null || g.apiKeyId === apiKeyId).map(g => ({ ...g })),
      bindingKeyId: keyId, policyFormat: s.policyFormat };
  }
  function fingerprint(secret) {
    current();
    if (typeof secret !== "string" || !secret || secret.length > 8192) throw new Error("Invalid API key binding");
    return createHmac("sha256", Buffer.from(state.bindingKey, "hex")).update(secret).digest("hex");
  }
  function legacyAttributionId(secret) {
    current();
    if (typeof secret !== "string" || !secret || secret.length > 8192) throw new Error("Invalid legacy attribution");
    // Domain-separated from retained credential bindings; the protected key is
    // stable across supported managed restores. Never expose binding material.
    return "legacy:" + createHmac("sha256", Buffer.from(state.bindingKey, "hex")).update("9router/usage-attribution/v1\0").update(secret).digest("hex");
  }
  function latchGap(apiKeyId, reason) {
    if (!(apiKeyId === null || typeof apiKeyId === "string" && apiKeyId.length > 0 && apiKeyId.length <= 200)) throw new Error("Invalid coverage scope");
    requiredText(reason, "gap reason");
    return mutate(s => {
      s.generation++;
      let gap = s.gaps.find(g => g.apiKeyId === apiKeyId && !g.resolvedAt);
      if (!gap) { gap = { id: randomUUID(), apiKeyId, startedAt: new Date().toISOString() }; s.gaps.push(gap); }
      Object.assign(gap, { generation: s.generation, reason, lastObservedAt: new Date().toISOString() });
    });
  }
  function retainRetiredBinding(apiKeyId, digest) {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("Invalid binding fingerprint");
    return mutate(s => {
      if (s.retiredBindings.some(b => b.apiKeyId === apiKeyId && b.fingerprint !== digest || b.fingerprint === digest && b.apiKeyId !== apiKeyId)) throw unavailable();
      if (!s.retiredBindings.some(b => b.apiKeyId === apiKeyId)) s.retiredBindings.push({ apiKeyId, fingerprint: digest, retiredAt: new Date().toISOString() });
    });
  }
  function reconcileGap({ gapId, apiKeyId, expectedGeneration, operationId, actor, reason, evidence }) {
    requiredText(operationId, "operationId", 200); requiredText(actor, "actor", 200);
    requiredText(reason, "reason"); requiredText(evidence, "evidence", 4000);
    const before = current().gaps.find(g => g.id === gapId);
    if (!before || before.apiKeyId !== apiKeyId || before.generation !== expectedGeneration || before.resolvedAt && before.operationId !== operationId) {
      const error = new Error("Coverage generation/scope conflict"); error.status = 409; throw error;
    }
    // JS synchronous DB+sidecar sequence freezes unrecorded admissions in this
    // single writer. In-flight completion cannot interleave without yielding.
    const payload = JSON.stringify({ gapId, apiKeyId, expectedGeneration, actor, reason, evidence });
    db.durableTransaction(() => {
      const previous = db.get("SELECT * FROM apiKeyAccountingAudit WHERE operationId=?", [operationId]);
      if (previous) {
        if (previous.action !== 'coverage_waiver' || previous.gapId !== gapId || previous.apiKeyId !== apiKeyId || previous.afterJson !== payload) {
          throw Object.assign(new Error('Recovery operation conflict'), { status: 409 });
        }
        return;
      }
      db.run(`INSERT INTO apiKeyAccountingAudit(id,apiKeyId,gapId,operationId,actor,reason,action,beforeJson,afterJson,createdAt)
        VALUES(?,?,?,?,?,?,?,?,?,?)`, [randomUUID(), apiKeyId, gapId, operationId, actor, reason, "coverage_waiver", JSON.stringify(before), payload, new Date().toISOString()]);
    });
    return mutate(s => {
      const gap = s.gaps.find(g => g.id === gapId);
      if (gap.apiKeyId !== apiKeyId || gap.generation !== expectedGeneration || gap.resolvedAt && gap.operationId !== operationId) throw Object.assign(new Error('Coverage generation/operation conflict'), { status: 409 });
      gap.resolvedAt ??= new Date().toISOString(); gap.operationId = operationId;
    });
  }
  function enterMaintenance(reason) {
    requiredText(reason, "maintenance reason");
    return mutate(s => { s.generation++; s.maintenance = { generation: s.generation, reason, startedAt: new Date().toISOString() }; });
  }
  function maintenanceReceipt(operation) {
    const s = current();
    const acknowledgement = (s.maintenanceReleases || []).find(row => row.operationId === operation.operationId);
    if (!acknowledgement) return null;
    const audit = db.get('SELECT * FROM apiKeyAccountingAudit WHERE operationId=?', [operation.operationId]);
    let after, before;
    try { after = JSON.parse(audit?.afterJson); before = JSON.parse(audit?.beforeJson); } catch { throw unavailable(); }
    if (audit?.action !== 'maintenance_release' || audit.gapId !== 'global-maintenance' || audit.apiKeyId !== null || audit.attemptId !== null ||
        JSON.stringify(after) !== JSON.stringify(operation) || before?.generation !== operation.expectedGeneration ||
        acknowledgement.generation !== operation.expectedGeneration || acknowledgement.coverageId !== s.id ||
        acknowledgement.payloadHash !== maintenanceReleasePayloadHash(s.id, operation)) throw Object.assign(new Error('Maintenance operation conflict'), { status: 409 });
    return { version: 1, kind: 'maintenance', action: 'maintenance_release', operationId: operation.operationId, generation: acknowledgement.generation, releasedAt: acknowledgement.releasedAt };
  }
  function releaseMaintenance({ expectedGeneration, operationId, actor, reason, evidence }) {
    requiredText(operationId, 'operationId', 200); requiredText(actor, 'actor', 200);
    requiredText(reason, 'reason'); requiredText(evidence, 'evidence', 4000);
    if (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 1) throw Object.assign(new Error('Maintenance generation conflict'), { status: 409 });
    const operation = { expectedGeneration, operationId, actor, reason, evidence };
    // Historical ACK replay is read-only, even when a later maintenance is active.
    if (maintenanceReceipt(operation)) return status();
    const s = current(), before = s.maintenance;
    if (!before || before.generation !== expectedGeneration) throw Object.assign(new Error('Maintenance generation conflict'), { status: 409 });
    // Permanent bounded history: never prune to admit another release. Check
    // before committing an intent so capacity cannot strand a new operation.
    if ((s.maintenanceReleases || []).length >= MAINTENANCE_RELEASE_MAX_RECEIPTS) throw unavailable();
    const payload = JSON.stringify(operation);
    db.durableTransaction(() => {
      const previous = db.get('SELECT * FROM apiKeyAccountingAudit WHERE operationId=?', [operationId]);
      if (previous) {
        if (previous.action !== 'maintenance_release' || previous.gapId !== 'global-maintenance' || previous.apiKeyId !== null || previous.attemptId !== null || previous.afterJson !== payload || JSON.parse(previous.beforeJson)?.generation !== expectedGeneration) throw Object.assign(new Error('Maintenance operation conflict'), { status: 409 });
        return;
      }
      db.run(`INSERT INTO apiKeyAccountingAudit(id,gapId,operationId,actor,reason,action,beforeJson,afterJson,createdAt)
        VALUES(?,?,?,?,?,?,?,?,?)`, [randomUUID(), 'global-maintenance', operationId, actor, reason, 'maintenance_release', JSON.stringify(before), payload, new Date().toISOString()]);
    });
    return mutate(next => {
      if (next.maintenance?.generation !== expectedGeneration) throw Object.assign(new Error('Maintenance generation conflict'), { status: 409 });
      next.maintenanceReleases ||= [];
      if (next.maintenanceReleases.length >= MAINTENANCE_RELEASE_MAX_RECEIPTS) throw unavailable();
      next.maintenanceReleases.push({ operationId, generation: expectedGeneration, coverageId: next.id,
        payloadHash: maintenanceReleasePayloadHash(next.id, operation), releasedAt: new Date().toISOString() });
      next.maintenance = null;
    });
  }
  function initializePolicyFormat(commit) {
    const before = current();
    if (before.policyFormat !== undefined || before.generation !== 0 || before.maintenance || before.gaps.length || before.retiredBindings.length) throw unavailable();
    policyTransition = true;
    try {
      mutate(s => { s.policyFormat = POLICY_FORMAT_VERSION; s.generation++; });
      const result = synchronousResult(commit());
      policyTransition = false;
      current();
      return result;
    } catch (error) {
      // Both uncertain sidecar and DB acknowledgements poison this handle.
      // Never auto-backfill on retry/reopen; mismatched artifacts need recovery.
      unhealthy = true;
      throw error;
    } finally { policyTransition = false; }
  }
  return { file, status, fingerprint, legacyAttributionId, latchGap, retainRetiredBinding, reconcileGap, enterMaintenance, releaseMaintenance, maintenanceReceipt, initializePolicyFormat,
    retiredBindings: () => structuredClone(current().retiredBindings) };
}
