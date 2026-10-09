import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from 'node:util';
import { getAccountingWriteCoordinator } from './accountingWriteCoordinator.js';
import { snapshotAccountingGroup } from '../db/accountingGroupPayload.js';
import { captureQueuedRequestAuthoritySync } from './queuedRequestAuthority.js';
import { validateQueuedBaseWire } from './queuedBaseWire.js';
import { getAdapter } from "../db/driver.js";
import { getPolicySync, putPolicySync, sumSpendSync, countStatesSync, insertAttemptSync, finalizeAttemptSync, getAttemptSync, resolveAttemptSync } from "../db/repos/apiKeyAccountingRepo.js";
import { resolveReferencePriceSync } from "../pricing/referenceResolver.js";
import { costFromExactUsage, decimalToNanoUsd } from "../pricing/money.js";
import { BUDGET_ERROR, BUDGET_SCOPE, ACCOUNTING_STATE as STATE } from "../../../open-sse/config/apiKeyBudgetConstants.js";
import { budgetWindows } from "./windows.js";
import { ApiKeyBudgetError } from "./errors.js";
import { isAccountedOpenaiChatProvider } from '../../../open-sse/config/accountedChatProviders.js';
import { validateAccountingUsageEvidence } from '../../../open-sse/utils/accountingUsageEvidence.js';
import { projectAccountingUsageSync } from "../db/repos/usageRepo.js";

// Internal operation capabilities survive HMR with the owned adapter identity.
// Queue payload holds an opaque ID plus bounded retained equality/evidence data,
// never an arbitrary callback or caller supplied transaction authority. Resolver is invoked inside the member savepoint.
const queuedOperations = global.__accountingQueuedOperations ??= new WeakMap();
export function resolveQueuedAccountingCommandSync(db, operationId) {
  const operation = queuedOperations.get(db)?.get(operationId);
  if (!operation) throw new ApiKeyBudgetError(BUDGET_ERROR.CONFLICT);
  return operation.prepare(operation.retained);
}

// Activation remains a separate audited rollout gate. There is intentionally no
// method to stamp coverage here. Queued methods are not yet inference callers.
export async function createBudgetContext(apiKeyId, { adapter = getAdapter, clock = () => new Date(), project = projectAccountingUsageSync } = {}) {
  const db = await adapter();
  const requestId = randomUUID();
  const attempts = new Map();
  const fail = code => { throw new ApiKeyBudgetError(code, { requestId }); };
  if (apiKeyId !== null && (typeof apiKeyId !== "string" || !apiKeyId || apiKeyId.length > 200)) fail(BUDGET_ERROR.UNAVAILABLE);
  function instant() {
    const now = new Date(clock());
    if (!Number.isFinite(now.getTime())) fail(BUDGET_ERROR.UNAVAILABLE);
    return now;
  }
  function coverage() {
    try {
      // Even no-key requests retain writer/schema/maintenance safety. Unhealthy
      // SQL.js RAM must never serve as policy truth after an uncertain commit.
      const state = db.coverage.status(apiKeyId);
      if (state.maintenance) fail(BUDGET_ERROR.UNAVAILABLE);
      return state;
    } catch { fail(BUDGET_ERROR.UNAVAILABLE); }
  }
  function activeKey() {
    const row = db.get("SELECT isActive FROM apiKeys WHERE id=?", [apiKeyId]);
    if (!row || ![1, true].includes(row.isActive)) fail(BUDGET_ERROR.UNAVAILABLE);
    const binding = db.get("SELECT retiredAt FROM apiKeyBindings WHERE apiKeyId=?", [apiKeyId]);
    if (!binding || binding.retiredAt) fail(BUDGET_ERROR.UNAVAILABLE);
  }
  function readStatus() {
    const state = coverage();
    // Status/gate never advertises allowance from poisoned storage. Only
    // beginAttempt owns the narrow fresh-proof+durable-gap exception.
    if (!db.health().healthy) fail(BUDGET_ERROR.UNAVAILABLE);
    if (apiKeyId === null) return { exempt: true };
    activeKey();
    const ledgerStartedAt = db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")?.value;
    if (!ledgerStartedAt) fail(BUDGET_ERROR.UNAVAILABLE);
    const policy = getPolicySync(db, apiKeyId);
    const budgeted = policy.weeklyLimitNanoUsd !== null || policy.monthlyLimitNanoUsd !== null;
    const now = instant();
    const windows = budgetWindows(now);
    const counts = countStatesSync(db, apiKeyId);
    const spent = { weekly: sumSpendSync(db, apiKeyId, windows.weekly.start, windows.weekly.end), monthly: sumSpendSync(db, apiKeyId, windows.monthly.start, windows.monthly.end) };
    return { policy, budgeted, now, windows, counts, spent, ledgerStartedAt, coverage: state };
  }
  function gateStatus(status) {
    if (status.exempt) return status;
    if (status.budgeted && status.coverage.gaps.some(g => !g.resolvedAt)) fail(BUDGET_ERROR.UNAVAILABLE);
    if (status.budgeted && status.counts.unresolved) fail(BUDGET_ERROR.UNRESOLVED);
    const blockedWindows = ["weekly", "monthly"].filter(window => status.policy[`${window}LimitNanoUsd`] !== null
      && BigInt(status.spent[window]) >= BigInt(status.policy[`${window}LimitNanoUsd`]))
      .map(window => ({ window, resetAt: status.windows[window].end }));
    if (blockedWindows.length) throw new ApiKeyBudgetError(BUDGET_ERROR.EXCEEDED, { requestId, blockedWindows, now: status.now });
    return status;
  }
  function gate() {
    try { return gateStatus(readStatus()); }
    catch (error) { if (error instanceof ApiKeyBudgetError) throw error; fail(BUDGET_ERROR.UNAVAILABLE); }
  }
  function latch(reason) {
    // Independent durable sidecar owns the exception. Missing ownership,
    // maintenance, sidecar or failed fsync never grants unlimited availability.
    coverage();
    try { db.coverage.latchGap(apiKeyId, reason); }
    catch { fail(BUDGET_ERROR.UNAVAILABLE); }
  }
  function projectTerminal(result) {
    if ([STATE.SETTLED, STATE.WAIVED].includes(result.state)) {
      // Outside the settlement catch: analytics failure cannot turn an acked
      // debit into unresolved or latch a fabricated accounting gap. Retrying
      // settlement/recovery or explicit projection replay repairs the crash gap.
      try { project(db, result.attemptId); } catch { console.warn("[Accounting] analytics projection deferred"); }
    }
    return result;
  }
  function beginAttempt({ provider, model, endpoint = "chat", connectionId = null }) {
    coverage();
    const health = db.health();
    if (!health.healthy) {
      if (health.poisoned !== true || health.closed !== false || apiKeyId === null || typeof db.provePersistedUnlimited !== "function") fail(BUDGET_ERROR.UNAVAILABLE);
      if (!BUDGET_SCOPE.includes(endpoint)) fail(BUDGET_ERROR.UNSUPPORTED);
      const startedAt = instant().toISOString();
      let proof;
      try { proof = db.provePersistedUnlimited(apiKeyId, db.coverage); }
      catch { fail(BUDGET_ERROR.UNAVAILABLE); }
      const state = coverage();
      if (proof.apiKeyId !== apiKeyId || proof.coverageId !== state.id || proof.coverageGeneration !== state.generation) fail(BUDGET_ERROR.UNAVAILABLE);
      const input = { attemptId: randomUUID(), requestId, apiKeyId, ownerInstanceId: db.ownerInstanceId,
        startedAt, provider, model, endpoint, connectionId, priceSnapshot: null, unrecorded: true };
      // Coalesced durable coverage gap, NOT durable per-attempt identity/cost.
      // Missing/ambiguous latch acknowledgement never produces a handle.
      latch("unhealthy_unlimited_admission");
      const attempt = Object.freeze(input);
      attempts.set(attempt.attemptId, attempt);
      return attempt;
    }
    // A healthy-path failure never retries through the poisoned-storage branch.
    const status = gate();
    if (status.exempt) return null;
    if (!BUDGET_SCOPE.includes(endpoint)) fail(BUDGET_ERROR.UNSUPPORTED);
    let price;
    try { price = resolveReferencePriceSync(db, provider, model, endpoint); }
    catch { fail(BUDGET_ERROR.UNAVAILABLE); }
    if (status.budgeted && price.status !== "priced") fail(BUDGET_ERROR.PRICING);
    const input = { attemptId: randomUUID(), requestId, apiKeyId, ownerInstanceId: db.ownerInstanceId,
      startedAt: status.now.toISOString(), provider, model, endpoint, connectionId, priceSnapshot: price.snapshot || null };
    // All gate reads, price selection and durable insertion run synchronously
    // without a yield in the single-writer process: no policy/gap mutation can
    // interleave. Re-read generation immediately before intent. No reservation.
    if (coverage().generation !== status.coverage.generation) fail(BUDGET_ERROR.UNAVAILABLE);
    try {
      const attempt = Object.freeze(insertAttemptSync(db, input));
      attempts.set(attempt.attemptId, attempt);
      return attempt;
    }
    catch (error) {
      if (error.code === BUDGET_ERROR.CONFLICT) throw error;
      if (status.budgeted) fail(BUDGET_ERROR.UNAVAILABLE);
      latch("intent_recording_failed");
      const attempt = Object.freeze({ ...input, unrecorded: true });
      attempts.set(attempt.attemptId, attempt);
      return attempt;
    }
  }
  function completeAttempt(attempt, { usage = null, outcome = "success", notDispatched = false, usageEvidence = null } = {}) {
    if (attempt === null && apiKeyId === null) { coverage(); return null; }
    if (!attempt || attempts.get(attempt.attemptId) !== attempt || attempt.requestId !== requestId || attempt.apiKeyId !== apiKeyId) fail(BUDGET_ERROR.CONFLICT);
    coverage();
    if (attempt.unrecorded) { latch("unrecorded_attempt_terminal"); return { state: STATE.UNRESOLVED, costNanoUsd: null, unrecorded: true }; }
    if (!db.health().healthy) fail(BUDGET_ERROR.UNAVAILABLE);
    // Deletion/disable after dispatch must not discard in-flight terminal usage.
    const policy = getPolicySync(db, apiKeyId);
    const budgeted = policy.weeklyLimitNanoUsd !== null || policy.monthlyLimitNanoUsd !== null;
    const original = getAttemptSync(db, attempt.attemptId);
    if (!original || original.requestId !== requestId || original.apiKeyId !== apiKeyId) fail(BUDGET_ERROR.CONFLICT);
    let cost = null;
    if (!notDispatched && usage && original.priceSnapshot) {
      try { cost = costFromExactUsage(usage, original.priceSnapshot.rates); } catch { /* unknown is unresolved, never estimated zero */ }
    }
    // Retain the original durable terminal time on duplicate or late retries,
    // not the closure's current clock; restart does not manufacture a conflict.
    // Observations cannot be billable usage or authority for automatic recovery.
    // Only unresolved terminals may retain this strictly bounded diagnostic envelope.
    let evidence = null;
    if (usageEvidence !== null) {
      if (usage !== null || notDispatched || !isAccountedOpenaiChatProvider(original.provider) || original.endpoint !== 'chat') fail(BUDGET_ERROR.CONFLICT);
      try { evidence = validateAccountingUsageEvidence(usageEvidence); } catch { fail(BUDGET_ERROR.CONFLICT); }
    }
    const terminal = { finishedAt: original.finishedAt || instant().toISOString(), outcome,
      state: notDispatched ? STATE.NOT_DISPATCHED : cost === null ? STATE.UNRESOLVED : STATE.SETTLED,
      ...(cost !== null ? { costNanoUsd: cost, usage } : {}), ...(evidence ? { usageEvidence: evidence } : {}) };
    let result;
    try { result = finalizeAttemptSync(db, attempt.attemptId, terminal); }
    catch (error) {
      if (error.code === BUDGET_ERROR.CONFLICT) throw error;
      if (budgeted) fail(BUDGET_ERROR.UNAVAILABLE);
      latch("settlement_recording_failed");
      return { state: STATE.UNRESOLVED, costNanoUsd: null, unrecorded: true };
    }
    return projectTerminal(result);
  }
  function enqueueOperation(prepare, retained, signal = null) {
    const operationId = randomUUID();
    let operations = queuedOperations.get(db);
    if (!operations) { operations = new Map(); queuedOperations.set(db, operations); }
    operations.set(operationId, { prepare, retained });
    // Include retained authority/evidence in the queue's bounded plain-data
    // envelope. Token-only accounting hid these bytes from queue/group ceilings.
    return getAccountingWriteCoordinator(db).enqueue({ type: 'service', operationId, retained }, { signal })
      .finally(() => operations.delete(operationId));
  }
  async function beginAttemptQueued(meta, { signal = null, requestAuthority = null, preparedWire = null } = {}) {
    if (signal?.aborted) throw signal.reason;
    // Capture immutable monetary authority, NOT permission to dispatch after wait.
    const detached = snapshotAccountingGroup([{ type: 'insert', input: meta }])[0];
    if (detached.type !== 'insert') fail(BUDGET_ERROR.UNAVAILABLE);
    const { provider, model, endpoint = 'chat', connectionId = null } = detached.input;
    const authority = requestAuthority === null ? null : snapshotAccountingGroup([{ type: 'authority', value: requestAuthority }])[0].value;
    const wire = preparedWire === null ? null : validateQueuedBaseWire(authority, preparedWire);
    coverage();
    // The narrow poisoned-unlimited proof+sidecar owner stays synchronous and
    // separate. No queued DB transaction can substitute for its independent ACK.
    if (!db.health().healthy) return beginAttempt({ provider, model, endpoint, connectionId });
    const preparedStatus = gate();
    if (preparedStatus.exempt) return null;
    if (!BUDGET_SCOPE.includes(endpoint)) fail(BUDGET_ERROR.UNSUPPORTED);
    let preparedPrice;
    try { preparedPrice = resolveReferencePriceSync(db, provider, model, endpoint); }
    catch { fail(BUDGET_ERROR.UNAVAILABLE); }
    if (preparedStatus.budgeted && preparedPrice.status !== 'priced') fail(BUDGET_ERROR.PRICING);
    const binding = db.get('SELECT fingerprint,retiredAt FROM apiKeyBindings WHERE apiKeyId=?', [apiKeyId]);
    let admittedInput = null, budgeted = preparedStatus.budgeted;
    try {
      const result = await enqueueOperation(() => {
        if (signal?.aborted) throw signal.reason;
        const status = gate(); budgeted = status.budgeted;
        if (authority !== null) {
          try {
            const fresh = captureQueuedRequestAuthoritySync(db, { credential: authority.credential, apiKeyId, provider, model, connectionId });
            if (!isDeepStrictEqual(fresh, authority)) fail(BUDGET_ERROR.UNAVAILABLE);
            if (wire !== null) validateQueuedBaseWire(fresh, wire);
          } catch { fail(BUDGET_ERROR.UNAVAILABLE); }
        }
        if (status.exempt || status.ledgerStartedAt !== preparedStatus.ledgerStartedAt ||
            !isDeepStrictEqual(db.get('SELECT fingerprint,retiredAt FROM apiKeyBindings WHERE apiKeyId=?', [apiKeyId]), binding)) fail(BUDGET_ERROR.UNAVAILABLE);
        let price;
        try { price = resolveReferencePriceSync(db, provider, model, endpoint); }
        catch { fail(BUDGET_ERROR.UNAVAILABLE); }
        if (!isDeepStrictEqual(price, preparedPrice)) fail(BUDGET_ERROR.UNAVAILABLE);
        if (status.budgeted && price.status !== 'priced') fail(BUDGET_ERROR.PRICING);
        if (coverage().generation !== status.coverage.generation) fail(BUDGET_ERROR.UNAVAILABLE);
        admittedInput = { attemptId: randomUUID(), requestId, apiKeyId, ownerInstanceId: db.ownerInstanceId,
          startedAt: status.now.toISOString(), provider, model, endpoint, connectionId, priceSnapshot: price.snapshot || null };
        return { type: 'insert', input: admittedInput };
      }, { meta: detached.input, price: preparedPrice, binding, ledgerStartedAt: preparedStatus.ledgerStartedAt, authority, wire }, signal);
      const attempt = Object.freeze(result); attempts.set(attempt.attemptId, attempt); return attempt;
    } catch (error) {
      // Member authority refusal/cancel cannot become an unlimited recording
      // exception. Only a prepared mutation whose durable ACK failed may latch.
      if (error instanceof ApiKeyBudgetError) throw error;
      if (!admittedInput && signal?.aborted) throw signal.reason;
      if (!admittedInput || budgeted) fail(BUDGET_ERROR.UNAVAILABLE);
      latch('intent_recording_failed');
      const attempt = Object.freeze({ ...admittedInput, unrecorded: true }); attempts.set(attempt.attemptId, attempt); return attempt;
    }
  }
  async function completeAttemptQueued(attempt, completion = {}) {
    if (attempt === null && apiKeyId === null) { coverage(); return null; }
    if (!attempt || attempts.get(attempt.attemptId) !== attempt || attempt.requestId !== requestId || attempt.apiKeyId !== apiKeyId) fail(BUDGET_ERROR.CONFLICT);
    coverage();
    if (attempt.unrecorded) return completeAttempt(attempt, completion);
    const detached = snapshotAccountingGroup([{ type: 'finalize', attemptId: attempt.attemptId, terminal: completion }])[0];
    if (detached.type !== 'finalize') fail(BUDGET_ERROR.CONFLICT);
    const { usage = null, outcome = 'success', notDispatched = false, usageEvidence = null } = detached.terminal;
    let preparedMutation = false, budgeted = true;
    try {
      const result = await enqueueOperation(() => {
        coverage(); if (!db.health().healthy) fail(BUDGET_ERROR.UNAVAILABLE);
        // Do not activeKey/gate terminal: deletion/disable/exhaustion after POST
        // cannot discard observed usage. Original persisted snapshot owns cost.
        const policy = getPolicySync(db, apiKeyId);
        budgeted = policy.weeklyLimitNanoUsd !== null || policy.monthlyLimitNanoUsd !== null;
        const original = getAttemptSync(db, attempt.attemptId);
        if (!original || original.requestId !== requestId || original.apiKeyId !== apiKeyId) fail(BUDGET_ERROR.CONFLICT);
        let cost = null;
        if (!notDispatched && usage && original.priceSnapshot) {
          try { cost = costFromExactUsage(usage, original.priceSnapshot.rates); } catch { /* unresolved, never estimated */ }
        }
        let evidence = null;
        if (usageEvidence !== null) {
          if (usage !== null || notDispatched || !isAccountedOpenaiChatProvider(original.provider) || original.endpoint !== 'chat') fail(BUDGET_ERROR.CONFLICT);
          try { evidence = validateAccountingUsageEvidence(usageEvidence); } catch { fail(BUDGET_ERROR.CONFLICT); }
        }
        const terminal = { finishedAt: original.finishedAt || instant().toISOString(), outcome,
          state: notDispatched ? STATE.NOT_DISPATCHED : cost === null ? STATE.UNRESOLVED : STATE.SETTLED,
          ...(cost !== null ? { costNanoUsd: cost, usage } : {}), ...(evidence ? { usageEvidence: evidence } : {}) };
        preparedMutation = true;
        return { type: 'finalize', attemptId: attempt.attemptId, terminal };
      }, detached.terminal);
      return projectTerminal(result);
    } catch (error) {
      if (error instanceof ApiKeyBudgetError || error?.code === BUDGET_ERROR.CONFLICT) throw error;
      if (!preparedMutation || budgeted) fail(BUDGET_ERROR.UNAVAILABLE);
      latch('settlement_recording_failed');
      return { state: STATE.UNRESOLVED, costNanoUsd: null, unrecorded: true };
    }
  }
  function updatePolicy({ weeklyLimitUsd, monthlyLimitUsd, expectedVersion }) {
    coverage();
    if (!db.health().healthy || apiKeyId === null) fail(BUDGET_ERROR.UNAVAILABLE);
    activeKey();
    const limits = { weeklyLimitNanoUsd: weeklyLimitUsd === null ? null : decimalToNanoUsd(weeklyLimitUsd), monthlyLimitNanoUsd: monthlyLimitUsd === null ? null : decimalToNanoUsd(monthlyLimitUsd) };
    if ((weeklyLimitUsd !== null || monthlyLimitUsd !== null) && coverage().gaps.some(g => !g.resolvedAt)) fail(BUDGET_ERROR.UNAVAILABLE);
    return putPolicySync(db, apiKeyId, limits, expectedVersion);
  }
  function resolveAttempt(attemptId, recovery) {
    coverage();
    if (getAttemptSync(db, attemptId)?.apiKeyId !== apiKeyId) fail(BUDGET_ERROR.CONFLICT);
    return projectTerminal(resolveAttemptSync(db, attemptId, recovery));
  }
  function reconcileGap(recovery) {
    coverage();
    if (apiKeyId === null || recovery.apiKeyId !== apiKeyId) fail(BUDGET_ERROR.CONFLICT);
    return db.coverage.reconcileGap(recovery);
  }
  return Object.freeze({ requestId, apiKeyId, gate, beginAttempt, completeAttempt, beginAttemptQueued, completeAttemptQueued, updatePolicy, resolveAttempt, reconcileGap });
}
