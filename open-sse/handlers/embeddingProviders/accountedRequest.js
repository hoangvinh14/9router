import { HTTP_STATUS, FETCH_CONNECT_TIMEOUT_MS } from '../../config/runtimeConfig.js';
import { createErrorResult, formatProviderError } from '../../utils/error.js';
import { normalizeExactUsage } from '../../utils/exactUsage.js';
import { readAccountingJson } from '../../utils/readAccountingJson.js';
import { getExecutor } from '../../executors/index.js';
import { refreshWithRetry } from '../../services/tokenRefresh.js';
import { FORMATS } from '../../translator/formats.js';

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
export async function handleAccountedEmbedding({ adapter, provider, model, credentials, ctx, requestBody, url, headers, accounting, signal, connectionId, log, onCredentialsRefreshed, onRequestSuccess }) {
  // Active identified unlimited keys need the same certified raw protocol as
  // budgeted keys. Unlimited pricing/recording exceptions are not schema approval.
  accounting.assertSupported(provider === 'openai' && adapter.accountingSchema === FORMATS.OPENAI);
  const serialized = JSON.stringify(requestBody);
  async function dispatch(target, requestHeaders) {
    signal?.throwIfAborted();
    const attempt = await accounting.beforeAttempt({ provider, model, endpoint: 'embeddings', connectionId }, !!adapter.accountingSchema);
    if (signal?.aborted) {
      await accounting.completeAttempt(attempt, { notDispatched: true, outcome: 'aborted' });
      signal.throwIfAborted();
    }
    const control = new AbortController();
    const timer = setTimeout(() => control.abort(new Error('Embedding connection deadline exceeded')), FETCH_CONNECT_TIMEOUT_MS);
    const merged = signal ? AbortSignal.any([signal, control.signal]) : control.signal;
    let response, raw, networkError;
    try {
      response = await awaitEmbeddingWork(() => fetch(target, { method: 'POST', headers: requestHeaders, body: serialized, signal: merged }), merged, true);
      clearTimeout(timer);
      raw = await readAccountingJson(response, signal);
    } catch (error) { networkError = { error }; }
    finally { clearTimeout(timer); }
    // Outside transport catch: settlement errors never become provider retries.
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
  const executor = getExecutor(provider);
  if (!executor?.noAuth && [HTTP_STATUS.UNAUTHORIZED, HTTP_STATUS.FORBIDDEN].includes(result.response.status)) {
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
