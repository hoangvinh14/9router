import { captureGeminiEmbeddingDispatch, validateGeminiEmbeddingOptions, QUEUED_GEMINI_EMBEDDING_PROTOCOL } from '../../config/accountedGeminiEmbeddingDispatch.js';
import { snapshotAccountingPreparedData } from '../../config/accountedBaseDispatch.js';
import { captureGeminiEmbeddingConversion } from '../../config/accountedGeminiEmbeddingCandidate.js';
import { captureAccountingProxyEnvironment } from '../../config/accountedProxyEnvironment.js';
import { FETCH_CONNECT_TIMEOUT_MS, HTTP_STATUS } from '../../config/runtimeConfig.js';
import { readBufferedGeminiEmbedding } from '../../utils/accountingGeminiEmbedding.js';

// Observe foreign work even when it ignores cancellation. A late unhanded
// response is disposed, never allowed to rewrite this generation's terminal.
function awaitPost(invoke, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true; signal.removeEventListener('abort', abort); callback(value);
    };
    const abort = () => finish(reject, signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    let work;
    try { work = invoke(); } catch (error) { finish(reject, error); return; }
    Promise.resolve(work).then(response => {
      if (!settled) finish(resolve, response);
      else { try { Promise.resolve(response?.body?.cancel(signal.reason)).catch(() => {}); } catch { /* disposal only */ } }
    }, error => finish(reject, error));
    if (signal.aborted) abort();
  });
}

// Request-owned generation. The caller still owes independently persisted
// selection/origin and own ACK delivery. Bare queued mode cannot skip binding.
export async function handleAccountedGeminiEmbedding({ evidence, accounting, signal, connectionId }) {
  const queued = accounting.requiresPreparedBaseWire === true;
  accounting.assertSupported(!queued || accounting.requiresQueuedGeminiEmbeddingsWire === true &&
    typeof accounting.assertGeminiEmbeddingImage === 'function');
  const image = captureGeminiEmbeddingDispatch(evidence);
  const assertImage = accounting.assertGeminiEmbeddingImage;
  if (assertImage !== undefined && typeof assertImage !== 'function') throw new Error('Gemini embedding authority unavailable');
  if (assertImage) assertImage(image);
  const conversion = captureGeminiEmbeddingConversion({ model: image.model, original: image.original, actual: image.actual });
  const environment = captureAccountingProxyEnvironment();
  const preparedWire = queued ? snapshotAccountingPreparedData({ protocol: QUEUED_GEMINI_EMBEDDING_PROTOCOL,
    geminiEmbeddingTransport: image, proxyEnvironment: environment }) : null;
  const { proxyAwareFetch } = await import('../../utils/proxyFetch.js');
  signal?.throwIfAborted();
  accounting.gate();
  const meta = { provider: 'gemini', model: image.model, endpoint: 'embeddings', connectionId };
  const attempt = await (queued ? accounting.beforeAttempt(meta, true, preparedWire) : accounting.beforeAttempt(meta, true));
  if (signal?.aborted) {
    await accounting.completeAttempt(attempt, { notDispatched: true, outcome: 'aborted' });
    signal.throwIfAborted();
  }
  let routingRefused = false;
  const routingGate = () => {
    try {
      accounting.gate();
      if (assertImage) assertImage(image);
      validateGeminiEmbeddingOptions(image, image.url, { method: 'POST', headers: image.headers, body: image.serialized, redirect: 'error' }, image.proxyOptions);
    } catch (error) { routingRefused = true; throw error; }
  };
  try { routingGate(); } catch (error) {
    await accounting.completeAttempt(attempt, { notDispatched: true, outcome: 'routing_refused' });
    throw error;
  }
  const control = new AbortController();
  const merged = signal ? AbortSignal.any([signal, control.signal]) : control.signal;
  const timer = setTimeout(() => control.abort(new Error('Embedding connection deadline exceeded')), FETCH_CONNECT_TIMEOUT_MS);
  let response, inspected, failure;
  try {
    response = await awaitPost(() => proxyAwareFetch(image.url,
      { method: 'POST', headers: image.headers, body: image.serialized, redirect: 'error', signal: merged }, image.proxyOptions,
      { singlePost: true, geminiEmbeddingTransport: image, proxyEnvironment: environment, routingGate }), merged);
    inspected = await readBufferedGeminiEmbedding(response, merged, conversion.inspection);
  } catch (error) { failure = { error }; }
  finally { clearTimeout(timer); }
  // Settlement/delivery errors escape. Never catch them as transport failures,
  // retry, create another terminal, or turn unknown metadata into exact zero.
  if (routingRefused) {
    await accounting.completeAttempt(attempt, { notDispatched: true, outcome: 'routing_refused' });
    throw failure.error;
  }
  const failedHttp = response && !response.ok;
  const terminal = await accounting.completeAttempt(attempt, {
    usage: inspected?.usage ?? null,
    outcome: merged.aborted ? 'aborted' : failedHttp ? 'failed' : failure ? 'network_unknown' : 'success',
  });
  signal?.throwIfAborted();
  if (!failure && response.ok) {
    accounting.assertSuccessfulTerminal(terminal);
    return { success: true, raw: inspected.message, usage: inspected.usage, status: response.status };
  }
  accounting.gate();
  // Never expose provider error text, query-key URLs, request images or native
  // transport errors. HTTP failure and exact usage remain separate facts.
  return { success: false, status: failedHttp ? response.status : HTTP_STATUS.BAD_GATEWAY, usage: inspected?.usage ?? null };
}
