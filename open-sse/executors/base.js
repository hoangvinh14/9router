import { HTTP_STATUS, DEFAULT_RETRY_CONFIG, resolveRetryEntry, FETCH_CONNECT_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { shouldRefreshCredentials } from "../services/oauthCredentialManager.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { ProxyPoolUnavailableError } from '../utils/proxyPolicyError.js';
import { dbg } from "../utils/debugLog.js";
import { ANTHROPIC_API_VERSION, OPENAI_COMPAT_BASE, ANTHROPIC_COMPAT_BASE } from "../providers/shared.js";
import { resolveOpenAICompatibleApiType } from "../services/provider.js";
import { executeAccountedBase } from "./accountedBase.js";
import { executeAccountedAnthropicCandidate } from "./accountedAnthropic.js";
import { ACCOUNTED_ANTHROPIC_CANDIDATE_MODE, ACCOUNTED_ANTHROPIC_LIVE_MODE } from "../config/accountedAnthropicCandidate.js";
import { executeAccountedResponsesCandidate } from './accountedResponses.js';
import { ACCOUNTED_RESPONSES_MODE, ACCOUNTED_RESPONSES_SSE_MODE } from '../config/accountedResponsesCandidate.js';
import { executeAccountedGeminiCandidate } from './accountedGemini.js';
import { ACCOUNTED_GEMINI_MODE, ACCOUNTED_GEMINI_SSE_MODE } from '../config/accountedGeminiCandidate.js';

// Retry backoff belongs to the caller lifecycle, not the connect timeout.
// Ordinary timers work across Node/Bun and remain controllable in tests.
function waitForRetry(ms, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener("abort", abort); resolve(); };
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(signal.reason); };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

// Caller cancellation must not wait for a provider retry hook to cooperate.
// Observe both outcomes even after abort wins (late rejection is not unhandled).
// This bounds caller abort latency, not the lifetime of foreign hook work.
function awaitRetryHook(invoke, signal) {
  signal?.throwIfAborted();
  if (!signal) return Promise.resolve().then(invoke);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true; signal.removeEventListener("abort", abort); callback(value);
    };
    const abort = () => finish(reject, signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    let work;
    try { work = invoke(); } catch (error) { finish(reject, signal.aborted ? signal.reason : error); return; }
    Promise.resolve(work).then(value => finish(resolve, value), error => finish(reject, error));
    if (signal.aborted) abort();
  });
}

/**
 * BaseExecutor - Base class for provider executors
 */
export class BaseExecutor {
  constructor(provider, config) {
    this.provider = provider;
    this.config = config;
    this.noAuth = config?.noAuth || false;
  }

  getProvider() {
    return this.provider;
  }

  getBaseUrls() {
    return this.config.baseUrls || (this.config.baseUrl ? [this.config.baseUrl] : []);
  }

  getFallbackCount() {
    return this.getBaseUrls().length || 1;
  }

  buildUrl(_model, _stream, urlIndex = 0, credentials = null) {
    if (this.provider?.startsWith?.("openai-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || OPENAI_COMPAT_BASE;
      const normalized = baseUrl.replace(/\/$/, "");
      const path = resolveOpenAICompatibleApiType(this.provider, credentials) === "responses" ? "/responses" : "/chat/completions";
      return `${normalized}${path}`;
    }
    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || ANTHROPIC_COMPAT_BASE;
      const normalized = baseUrl.replace(/\/$/, "");
      return `${normalized}/messages`;
    }
    const baseUrls = this.getBaseUrls();
    return baseUrls[urlIndex] || baseUrls[0] || this.config.baseUrl;
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      "Content-Type": "application/json",
      ...this.config.headers
    };

    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      // Anthropic-compatible providers use x-api-key header
      if (credentials.apiKey) {
        headers["x-api-key"] = credentials.apiKey;
      } else if (credentials.accessToken) {
        headers["Authorization"] = `Bearer ${credentials.accessToken}`;
      }
      if (!headers["anthropic-version"]) {
        headers["anthropic-version"] = ANTHROPIC_API_VERSION;
      }
    } else {
      // Standard Bearer token auth for other providers
      if (credentials.accessToken) {
        headers["Authorization"] = `Bearer ${credentials.accessToken}`;
      } else if (credentials.apiKey) {
        headers["Authorization"] = `Bearer ${credentials.apiKey}`;
      }
    }

    if (stream) {
      headers["Accept"] = "text/event-stream";
    }

    return headers;
  }

  // Override in subclass for provider-specific transformations
  transformRequest(_model, body, _stream, _credentials) {
    return body;
  }

  shouldRetry(status, urlIndex) {
    return status === HTTP_STATUS.RATE_LIMITED && urlIndex + 1 < this.getFallbackCount();
  }

  // Override in subclass for provider-specific refresh
  async refreshCredentials(_credentials, _log, _proxyOptions = null) {
    return null;
  }

  needsRefresh(credentials) {
    return shouldRefreshCredentials(this.provider, credentials);
  }

  parseError(response, bodyText) {
    return { status: response.status, message: bodyText || `HTTP ${response.status}` };
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null, providerOverrides = null, accounting = null, connectionId = null, accountingMode = null }) {
    signal?.throwIfAborted();
    // Explicit internal candidate entry only. App eligibility remains separate;
    // do not strip registry beta semantics or fall through on local rejection.
    if (accounting && [ACCOUNTED_ANTHROPIC_CANDIDATE_MODE, ACCOUNTED_ANTHROPIC_LIVE_MODE].includes(accountingMode)) {
      return executeAccountedAnthropicCandidate(this, { model, body, stream, credentials, signal, log, proxyOptions, providerOverrides, accounting, connectionId, accountingMode });
    }
    if (accounting && [ACCOUNTED_RESPONSES_MODE, ACCOUNTED_RESPONSES_SSE_MODE].includes(accountingMode)) {
      return executeAccountedResponsesCandidate(this, { model, body, stream, credentials, signal, log, proxyOptions, providerOverrides, accounting, connectionId, accountingMode });
    }
    if (accounting && [ACCOUNTED_GEMINI_MODE, ACCOUNTED_GEMINI_SSE_MODE].includes(accountingMode)) {
      return executeAccountedGeminiCandidate(this, { model, body, stream, credentials, signal, log, proxyOptions, providerOverrides, accounting, connectionId, accountingMode });
    }
    const fallbackCount = this.getFallbackCount();
    let lastError = null;
    let lastStatus = 0;
    const retryAttemptsByUrl = {};

    // Merge default retry config with provider-specific config
    const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...this.config.retry };

    // Schedule retry via retryConfig[statusKey]. Returns true when caller should `urlIndex--; continue`
    // response (optional) lets a subclass hook compute a dynamic delay (e.g. antigravity Retry-After).
    const tryRetry = async (urlIndex, statusKey, reason, response = null, discard = null) => {
      signal?.throwIfAborted();
      const { attempts, delayMs } = resolveRetryEntry(retryConfig[statusKey]);
      if (attempts <= 0 || retryAttemptsByUrl[urlIndex] >= attempts) return false;
      // Hook: subclass may derive delay from the response (headers/body). null → skip retry, use fallback.
      let waitMs = delayMs;
      if (response && this.computeRetryDelay) {
        const dynamic = await awaitRetryHook(() => this.computeRetryDelay(response, retryAttemptsByUrl[urlIndex] + 1, delayMs, { signal }), signal);
        signal?.throwIfAborted();
        if (dynamic === false) return false; // hook vetoes retry (e.g. Retry-After too long)
        if (dynamic != null) waitMs = dynamic;
      }
      // Only dispose once retry is committed; a vetoed final response remains
      // readable by the caller. Do not await cancel: tee branches can stall it.
      discard?.();
      retryAttemptsByUrl[urlIndex]++;
      log?.debug?.("RETRY", `${reason} retry ${retryAttemptsByUrl[urlIndex]}/${attempts} after ${waitMs / 1000}s`);
      await waitForRetry(waitMs, signal);
      signal?.throwIfAborted();
      return true;
    };

    if (accounting) return executeAccountedBase(this, { model, body, stream, credentials, signal, log, proxyOptions, providerOverrides, accounting, connectionId, accountingMode },
      { fallbackCount, tryRetry, retryAttemptsByUrl });

    for (let urlIndex = 0; urlIndex < fallbackCount; urlIndex++) {
      signal?.throwIfAborted();
      const url = this.buildUrl(model, stream, urlIndex, credentials);
      const transformedBody = this.transformRequest(model, body, stream, credentials);
      const headers = this.buildHeaders(credentials, stream, url, model, transformedBody);
      // User per-provider override wins over registry headers (blocked names filtered at the API)
      if (providerOverrides?.headers) Object.assign(headers, providerOverrides.headers);

      if (!retryAttemptsByUrl[urlIndex]) retryAttemptsByUrl[urlIndex] = 0;

      // Abort if upstream doesn't return response headers within connection timeout
      const connectCtrl = new AbortController();
      const timeoutMs = this.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS;
      const connectTimer = setTimeout(() => connectCtrl.abort(new Error("fetch connect timeout")), timeoutMs);
      const mergedSignal = signal ? AbortSignal.any([signal, connectCtrl.signal]) : connectCtrl.signal;

      let response, discarded = false;
      const discard = reason => {
        if (discarded) return;
        discarded = true;
        try { Promise.resolve(response?.body?.cancel(reason)).catch(() => {}); } catch { /* cleanup only */ }
      };
      try {
        const bodyStr = JSON.stringify(transformedBody);
        signal?.throwIfAborted();
        const fetchT0 = Date.now();
        dbg("FETCH", `${this.provider.toUpperCase()} → ${url} | body=${bodyStr.length}B | connectTimeout=${timeoutMs}ms`);
        response = await proxyAwareFetch(url, {
          method: "POST",
          headers,
          body: bodyStr,
          signal: mergedSignal
        }, proxyOptions);
        clearTimeout(connectTimer);
        const ct = response.headers?.get?.("content-type") || "";
        const cl = response.headers?.get?.("content-length") || "?";
        dbg("FETCH", `${this.provider.toUpperCase()} ← ${response.status} | ttft=${Date.now() - fetchT0}ms | ct=${ct} | cl=${cl}`);

        if (await tryRetry(urlIndex, response.status, `status ${response.status}`, response, discard)) { urlIndex--; continue; }

        if (this.shouldRetry(response.status, urlIndex)) {
          log?.debug?.("RETRY", `${response.status} on ${url}, trying fallback ${urlIndex + 1}`);
          lastStatus = response.status;
          discard();
          continue;
        }

        signal?.throwIfAborted();
        return { response, url, headers, transformedBody };
      } catch (error) {
        clearTimeout(connectTimer);
        if (signal?.aborted) {
          // This response will not be handed to the caller. Dispose without
          // replacing the exact caller reason with a body-cleanup failure.
          discard(signal.reason);
          signal.throwIfAborted();
        }
        // A hook/processing exception also abandons the unhanded response.
        discard(error);
        // This local pinned-policy denial cannot recover through network
        // backoff or another URL. Caller cancellation above still owns reason.
        if (error instanceof ProxyPoolUnavailableError) throw error;
        lastError = error;
        const isConnectTimeout = connectCtrl.signal.aborted && error.name === "AbortError";
        dbg("FETCH", `${this.provider.toUpperCase()} ✖ ${error.name}: ${error.message}${isConnectTimeout ? " (connect timeout)" : ""}`);
        // Connect timeout is internal — convert to retryable network error, don't propagate AbortError
        if (error.name === "AbortError" && !isConnectTimeout) throw error;

        // Map network/fetch exceptions to 502 retry config
        if (await tryRetry(urlIndex, HTTP_STATUS.BAD_GATEWAY, `network "${error.message}"`)) { urlIndex--; continue; }

        if (urlIndex + 1 < fallbackCount) {
          log?.debug?.("RETRY", `Error on ${url}, trying fallback ${urlIndex + 1}`);
          continue;
        }
        throw error;
      }
    }

    throw lastError || new Error(`All ${fallbackCount} URLs failed with status ${lastStatus}`);
  }
}

export default BaseExecutor;
