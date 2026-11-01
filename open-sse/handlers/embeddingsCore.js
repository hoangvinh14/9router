import { createErrorResult, parseUpstreamError, formatProviderError } from "../utils/error.js";
import { HTTP_STATUS, FETCH_CONNECT_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { getExecutor } from "../executors/index.js";
import { refreshWithRetry } from "../services/tokenRefresh.js";
import { getEmbeddingAdapter } from "./embeddingProviders/index.js";
import { dispatchEmbeddings } from './embeddings-accounting.js';
import { assertEmbeddingsRequest } from '../utils/accounting-embeddings-usage.js';
import { isAccountingRefusal } from '../utils/accounting-transport.js';

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
  dispatch = dispatchEmbeddings,
}) {
  const { provider, model } = modelInfo;
  if (accounting) assertEmbeddingsRequest(body);
  // Selected sessions provide a single composed lifetime across all attempts.
  const requestSignal = accounting?.signal || signal;
  const send = (target, options) => accounting
    ? dispatch({url:target,options:{...options,signal:requestSignal},credentials,accounting})
    : fetch(target,{...options,...(requestSignal ? {signal:requestSignal} : {})});

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

  let providerResponse;
  try {
    providerResponse = await send(url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      ...(typeof AbortSignal?.timeout === "function"
        ? { signal: AbortSignal.timeout(FETCH_CONNECT_TIMEOUT_MS) }
        : {}),
    });
  } catch (error) {
    if (accounting || isAccountingRefusal(error)) throw error;
    const errMsg = formatProviderError(error, provider, model, HTTP_STATUS.BAD_GATEWAY);
    log?.debug?.("EMBEDDINGS", `Fetch error: ${errMsg}`);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, errMsg);
  }

  // Valid evidence has already settled at this point. Cancellation still must
  // not turn that settlement into provider/client success or launch refresh.
  accounting?.signal.throwIfAborted();

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
      // A selected API-key session has no supported credential refresher.
      // Refuse mutation before persistence or a successor POST.
      if (accounting) throw new Error('Selected embeddings credential refresh unsupported');
      Object.assign(credentials, newCredentials);
      if (onCredentialsRefreshed) await onCredentialsRefreshed(newCredentials);

      try {
        const retryHeaders = adapter.buildHeaders(credentials, ctx);
        const retryUrl = adapter.buildUrl(model, credentials, ctx);
        providerResponse = await send(retryUrl, {
          method: "POST",
          headers: retryHeaders,
          body: JSON.stringify(requestBody),
        });
      } catch (error) {
        if (accounting || isAccountingRefusal(error)) throw error;
        log?.warn?.("TOKEN", `${provider.toUpperCase()} | retry after refresh failed`);
      }
    } else {
      log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh failed`);
    }
  }

  if (!providerResponse.ok) {
    if (accounting) {
      // Already validated and own-ACKed by the actual transport boundary. Retain
      // only this response until normal fallback/exhaustion decides its owner.
      const bytes = new Uint8Array(await providerResponse.arrayBuffer());
      let raw;
      try { raw = JSON.parse(new TextDecoder().decode(bytes)); }
      catch { throw new Error('Selected embeddings response lost validated JSON'); }
      const message = typeof raw.error?.message === 'string' ? raw.error.message : 'Upstream embeddings error';
      return {success:false,status:providerResponse.status,error:message,
        response:new Response(bytes,{status:providerResponse.status,headers:providerResponse.headers})};
    }
    const { statusCode, message } = await parseUpstreamError(providerResponse);
    const errMsg = formatProviderError(new Error(message), provider, model, statusCode);
    log?.debug?.("EMBEDDINGS", `Provider error: ${errMsg}`);
    return createErrorResult(statusCode, errMsg);
  }

  let responseBody, selectedBytes;
  try {
    if (accounting) {
      selectedBytes = new Uint8Array(await providerResponse.arrayBuffer());
      responseBody = JSON.parse(new TextDecoder().decode(selectedBytes));
    } else responseBody = await providerResponse.json();
  } catch {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Invalid JSON response from ${provider}`);
  }

  if (onRequestSuccess) await onRequestSuccess();

  const normalized = adapter.normalize(responseBody, model);
  log?.debug?.("EMBEDDINGS", `Success | usage=${JSON.stringify(normalized.usage || {})}`);

  return {
    success: true,
    usage: normalized.usage || null,
    response: new Response(selectedBytes || JSON.stringify(normalized), {
      headers: accounting ? providerResponse.headers : {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }),
  };
}
