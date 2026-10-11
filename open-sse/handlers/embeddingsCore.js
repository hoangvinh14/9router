import { createErrorResult, parseUpstreamError, formatProviderError } from "../utils/error.js";
import { HTTP_STATUS, FETCH_CONNECT_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { getExecutor } from "../executors/index.js";
import { refreshWithRetry } from "../services/tokenRefresh.js";
import { getEmbeddingAdapter } from "./embeddingProviders/index.js";
import { handleAccountedEmbedding } from "./embeddingProviders/accountedRequest.js";
import { snapshotAccountingPreparedData } from "../config/accountedBaseDispatch.js";
import { PROVIDER_MEDIA } from '../providers/index.js';
import { captureUnhealthyApiKeyMaterial } from '../config/accountedUnhealthyChatDispatch.js';
import { captureGeminiEmbeddingDispatch } from '../config/accountedGeminiEmbeddingDispatch.js';
import { handleAccountedGeminiEmbedding } from './embeddingProviders/accountedGeminiRequest.js';

/**
 * Core embeddings handler — orchestrator only. Provider-specific URL/headers/body/normalize
 * live in `./embeddingProviders/{id}.js`.
 *
 * @returns {Promise<{ success: boolean, response: Response, status?: number, error?: string }>}
 */
export async function handleEmbeddingsCore({
  body,
  modelInfo,
  credentials,
  log,
  onCredentialsRefreshed,
  onRequestSuccess,
  accounting = null,
  signal = null,
  connectionId = null,
  proxyOptions = null,
}) {
  const unhealthy = accounting?.requiresUnhealthyEmbeddingsWire === true;
  const geminiEmbedding = accounting?.requiresGeminiEmbeddingsWire === true;
  // Internal accounted work must be plain and detached BEFORE reading input or
  // calling adapters. JSON serialization is not a guard: toJSON/accessors can
  // execute or erase unsupported original fields. Ordinary sync/OFF is unchanged.
  if (accounting?.requiresPreparedBaseWire || unhealthy || geminiEmbedding) {
    body = snapshotAccountingPreparedData(body);
    modelInfo = snapshotAccountingPreparedData(modelInfo);
    credentials = snapshotAccountingPreparedData(credentials);
    proxyOptions = snapshotAccountingPreparedData(proxyOptions);
  }
  const { provider, model } = modelInfo;
  // Request-local internal opt-in only. App entry does not issue this flag yet;
  // plain equality and current config are not persisted origin/ACK permission.
  if (geminiEmbedding) {
    accounting.gate();
    accounting.assertSupported(!unhealthy && (!accounting.requiresPreparedBaseWire ||
      accounting.requiresQueuedGeminiEmbeddingsWire === true && typeof accounting.assertGeminiEmbeddingImage === 'function') && provider === 'gemini' &&
      typeof model === 'string' && !!model && (body.model === model || body.model === `gemini/${model}`));
    const original = body.model === model ? body : snapshotAccountingPreparedData({ ...body, model });
    captureUnhealthyApiKeyMaterial(credentials, proxyOptions);
    const mediaConfig = snapshotAccountingPreparedData(PROVIDER_MEDIA.gemini.embeddingConfig);
    const adapter = getEmbeddingAdapter(provider);
    accounting.assertSupported(!!adapter);
    let evidence;
    try {
      const ctx = { input: original.input };
      const actual = adapter.buildBody(model, original);
      evidence = captureGeminiEmbeddingDispatch({ model, original, actual, mediaConfig, credentials,
        headers: adapter.buildHeaders(credentials, ctx), url: adapter.buildUrl(model, credentials, ctx),
        serialized: JSON.stringify(actual), proxyOptions });
    } catch { throw new Error('Gemini embedding dispatch unavailable'); }
    // No provider-error catch around own settlement or terminal authorization.
    const result = await handleAccountedGeminiEmbedding({ evidence, accounting, signal, connectionId });
    if (!result.success) return createErrorResult(result.status, 'Embedding upstream response unavailable');
    const normalized = adapter.normalize(result.raw, model);
    // Legacy Gemini adapter zeros are not raw evidence. Expose counts only when
    // the owner has validated metadata; unknown remains null rather than zero.
    normalized.usage = result.usage ? { prompt_tokens: result.usage.input, total_tokens: result.usage.input } : null;
    if (onRequestSuccess) await onRequestSuccess();
    return { success: true, accountingOwned: true, usage: normalized.usage,
      response: Response.json(normalized, { headers: { 'Access-Control-Allow-Origin': '*' } }) };
  }
  if (unhealthy) {
    accounting.gate();
    accounting.assertSupported(provider === 'openai' && typeof model === 'string' && !!model &&
      (body.model === model || body.model === `openai/${model}`));
    // Only the exact gateway prefix may change. Preserve all other fields for
    // the embeddings-specific full original/prepared validator at the owner.
    if (body.model !== model) body = snapshotAccountingPreparedData({ ...body, model });
  }

  // Validate input
  const input = body.input;
  if (!input) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: input");
  }
  if (typeof input !== "string" && !Array.isArray(input)) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "input must be a string or array of strings");
  }

  const adapter = getEmbeddingAdapter(provider);
  if (!adapter) {
    return createErrorResult(
      HTTP_STATUS.BAD_REQUEST,
      `Provider '${provider}' does not support embeddings.`
    );
  }

  const ctx = { input };
  // buildUrl/buildHeaders/buildBody were called bare. An adapter that rejects a
  // misconfigured connection — selfhosted-embedding throws when no baseUrl is set
  // rather than silently falling back to api.openai.com — would have escaped this
  // function uncaught, surfacing as a 500 or a request that never settles. A
  // configuration mistake is a 400 with the reason in it.
  let url, headers, requestBody;
  try {
    url = adapter.buildUrl(model, credentials, ctx);
    headers = adapter.buildHeaders(credentials, ctx);
    requestBody = adapter.buildBody(model, {
      input,
      encoding_format: body.encoding_format || "float",
      dimensions: body.dimensions,
    });
  } catch (error) {
    log?.debug?.("EMBEDDINGS", `Request build failed: ${error.message}`);
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, `[${provider}/${model}] ${error.message}`);
  }

  log?.debug?.("EMBEDDINGS", `${provider.toUpperCase()} | ${model} | input_type=${Array.isArray(input) ? `array[${input.length}]` : "string"}`);

  if (accounting) return handleAccountedEmbedding({ adapter, provider, model, credentials, ctx, requestBody, originalBody: body, url, headers, proxyOptions,
    accounting, signal, connectionId, log, onCredentialsRefreshed, onRequestSuccess });

  let providerResponse;
  try {
    providerResponse = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      ...(typeof AbortSignal?.timeout === "function"
        ? { signal: AbortSignal.timeout(FETCH_CONNECT_TIMEOUT_MS) }
        : {}),
    });
  } catch (error) {
    const errMsg = formatProviderError(error, provider, model, HTTP_STATUS.BAD_GATEWAY);
    log?.debug?.("EMBEDDINGS", `Fetch error: ${errMsg}`);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, errMsg);
  }

  // Handle 401/403 — try token refresh (skip for noAuth providers)
  const executor = getExecutor(provider);
  if (
    !executor?.noAuth &&
    (providerResponse.status === HTTP_STATUS.UNAUTHORIZED ||
      providerResponse.status === HTTP_STATUS.FORBIDDEN)
  ) {
    const newCredentials = await refreshWithRetry(
      () => executor.refreshCredentials(credentials, log),
      3,
      log
    );

    if (newCredentials?.accessToken || newCredentials?.apiKey) {
      log?.info?.("TOKEN", `${provider.toUpperCase()} | refreshed for embeddings`);
      Object.assign(credentials, newCredentials);
      if (onCredentialsRefreshed) await onCredentialsRefreshed(newCredentials);

      try {
        const retryHeaders = adapter.buildHeaders(credentials, ctx);
        const retryUrl = adapter.buildUrl(model, credentials, ctx);
        providerResponse = await fetch(retryUrl, {
          method: "POST",
          headers: retryHeaders,
          body: JSON.stringify(requestBody),
        });
      } catch {
        log?.warn?.("TOKEN", `${provider.toUpperCase()} | retry after refresh failed`);
      }
    } else {
      log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh failed`);
    }
  }

  if (!providerResponse.ok) {
    const { statusCode, message } = await parseUpstreamError(providerResponse);
    const errMsg = formatProviderError(new Error(message), provider, model, statusCode);
    log?.debug?.("EMBEDDINGS", `Provider error: ${errMsg}`);
    return createErrorResult(statusCode, errMsg);
  }

  let responseBody;
  try {
    responseBody = await providerResponse.json();
  } catch {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Invalid JSON response from ${provider}`);
  }

  if (onRequestSuccess) await onRequestSuccess();

  const normalized = adapter.normalize(responseBody, model);
  log?.debug?.("EMBEDDINGS", `Success | usage=${JSON.stringify(normalized.usage || {})}`);

  return {
    success: true,
    usage: normalized.usage || null,
    response: new Response(JSON.stringify(normalized), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }),
  };
}
