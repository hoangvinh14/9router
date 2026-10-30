import { randomUUID } from "node:crypto";
import { canonical, conflict, snapshotPayload, text, timestamp } from "../../accounting/attempt-payload.js";
import { costFromExactUsageSnapshot, nanoUsd, validatePriceSnapshot } from "../../accounting/exact-money.js";

function persistedJson(value) {
  try { return JSON.parse(value); }
  catch (cause) { throw new Error('Invalid persisted accounting evidence', { cause }); }
}
function attempt(row) {
  if (!row) return null;
  const { priceSnapshotJson, usageJson, terminalJson: _terminal, intentJson: _intent, ...rest } = row;
  return { ...rest, costNanoUsd: row.costNanoUsd === null ? null : String(row.costNanoUsd), priceSnapshot: persistedJson(priceSnapshotJson), usage: usageJson ? persistedJson(usageJson) : null };
}
export function getAttemptSync(db, id) { return attempt(db.get("SELECT * FROM apiKeyAccounting WHERE attemptId=?", [id])); }
export function insertAttemptMutation(db, input) {
  input = snapshotPayload(input);
  const allowed = ["attemptId", "requestId", "apiKeyId", "ownerInstanceId", "startedAt", "provider", "model", "endpoint", "connectionId", "priceSnapshot"];
  if (Object.keys(input).some(k => !allowed.includes(k))) throw new Error("Invalid intent field");
  for (const field of ["attemptId", "requestId", "apiKeyId", "ownerInstanceId", "provider", "model", "endpoint"]) text(input[field], field);
  timestamp(input.startedAt); validatePriceSnapshot(input.priceSnapshot);
  if (input.connectionId != null) text(input.connectionId, "connection ID");
  input.connectionId ??= null;
  const payload = canonical(input), prior = db.get("SELECT * FROM apiKeyAccounting WHERE attemptId=?", [input.attemptId]);
  if (prior) {
    if (prior.intentJson !== payload) throw conflict("Attempt identity/snapshot conflict");
    return getAttemptSync(db, input.attemptId);
  }
  db.run("INSERT INTO apiKeyAccounting(attemptId,requestId,apiKeyId,ownerInstanceId,startedAt,provider,model,endpoint,connectionId,state,priceSnapshotJson,intentJson) VALUES(?,?,?,?,?,?,?,?,?,'pending',?,?)",
    [input.attemptId, input.requestId, input.apiKeyId, input.ownerInstanceId, input.startedAt, input.provider, input.model, input.endpoint, input.connectionId, canonical(input.priceSnapshot), payload]);
  return getAttemptSync(db, input.attemptId);
}
export function insertAttemptSync(db, input) { return db.durableTransaction(() => insertAttemptMutation(db, input)); }

export function finalizeAttemptMutation(db, id, terminal) {
  terminal = snapshotPayload(terminal);
  if (!terminal || Object.keys(terminal).some(k => !["state", "outcome", "finishedAt", "usage", "notDispatchedEvidence", "evidence"].includes(k)) || !["settled", "unresolved", "not_dispatched", "unrecorded"].includes(terminal.state)) throw new Error("Invalid terminal state/fields");
  timestamp(terminal.finishedAt); text(terminal.outcome, "outcome");
  if (terminal.evidence !== undefined) {
    const e = terminal.evidence;
    if (!e || Object.keys(e).some(k => !['kind', 'interrupted'].includes(k)) || !['absent','valid','malformed','conflicting'].includes(e.kind) || typeof e.interrupted !== 'boolean') throw new Error('Invalid terminal evidence');
  }
  if (terminal.state === 'unrecorded' && (terminal.evidence?.kind !== 'absent' || terminal.evidence.interrupted !== true)) throw new Error('Unrecorded requires interrupted absent evidence');
  if (terminal.evidence && terminal.state === 'settled' && terminal.evidence.kind !== 'valid') throw new Error('Settlement requires valid evidence');
  const row = db.get("SELECT * FROM apiKeyAccounting WHERE attemptId=?", [id]);
  if (!row) throw new Error("Unknown attempt");
  const payload = canonical(terminal);
  if (row.terminalJson === payload) return getAttemptSync(db, id);
  let cost = null;
  if (terminal.state === "settled") cost = costFromExactUsageSnapshot(terminal.usage, persistedJson(row.priceSnapshotJson));
  else if (terminal.usage !== undefined) throw new Error("Non-settlement cannot claim exact usage");
  if (terminal.state === "not_dispatched") text(terminal.notDispatchedEvidence, "not-dispatched evidence");
  else if (terminal.notDispatchedEvidence !== undefined) throw new Error("Invalid not-dispatched evidence");
  if (row.manuallyResolved || row.state !== "pending" && !(['unresolved', 'unrecorded'].includes(row.state) && terminal.state === "settled")) {
    const operationId = `observation:${id}:${payload}`;
    db.run("INSERT OR IGNORE INTO apiKeyAccountingAudit(id,attemptId,apiKeyId,operationId,actor,reason,action,beforeJson,afterJson,createdAt) VALUES(?,?,?,?,? ,?,'observation_conflict',?,?,?)",
      [randomUUID(), id, row.apiKeyId, operationId, "accounting_callback", "Conflicting terminal observation", canonical(attempt(row)), payload, new Date().toISOString()]);
    return { observationConflict: true };
  }
  const result = db.run("UPDATE apiKeyAccounting SET state=?,outcome=?,finishedAt=?,usageJson=?,costNanoUsd=?,terminalJson=?,resolutionVersion=resolutionVersion+1 WHERE attemptId=? AND resolutionVersion=?",
    [terminal.state, terminal.outcome, terminal.finishedAt, terminal.usage ? canonical(terminal.usage) : null, cost === null ? null : Number(cost), payload, id, row.resolutionVersion]);
  if (Number(result.changes) !== 1) throw conflict("Attempt resolution version conflict");
  return getAttemptSync(db, id);
}
export function finalizeAttemptSync(db, id, terminal) {
  const result = db.durableTransaction(() => finalizeAttemptMutation(db, id, terminal));
  if (result.observationConflict) throw conflict("Attempt terminal observation conflict");
  return result;
}
export function resolveAttemptSync(db, id, input) {
  const operation = snapshotPayload(input);
  for (const field of ["operationId", "actor", "reason", "evidence"]) text(operation[field], field, field === "evidence" ? 4000 : 512);
  if (!Number.isSafeInteger(operation.expectedVersion) || operation.expectedVersion < 0 || !["waive", "exact_usage", "cost_correction"].includes(operation.action)) throw conflict();
  const allowed = ["operationId", "actor", "reason", "evidence", "expectedVersion", "action", ...(operation.action === "exact_usage" ? ["usage"] : operation.action === "cost_correction" ? ["costNanoUsd"] : [])];
  if (Object.keys(operation).some(k => !allowed.includes(k))) throw new Error("Invalid recovery field");
  const payload = canonical(operation);
  return db.durableTransaction(() => {
    const previous = db.get("SELECT * FROM apiKeyAccountingAudit WHERE operationId=?", [operation.operationId]);
    if (previous) {
      if (previous.attemptId !== id || previous.afterJson !== payload) throw conflict();
      return getAttemptSync(db, id);
    }
    const row = db.get("SELECT * FROM apiKeyAccounting WHERE attemptId=?", [id]);
    if (!row || row.state !== "unresolved" || row.resolutionVersion !== operation.expectedVersion) throw conflict("Recovery resolution version/state conflict");
    const cost = operation.action === "exact_usage" ? costFromExactUsageSnapshot(operation.usage, persistedJson(row.priceSnapshotJson)) : operation.action === "waive" ? "0" : nanoUsd(operation.costNanoUsd);
    const result = db.run("UPDATE apiKeyAccounting SET state=?,costNanoUsd=?,usageJson=?,manuallyResolved=1,resolutionVersion=resolutionVersion+1 WHERE attemptId=? AND resolutionVersion=?",
      [operation.action === "waive" ? "waived" : "settled", Number(cost), operation.usage ? canonical(operation.usage) : row.usageJson, id, operation.expectedVersion]);
    if (Number(result.changes) !== 1) throw conflict();
    db.run("INSERT INTO apiKeyAccountingAudit(id,attemptId,apiKeyId,operationId,actor,reason,action,beforeJson,afterJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?)",
      [randomUUID(), id, row.apiKeyId, operation.operationId, operation.actor, operation.reason, operation.action, canonical(attempt(row)), payload, new Date().toISOString()]);
    return getAttemptSync(db, id);
  });
}
export function recoverPendingSync(db, ownerInstanceId = null) {
  return db.durableTransaction(() => {
    // Coverage is loaded before lifecycle recovery. Never infer absence from
    // unavailable sidecar evidence or from a detected recording failure.
    const candidates = db.all("SELECT attemptId,apiKeyId FROM apiKeyAccounting WHERE state='pending' AND usageJson IS NULL AND costNanoUsd IS NULL AND terminalJson IS NULL AND NOT EXISTS (SELECT 1 FROM apiKeyAccountingAudit a WHERE a.attemptId=apiKeyAccounting.attemptId)" + (ownerInstanceId ? " AND ownerInstanceId=?" : ""), ownerInstanceId ? [ownerInstanceId] : []);
    for (const row of candidates) {
      const coverage = db.coverage?.status(row.apiKeyId);
      if (!coverage || coverage.maintenance || coverage.gaps.some(gap => !gap.resolvedAt)) continue;
      db.run("UPDATE apiKeyAccounting SET state='unrecorded',outcome='network_unknown',finishedAt=?,resolutionVersion=resolutionVersion+1 WHERE attemptId=? AND state='pending'", [new Date().toISOString(), row.attemptId]);
    }
    // Contrary persisted evidence is an accounting obligation, never a live
    // pending allowance after this owner is gone. Preserve its usage/cost.
    db.run("UPDATE apiKeyAccounting SET state='unresolved',outcome='persisted_evidence_pending',finishedAt=?,resolutionVersion=resolutionVersion+1 WHERE state='pending'" + (ownerInstanceId ? " AND ownerInstanceId=?" : ""),
      [new Date().toISOString(), ...(ownerInstanceId ? [ownerInstanceId] : [])]);
  });
}
export function countAttemptStatesSync(db, apiKeyId, start = null, end = null) {
  if ((start === null) !== (end === null)) throw new Error('Complete accounting window required');
  if (start !== null) { timestamp(start); timestamp(end); }
  const rows = db.all("SELECT state,count(*) AS count FROM apiKeyAccounting WHERE apiKeyId=? AND state IN ('pending','unresolved')" +
    (start === null ? '' : ' AND startedAt>=? AND startedAt<?') + ' GROUP BY state', [apiKeyId, ...(start === null ? [] : [start, end])]);
  const counts = { pendingCount: 0, unresolvedCount: 0 };
  for (const row of rows) {
    if (!Number.isSafeInteger(row.count) || row.count < 0) throw new Error('Invalid accounting count');
    counts[row.state === 'pending' ? 'pendingCount' : 'unresolvedCount'] = row.count;
  }
  return counts;
}

export function sumSpendSync(db, apiKeyId, start, end) {
  timestamp(start); timestamp(end);
  return db.all("SELECT costNanoUsd FROM apiKeyAccounting WHERE apiKeyId=? AND startedAt>=? AND startedAt<? AND state IN ('settled','waived')", [apiKeyId, start, end])
    .reduce((sum, row) => sum + BigInt(row.costNanoUsd), 0n).toString();
}
