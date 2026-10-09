import "open-sse/index.js";

import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { handleAntigravityQuotaError, clearAntigravityStrikes } from "../services/antigravityQuota.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo, getComboModels } from "../services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";
import { getTransform as getPxpipeTransform } from "@/lib/pxpipe/loader.js";
import { appendPxpipeEvent } from "@/lib/pxpipe/events.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { upstreamResponseHeaders } from "open-sse/utils/upstreamHeaders.js";
import { awaitAbortableWork } from "open-sse/utils/abortableWork.js";
import { handleComboChat, handleFusionChat, detectRequiredCapabilities } from "open-sse/services/combo.js";
import { augmentModelsWithCapacityAdapter, withCapacityAdapterStripping, getActiveAdapterStrategy } from "open-sse/services/capacityAdapter.js";
import { handleBypassRequest } from "open-sse/utils/bypassHandler.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { detectFormatByEndpoint, FORMATS } from "open-sse/translator/formats.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";
import { stripModelContextMarker } from "open-sse/utils/modelMarkers.js";
import { isAccountedOpenaiChatProvider } from 'open-sse/config/accountedChatProviders.js';
import { ACCOUNTED_ANTHROPIC_GATEWAY_PATHS } from 'open-sse/config/accountedAnthropicCandidate.js';
import { ACCOUNTED_CODEX_GATEWAY_PATHS, supportsCodexRequest } from 'open-sse/config/accountedCodexCandidate.js';
import { getGeminiOriginal, supportsGeminiRequest, ACCOUNTED_GEMINI_MODEL } from 'open-sse/config/accountedGeminiCandidate.js';
import { MAX_ACCOUNTED_COMBO_DEPTH } from 'open-sse/config/apiKeyBudgetConstants.js';
import { createRequestAccounting } from "@/lib/apiKeyBudget/requestAccounting.js";
import { handleUnhealthyChatEntry } from "@/lib/apiKeyBudget/unhealthyChatEntry.js";
import { isApiKeyBudgetError, budgetErrorResponse } from "@/lib/apiKeyBudget/errors.js";

/**
 * Handle chat completion request
 * Supports: OpenAI, Claude, Gemini, OpenAI Responses API formats
 * Format detection and translation handled by translator
 */
export async function handleChat(request, clientRawRequest = null) {
  try { return await handleChatRequest(request, clientRawRequest); }
  catch (error) {
    if (request.signal?.aborted) throw request.signal.reason;
    if (isApiKeyBudgetError(error)) return budgetErrorResponse(error);
    throw error;
  }
}
async function handleChatRequest(request, clientRawRequest = null) {
  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("CHAT", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  // Poisoned storage needs independently persisted caller/config authority
  // before any ordinary settings/auth/model/account repository is read.
  const unhealthyResponse = await handleUnhealthyChatEntry(request, body, handleChatCore, log);
  if (unhealthyResponse) return unhealthyResponse;

  // Build clientRawRequest for logging (if not provided)
  if (!clientRawRequest) {
    let url;
    try { url = new URL(request.url); }
    catch { return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid gateway request URL"); }
    clientRawRequest = {
      endpoint: url.pathname,
      body,
      headers: Object.fromEntries(request.headers.entries())
    };
  }
  // Claude Code marks a 1M-context request as `<model>[1m]`; the marker matches
  // no combo, alias or provider/model pair, so it must not reach resolution.
  // The capability travels in the anthropic-beta header, forwarded as-is.
  const { model: modelStr, contextMarker } = stripModelContextMarker(body.model);
  if (contextMarker) body.model = modelStr;

  // Request summary is emitted as the unified "▶" line in chatCore (has fmt/thinking/account)

  // Log API key (masked)
  const authHeader = request.headers.get("Authorization");
  const apiKey = extractApiKey(request);
  if (authHeader && apiKey) {
    const masked = log.maskKey(apiKey);
    log.debug("AUTH", `API Key: ${masked}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  // Enforce API key if enabled in settings
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    const valid = await isValidApiKey(apiKey);
    if (!valid) {
      log.warn("AUTH", "Invalid API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
    }
  }

  if (!modelStr) {
    log.warn("CHAT", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  const accounting = await createRequestAccounting(request);
  const geminiOriginal = getGeminiOriginal(request);
  if (accounting && geminiOriginal) {
    accounting.assertSupported(geminiOriginal.validRoute && geminiOriginal.model === modelStr &&
      supportsGeminiRequest(geminiOriginal.body));
    // Restore the detached original only when recording is active. Native
    // wrapper cannot create a second context or strip tools into eligibility.
    body = { ...geminiOriginal.body, model: modelStr, stream: geminiOriginal.stream };
  }

  // Bypass naming/warmup requests before combo rotation to avoid wasting rotation slots
  const userAgent = request?.headers?.get("user-agent") || "";
  const bypassResponse = handleBypassRequest(body, modelStr, userAgent, !!settings.ccFilterNaming);
  if (bypassResponse) return bypassResponse.response || bypassResponse;

  const requiredCapabilities = detectRequiredCapabilities(body);

  // Check if model is a combo (has multiple models with fallback)
  const comboModels = await getComboModels(modelStr);
  if (comboModels) {
    // Check for combo-specific strategy first, fallback to global
    const comboStrategies = settings.comboStrategies || {};
    const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
    const comboStrategy = comboSpecificStrategy || settings.comboStrategy || "fallback";
    const augmentedModels = augmentModelsWithCapacityAdapter(comboModels, requiredCapabilities, settings);
    const adapterAdded = augmentedModels.filter((m) => !comboModels.includes(m));

    // Augmentation selects candidates, not a billable attempt. Each concrete
    // candidate still verifies provider/schema and owns its actual POST below.
    accounting?.gate();
    if (comboStrategy === "fusion") {
      log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
      return handleFusionChat({
        body,
        models: comboModels,
        accounting,
        signal: request?.signal,
        handleSingleModel: (b, m, isPanel, dispatchSignal) => {
          let cleanRawReq = clientRawRequest;
          if (isPanel && clientRawRequest) {
            const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
            cleanRawReq = { ...clientRawRequest, body: cleanBody };
          }
          return handleSingleModelChat(b, m, cleanRawReq, request, apiKey, null, accounting, dispatchSignal, accounting ? [modelStr] : []);
        },
        log,
        comboName: modelStr,
        judgeModel: comboStrategies[modelStr]?.judgeModel,
        tuning: comboStrategies[modelStr]?.fusionTuning,
      });
    }

    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    log.info("CHAT", `Combo "${modelStr}" with ${augmentedModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      accounting,
      signal: request?.signal,
      models: augmentedModels,
      handleSingleModel: withCapacityAdapterStripping(
        (b, m) => handleSingleModelChat(accounting ? structuredClone(b) : b, m, clientRawRequest, request, apiKey, null, accounting, null, accounting ? [modelStr] : []),
        adapterAdded
      ),
      log,
      comboName: modelStr,
      comboStrategy,
      comboStickyLimit
    });
  }

  // Single model request — may still switch to a capacity-adapter model if the
  // target lacks a capability the request needs (e.g. no vision, request has an image).
  const soloAugmented = augmentModelsWithCapacityAdapter([modelStr], requiredCapabilities, settings);
  if (soloAugmented.length > 1) {
    accounting?.gate();
    const adapterAdded = soloAugmented.filter((m) => m !== modelStr);
    log.info("CHAT", `Capacity adapter for [${[...requiredCapabilities].join(",")}] on "${modelStr}" → trying ${soloAugmented.join(", ")}`);
    return handleComboChat({
      body,
      models: soloAugmented,
      accounting,
      signal: request?.signal,
      handleSingleModel: withCapacityAdapterStripping(
        (b, m) => handleSingleModelChat(accounting ? structuredClone(b) : b, m, clientRawRequest, request, apiKey, null, accounting),
        adapterAdded
      ),
      log,
      comboName: modelStr,
      comboStrategy: getActiveAdapterStrategy(requiredCapabilities, settings)
    });
  }

  return handleSingleModelChat(body, modelStr, clientRawRequest, request, apiKey, contextMarker ? `${modelStr.slice(modelStr.indexOf("/") + 1)}[${contextMarker}]` : null, accounting);
}

/**
 * Handle single model chat request
 */
async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKey = null, requestedModel = null, accounting = null, signalOverride = null, comboPath = []) {
  const requestSignal = signalOverride || request?.signal;
  if (accounting) { requestSignal?.throwIfAborted(); accounting.gate(); }
  const modelInfo = await awaitAbortableWork(() => getModelInfo(modelStr), accounting ? requestSignal : null);

  // If provider is null, this might be a combo name - check and handle
  if (!modelInfo.provider) {
    const comboModels = await awaitAbortableWork(() => getComboModels(modelStr), accounting ? requestSignal : null);
    if (comboModels) {
      // Combo identities come from the exact-name resolver; prefer its canonical
      // name, never a client tracking ID. Branch-local paths allow sibling reuse.
      const comboId = modelInfo.model || modelStr;
      accounting?.assertSupported(!comboPath.includes(comboId) && comboPath.length < MAX_ACCOUNTED_COMBO_DEPTH);
      const nextPath = accounting ? [...comboPath, comboId] : comboPath;
      const chatSettings = await getSettings();
      // Check for combo-specific strategy first, fallback to global
      const comboStrategies = chatSettings.comboStrategies || {};
      const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
      const comboStrategy = comboSpecificStrategy || chatSettings.comboStrategy || "fallback";
      // Nested fusion needs a separate bounded fan-out contract. Depth alone
      // does not bound parallel work; keep this branch closed until certified.
      accounting?.assertSupported(comboStrategy !== "fusion");
      const requiredCapabilities = detectRequiredCapabilities(body);
      const augmentedModels = augmentModelsWithCapacityAdapter(comboModels, requiredCapabilities, chatSettings);
      const adapterAdded = augmentedModels.filter((m) => !comboModels.includes(m));

      if (comboStrategy === "fusion") {
        log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
        return handleFusionChat({
          body,
          models: comboModels,
          accounting,
          signal: requestSignal,
          handleSingleModel: (b, m, isPanel, dispatchSignal) => {
            let cleanRawReq = clientRawRequest;
            if (isPanel && clientRawRequest) {
              const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
              cleanRawReq = { ...clientRawRequest, body: cleanBody };
            }
            return handleSingleModelChat(b, m, cleanRawReq, request, apiKey, null, accounting, dispatchSignal || requestSignal, nextPath);
          },
          log,
          comboName: modelStr,
          judgeModel: comboStrategies[modelStr]?.judgeModel,
          tuning: comboStrategies[modelStr]?.fusionTuning,
        });
      }

      const comboStickyLimit = chatSettings.comboStickyRoundRobinLimit;
      log.info("CHAT", `Combo "${modelStr}" with ${augmentedModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
      return handleComboChat({
        body,
        models: augmentedModels,
        accounting,
        signal: requestSignal,
        handleSingleModel: withCapacityAdapterStripping(
          (b, m) => handleSingleModelChat(accounting ? structuredClone(b) : b, m, clientRawRequest, request, apiKey, null, accounting, requestSignal, nextPath),
          adapterAdded
        ),
        log,
        comboName: modelStr,
        comboStrategy,
        comboStickyLimit
      });
    }
    log.warn("CHAT", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;
  // Potential standard native slice only; eligibility is not transport approval.
  // Core and the actual POST owner still deny OAuth/beta/unsupported options.
  // Explicit boolean intent and exact native route only; body-shape/substrings
  // cannot approve a different billed entry point.
  let nativeAccountingCandidate = false;
  if (accounting && provider === 'anthropic' && typeof body.stream === 'boolean') {
    try { nativeAccountingCandidate = ACCOUNTED_ANTHROPIC_GATEWAY_PATHS.includes(new URL(request.url).pathname); }
    catch { return errorResponse(HTTP_STATUS.BAD_REQUEST, 'Invalid gateway request URL'); }
  }
  if (accounting && provider === 'codex') {
    try { nativeAccountingCandidate = ACCOUNTED_CODEX_GATEWAY_PATHS.includes(new URL(request.url).pathname) && supportsCodexRequest({ ...body, model }, model); }
    catch { return errorResponse(HTTP_STATUS.BAD_REQUEST, 'Invalid gateway request URL'); }
  }
  if (accounting && provider === 'gemini') {
    const original = getGeminiOriginal(request);
    nativeAccountingCandidate = !!original && original.validRoute && original.model === modelStr &&
      (modelStr === model || modelStr === `gemini/${model}`) && ACCOUNTED_GEMINI_MODEL.test(model) &&
      typeof body.stream === 'boolean' && body.stream === original.stream && supportsGeminiRequest(original.body);
  }
  accounting?.assertSupported(isAccountedOpenaiChatProvider(provider) || nativeAccountingCandidate);

  // Routing shown in the unified "▶" line (client model → provider/model)

  // Extract userAgent from request
  const userAgent = request?.headers?.get("user-agent") || "";

  // Try with available accounts (fallback on errors)
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;
  let lastHeaders = null;

  while (true) {
    if (accounting) { requestSignal?.throwIfAborted(); accounting.gate(); }
    const credentials = await awaitAbortableWork(() => getProviderCredentials(provider, excludeConnectionIds, model, { requestedModel: requestedModel || model }), accounting ? requestSignal : null);

    // All accounts unavailable
    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("CHAT", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman, lastHeaders);
      }
      if (excludeConnectionIds.size === 0) {
        log.warn("AUTH", `No active credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.NOT_FOUND, `No active credentials for provider: ${provider}`);
      }
      log.warn("CHAT", "No more accounts available", { provider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable", lastHeaders);
    }

    // Account selection shown in the unified "▶" line (acc:...)
    const refreshedCredentials = await awaitAbortableWork(() => checkAndRefreshToken(provider, credentials), accounting ? requestSignal : null);
    if (accounting) requestSignal?.throwIfAborted();

    // Ensure real project ID is available for providers that need it (P0 fix: cold miss)
    if ((provider === "antigravity" || provider === "gemini-cli") && !refreshedCredentials.projectId) {
      const pid = await getProjectIdForConnection(credentials.connectionId, refreshedCredentials.accessToken, provider);
      if (pid) {
        refreshedCredentials.projectId = pid;
        // Persist to DB in background so subsequent requests have it immediately
        updateProviderCredentials(credentials.connectionId, { projectId: pid }).catch(() => { });
      }
    }

    // Use shared chatCore
    const chatSettings = await getSettings();
    const providerThinking = (chatSettings.providerThinking || {})[provider] || null;
    let sourceFormatOverride = null;
    if (request?.url) {
      try { sourceFormatOverride = detectFormatByEndpoint(new URL(request.url).pathname, body); }
      catch { return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid gateway request URL"); }
    }
    const result = await handleChatCore({
      accounting,
      signal: requestSignal,
      body: { ...body, model: `${provider}/${model}` },
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      clientRawRequest,
      connectionId: credentials.connectionId,
      userAgent,
      apiKey,
      ccFilterNaming: !!chatSettings.ccFilterNaming,
      rtkEnabled: !!chatSettings.rtkEnabled,
      headroomEnabled: !!chatSettings.headroomEnabled,
      headroomUrl: chatSettings.headroomUrl || DEFAULT_HEADROOM_URL,
      headroomCompressUserMessages: !!chatSettings.headroomCompressUserMessages,
      headroomTimeoutMs: chatSettings.headroomTimeoutMs,
      cavemanEnabled: !!chatSettings.cavemanEnabled,
      cavemanLevel: chatSettings.cavemanLevel || "full",
      ponytailEnabled: !!chatSettings.ponytailEnabled,
      ponytailLevel: chatSettings.ponytailLevel || "full",
      pxpipeEnabled: !!chatSettings.pxpipeEnabled,
      pxpipeMinChars: chatSettings.pxpipeMinChars,
      pxpipeTimeoutMs: chatSettings.pxpipeTimeoutMs,
      // Lazily warms the in-process module on first use; null when not installed (fail-open)
      pxpipeTransform: chatSettings.pxpipeEnabled ? await getPxpipeTransform() : null,
      onPxpipeEvent: appendPxpipeEvent,
      providerThinking,
      // Per-provider user overrides (custom headers / connect timeout) from settings
      providerOverrides: (chatSettings.providerOverrides || {})[provider] || null,
      // Detect source format by endpoint + body
      sourceFormatOverride,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          ...newCreds,
          existingProviderSpecificData: credentials.providerSpecificData,
          testStatus: "active"
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model);
        // "Consecutive" strikes: a success clears the breaker for this pair.
        clearAntigravityStrikes(credentials.connectionId, model);
      }
    });

    if (result.success) return result.response;
    // Failed billable attempt is terminal before control-plane mutations or
    // another account selection. Local refusal never creates provider cooldown.
    if (accounting) { requestSignal?.throwIfAborted(); accounting.gate(); }

    // Antigravity 409/429: refresh live quota to get exact resetAt before locking
    let quotaResetMs = null;
    let resetsAtMs = result.resetsAtMs;
    if (provider === "antigravity" && (result.status === 409 || result.status === 429)) {
      quotaResetMs = await handleAntigravityQuotaError(
        credentials.connectionId, result.status, model,
        refreshedCredentials.accessToken, credentials.providerSpecificData
      );
      if (quotaResetMs) resetsAtMs = quotaResetMs;
    }

    // Exhausted Antigravity model is blocked only in RAM cache until upstream resetAt.
    // Do not persist a modelLock_* for this path.
    const shouldFallback = provider === "antigravity" && quotaResetMs
      ? true
      : (await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model, resetsAtMs)).shouldFallback;

    if (shouldFallback) {
      log.warn("FALLBACK", `⇄ ACC:${credentials.connectionName} UNAVAILABLE (${result.status}) → NEXT ACCOUNT`);
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      lastHeaders = upstreamResponseHeaders(result.response?.headers);
      continue;
    }

    return result.response;
  }
}
