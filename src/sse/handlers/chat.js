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
import { mergeWithDefaults } from "@/lib/db/repos/settingsRepo.js";
import { getModelInfo, getComboModels } from "../services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";
import { getTransform as getPxpipeTransform } from "@/lib/pxpipe/loader.js";
import { appendPxpipeEvent } from "@/lib/pxpipe/events.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { upstreamResponseHeaders } from "open-sse/utils/upstreamHeaders.js";
import { handleComboChat, handleFusionChat, detectRequiredCapabilities } from "open-sse/services/combo.js";
import { augmentModelsWithCapacityAdapter, withCapacityAdapterStripping, getActiveAdapterStrategy } from "open-sse/services/capacityAdapter.js";
import { handleBypassRequest } from "open-sse/utils/bypassHandler.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import { resolveSessionIdentity } from "open-sse/utils/sessionManager.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";
import { stripModelContextMarker } from "open-sse/utils/modelMarkers.js";
import { getKeyAccessContext, enforceKeyAccess, filterAdapterModels, isRequestedTargetAllowed } from "../services/keyAccess.js";
import { resolveSmartChoice } from "../services/systemoneRouter.js";
import { refuseUnadmittedAccountingRequest, accountingUnavailableResponse, selectedAccountingSecret } from "@/lib/accounting/request-boundary.js";
import { markAccountingResponse } from "open-sse/utils/accountingResponse.js";

const refuseCandidate = () => markAccountingResponse(accountingUnavailableResponse());
const extendBranch = (branch, target) => Object.freeze([...branch, target]);
const supportsAccountedCombo = strategy => ["fallback", "round-robin"].includes(strategy);

/**
 * Handle chat completion request
 * Supports: OpenAI, Claude, Gemini, OpenAI Responses API formats
 * Format detection and translation handled by translator
 */
export async function handleChat(request, clientRawRequest = null) {
  // Direct/internal callers need the same check as the public guard, before
  // parsing, routing, naming bypass, helper inference or credential discovery.
  const accountingRefusal = await refuseUnadmittedAccountingRequest(request);
  if (accountingRefusal) return accountingRefusal;
  return routeChat(request, clientRawRequest, null);
}

// Internal candidate composition only. Public callers cannot select this entry
// or supply an identity, routing readers, or context factory through a request.
export async function handleAccountedChatCandidate(request, { identity, createContext, provider = "anthropic" }) {
  try {
    const endpoint = provider === 'codex' ? '/v1/responses' : '/v1/messages';
    if (!['anthropic', 'codex'].includes(provider) || request.method !== 'POST' || new URL(request.url).pathname !== endpoint ||
        request.headers.has('anthropic-workspace-id') ||
        !identity.matchesSecret(selectedAccountingSecret(request))) return refuseCandidate();
    const view = await identity.captureRoute();
    const settings = mergeWithDefaults(view.reads.getSettingsData());
    return await routeChat(request, null, { view, settings, createContext, provider });
  } catch {
    return refuseCandidate();
  }
}

async function routeChat(request, clientRawRequest, candidate) {
  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("CHAT", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  // Build clientRawRequest for logging (if not provided)
  if (!clientRawRequest) {
    const url = new URL(request.url);
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

  const session = resolveSessionIdentity({ headers: clientRawRequest?.headers, body });
  const sessionId = session?.sessionId || null;

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
  const settings = candidate ? candidate.settings : await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    // The candidate already matched the owner-bound secret; the final SQLite
    // gate resolves that same secret again. Ordinary auth stays unchanged.
    const valid = candidate || await isValidApiKey(apiKey);
    if (!valid) {
      log.warn("AUTH", "Invalid API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
    }
  }

  if (!modelStr) {
    log.warn("CHAT", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  // Per-key access control: a restricted key may call only its listed combos and
  // models. Checked once on the requested target, before bypass, combo expansion
  // and any credential lookup; an allowed combo grants the members it routes to.
  const keyAccess = candidate ? candidate.view.access : await getKeyAccessContext(request);
  if (candidate) {
    const { reads } = candidate.view;
    if (contextMarker || !await isRequestedTargetAllowed(keyAccess, modelStr, {
      getCombos: reads.getCombos,
      getComboModels: target => getComboModels(target, reads),
      getModelInfo: target => getModelInfo(target, reads),
    })) return refuseCandidate();
  } else {
    const keyAccessDenied = await enforceKeyAccess(keyAccess, modelStr);
    if (keyAccessDenied) return keyAccessDenied;
  }
  const branch = candidate ? Object.freeze([modelStr]) : null;
  const runSingle = (b, m, nextBranch = branch, requestedModel = null) =>
    handleSingleModelChat(b, m, clientRawRequest, request, apiKey, requestedModel, candidate, nextBranch);

  // Bypass naming/warmup requests before combo rotation to avoid wasting rotation slots
  const userAgent = request?.headers?.get("user-agent") || "";
  const bypassResponse = handleBypassRequest(body, modelStr, userAgent, !!settings.ccFilterNaming);
  if (bypassResponse) return candidate ? refuseCandidate() : bypassResponse.response || bypassResponse;

  const requiredCapabilities = detectRequiredCapabilities(body);

  // Check if model is a combo (has multiple models with fallback)
  const comboModels = await getComboModels(modelStr, candidate?.view.reads);
  if (comboModels) {
    if (candidate?.provider === "codex") return refuseCandidate();
    // Check for combo-specific strategy first, fallback to global
    const comboStrategies = settings.comboStrategies || {};
    const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
    const comboStrategy = comboSpecificStrategy || settings.comboStrategy || "fallback";
    const expanded = augmentModelsWithCapacityAdapter(comboModels, requiredCapabilities, settings);
    if (candidate && (!supportsAccountedCombo(comboStrategy) || expanded.some(m => !comboModels.includes(m)))) return refuseCandidate();
    const augmentedModels = candidate ? expanded : await filterAdapterModels(keyAccess, expanded, comboModels);
    const adapterAdded = augmentedModels.filter((m) => !comboModels.includes(m));

    if (comboStrategy === "fusion") {
      log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
      return handleFusionChat({
        body,
        models: comboModels,
        handleSingleModel: (b, m, isPanel) => {
          let cleanRawReq = clientRawRequest;
          if (isPanel && clientRawRequest) {
            const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
            cleanRawReq = { ...clientRawRequest, body: cleanBody };
          }
          return handleSingleModelChat(b, m, cleanRawReq, request, apiKey);
        },
        log,
        comboName: modelStr,
        judgeModel: comboStrategies[modelStr]?.judgeModel,
        tuning: comboStrategies[modelStr]?.fusionTuning,
      });
    }

    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    const comboCfg = comboStrategies[modelStr] || {};
    log.info("CHAT", `Combo "${modelStr}" with ${augmentedModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: augmentedModels,
      handleSingleModel: withCapacityAdapterStripping(
        (b, m) => runSingle(b, m, branch ? extendBranch(branch, m) : null),
        adapterAdded
      ),
      log,
      comboName: modelStr,
      comboStrategy,
      comboStickyLimit,
      sessionId,
      smartPolicy: comboCfg.smartPolicy || "smart",
      sessionSticky: comboCfg.sessionSticky !== false,
      confidenceThreshold: typeof comboCfg.confidenceThreshold === "number" ? comboCfg.confidenceThreshold : 0.8,
      resolveSmartChoice: comboStrategy === "smart"
        ? (b, m) => resolveSmartChoice({
            body: b,
            models: m,
            routerModel: comboCfg.routerModel,
            log,
          })
        : null,
    });
  }

  // Single model request — may still switch to a capacity-adapter model if the
  // target lacks a capability the request needs (e.g. no vision, request has an image).
  const expanded = augmentModelsWithCapacityAdapter([modelStr], requiredCapabilities, settings);
  if (candidate && expanded.some(m => m !== modelStr)) return refuseCandidate();
  const soloAugmented = candidate ? expanded : await filterAdapterModels(keyAccess, expanded, [modelStr]);
  if (soloAugmented.length > 1) {
    const adapterAdded = soloAugmented.filter((m) => m !== modelStr);
    log.info("CHAT", `Capacity adapter for [${[...requiredCapabilities].join(",")}] on "${modelStr}" → trying ${soloAugmented.join(", ")}`);
    return handleComboChat({
      body,
      models: soloAugmented,
      handleSingleModel: withCapacityAdapterStripping(
        (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
        adapterAdded
      ),
      log,
      comboName: modelStr,
      comboStrategy: getActiveAdapterStrategy(requiredCapabilities, settings)
    });
  }

  return runSingle(body, modelStr, branch, contextMarker ? `${modelStr.slice(modelStr.indexOf("/") + 1)}[${contextMarker}]` : null);
}

/**
 * Handle single model chat request
 */
async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKey = null, requestedModel = null, candidate = null, branch = null) {
  if (candidate) {
    try {
      return await dispatchSingleModel(body, modelStr, clientRawRequest, request, apiKey, requestedModel, candidate, branch);
    } catch {
      // Combo catches thrown errors and would otherwise try a successor.
      return refuseCandidate();
    }
  }
  return dispatchSingleModel(body, modelStr, clientRawRequest, request, apiKey, requestedModel, null, null);
}

async function dispatchSingleModel(body, modelStr, clientRawRequest, request, apiKey, requestedModel, candidate, branch) {
  if (candidate && (branch.length > 16 || new Set(branch).size !== branch.length)) return refuseCandidate();
  const modelInfo = await getModelInfo(modelStr, candidate?.view.reads);

  // If provider is null, this might be a combo name - check and handle
  if (!modelInfo.provider) {
    const comboModels = await getComboModels(modelStr, candidate?.view.reads);
    if (comboModels) {
      const chatSettings = candidate ? candidate.settings : await getSettings();
      // Check for combo-specific strategy first, fallback to global
      const comboStrategies = chatSettings.comboStrategies || {};
      const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
      const comboStrategy = comboSpecificStrategy || chatSettings.comboStrategy || "fallback";
      const requiredCapabilities = detectRequiredCapabilities(body);
      // Nested combo (a combo member that is itself a combo): the access decision
      // was made on the outer target; only drop adapter models the key may not call.
      const keyAccess = candidate ? candidate.view.access : await getKeyAccessContext(request);
      const expanded = augmentModelsWithCapacityAdapter(comboModels, requiredCapabilities, chatSettings);
      if (candidate && (!supportsAccountedCombo(comboStrategy) || expanded.some(m => !comboModels.includes(m)))) return refuseCandidate();
      const augmentedModels = candidate ? expanded : await filterAdapterModels(keyAccess, expanded, comboModels);
      const adapterAdded = augmentedModels.filter((m) => !comboModels.includes(m));

      if (comboStrategy === "fusion") {
        log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
        return handleFusionChat({
          body,
          models: comboModels,
          handleSingleModel: (b, m, isPanel) => {
            let cleanRawReq = clientRawRequest;
            if (isPanel && clientRawRequest) {
              const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
              cleanRawReq = { ...clientRawRequest, body: cleanBody };
            }
            return handleSingleModelChat(b, m, cleanRawReq, request, apiKey);
          },
          log,
          comboName: modelStr,
          judgeModel: comboStrategies[modelStr]?.judgeModel,
          tuning: comboStrategies[modelStr]?.fusionTuning,
        });
      }

      const comboStickyLimit = chatSettings.comboStickyRoundRobinLimit;
      const comboCfg = comboStrategies[modelStr] || {};
      const nestedSession = resolveSessionIdentity({ headers: clientRawRequest?.headers, body });
      const nestedSessionId = nestedSession?.sessionId || null;
      log.info("CHAT", `Combo "${modelStr}" with ${augmentedModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
      return handleComboChat({
        body,
        models: augmentedModels,
        handleSingleModel: withCapacityAdapterStripping(
          (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey, null, candidate, branch ? extendBranch(branch, m) : null),
          adapterAdded
        ),
        log,
        comboName: modelStr,
        comboStrategy,
        comboStickyLimit,
        sessionId: nestedSessionId,
        smartPolicy: comboCfg.smartPolicy || "smart",
        sessionSticky: comboCfg.sessionSticky !== false,
        confidenceThreshold: typeof comboCfg.confidenceThreshold === "number" ? comboCfg.confidenceThreshold : 0.8,
        resolveSmartChoice: comboStrategy === "smart"
          ? (b, m) => resolveSmartChoice({
              body: b,
              models: m,
              routerModel: comboCfg.routerModel,
              log,
            })
          : null,
      });
    }
    if (candidate) return refuseCandidate();
    log.warn("CHAT", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;
  if (candidate && provider !== candidate.provider) return refuseCandidate();
  const routeProof = candidate ? await candidate.view.select(branch, { provider, model }) : null;

  // Routing shown in the unified "▶" line (client model → provider/model)

  // Extract userAgent from request
  const userAgent = request?.headers?.get("user-agent") || "";

  // Try with available accounts (fallback on errors)
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;
  let lastHeaders = null;

  while (true) {
    const credentialOptions = { requestedModel: requestedModel || model };
    if (candidate) credentialOptions.accountedSettings = candidate.settings;
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model, credentialOptions);

    // All accounts unavailable
    if (!credentials || credentials.allRateLimited) {
      if (candidate) return refuseCandidate();
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
    // This candidate does not authorize a refresh or a second account.
    if (candidate) {
      const matchesAuth = provider === "codex"
        ? credentials.authType === "oauth" && credentials.accessToken && !credentials.apiKey
        : credentials.authType === "apikey" && credentials.apiKey && !credentials.accessToken && !credentials.refreshToken;
      if (!matchesAuth) return refuseCandidate();
    }
    const refreshedCredentials = candidate ? credentials : await checkAndRefreshToken(provider, credentials);

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
    const chatSettings = candidate ? candidate.settings : await getSettings();
    const providerThinking = (chatSettings.providerThinking || {})[provider] || null;
    const accounting = candidate ? await candidate.createContext({ routeProof, provider, model, credentials, settings: chatSettings }) : null;
    if (candidate && !accounting) return refuseCandidate();
    const result = await handleChatCore({
      ...(candidate ? { accounting } : {}),
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
      customPromptEnabled: !!chatSettings.customPromptEnabled,
      customPrompt: chatSettings.customPrompt || "",
      pxpipeEnabled: !!chatSettings.pxpipeEnabled,
      pxpipeMinChars: chatSettings.pxpipeMinChars,
      pxpipeTimeoutMs: chatSettings.pxpipeTimeoutMs,
      // Lazily warms the in-process module on first use; null when not installed (fail-open)
      pxpipeTransform: !candidate && chatSettings.pxpipeEnabled ? await getPxpipeTransform() : null,
      onPxpipeEvent: appendPxpipeEvent,
      providerThinking,
      // Per-provider user overrides (custom headers / connect timeout) from settings
      providerOverrides: (chatSettings.providerOverrides || {})[provider] || null,
      // Detect source format by endpoint + body
      sourceFormatOverride: request?.url ? detectFormatByEndpoint(new URL(request.url).pathname, body) : null,
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

    // Accounting failures/refusals never become provider cooldown or implicit
    // next-account retries. A fresh owned successor requires explicit evidence.
    if (candidate) return markAccountingResponse(result.response);
    if (result.accountingRefused) return result.response;
    if (result.success) return result.response;

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
