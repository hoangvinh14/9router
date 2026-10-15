import { isGeminiOwnedFilesMode, isGeminiOwnedVideoMetadataMode, isGeminiOwnedVideoResolutionMode, isGeminiOwnedVideoClientMode, isGeminiOwnedVideoClientInlineMode, isGeminiOwnedVideoClientInlineAudioMode, isGeminiOwnedVideoClientInlineAudioVideoMode } from '../../../open-sse/config/accountingGeminiOwnedFilesModes.js';
import { assertGeminiOwnedFileBindingSync, assertGeminiOwnedFileVideoMetadataSync, assertGeminiOwnedFileVideoResolutionSync, assertGeminiOwnedFileClientToolsSync, assertGeminiOwnedFileInlineMediaSync, assertGeminiOwnedFileInlineAudioSync, assertGeminiOwnedFileInlineVideoSync } from './geminiOwnedFileAuthority.js';
import { captureGeminiOwnedFilePriceSync } from './geminiOwnedFilePricing.js';
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from 'node:util';
import { getAccountingWriteCoordinator } from './accountingWriteCoordinator.js';
import { snapshotAccountingGroup } from '../db/accountingGroupPayload.js';
import { captureQueuedRequestAuthoritySync } from './queuedRequestAuthority.js';
import { validateQueuedBaseWire } from './queuedBaseWire.js';
import { QUEUED_GEMINI_EMBEDDING_PROTOCOL } from './queuedGeminiEmbeddingWire.js';
import { captureGeminiEmbeddingSelectionSync } from './geminiEmbeddingSelection.js';
import { assertPersistedRoutingMaterialCurrent } from './persistedRoutingGraph.js';
import { getAdapter } from "../db/driver.js";
import { getPolicySync, putPolicySync, sumSpendSync, countStatesSync, insertAttemptSync, finalizeAttemptSync, getAttemptSync, resolveAttemptSync } from "../db/repos/apiKeyAccountingRepo.js";
import { resolveReferencePriceSync } from "../pricing/referenceResolver.js";
import { costFromExactUsageSnapshot, decimalToNanoUsd } from "../pricing/money.js";
import { BUDGET_ERROR, BUDGET_SCOPE, ACCOUNTING_STATE as STATE } from "../../../open-sse/config/apiKeyBudgetConstants.js";
import { budgetWindows } from "./windows.js";
import { ApiKeyBudgetError } from "./errors.js";
import { isAccountedOpenaiChatProvider } from '../../../open-sse/config/accountedChatProviders.js';
import { validateAccountingUsageEvidence } from '../../../open-sse/utils/accountingUsageEvidence.js';
import { projectAccountingUsageSync } from "../db/repos/usageRepo.js";
import { ACCOUNTED_ANTHROPIC_DYNAMIC_MODE, ACCOUNTED_CLAUDE_OAUTH_DYNAMIC_MODE, isClaudeDynamicMode } from '../../../open-sse/config/accountingClaudeDynamicModes.js';
import { supportsClaudeDynamicOriginal } from '../../../open-sse/config/accountingClaudeDynamicOriginal.js';
import { ACCOUNTED_ANTHROPIC_BETA_LIVE_MODE, anthropicRequestHasCache1h } from '../../../open-sse/config/accountedAnthropicCandidate.js';
import { CLAUDE_ACCOUNTING_SERVER_FETCH_NAME } from '../../../open-sse/config/accountingClaudeServerFetch.js';
import { CLAUDE_ACCOUNTING_SERVER_SEARCH_NAME } from '../../../open-sse/config/accountingClaudeServerSearch.js';
import { ACCOUNTING_CODE_PROVENANCE, ACCOUNTING_WEB_FETCH_PROVENANCE, ACCOUNTING_EMBEDDED_TOOL_PROVENANCE, ACCOUNTING_EMBEDDED_TOOL_RATES } from '../../../open-sse/config/accountingEmbeddedToolRates.js';
import { ACCOUNTED_CLAUDE_OAUTH_MODE } from '../../../open-sse/config/accountedClaudeOauth.js';
import { isGeminiClientMode } from '../../../open-sse/config/accountingGeminiClientModes.js';
import { isGeminiInlineMode } from '../../../open-sse/config/accountingGeminiInlineModes.js';
import { isGeminiAudioMode } from '../../../open-sse/config/accountingGeminiAudioModes.js';
import { isGeminiVideoMode } from '../../../open-sse/config/accountingGeminiVideoModes.js';
import { isGeminiVideoMetadataMode } from '../../../open-sse/config/accountingGeminiVideoMetadataModes.js';
import { isGeminiVideoResolutionMode } from '../../../open-sse/config/accountingGeminiVideoResolutionModes.js';
import { isGeminiInlineResolutionMode } from '../../../open-sse/config/accountingGeminiInlineResolutionModes.js';
import { isGeminiAudioResolutionMode } from '../../../open-sse/config/accountingGeminiAudioResolutionModes.js';
import { isGeminiVideoProcessingMode } from '../../../open-sse/config/accountingGeminiVideoProcessingModes.js';
import { isGeminiProcessingToolsMode } from '../../../open-sse/config/accountingGeminiProcessingToolsModes.js';
import { ACCOUNTING_GEMINI_PROCESSING_MODALITY_PROVENANCE, ACCOUNTING_GEMINI_PROCESSING_RATES, ACCOUNTING_GEMINI_PROCESSING_RATE_UNIT } from '../../../open-sse/config/accountingGeminiProcessingRates.js';
import { ACCOUNTING_GEMINI_PROCESSING_ZERO_PROVENANCE } from '../../../open-sse/config/accountingGeminiProcessingEvidence.js';
import { ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES } from '../../../open-sse/config/accountingGeminiInlineMedia.js';
import { createGeminiInputModalityAuthority } from '../../../open-sse/config/accountingGeminiInputModalities.js';
import { ACCOUNTING_GEMINI_MODALITY_PROVENANCE, ACCOUNTING_GEMINI_MODALITY_RATE_UNIT, ACCOUNTING_GEMINI_MODALITY_RATES } from '../../../open-sse/config/accountingGeminiModalityRates.js';

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
      try { cost = costFromExactUsageSnapshot(usage, original.priceSnapshot); } catch { /* unknown is unresolved, never estimated zero */ }
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
  async function beginAttemptQueued(meta, { signal = null, requestAuthority = null, preparedWire = null, routingMaterial = null, ownedFileCapability = null } = {}) {
    if (signal?.aborted) throw signal.reason;
    // Capture immutable monetary authority, NOT permission to dispatch after wait.
    const detached = snapshotAccountingGroup([{ type: 'insert', input: meta }])[0];
    if (detached.type !== 'insert') fail(BUDGET_ERROR.UNAVAILABLE);
    const { provider, model, endpoint = 'chat', connectionId = null } = detached.input;
    const authority = requestAuthority === null ? null : snapshotAccountingGroup([{ type: 'authority', value: requestAuthority }])[0].value;
    const wire = preparedWire === null ? null : validateQueuedBaseWire(authority, preparedWire);
    const routing = routingMaterial === null ? null : snapshotAccountingGroup([{ type: 'routing-material', value: routingMaterial }])[0].value;
    const needsGeminiOwnedVideoMetadata = wire?.protocol === 'native-gemini' && isGeminiOwnedVideoMetadataMode(wire.geminiTransport.mode);
    const needsGeminiOwnedVideoResolution = wire?.protocol === 'native-gemini' && isGeminiOwnedVideoResolutionMode(wire.geminiTransport.mode);
    const needsGeminiOwnedPrice = wire?.protocol === 'native-gemini' && (isGeminiOwnedFilesMode(wire.geminiTransport.mode) || needsGeminiOwnedVideoMetadata || needsGeminiOwnedVideoResolution);
    if (needsGeminiOwnedPrice && (provider !== 'gemini' || endpoint !== 'chat')) fail(BUDGET_ERROR.UNAVAILABLE);
    if (!needsGeminiOwnedPrice && ownedFileCapability !== null) fail(BUDGET_ERROR.UNAVAILABLE);
    const checkOwnedResource = () => {
      if (!needsGeminiOwnedPrice) return;
      if (!authority || authority.apiKeyId !== apiKeyId || authority.provider !== provider || authority.model !== model || authority.connectionId !== connectionId) fail(BUDGET_ERROR.UNAVAILABLE);
      try {
        const bound = assertGeminiOwnedFileBindingSync(db, ownedFileCapability, { credential: authority.credential, apiKeyId, provider, model, connectionId }, wire.geminiTransport.originalBody);
        if (!isDeepStrictEqual(bound.resources, wire.geminiTransport.resources) ||
            assertGeminiOwnedFileVideoMetadataSync(db, ownedFileCapability, wire.geminiTransport.originalBody, model) !== needsGeminiOwnedVideoMetadata ||
            assertGeminiOwnedFileVideoResolutionSync(db, ownedFileCapability, wire.geminiTransport.originalBody, model) !== needsGeminiOwnedVideoResolution ||
            assertGeminiOwnedFileClientToolsSync(db, ownedFileCapability, wire.geminiTransport.originalBody, model) !== isGeminiOwnedVideoClientMode(wire.geminiTransport.mode) ||
            assertGeminiOwnedFileInlineMediaSync(db, ownedFileCapability, wire.geminiTransport.originalBody, model) !== isGeminiOwnedVideoClientInlineMode(wire.geminiTransport.mode) ||
            assertGeminiOwnedFileInlineAudioSync(db, ownedFileCapability, wire.geminiTransport.originalBody, model) !== isGeminiOwnedVideoClientInlineAudioMode(wire.geminiTransport.mode) ||
            assertGeminiOwnedFileInlineVideoSync(db, ownedFileCapability, wire.geminiTransport.originalBody, model) !== isGeminiOwnedVideoClientInlineAudioVideoMode(wire.geminiTransport.mode)) fail(BUDGET_ERROR.UNAVAILABLE);
      } catch { fail(BUDGET_ERROR.UNAVAILABLE); }
    };
    checkOwnedResource();
    const needsGeminiClientPrice = provider === 'gemini' && endpoint === 'chat' && wire?.protocol === 'native-gemini' && isGeminiClientMode(wire.geminiTransport.mode);
    const needsGeminiProcessingTools = provider === 'gemini' && endpoint === 'chat' && wire?.protocol === 'native-gemini' && isGeminiProcessingToolsMode(wire.geminiTransport.mode);
    const needsGeminiProcessingEvidence = provider === 'gemini' && endpoint === 'chat' && wire?.protocol === 'native-gemini' && (isGeminiVideoProcessingMode(wire.geminiTransport.mode) || needsGeminiProcessingTools);
    const needsGeminiInlinePrice = provider === 'gemini' && endpoint === 'chat' && wire?.protocol === 'native-gemini' && (isGeminiInlineMode(wire.geminiTransport.mode) || isGeminiAudioMode(wire.geminiTransport.mode) || isGeminiVideoMode(wire.geminiTransport.mode) || isGeminiVideoMetadataMode(wire.geminiTransport.mode) || isGeminiVideoResolutionMode(wire.geminiTransport.mode) || isGeminiInlineResolutionMode(wire.geminiTransport.mode) || isGeminiAudioResolutionMode(wire.geminiTransport.mode) || needsGeminiProcessingEvidence);
    let inputModalities = null;
    if (needsGeminiInlinePrice) {
      try {
        const original = wire.geminiTransport.originalBody, resolution = isGeminiVideoResolutionMode(wire.geminiTransport.mode) || needsGeminiProcessingEvidence && (Object.hasOwn(original.generationConfig || {}, 'mediaResolution') || original.contents.some(content => content.parts.some(part => Object.hasOwn(part, 'mediaResolution') && ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES.includes(part.inlineData?.mimeType))));
        const metadata = isGeminiVideoMetadataMode(wire.geminiTransport.mode) || (resolution || needsGeminiProcessingEvidence) && original.contents.some(content => content.parts.some(part => Object.hasOwn(part, 'videoMetadata')));
        const video = isGeminiVideoMode(wire.geminiTransport.mode) || metadata || resolution || needsGeminiProcessingEvidence;
        const processingTrace = needsGeminiProcessingTools && original.contents.some(content => content.parts.some(part => Object.hasOwn(part, 'toolCall') || Object.hasOwn(part, 'toolResponse')));
        inputModalities = createGeminiInputModalityAuthority(original, Object.hasOwn(original, 'tools') ? original : null, true, isGeminiAudioMode(wire.geminiTransport.mode) || video || isGeminiAudioResolutionMode(wire.geminiTransport.mode), video, metadata, resolution, isGeminiInlineResolutionMode(wire.geminiTransport.mode), isGeminiAudioResolutionMode(wire.geminiTransport.mode), needsGeminiProcessingEvidence, processingTrace).allowedInputModalities;
      }
      catch { fail(BUDGET_ERROR.UNAVAILABLE); }
    }
    const hasGeminiInlinePrice = price => price.status === 'priced' && inputModalities.every(modality => {
      const fields = ACCOUNTING_GEMINI_MODALITY_RATES.find(item => item.modality === modality);
      const initial = [fields.input, fields.cached].every(key => Object.hasOwn(price.snapshot.rates, key) && price.snapshot.rateUnits?.[key] === ACCOUNTING_GEMINI_MODALITY_RATE_UNIT);
      if (!needsGeminiProcessingTools) return initial;
      const processing = ACCOUNTING_GEMINI_PROCESSING_RATES.find(item => item.modality === modality);
      return initial && processing && Object.hasOwn(price.snapshot.rates, processing.rate) && price.snapshot.rateUnits?.[processing.rate] === ACCOUNTING_GEMINI_PROCESSING_RATE_UNIT;
    });
    let needsCache1hRate = false, needsServerSearchRate = false, needsServerFetchUsage = false, needsCodeUsage = false;
    try {
      needsCache1hRate = wire?.protocol === 'native-anthropic' && [ACCOUNTED_ANTHROPIC_BETA_LIVE_MODE, ACCOUNTED_CLAUDE_OAUTH_MODE, ACCOUNTED_ANTHROPIC_DYNAMIC_MODE, ACCOUNTED_CLAUDE_OAUTH_DYNAMIC_MODE].includes(wire.anthropicTransport.mode) &&
        anthropicRequestHasCache1h(JSON.parse(wire.anthropicTransport.serializedBody));
      needsServerSearchRate = ['anthropic', 'claude'].includes(provider) && endpoint === 'chat' && wire?.protocol === 'native-anthropic' &&
        (provider === 'claude' ? [ACCOUNTED_CLAUDE_OAUTH_MODE, ACCOUNTED_CLAUDE_OAUTH_DYNAMIC_MODE] : [ACCOUNTED_ANTHROPIC_BETA_LIVE_MODE, ACCOUNTED_ANTHROPIC_DYNAMIC_MODE]).includes(wire.anthropicTransport.mode) &&
        JSON.parse(wire.anthropicTransport.originalSerializedBody).tools?.some(tool => tool.name === CLAUDE_ACCOUNTING_SERVER_SEARCH_NAME) === true;
      needsServerFetchUsage = ['anthropic', 'claude'].includes(provider) && endpoint === 'chat' && wire?.protocol === 'native-anthropic' &&
        (provider === 'claude' ? [ACCOUNTED_CLAUDE_OAUTH_MODE, ACCOUNTED_CLAUDE_OAUTH_DYNAMIC_MODE] : [ACCOUNTED_ANTHROPIC_BETA_LIVE_MODE, ACCOUNTED_ANTHROPIC_DYNAMIC_MODE]).includes(wire.anthropicTransport.mode) &&
        JSON.parse(wire.anthropicTransport.originalSerializedBody).tools?.some(tool => tool.name === CLAUDE_ACCOUNTING_SERVER_FETCH_NAME) === true;
      needsCodeUsage = wire?.protocol === 'native-anthropic' && isClaudeDynamicMode(wire.anthropicTransport.mode);
      if (needsCodeUsage && !supportsClaudeDynamicOriginal(JSON.parse(wire.anthropicTransport.originalSerializedBody), model)) fail(BUDGET_ERROR.UNAVAILABLE);
    } catch { fail(BUDGET_ERROR.UNAVAILABLE); }
    const oauthProtocols = { claude: ['native-anthropic'], codex: ['native-codex'], 'grok-cli': ['native-grok-cli'], github: ['native-github-responses', 'native-github-messages', 'chat-github-messages'], commandcode: ['native-commandcode'], kiro: ['native-kiro'] };
    if (Object.hasOwn(oauthProtocols, provider) && (!oauthProtocols[provider].includes(wire?.protocol) || endpoint !== 'chat' ||
        authority?.provider !== provider || authority.model !== model || authority.connection?.id !== connectionId)) fail(BUDGET_ERROR.UNAVAILABLE);
    const geminiEmbedding = wire?.protocol === QUEUED_GEMINI_EMBEDDING_PROTOCOL;
    const embeddingProtocol = wire?.protocol === 'native-embeddings' || geminiEmbedding;
    if (embeddingProtocol && endpoint !== 'embeddings' || endpoint === 'embeddings' && wire !== null && !embeddingProtocol ||
        provider === 'gemini' && endpoint === 'embeddings' && (!geminiEmbedding || authority?.provider !== provider ||
          authority.model !== model || authority.connection?.id !== connectionId)) fail(BUDGET_ERROR.UNAVAILABLE);
    let preparedSelection = null;
    if (geminiEmbedding) {
      try { preparedSelection = captureGeminiEmbeddingSelectionSync(db, authority); } catch { fail(BUDGET_ERROR.UNAVAILABLE); }
    }
    coverage();
    // The narrow poisoned-unlimited proof+sidecar owner stays synchronous and
    // separate. No queued DB transaction can substitute for its independent ACK.
    // Poisoned/unrecorded unlimited admission cannot establish paid-search
    // original price/count authority. Refuse rather than downgrade this slice.
    if (!db.health().healthy) {
      if (needsServerSearchRate || needsServerFetchUsage || needsCodeUsage || needsGeminiClientPrice || needsGeminiInlinePrice || needsGeminiOwnedPrice) fail(BUDGET_ERROR.UNAVAILABLE);
      return beginAttempt({ provider, model, endpoint, connectionId });
    }
    const preparedStatus = gate();
    if (preparedStatus.exempt) return null;
    if (!BUDGET_SCOPE.includes(endpoint)) fail(BUDGET_ERROR.UNSUPPORTED);
    let preparedPrice;
    try { preparedPrice = resolveReferencePriceSync(db, provider, model, endpoint); }
    catch { fail(BUDGET_ERROR.UNAVAILABLE); }
    let preparedOwnedPrice = null;
    if (needsGeminiOwnedPrice) {
      try { preparedOwnedPrice = captureGeminiOwnedFilePriceSync(db, ownedFileCapability, wire.geminiTransport.originalBody, model); }
      catch { fail(BUDGET_ERROR.PRICING); }
      checkOwnedResource();
    }
    const hasServerSearchRate = price => price.status === 'priced' && ACCOUNTING_EMBEDDED_TOOL_RATES.every(({ rate, unit }) =>
      Object.hasOwn(price.snapshot?.rates || {}, rate) && price.snapshot.rateUnits?.[rate] === unit);
    if (preparedStatus.budgeted && preparedPrice.status !== 'priced' || needsCache1hRate && preparedPrice.snapshot?.rates.cache_creation_1h === undefined ||
        needsServerSearchRate && !hasServerSearchRate(preparedPrice) || (needsServerFetchUsage || needsCodeUsage || needsGeminiClientPrice) && preparedPrice.status !== 'priced' || needsGeminiInlinePrice && !hasGeminiInlinePrice(preparedPrice)) fail(BUDGET_ERROR.PRICING);
    const binding = db.get('SELECT fingerprint,retiredAt FROM apiKeyBindings WHERE apiKeyId=?', [apiKeyId]);
    let admittedInput = null, budgeted = preparedStatus.budgeted;
    try {
      const result = await enqueueOperation(() => {
        if (signal?.aborted) throw signal.reason;
        const status = gate(); budgeted = status.budgeted;
        if (routing !== null) {
          try { assertPersistedRoutingMaterialCurrent(db, routing, gate); }
          catch { fail(BUDGET_ERROR.UNAVAILABLE); }
        }
        if (authority !== null) {
          try {
            const fresh = captureQueuedRequestAuthoritySync(db, { credential: authority.credential, apiKeyId, provider, model, connectionId });
            if (!isDeepStrictEqual(fresh, authority)) fail(BUDGET_ERROR.UNAVAILABLE);
            if (wire !== null) validateQueuedBaseWire(fresh, wire);
            if (geminiEmbedding && !isDeepStrictEqual(captureGeminiEmbeddingSelectionSync(db, fresh), preparedSelection)) fail(BUDGET_ERROR.UNAVAILABLE);
          } catch { fail(BUDGET_ERROR.UNAVAILABLE); }
        }
        checkOwnedResource();
        if (status.exempt || status.ledgerStartedAt !== preparedStatus.ledgerStartedAt ||
            !isDeepStrictEqual(db.get('SELECT fingerprint,retiredAt FROM apiKeyBindings WHERE apiKeyId=?', [apiKeyId]), binding)) fail(BUDGET_ERROR.UNAVAILABLE);
        let price;
        try { price = resolveReferencePriceSync(db, provider, model, endpoint); }
        catch { fail(BUDGET_ERROR.UNAVAILABLE); }
        if (!isDeepStrictEqual(price, preparedPrice)) fail(BUDGET_ERROR.UNAVAILABLE);
        if (status.budgeted && price.status !== 'priced' || needsCache1hRate && price.snapshot?.rates.cache_creation_1h === undefined ||
            needsServerSearchRate && !hasServerSearchRate(price) || (needsServerFetchUsage || needsCodeUsage || needsGeminiClientPrice) && price.status !== 'priced' || needsGeminiInlinePrice && !hasGeminiInlinePrice(price)) fail(BUDGET_ERROR.PRICING);
        let ownedPrice = null;
        if (needsGeminiOwnedPrice) {
          try { ownedPrice = captureGeminiOwnedFilePriceSync(db, ownedFileCapability, wire.geminiTransport.originalBody, model); }
          catch { fail(BUDGET_ERROR.PRICING); }
          if (!isDeepStrictEqual(ownedPrice, preparedOwnedPrice)) fail(BUDGET_ERROR.UNAVAILABLE);
          checkOwnedResource();
        }
        if (coverage().generation !== status.coverage.generation) fail(BUDGET_ERROR.UNAVAILABLE);
        admittedInput = { attemptId: randomUUID(), requestId, apiKeyId, ownerInstanceId: db.ownerInstanceId,
          startedAt: status.now.toISOString(), provider, model, endpoint, connectionId,
          priceSnapshot: needsGeminiOwnedPrice ? ownedPrice.snapshot : needsCache1hRate || needsServerSearchRate || needsServerFetchUsage || needsCodeUsage || needsGeminiInlinePrice ? { ...price.snapshot, usageSemantics: {
            ...(needsCache1hRate ? { cacheWriteTiers: 'observed_5m_1h' } : {}),
            ...(needsServerSearchRate ? { serverToolUses: ACCOUNTING_EMBEDDED_TOOL_PROVENANCE } : {}),
            ...(needsServerFetchUsage ? { nonBillableServerToolUses: ACCOUNTING_WEB_FETCH_PROVENANCE } : {}),
            ...(needsCodeUsage ? { codeServerToolUses: ACCOUNTING_CODE_PROVENANCE } : {}),
            ...(needsGeminiInlinePrice ? { inputModalities: ACCOUNTING_GEMINI_MODALITY_PROVENANCE, allowedInputModalities: inputModalities } : {}),
            ...(needsGeminiProcessingEvidence ? { videoProcessingToolPrompt: needsGeminiProcessingTools ? ACCOUNTING_GEMINI_PROCESSING_MODALITY_PROVENANCE : ACCOUNTING_GEMINI_PROCESSING_ZERO_PROVENANCE } : {}),
            ...(needsGeminiProcessingTools ? { allowedProcessingToolModalities: [...inputModalities] } : {}),
          } } : price.snapshot || null };
        return { type: 'insert', input: admittedInput };
      }, { meta: detached.input, price: preparedPrice, binding, ledgerStartedAt: preparedStatus.ledgerStartedAt, authority, wire, routing, preparedSelection, ...(preparedOwnedPrice ? { ownedPrice: preparedOwnedPrice } : {}) }, signal);
      const attempt = Object.freeze(result); attempts.set(attempt.attemptId, attempt); return attempt;
    } catch (error) {
      // Member authority refusal/cancel cannot become an unlimited recording
      // exception. Only a prepared mutation whose durable ACK failed may latch.
      if (error instanceof ApiKeyBudgetError) throw error;
      if (!admittedInput && signal?.aborted) throw signal.reason;
      if (!admittedInput || budgeted || needsGeminiInlinePrice || needsGeminiOwnedPrice) fail(BUDGET_ERROR.UNAVAILABLE);
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
          try { cost = costFromExactUsageSnapshot(usage, original.priceSnapshot); } catch { /* unresolved, never estimated */ }
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
