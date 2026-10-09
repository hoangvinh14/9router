import { proxyAwareFetch } from '../utils/proxyFetch.js';
import { readAccountingText } from '../utils/readAccountingJson.js';
import { createAccountedOpenaiStream } from '../utils/accountedOpenaiStream.js';
import { createBufferedAccountingSseObserver } from '../utils/accountingSseUsage.js';
import { normalizeAccountedChatUsage } from '../utils/accountedChatUsage.js';
import { isAccountedOpenaiChatProvider, isAccountedChatTransport } from '../config/accountedChatProviders.js';
import { HTTP_STATUS, FETCH_CONNECT_TIMEOUT_MS } from '../config/runtimeConfig.js';
import { captureAccountingProxyEnvironment } from '../config/accountedProxyEnvironment.js';
import { captureAccountingBaseTransport } from '../config/accountedBaseTransport.js';
import { snapshotAccountingPreparedData } from '../config/accountedBaseDispatch.js';

function awaitFetch(invoke, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => { if (settled) return; settled = true; signal.removeEventListener('abort', abort); callback(value); };
    const abort = () => finish(reject, signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    let work;
    try { work = invoke(); } catch (error) { finish(reject, error); return; }
    Promise.resolve(work).then(value => {
      if (settled) { try { Promise.resolve(value?.body?.cancel(signal.reason)).catch(() => {}); } catch { /* unhanded response */ } }
      else finish(resolve, value);
    }, error => finish(reject, error));
    if (signal.aborted) abort();
  });
}

// One owner per actual POST. Never wrap an executor invocation in a second debit.
// Nonstream JSON, buffered forced-SSE → JSON, or explicitly raw OpenAI SSE.
export async function executeAccountedBase(executor, options, { fallbackCount, tryRetry, retryAttemptsByUrl }) {
  const { model, body, stream, credentials, signal, proxyOptions, providerOverrides, accounting, connectionId, accountingMode } = options;
  accounting.assertSupported(isAccountedOpenaiChatProvider(executor.provider) && (stream === false || accountingMode === 'buffered-openai-sse' || accountingMode === 'live-openai-sse'));
  let lastError;
  for (let index = 0; index < fallbackCount; index++) {
    signal?.throwIfAborted();
    const url = executor.buildUrl(model, stream, index, credentials);
    accounting.assertSupported(isAccountedChatTransport(executor.provider, url, credentials?.runtimeTransport));
    const transformed = executor.transformRequest(model, body, stream, credentials);
    const transformedBody = stream ? { ...transformed, stream: true, stream_options: { ...transformed.stream_options, include_usage: true } } : transformed;
    // Detached wire material before admission can yield; singleton header state
    // is never consulted after the await. Pricing model remains resolved identity.
    const headers = { ...executor.buildHeaders(credentials, stream, url, model, transformedBody), ...(providerOverrides?.headers || {}) };
    const serialized = JSON.stringify(transformedBody);
    retryAttemptsByUrl[index] ??= 0;
    // Only the queued request owner requests bounded prepared-wire equality;
    // preserve legacy synchronous owner call shape and standalone engine use.
    const preparedWire = accounting.requiresPreparedBaseWire ? snapshotAccountingPreparedData({ url, headers, stream,
      credentials: { apiKey: credentials?.apiKey ?? null, accessToken: credentials?.accessToken ?? null },
      providerOverrides: providerOverrides ?? null, proxyOptions,
      proxyEnvironment: captureAccountingProxyEnvironment(),
      runtimeTransport: credentials?.runtimeTransport ?? null,
      baseTransport: captureAccountingBaseTransport(executor.config), urlIndex: index }) : null;
    // Exactly the original immutable values shown to admission reach POST. Do
    // not expose mutable local headers/options then dispatch them after await.
    const postHeaders = preparedWire ? preparedWire.headers : headers;
    const resolvedProxyOptions = preparedWire ? preparedWire.proxyOptions : proxyOptions;
    const dispatchEvidence = preparedWire ? Object.freeze({ provider: executor.provider,
      baseTransport: preparedWire.baseTransport, urlIndex: preparedWire.urlIndex, runtimeTransport: preparedWire.runtimeTransport }) : null;
    const attempt = await (accounting.requiresPreparedBaseWire
      ? accounting.beforeAttempt({ provider: executor.provider, model, endpoint: 'chat', connectionId }, true, preparedWire)
      : accounting.beforeAttempt({ provider: executor.provider, model, endpoint: 'chat', connectionId }, true));
    if (signal?.aborted) {
      await accounting.completeAttempt(attempt, { notDispatched: true, outcome: 'aborted' }); signal.throwIfAborted();
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error('Chat connection deadline exceeded')), executor.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS);
    const merged = signal ? AbortSignal.any([signal, ctrl.signal]) : ctrl.signal;
    let response, text, usage = null, usageEvidence = null, transportError;
    // Accounting errors deliberately cannot enter either transport/read catch.
    try { response = await awaitFetch(() => accounting.requiresPreparedBaseWire
      ? proxyAwareFetch(url, { method: 'POST', headers: postHeaders, body: serialized, signal: merged, redirect: 'error' }, resolvedProxyOptions,
        { singlePost: true, proxyEnvironment: preparedWire.proxyEnvironment, baseTransport: dispatchEvidence })
      : proxyAwareFetch(url, { method: 'POST', headers, body: serialized, signal: merged }, resolvedProxyOptions), merged); }
    catch (error) { transportError = { error }; }
    finally { clearTimeout(timer); }
    if (!transportError && response.ok && accountingMode === 'live-openai-sse') {
      let liveBody, liveResponse;
      try {
        if (!response.body || !response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) throw new Error('Unsupported live response');
        // Construction may fail before ownership transfers (e.g. locked reader).
        liveBody = createAccountedOpenaiStream(response, { accounting, attempt, signal, provider: executor.provider });
        liveResponse = new Response(liveBody, { status: response.status, headers: response.headers });
      } catch { /* construction only; settlement stays outside this catch */ }
      if (liveResponse) return { response: liveResponse, url, headers, transformedBody, accountingOwned: true, accountingLive: true };
      // Before transfer, the caller owns the unknown terminal. Persistence is
      // outside the construction catch; never reclassify it as network/retry.
      if (liveBody) await liveBody.cancel('Unhanded accounting response');
      else {
        try { Promise.resolve(response.body?.cancel()).catch(() => {}); } catch { /* foreign cleanup only */ }
        await accounting.completeAttempt(attempt, { usage: null, outcome: 'network_unknown' });
      }
      accounting.assertSupported(false); // Local fail-closed, also for unlimited.
    }
    if (!transportError) {
      const observer = response.headers.get('content-type')?.includes('text/event-stream') ? createBufferedAccountingSseObserver(executor.provider) : null;
      try {
        text = await readAccountingText(response, signal, { onChunk: observer ? chunk => observer.push(chunk) : null });
        if (observer) {
          const inspected = observer.finish(); usage = inspected.usage; usageEvidence = inspected.usageEvidence;
        } else usage = normalizeAccountedChatUsage(JSON.parse(text)?.usage, executor.provider);
      } catch (error) {
        transportError = { error };
        // Do not flush a partial event on failure. Only fully observed usage
        // frames survive as diagnostic counts; never exact terminal authority.
        usageEvidence = observer?.evidence(signal?.aborted ? 'cancelled' : 'interrupted') || null;
      }
    }
    const terminal = await accounting.completeAttempt(attempt, { usage: transportError ? null : usage,
      ...(usageEvidence ? { usageEvidence } : {}),
      outcome: signal?.aborted ? 'aborted' : transportError ? 'network_unknown' : response.ok ? 'success' : 'failed' });
    signal?.throwIfAborted();
    if (!transportError && response.ok) accounting.assertSuccessfulTerminal(terminal);
    if (transportError || !response.ok) accounting.gate();
    if (transportError) {
      lastError = transportError.error;
      if (await tryRetry(index, HTTP_STATUS.BAD_GATEWAY, 'accounted transport error')) { index--; continue; }
      if (index + 1 < fallbackCount) continue;
      throw lastError;
    }
    const replay = new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers });
    let discarded = false;
    const discard = () => { if (discarded) return; discarded = true; try { Promise.resolve(replay.body?.cancel()).catch(() => {}); } catch { /* cleanup only */ } };
    // Prior attempt is terminal before any retry hook/backoff/new admission.
    if (await tryRetry(index, replay.status, `status ${replay.status}`, replay, discard)) { index--; continue; }
    if (executor.shouldRetry(replay.status, index)) { discard(); continue; }
    return { response: replay, url, headers, transformedBody, accountingOwned: true };
  }
  throw lastError || new Error('Accounted chat URLs exhausted');
}
