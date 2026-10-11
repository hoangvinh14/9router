import { HTTP_STATUS, FETCH_CONNECT_TIMEOUT_MS } from '../../config/runtimeConfig.js';
import { createErrorResult, formatProviderError } from '../../utils/error.js';
import { normalizeExactUsage } from '../../utils/exactUsage.js';
import { readAccountingJson } from '../../utils/readAccountingJson.js';
import { getExecutor } from '../../executors/index.js';
import { refreshWithRetry } from '../../services/tokenRefresh.js';
import { FORMATS } from '../../translator/formats.js';
import { captureAccountingProxyEnvironment } from '../../config/accountedProxyEnvironment.js';
import { snapshotAccountingPreparedData } from '../../config/accountedBaseDispatch.js';
import { captureAccountingEmbeddingsConfig, validateAccountingEmbeddingsDispatch } from '../../config/accountedEmbeddingsDispatch.js';
import { captureUnhealthyEmbeddingsDispatch, validateUnhealthyEmbeddingsOptions } from '../../config/accountedUnhealthyEmbeddingsDispatch.js';

// Prompt stop even if a foreign fetch/refresh ignores its AbortSignal. Observe
// late outcomes; only an unhanded late Response is cancelled (never awaited).
function awaitEmbeddingWork(invoke, signal, discardLateResponse = false) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => { if (settled) return; settled = true; signal?.removeEventListener('abort', abort); callback(value); };
    const abort = () => finish(reject, signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    let work;
    try { work = invoke(); } catch (error) { finish(reject, signal?.aborted ? signal.reason : error); return; }
    Promise.resolve(work).then(value => {
      if (settled && discardLateResponse) {
        try { Promise.resolve(value?.body?.cancel(signal?.reason)).catch(() => {}); } catch { /* cleanup only */ }
      } else finish(resolve, value);
    }, error => finish(reject, error));
    if (signal?.aborted) abort();
  });
}

// Injected request-local lifecycle; no app DB imports and no singleton state.
export async function handleAccountedEmbedding({ adapter, provider, model, credentials, ctx, requestBody, originalBody, url, headers, proxyOptions = null, accounting, signal, connectionId, log, onCredentialsRefreshed, onRequestSuccess }) {
  // Active identified unlimited keys need the same certified raw protocol as
  // budgeted keys. Unlimited pricing/recording exceptions are not schema approval.
  accounting.assertSupported(provider === 'openai' && adapter.accountingSchema === FORMATS.OPENAI);
  // Also guard direct owner calls, not only the public core's adapter path.
  // Refuse programmable originals before any serialization or header coercion.
  const unhealthy = accounting.requiresUnhealthyEmbeddingsWire === true;
  if (accounting.requiresPreparedBaseWire || unhealthy) {
    originalBody = snapshotAccountingPreparedData(originalBody);
    requestBody = snapshotAccountingPreparedData(requestBody);
    credentials = snapshotAccountingPreparedData(credentials);
    headers = snapshotAccountingPreparedData(headers);
    proxyOptions = snapshotAccountingPreparedData(proxyOptions);
  }
  const serialized = JSON.stringify(requestBody);
  const unhealthyTransport = unhealthy ? captureUnhealthyEmbeddingsDispatch({ model, body: originalBody, actual: requestBody,
    mediaConfig: captureAccountingEmbeddingsConfig(), credentials, headers, url, serialized, proxyOptions }) : null;
  const unhealthyEnvironment = unhealthy ? captureAccountingProxyEnvironment() : null;
  async function dispatch(target, requestHeaders) {
    signal?.throwIfAborted();
    const preparedWire = accounting.requiresPreparedBaseWire ? snapshotAccountingPreparedData({
      protocol: 'native-embeddings', url: target, headers: Object.fromEntries(new Headers(requestHeaders)),
      credentials: { apiKey: credentials.apiKey ?? null, accessToken: credentials.accessToken ?? null }, providerOverrides: null,
      proxyOptions, proxyEnvironment: captureAccountingProxyEnvironment(),
      embeddingsTransport: { model, mediaConfig: captureAccountingEmbeddingsConfig(), serializedBody: serialized, originalSerializedBody: JSON.stringify(originalBody) },
    }) : null;
    if (preparedWire) {
      accounting.assertSupported(!!credentials.apiKey && !credentials.accessToken);
      validateAccountingEmbeddingsDispatch(preparedWire.embeddingsTransport, target);
    }
    // proxyFetch publishes a global wrapper as an import side effect. Load it
    // only for internal queued work, before intent; synchronous/OFF imports must
    // not acquire a new global-fetch owner or change their refresh behavior.
    const queuedFetch = preparedWire || unhealthy ? (await import('../../utils/proxyFetch.js')).proxyAwareFetch : null;
    if (unhealthy) accounting.gate();
    const attempt = await (preparedWire
      ? accounting.beforeAttempt({ provider, model, endpoint: 'embeddings', connectionId }, !!adapter.accountingSchema, preparedWire)
      : accounting.beforeAttempt({ provider, model, endpoint: 'embeddings', connectionId }, !!adapter.accountingSchema));
    if (signal?.aborted) {
      await accounting.completeAttempt(attempt, { notDispatched: true, outcome: 'aborted' });
      signal.throwIfAborted();
    }
    let routingRefused = false;
    const routingGate = unhealthy ? () => {
      try {
        accounting.gate();
        validateUnhealthyEmbeddingsOptions(unhealthyTransport, target,
          { method: 'POST', headers: requestHeaders, body: serialized, redirect: 'error' }, proxyOptions);
      } catch (error) { routingRefused = true; throw error; }
    } : null;
    if (routingGate) {
      try { routingGate(); } catch (error) {
        await accounting.completeAttempt(attempt, { notDispatched: true, outcome: 'routing_refused' });
        throw error;
      }
    }
    const control = new AbortController();
    const timer = setTimeout(() => control.abort(new Error('Embedding connection deadline exceeded')), FETCH_CONNECT_TIMEOUT_MS);
    const merged = signal ? AbortSignal.any([signal, control.signal]) : control.signal;
    let response, raw, networkError;
    try {
      response = await awaitEmbeddingWork(() => unhealthyTransport
        ? queuedFetch(unhealthyTransport.url, { method: 'POST', headers: unhealthyTransport.headers, body: unhealthyTransport.serialized, redirect: 'error', signal: merged }, unhealthyTransport.proxyOptions,
          { singlePost: true, unhealthyEmbeddingsTransport: unhealthyTransport, proxyEnvironment: unhealthyEnvironment, routingGate })
        : preparedWire
        ? queuedFetch(preparedWire.url, { method: 'POST', headers: preparedWire.headers, body: preparedWire.embeddingsTransport.serializedBody, redirect: 'error', signal: merged }, preparedWire.proxyOptions,
          { singlePost: true, proxyEnvironment: preparedWire.proxyEnvironment, embeddingsTransport: preparedWire.embeddingsTransport })
        : fetch(target, { method: 'POST', headers: requestHeaders, body: serialized, signal: merged }), merged, true);
      clearTimeout(timer);
      raw = await readAccountingJson(response, signal);
    } catch (error) { networkError = { error }; }
    finally { clearTimeout(timer); }
    // Outside transport catch: settlement errors never become provider retries.
    if (routingRefused) {
      await accounting.completeAttempt(attempt, { notDispatched: true, outcome: 'routing_refused' });
      throw networkError.error;
    }
    const terminal = await accounting.completeAttempt(attempt, {
      usage: networkError || !adapter.accountingSchema ? null : normalizeExactUsage(raw?.usage, adapter.accountingSchema, 'embeddings'),
      outcome: signal?.aborted ? 'aborted' : networkError ? 'network_unknown' : response.ok ? 'success' : 'failed',
    });
    signal?.throwIfAborted();
    // Preserve a settled success that reaches the limit; unknown success must
    // satisfy current policy before translation. Failed/ambiguous attempts gate
    // before provider-error mapping, refresh, cooldown or fallback can run.
    if (!networkError && response.ok) accounting.assertSuccessfulTerminal(terminal);
    if (networkError || !response.ok) accounting.gate();
    if (networkError) return { error: createErrorResult(HTTP_STATUS.BAD_GATEWAY, formatProviderError(new Error('Embedding upstream response unavailable'), provider, model, HTTP_STATUS.BAD_GATEWAY)) };
    return { response, raw };
  }
  let result = await dispatch(url, headers);
  if (result.error) return result.error;
  const executor = unhealthy ? null : getExecutor(provider);
  if (!unhealthy && !accounting.requiresPreparedBaseWire && !executor?.noAuth && [HTTP_STATUS.UNAUTHORIZED, HTTP_STATUS.FORBIDDEN].includes(result.response.status)) {
    // Recheck after the first durable terminal; usage-less auth errors are not free.
    // beforeAttempt below owns the final fresh admission immediately before POST.
    await accounting.gate();
    const refreshed = await awaitEmbeddingWork(() => refreshWithRetry(() => executor.refreshCredentials(credentials, log), 3, log), signal);
    signal?.throwIfAborted();
    if (refreshed?.accessToken || refreshed?.apiKey) {
      Object.assign(credentials, refreshed);
      if (onCredentialsRefreshed) await onCredentialsRefreshed(refreshed);
      result = await dispatch(adapter.buildUrl(model, credentials, ctx), adapter.buildHeaders(credentials, ctx));
      if (result.error) return result.error;
    }
  }
  if (!result.response.ok) return createErrorResult(result.response.status, formatProviderError(new Error('Embedding provider request failed'), provider, model, result.response.status));
  // Translation failure cannot undo or repeat the acknowledged ledger debit.
  const normalized = adapter.normalize(result.raw, model);
  if (onRequestSuccess) await onRequestSuccess();
  return { success: true, accountingOwned: true, usage: normalized.usage || null,
    response: Response.json(normalized, { headers: { 'Access-Control-Allow-Origin': '*' } }) };
}
