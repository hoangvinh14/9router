import { isDeepStrictEqual } from 'node:util';
import { getAdapter } from '../db/driver.js';
import { extractGatewayCredential, resolveGatewayIdentity } from './identity.js';
import { createBudgetContext } from './service.js';
import { captureQueuedRequestAuthoritySync } from './queuedRequestAuthority.js';
import { validateQueuedBaseWire } from './queuedBaseWire.js';
import { isAccountedOpenaiChatProvider } from '../../../open-sse/config/accountedChatProviders.js';
import { ApiKeyBudgetError, isApiKeyBudgetError } from './errors.js';
import { BUDGET_ERROR, ACCOUNTING_STATE as STATE } from '../../../open-sse/config/apiKeyBudgetConstants.js';

// Request-local injection only; no activation, startup repair or cached policy.
// OFF is an authoritative persisted absence, not a storage-error exemption.
export async function createRequestAccounting(request, { adapter = getAdapter, persistedTarget = null, persistedSelection = false, queued = false } = {}) {
  // INTERNAL resolved target only. Selection is separately verified by the app;
  // caller/config proof alone must not grant routing/provider eligibility.
  let credential, target;
  const signal = request.signal;
  try {
    credential = extractGatewayCredential(request);
    target = persistedTarget && Object.freeze({ provider: persistedTarget.provider,
      model: persistedTarget.model, connectionId: persistedTarget.connectionId });
  } catch { throw new ApiKeyBudgetError(BUDGET_ERROR.UNAVAILABLE); }
  let db, identity, pinnedProof = null;
  const cancel = () => { if (signal?.aborted) throw signal.reason; };
  function prove() {
    const health = db.health();
    if (health.healthy || health.poisoned !== true || health.closed !== false ||
        !target || typeof db.provePersistedRequest !== 'function') throw new Error('Storage unhealthy');
    if (persistedSelection) {
      if (typeof db.provePersistedSelection !== 'function') throw new Error('Selection unavailable');
      const proof = db.provePersistedSelection({ credential, provider: target.provider, model: target.model, excludeConnectionIds: [] }, db.coverage);
      if (proof.connection.id !== target.connectionId) throw new Error('Selection changed');
      return proof;
    }
    return db.provePersistedRequest({ credential, ...target }, db.coverage);
  }
  try {
    db = await adapter();
    if (db.coverage.status(null).maintenance) throw new Error('Maintenance');
    if (!db.health().healthy) {
      pinnedProof = prove();
      identity = { status: 'active', apiKeyId: pinnedProof.apiKeyId };
    } else identity = await resolveGatewayIdentity(request, { adapter: async () => db });
  } catch { throw new ApiKeyBudgetError(BUDGET_ERROR.UNAVAILABLE); }
  if (identity.status === 'disabled') throw new ApiKeyBudgetError(BUDGET_ERROR.UNAVAILABLE);
  let activated;
  try { activated = pinnedProof ? pinnedProof.ledgerStartedAt : db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")?.value; }
  catch { throw new ApiKeyBudgetError(BUDGET_ERROR.UNAVAILABLE); }
  if (identity.status !== 'active' || !activated) return null;
  const context = await createBudgetContext(identity.apiKeyId, { adapter: async () => db });
  function gate() {
    if (!pinnedProof) return context.gate();
    cancel();
    try {
      const fresh = prove();
      // Every gate uses newly durable evidence. The old snapshot is only an
      // immutable equality constraint, never a substitute for a failed read.
      // Generation may advance through this request's own ACKed gap latch.
      for (const key of ['apiKeyId', 'policyVersion', 'coverageId', 'ledgerStartedAt', 'provider', 'model', 'settings', 'connection', 'proxyPool']) {
        if (!isDeepStrictEqual(fresh[key], pinnedProof[key])) throw new Error('Authority changed');
      }
      const state = db.coverage.status(identity.apiKeyId);
      if (state.maintenance || state.id !== fresh.coverageId || state.generation !== fresh.coverageGeneration) throw new Error('Coverage changed');
      cancel();
      return Object.freeze({ budgeted: false, ledgerStartedAt: fresh.ledgerStartedAt });
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      throw new ApiKeyBudgetError(BUDGET_ERROR.UNAVAILABLE, { requestId: context.requestId });
    }
  }
  return Object.freeze({
    requestId: context.requestId,
    isLocalError: isApiKeyBudgetError,
    requiresPreparedBaseWire: queued && !pinnedProof,
    gate,
    assertSupported(supported) {
      gate();
      if (!supported) throw new ApiKeyBudgetError(BUDGET_ERROR.UNSUPPORTED, { requestId: context.requestId });
    },
    beforeAttempt(meta, supported, preparedWire = null) {
      if (queued && !pinnedProof) {
        // Opt-in only while actual-owner/transport gates are incomplete. Prepared
        // caller/config equality is re-read inside service's group transaction;
        // no callback or pre-await authorization substitutes for fresh authority.
        try {
          cancel();
          const status = gate();
          if (status.budgeted && !supported) throw new ApiKeyBudgetError(BUDGET_ERROR.UNSUPPORTED, { requestId: context.requestId });
          const authority = captureQueuedRequestAuthoritySync(db, { credential, apiKeyId: identity.apiKeyId,
            provider: meta.provider, model: meta.model, connectionId: meta.connectionId ?? null });
          const wire = isAccountedOpenaiChatProvider(meta.provider) ? validateQueuedBaseWire(authority, preparedWire) : null;
          return context.beginAttemptQueued(meta, { signal, requestAuthority: authority, preparedWire: wire });
        } catch (error) {
          if (signal?.aborted) return Promise.reject(signal.reason);
          return Promise.reject(error instanceof ApiKeyBudgetError ? error : new ApiKeyBudgetError(BUDGET_ERROR.UNAVAILABLE, { requestId: context.requestId }));
        }
      }
      const status = gate();
      if (pinnedProof && (!meta || ['provider', 'model', 'connectionId'].some(key => meta[key] !== target[key])) ||
          (status.budgeted || pinnedProof) && !supported) {
        throw new ApiKeyBudgetError(BUDGET_ERROR.UNSUPPORTED, { requestId: context.requestId });
      }
      // No yield between fresh caller/config gate and the existing service's
      // fresh policy proof + independent durable gap ACK. No second sink.
      return context.beginAttempt(meta);
    },
    assertSuccessfulTerminal(terminal) {
      if (!terminal || ![STATE.SETTLED, STATE.UNRESOLVED].includes(terminal.state) ||
          terminal.state === STATE.SETTLED && (terminal.unrecorded || terminal.costNanoUsd === null || terminal.costNanoUsd === undefined)) {
        throw new ApiKeyBudgetError(BUDGET_ERROR.UNAVAILABLE, { requestId: context.requestId });
      }
      // A settled request may legitimately cross the limit; only the next
      // admission should fail. Unknown success instead checks current policy.
      // Unlimited unresolved recording is allowed by contract; unrecorded
      // results only originate after the service ACKs an independent gap latch.
      if (terminal.state === STATE.UNRESOLVED) gate();
    },
    completeAttempt: queued && !pinnedProof ? context.completeAttemptQueued : context.completeAttempt,
  });
}
