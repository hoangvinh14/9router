import { isDeepStrictEqual } from 'node:util';
import { getAdapter } from '../db/driver.js';
import { extractGatewayCredential, resolveGatewayIdentity } from './identity.js';
import { validateKeyBindings } from '../db/helpers/apiKeyBindings.js';
import { createBudgetContext } from './service.js';
import { captureQueuedRequestAuthoritySync } from './queuedRequestAuthority.js';
import { validateQueuedBaseWire } from './queuedBaseWire.js';
import { capturePersistedRoutingGraph, assertPersistedRoutingMaterialCurrent } from './persistedRoutingGraph.js';
import { snapshotAccountingGroup } from '../db/accountingGroupPayload.js';
import { isAccountedOpenaiChatProvider } from '../../../open-sse/config/accountedChatProviders.js';
import { ACCOUNTED_ANTHROPIC_BETA_LIVE_MODE, ANTHROPIC_OAUTH_TOKEN_PREFIX } from '../../../open-sse/config/accountedAnthropicCandidate.js';
import { ACCOUNTED_CLAUDE_OAUTH_MODE } from '../../../open-sse/config/accountedClaudeOauth.js';
import { ApiKeyBudgetError, isApiKeyBudgetError } from './errors.js';
import { BUDGET_ERROR, ACCOUNTING_STATE as STATE } from '../../../open-sse/config/apiKeyBudgetConstants.js';

// Exact issued contexts only: immutable origin, not policy/spend/freshness cache.
// Copies, alternate bundles and caller-shaped method objects fail closed.
const requestAccountingOrigins = new WeakMap();
export function assertRequestAccountingOrigin(accounting, { db, credential, apiKeyId }) {
  const origin = requestAccountingOrigins.get(accounting);
  if (!origin || !origin.healthySynchronous || origin.db !== db || origin.credential !== credential || origin.apiKeyId !== apiKeyId) {
    throw new ApiKeyBudgetError(BUDGET_ERROR.UNAVAILABLE);
  }
}

// Separate exact issued queued contract; never broaden synchronous provenance.
export function assertQueuedRequestAccountingOrigin(accounting, { db, credential, apiKeyId }) {
  const origin = requestAccountingOrigins.get(accounting);
  if (!origin || !origin.healthyQueued || origin.db !== db || origin.credential !== credential || origin.apiKeyId !== apiKeyId) {
    throw new ApiKeyBudgetError(BUDGET_ERROR.UNAVAILABLE);
  }
}

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
  let db, identity, pinnedProof = null, routingProof = null;
  // Retained issued admission authority, not an ACK cache or spend buffer.
  // Only delivered service handles enter this request-local map.
  const failureAuthorities = new WeakMap();
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
  function assertRoutingCurrent() {
    if (!routingProof) return;
    try { assertPersistedRoutingMaterialCurrent(db, routingProof.material, () => { cancel(); gate(); }); }
    catch (error) {
      if (signal?.aborted) throw signal.reason;
      throw error instanceof ApiKeyBudgetError ? error : new ApiKeyBudgetError(BUDGET_ERROR.UNAVAILABLE, { requestId: context.requestId });
    }
  }
  const issued = Object.freeze({
    requestId: context.requestId,
    isLocalError: isApiKeyBudgetError,
    requiresPreparedBaseWire: queued && !pinnedProof,
    async captureRoutingGraph(root, resolve) {
      cancel(); gate();
      if (pinnedProof || routingProof) throw new ApiKeyBudgetError(BUDGET_ERROR.UNAVAILABLE, { requestId: context.requestId });
      try {
        const proof = await capturePersistedRoutingGraph(db, root, { resolve, gate: () => { cancel(); gate(); } });
        cancel(); gate();
        // Concurrent captures cannot replace an already retained request graph.
        if (routingProof) throw new Error('Routing proof already captured');
        routingProof = proof;
        return proof.graph;
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        throw error instanceof ApiKeyBudgetError ? error : new ApiKeyBudgetError(BUDGET_ERROR.UNAVAILABLE, { requestId: context.requestId });
      }
    },
    gate,
    assertRoutingCurrent,
    assertNestedFusionSupported(comboId) {
      cancel(); gate(); assertRoutingCurrent();
      const node = routingProof?.graph.occurrences.find(o => o.node.id === comboId && o.node.kind === 'fusion')?.node;
      if (!queued || pinnedProof || !node || !node.evidence.nestedTextEligible ||
          routingProof.graph.occurrences.some(o => o.node.kind === 'leaf' && !isAccountedOpenaiChatProvider(o.node.provider))) {
        throw new ApiKeyBudgetError(BUDGET_ERROR.UNSUPPORTED, { requestId: context.requestId });
      }
    },
    assertSupported(supported) {
      gate();
      if (!supported) throw new ApiKeyBudgetError(BUDGET_ERROR.UNSUPPORTED, { requestId: context.requestId });
    },
    beforeAttempt(meta, supported, preparedWire = null) {
      if (routingProof) {
        try {
          const candidate = snapshotAccountingGroup([{ type: 'routing-target', value: meta }])[0].value;
          if (!routingProof.graph.occurrences.some(o => o.node.kind === 'leaf' && o.node.provider === candidate?.provider && o.node.model === candidate?.model)) {
            throw new Error('Target absent from captured routing graph');
          }
          assertPersistedRoutingMaterialCurrent(db, routingProof.material, () => { cancel(); gate(); });
        }
        catch (error) {
          const refusal = signal?.aborted ? signal.reason : error instanceof ApiKeyBudgetError ? error : new ApiKeyBudgetError(BUDGET_ERROR.UNAVAILABLE, { requestId: context.requestId });
          if (queued) return Promise.reject(refusal);
          throw refusal;
        }
      }
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
          const wire = isAccountedOpenaiChatProvider(meta.provider) || ['gemini', 'anthropic', 'claude', 'codex', 'grok-cli', 'github', 'commandcode', 'kiro'].includes(meta.provider) ? validateQueuedBaseWire(authority, preparedWire) : null;
          const work = context.beginAttemptQueued(meta, { signal, requestAuthority: authority, preparedWire: wire, routingMaterial: routingProof?.material ?? null });
          // Do not add a delivery yield to other provider owners. Captured
          // authority, never mutable caller meta, chooses this narrow retention.
          if (!['anthropic', 'claude'].includes(authority.provider)) return work;
          return work.then(attempt => {
            if (attempt && !attempt.unrecorded) failureAuthorities.set(attempt, { authority, wire });
            return attempt;
          });
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
    assertFailedTerminal(attempt, terminal) {
      // Exact failed HTTP is not success and not another budget admission.
      // Delivered completion remains mandatory; a stored row cannot replace it.
      cancel();
      try {
        const observed = snapshotAccountingGroup([{ type: 'failed-terminal', value: terminal }])[0].value;
        if (!attempt || !['anthropic', 'claude'].includes(attempt.provider) || attempt.unrecorded || !observed || observed.state !== STATE.SETTLED || observed.outcome !== 'failed' ||
            observed.requestId !== context.requestId || observed.attemptId !== attempt.attemptId || observed.apiKeyId !== identity.apiKeyId ||
            observed.unrecorded || observed.costNanoUsd === null || observed.costNanoUsd === undefined || !db.health().healthy) throw new Error('Terminal unavailable');
        const coverage = db.coverage.status(identity.apiKeyId);
        if (coverage.maintenance || coverage.gaps.some(gap => !gap.resolvedAt)) throw new Error('Terminal unavailable');
        if (queued) {
          const retained = failureAuthorities.get(attempt);
          if (!retained) throw new Error('Terminal unavailable');
          const fresh = captureQueuedRequestAuthoritySync(db, { credential, apiKeyId: identity.apiKeyId,
            provider: attempt.provider, model: attempt.model, connectionId: attempt.connectionId ?? null });
          if (!isDeepStrictEqual(fresh, retained.authority)) throw new Error('Terminal unavailable');
          if (retained.wire !== null) validateQueuedBaseWire(fresh, retained.wire);
        } else {
          const key = db.get('SELECT * FROM apiKeys WHERE key=?', [credential]);
          if (!key || key.id !== identity.apiKeyId || ![1, true].includes(key.isActive)) throw new Error('Terminal unavailable');
          validateKeyBindings(db, db.coverage, [key]);
          const binding = db.get('SELECT retiredAt FROM apiKeyBindings WHERE apiKeyId=?', [identity.apiKeyId]);
          if (!binding || binding.retiredAt || !db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")?.value) throw new Error('Terminal unavailable');
        }
        if (routingProof) assertPersistedRoutingMaterialCurrent(db, routingProof.material, cancel);
        cancel();
      } catch {
        if (signal?.aborted) throw signal.reason;
        throw new ApiKeyBudgetError(BUDGET_ERROR.UNAVAILABLE, { requestId: context.requestId });
      }
    },
    prepareClaudeOauthRefresh(attempt, terminal) {
      issued.assertFailedTerminal(attempt, terminal); cancel(); gate();
      const retained = failureAuthorities.get(attempt);
      if (!queued || attempt.provider !== 'claude' || retained?.wire?.anthropicTransport?.mode !== ACCOUNTED_CLAUDE_OAUTH_MODE) {
        throw new ApiKeyBudgetError(BUDGET_ERROR.UNAVAILABLE, { requestId: context.requestId });
      }
      const saved = JSON.parse(retained.authority.connection.data);
      if (typeof saved.refreshToken !== 'string' || !saved.refreshToken || /[\r\n\u0000]/.test(saved.refreshToken)) {
        throw new ApiKeyBudgetError(BUDGET_ERROR.UNAVAILABLE, { requestId: context.requestId });
      }
      return snapshotAccountingGroup([{ type: 'refresh', value: { apiKey: saved.apiKey ?? null, accessToken: saved.accessToken ?? null, refreshToken: saved.refreshToken } }])[0].value;
    },
    completeClaudeOauthRefresh(attempt, terminal, refreshed) {
      // A refresh response is not permission to overwrite another generation.
      // Recheck original complete authority and policy in the same durable CAS
      // transaction as credential persistence; no successor before its ACK.
      issued.prepareClaudeOauthRefresh(attempt, terminal);
      if (!refreshed || typeof refreshed.accessToken !== 'string' || !refreshed.accessToken.startsWith(ANTHROPIC_OAUTH_TOKEN_PREFIX) ||
          /[\r\n\u0000]/.test(refreshed.accessToken) || typeof refreshed.refreshToken !== 'string' || !refreshed.refreshToken ||
          /[\r\n\u0000]/.test(refreshed.refreshToken) || !Number.isSafeInteger(refreshed.expiresIn) || refreshed.expiresIn <= 0) {
        throw new ApiKeyBudgetError(BUDGET_ERROR.UNAVAILABLE, { requestId: context.requestId });
      }
      const retained = failureAuthorities.get(attempt); let credentials;
      db.durableTransaction(() => {
        issued.prepareClaudeOauthRefresh(attempt, terminal);
        const saved = JSON.parse(retained.authority.connection.data);
        const updated = { ...saved, refreshToken: refreshed.refreshToken, expiresIn: refreshed.expiresIn,
          expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString() };
        if (saved.apiKey) updated.apiKey = refreshed.accessToken;
        else updated.accessToken = refreshed.accessToken;
        if (saved.apiKey && saved.accessToken) updated.accessToken = refreshed.accessToken;
        db.run('UPDATE providerConnections SET data=? WHERE id=? AND data=?', [JSON.stringify(updated), attempt.connectionId, retained.authority.connection.data]);
        const current = db.get('SELECT data FROM providerConnections WHERE id=?', [attempt.connectionId]);
        if (current?.data !== JSON.stringify(updated)) throw new ApiKeyBudgetError(BUDGET_ERROR.UNAVAILABLE, { requestId: context.requestId });
        credentials = { apiKey: updated.apiKey ?? null, accessToken: updated.accessToken ?? null, refreshToken: updated.refreshToken };
      });
      cancel(); return Object.freeze(credentials);
    },
    assertClaudeOauthTerminal(attempt, terminal) {
      const retained = attempt && failureAuthorities.get(attempt);
      if (attempt?.provider !== 'claude' || retained?.wire?.anthropicTransport?.mode !== ACCOUNTED_CLAUDE_OAUTH_MODE) {
        throw new ApiKeyBudgetError(BUDGET_ERROR.UNAVAILABLE, { requestId: context.requestId });
      }
      return issued.assertAnthropicBetaTerminal(attempt, terminal);
    },
    assertAnthropicBetaTerminal(attempt, terminal) {
      // Beta queued success needs its own retained dispatch authority, not just
      // a settled shape. Never re-admit spend after a legitimate debit.
      cancel();
      try {
        const observed = snapshotAccountingGroup([{ type: 'beta-terminal', value: terminal }])[0].value;
        const retained = attempt && failureAuthorities.get(attempt);
        if (!queued || !retained || !attempt || !['anthropic', 'claude'].includes(attempt.provider) || attempt.unrecorded ||
            retained.wire?.anthropicTransport?.mode !== (attempt.provider === 'claude' ? ACCOUNTED_CLAUDE_OAUTH_MODE : ACCOUNTED_ANTHROPIC_BETA_LIVE_MODE) ||
            !observed || observed.state !== STATE.SETTLED || observed.outcome !== 'success' || observed.unrecorded ||
            observed.requestId !== context.requestId || observed.attemptId !== attempt.attemptId || observed.apiKeyId !== identity.apiKeyId ||
            observed.costNanoUsd === null || observed.costNanoUsd === undefined || !db.health().healthy) throw new Error('Terminal unavailable');
        const coverage = db.coverage.status(identity.apiKeyId);
        if (coverage.maintenance || coverage.gaps.some(gap => !gap.resolvedAt)) throw new Error('Terminal unavailable');
        const fresh = captureQueuedRequestAuthoritySync(db, { credential, apiKeyId: identity.apiKeyId,
          provider: attempt.provider, model: attempt.model, connectionId: attempt.connectionId ?? null });
        if (!isDeepStrictEqual(fresh, retained.authority)) throw new Error('Terminal unavailable');
        validateQueuedBaseWire(fresh, retained.wire);
        if (routingProof) assertPersistedRoutingMaterialCurrent(db, routingProof.material, cancel);
        cancel();
      } catch {
        if (signal?.aborted) throw signal.reason;
        throw new ApiKeyBudgetError(BUDGET_ERROR.UNAVAILABLE, { requestId: context.requestId });
      }
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
  requestAccountingOrigins.set(issued, Object.freeze({ db, credential, apiKeyId: identity.apiKeyId,
    healthySynchronous: !queued && !pinnedProof, healthyQueued: queued === true && !pinnedProof }));
  return issued;
}
