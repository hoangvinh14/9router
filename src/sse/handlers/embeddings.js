import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo } from "../services/model.js";
import { getKeyAccessContext, enforceKeyAccessResolved } from "../services/keyAccess.js";
import { handleEmbeddingsCore } from "open-sse/handlers/embeddingsCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { saveRequestUsage } from "@/lib/usageDb.js";
import { captureEmbeddingsAccounting } from '../services/embeddings-accounting.js';
import { budgetErrorResponse } from '../../lib/accounting/budget-errors.js';
import { isAccountingRefusal } from 'open-sse/utils/accounting-transport.js';

function exactEmbeddingUsage(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.estimated === true) return null;
  const promptTokens = raw.prompt_tokens ?? raw.input_tokens;
  const completionTokens = raw.completion_tokens ?? raw.output_tokens ?? 0;
  const totalTokens = raw.total_tokens;
  if (!Number.isSafeInteger(promptTokens) || promptTokens <= 0 || completionTokens !== 0 || totalTokens !== promptTokens) return null;
  return { prompt_tokens: promptTokens, completion_tokens: 0, total_tokens: totalTokens };
}

/**
 * Handle embeddings request for the SSE/Next.js server.
 * Follows the same auth + fallback pattern as handleChat.
 *
 * @param {Request} request
 */
export async function handleEmbeddings(request) {
  let accounting;
  try {
    accounting = captureEmbeddingsAccounting(request);
    const response = await handleEmbeddingsRequest(request,accounting);
    if (!accounting) return response;
    const headers = new Headers(response.headers);
    for (const [name,value] of Object.entries(accounting.responseHeaders)) headers.set(name,value);
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  } catch (error) {
    // Initialization failure of an enrolled request must never fall through to
    // legacy dispatch. Unassociated errors retain the pre-existing behavior.
    if (!accounting) {
      if (!isAccountingRefusal(error)) throw error;
    }
    return budgetErrorResponse(error);
  } finally {accounting?.dispose();}
}

async function handleEmbeddingsRequest(request,accounting) {
  let body;
  try {
    body = await (accounting ? accounting.wait(request.json()) : request.json());
  } catch (error) {
    if (accounting) throw error;
    log.warn("EMBEDDINGS", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  let url;
  try { url = new URL(request.url); }
  catch { return errorResponse(HTTP_STATUS.BAD_REQUEST, 'Invalid request URL'); }
  const modelStr = body.model;

  log.request("POST", `${url.pathname} | ${modelStr}`);

  // Log API key (masked)
  const apiKey = extractApiKey(request);
  if (apiKey) {
    log.debug("AUTH", `API Key: ${log.maskKey(apiKey)}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  // Enforce API key if enabled in settings
  const wait = pending => accounting ? accounting.wait(pending) : pending;
  const settings = accounting?.degraded ? accounting.settings() : await wait(getSettings());
  if (settings.requireApiKey) {
    if (!apiKey) {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    const valid = accounting?.degraded ? true : await wait(isValidApiKey(apiKey));
    if (!valid) {
      log.warn("AUTH", "Invalid API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
    }
  }

  if (!modelStr) {
    log.warn("EMBEDDINGS", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  if (!body.input) {
    log.warn("EMBEDDINGS", "Missing input");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: input");
  }

  accounting?.authorizeTarget(modelStr,body);
  const modelInfo = accounting?.degraded ? accounting.modelInfo(modelStr) : await wait(getModelInfo(modelStr));
  if (!modelInfo.provider) {
    log.warn("EMBEDDINGS", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;

  // Per-key access control: checked before any credential lookup.
  const keyAccessDenied = accounting?.degraded ? null : await wait(enforceKeyAccessResolved(await wait(getKeyAccessContext(request)), modelStr, provider, model));
  if (keyAccessDenied) return keyAccessDenied;

  if (modelStr !== `${provider}/${model}`) {
    log.info("ROUTING", `${modelStr} → ${provider}/${model}`);
  } else {
    log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);
  }

  // Credential + fallback loop (mirrors handleChat)
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;
  let retainedError = null;

  while (true) {
    accounting?.assertCurrent();
    const credentials = accounting?.degraded ? accounting.credentials(provider,model,excludeConnectionIds) : await wait(getProviderCredentials(provider, excludeConnectionIds, model));
    accounting?.assertCurrent();

    // All accounts unavailable
    if (!credentials || credentials.allRateLimited) {
      if (accounting && retainedError) return retainedError;
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("EMBEDDINGS", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) {
        log.error("AUTH", `No credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      }
      log.warn("EMBEDDINGS", "No more accounts available", { provider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    // A real successor supersedes the predecessor bytes. Any local admission
    // refusal must win rather than resurrect that earlier upstream response.
    retainedError = null;
    log.info("AUTH", `\x1b[32mUsing ${provider} account: ${credentials.connectionName}\x1b[0m`);

    // Validate persisted API-key selection before any proactive refresh producer.
    // Selected credentials have no supported token-refresh path.
    if (accounting) accounting.validateSelection({provider,model,endpoint:'embeddings',connectionId:credentials.connectionId},credentials);
    const refreshedCredentials = accounting ? credentials : await checkAndRefreshToken(provider, credentials);
    const binding = accounting?.bind({provider,model,endpoint:'embeddings',connectionId:credentials.connectionId},refreshedCredentials);

    const result = await handleEmbeddingsCore({
      body: { ...body, model: `${provider}/${model}` },
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      accounting: binding,
      signal: request.signal,
      log,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          ...newCreds,
          existingProviderSpecificData: credentials.providerSpecificData,
          testStatus: "active"
        });
      },
      onRequestSuccess: async () => {
        if (accounting?.degraded) return;
        await wait(clearAccountError(credentials.connectionId, credentials, model));
      }
    });

    if (result.success) {
      const usage = exactEmbeddingUsage(result.usage);
      if (usage) {
        saveRequestUsage({
          provider,
          model,
          connectionId: credentials.connectionId,
          apiKey,
          endpoint: url.pathname,
          tokens: usage,
          status: "success",
        }).catch(() => {});
      }
      return result.response;
    }

    accounting?.assertCurrent();
    const { shouldFallback } = await wait(markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model, null, accounting));

    if (shouldFallback) {
      log.warn("AUTH", `Account ${credentials.connectionName} unavailable (${result.status}), trying fallback`);
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      if (accounting) retainedError = result.response;
      continue;
    }

    return result.response;
  }
}
