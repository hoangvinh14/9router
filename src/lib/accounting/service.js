import { createHash, randomUUID } from "node:crypto";
import { canonical, conflict, snapshotPayload, text, unavailable } from "./attempt-payload.js";
import { validateKeyBindings } from "../db/helpers/api-key-bindings.js";
import { resolveReferencePriceSync } from "../pricing/referenceResolver.js";
import { getWriteCoordinator, WRITE_LIMITS } from "./write-coordinator.js";
import { synchronousResult } from "../db/durableFile.js";
import { insertAttemptMutation, finalizeAttemptMutation, getAttemptSync, resolveAttemptSync } from "../db/repos/api-key-accounting-repo.js";

const services = new WeakMap();
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function configRevision(db) {
  return hash([db.all("SELECT * FROM settings ORDER BY id"), db.all("SELECT * FROM combos ORDER BY id"),
    db.all("SELECT * FROM kv WHERE scope IN ('modelAliases','customModels','disabledModels') ORDER BY scope,key")]);
}
export function createAccountingService(db) {
  if (services.has(db)) return services.get(db);
  if (!db.ownerInstanceId || !db.coverage) throw unavailable("Accounting initialization required");
  const contexts = new WeakMap(), receipts = new WeakMap(), operations = new Map();
  const lifetime = db.ownerInstanceId;
  let closed = false, retainedBytes = 0;
  function live() { if (closed || db.ownerInstanceId !== lifetime || !db.health().healthy) throw unavailable(); }
  function keyAuthority(id) {
    const key = db.get("SELECT * FROM apiKeys WHERE id=?", [id]);
    if (!key || key.isActive !== 1) throw unavailable("Accounting key inactive or missing");
    validateKeyBindings(db, db.coverage, [key]);
    const binding = db.get("SELECT * FROM apiKeyBindings WHERE apiKeyId=?", [id]);
    if (!binding || binding.retiredAt || binding.fingerprint !== db.coverage.fingerprint(key.key)) throw unavailable("Retained key binding unavailable");
    return { id: key.id, fingerprint: db.coverage.fingerprint(key.key), accessRestricted: key.accessRestricted, accessAllow: key.accessAllow };
  }
  function createContext({ apiKeyId, validateAuthoritySync }) {
    live(); text(apiKeyId, "key ID", 200);
    if (typeof validateAuthoritySync !== "function" || validateAuthoritySync.constructor?.name === "AsyncFunction") throw new Error("Synchronous request authority capability required");
    const context = Object.freeze({ requestId: randomUUID() });
    contexts.set(context, { apiKeyId, validateAuthoritySync, key: keyAuthority(apiKeyId), revision: configRevision(db), generation: db.coverage.status(apiKeyId).generation });
    return context;
  }
  function authorize(context, candidate, expectedPrice) {
    live();
    const authority = contexts.get(context);
    if (!authority) throw unavailable("Unknown request authority");
    const key = keyAuthority(authority.apiKeyId), coverage = db.coverage.status(authority.apiKeyId);
    if (canonical(key) !== canonical(authority.key) || configRevision(db) !== authority.revision || coverage.generation !== authority.generation || coverage.maintenance || coverage.gaps.some(g => !g.resolvedAt)) throw unavailable("Accounting authority changed");
    const price = resolveReferencePriceSync(db, candidate.provider, candidate.model, candidate.endpoint);
    if (price.status !== "priced" || expectedPrice && price.snapshot.revision !== expectedPrice.revision) throw unavailable("Accounting original price authority changed");
    if (synchronousResult(authority.validateAuthoritySync(Object.freeze({ apiKeyId: authority.apiKeyId, candidate: snapshotPayload(candidate), keyAccess: { restricted: key.accessRestricted === 1, allow: key.accessAllow } }))) !== true) throw unavailable("Request authority refused");
    return { apiKeyId: authority.apiKeyId, snapshot: price.snapshot };
  }
  const coordinator = getWriteCoordinator(db, commands => db.durableTransaction(() => commands.map(command => {
    try {
      return db.transaction(() => {
        const operation = operations.get(command.operationId);
        if (!operation || canonical(operation.retained) !== canonical(command.retained)) throw unavailable("Unknown accounting operation");
        const { context, retained } = operation;
        if (retained.type === "intent") {
          const verified = authorize(context, retained.candidate, retained.priceSnapshot);
          return { ok: true, value: insertAttemptMutation(db, { attemptId: randomUUID(), requestId: context.requestId, apiKeyId: verified.apiKeyId,
            ownerInstanceId: lifetime, startedAt: new Date().toISOString(), ...retained.candidate, priceSnapshot: verified.snapshot }) };
        }
        if (retained.type === "terminal") {
          live();
          const value = finalizeAttemptMutation(db, retained.attemptId, retained.terminal);
          return value.observationConflict ? { ok: false, error: conflict("Attempt terminal observation conflict") } : { ok: true, value };
        }
        throw new Error("Unknown accounting operation type");
      });
    } catch (error) { if (!db.health().healthy) throw error; return { ok: false, error }; }
  })));
  async function queued(context, retained, signal) {
    const operationId = randomUUID();
    const command = { operationId, retained };
    const bytes = Buffer.byteLength(canonical(command)) * 2;
    if (operations.size >= WRITE_LIMITS.queueCount || bytes > WRITE_LIMITS.operationBytes || retainedBytes + bytes > WRITE_LIMITS.queueBytes) throw unavailable("Accounting queue capacity exceeded");
    operations.set(operationId, { context, retained });
    retainedBytes += bytes;
    try { return await coordinator.enqueue(command, { signal }); }
    finally { operations.delete(operationId); retainedBytes -= bytes; }
  }
  async function beginAttempt(context, input, { signal } = {}) {
    const candidate = snapshotPayload(input);
    if (Object.keys(candidate).some(k => !["provider", "model", "endpoint", "connectionId"].includes(k))) throw new Error("Invalid candidate field");
    for (const field of ["provider", "model", "endpoint"]) text(candidate[field], field);
    if (candidate.connectionId !== undefined && candidate.connectionId !== null) text(candidate.connectionId, "connection ID");
    const verified = authorize(context, candidate);
    const value = await queued(context, { type: "intent", candidate, priceSnapshot: verified.snapshot }, signal);
    live();
    const receipt = Object.freeze({ attemptId: value.attemptId, kind: "intent" });
    receipts.set(receipt, { context, candidate, snapshot: value.priceSnapshot, dispatched: false });
    return receipt;
  }
  function assertDispatchAuthority(receipt, context) {
    const owned = receipts.get(receipt);
    if (!owned || owned.context !== context || owned.dispatched) throw unavailable("Intent ACK is absent or already consumed");
    authorize(context, owned.candidate, owned.snapshot);
    const row = getAttemptSync(db, receipt.attemptId);
    if (!row || row.state !== "pending" || row.ownerInstanceId !== lifetime) throw unavailable("Intent no longer dispatchable");
    owned.dispatched = true;
    return true;
  }
  async function completeAttempt(receipt, evidence, { signal } = {}) {
    live();
    const owned = receipts.get(receipt);
    if (!owned) throw unavailable("Own intent ACK required");
    let terminal = snapshotPayload(evidence);
    if (terminal.state === "settled" && terminal.usage?.exact !== true) {
      terminal = { state: "unresolved", outcome: terminal.outcome, finishedAt: terminal.finishedAt };
    }
    if (terminal.state === "not_dispatched" && owned.dispatched) throw conflict("Dispatched intent cannot be declared not-dispatched");
    const value = await queued(owned.context, { type: "terminal", attemptId: receipt.attemptId, terminal }, signal);
    return Object.freeze({ kind: "terminal", attemptId: receipt.attemptId, state: value.state, resolutionVersion: value.resolutionVersion });
  }
  function resolveAttempt(id, operation) { live(); return resolveAttemptSync(db, id, operation); }
  function disposeContext(context) { contexts.delete(context); }
  function stop() { closed = true; operations.clear(); return coordinator.stop(); }
  const service = Object.freeze({ createContext, beginAttempt, completeAttempt, assertDispatchAuthority, resolveAttempt, disposeContext, stop });
  services.set(db, service);
  return service;
}
