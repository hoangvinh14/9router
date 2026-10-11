import { proxyAwareFetch } from '../utils/proxyFetch.js';
import { readBufferedGeminiAccounting } from '../utils/accountingGeminiUsage.js';
import { readAccountingText } from '../utils/readAccountingJson.js';
import { supportsGeminiCandidate, ACCOUNTED_GEMINI_SSE_MODE } from '../config/accountedGeminiCandidate.js';
import { createAccountingGeminiSseParser } from '../utils/accountingGeminiSseParser.js';
import { createAccountedOpenaiStream } from '../utils/accountedOpenaiStream.js';
import { FETCH_CONNECT_TIMEOUT_MS } from '../config/runtimeConfig.js';
import { captureAccountingBaseTransport } from '../config/accountedBaseTransport.js';
import { captureAccountingProxyEnvironment } from '../config/accountedProxyEnvironment.js';
import { snapshotAccountingPreparedData } from '../config/accountedBaseDispatch.js';

function fetchOnce(invoke, signal) {
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
      if (settled) { try { Promise.resolve(value?.body?.cancel(signal.reason)).catch(() => {}); } catch { /* foreign cleanup */ } }
      else finish(resolve, value);
    }, error => finish(reject, error));
    if (signal.aborted) abort();
  });
}
// Native original generateContent JSON, not an OpenAI reconversion. One strict
// POST/intent/sole bounded raw reader; no refresh, redirect or retry shortcut.
export async function executeAccountedGeminiCandidate(executor, options) {
  const { model, accounting, signal, connectionId } = options;
  const credentials = structuredClone(options.credentials);
  const proxyOptions = options.proxyOptions ? structuredClone(options.proxyOptions) : null;
  const live = options.accountingMode === ACCOUNTED_GEMINI_SSE_MODE;
  const url = executor.buildUrl(model, live, 0, credentials);
  const { model: _model, stream: _stream, ...body } = structuredClone(options.body);
  const headers = new Headers({ ...executor.buildHeaders(credentials, live, url, model, body), ...(options.providerOverrides?.headers || {}) });
  accounting.assertSupported(supportsGeminiCandidate(executor, options, url, body, headers));
  let serialized, wireBody;
  try { serialized = JSON.stringify(body); wireBody = JSON.parse(serialized); }
  catch (error) { accounting.assertSupported(false); throw error; }
  accounting.assertSupported(supportsGeminiCandidate(executor, options, url, wireBody, headers));
  signal?.throwIfAborted();
  // Default synchronous owner keeps its two-argument contract. Internal queued
  // admission receives the original immutable native work, never rebuilt later.
  const preparedWire = accounting.requiresPreparedBaseWire ? snapshotAccountingPreparedData({
    protocol: 'native-gemini', url, headers: Object.fromEntries(headers),
    credentials: { apiKey: credentials?.apiKey ?? null, accessToken: credentials?.accessToken ?? null },
    providerOverrides: options.providerOverrides ?? null, proxyOptions, proxyEnvironment: captureAccountingProxyEnvironment(),
    geminiTransport: { model, mode: options.accountingMode, baseTransport: captureAccountingBaseTransport(executor.config), serializedBody: serialized },
  }) : null;
  const postHeaders = preparedWire ? preparedWire.headers : headers;
  const postProxy = preparedWire ? preparedWire.proxyOptions : proxyOptions;
  const postBody = preparedWire ? preparedWire.geminiTransport.serializedBody : serialized;
  const attempt = await (preparedWire
    ? accounting.beforeAttempt({ provider: executor.provider, model, endpoint: 'chat', connectionId }, true, preparedWire)
    : accounting.beforeAttempt({ provider: executor.provider, model, endpoint: 'chat', connectionId }, true));
  if (signal?.aborted) {
    await accounting.completeAttempt(attempt, { notDispatched: true, outcome: 'aborted' }); signal.throwIfAborted();
  }
  const control = new AbortController();
  const merged = signal ? AbortSignal.any([signal, control.signal]) : control.signal;
  const timer = setTimeout(() => control.abort(new Error('Chat connection deadline exceeded')), executor.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS);
  let response, message = null, usage = null, text, transportError = null, invoked = false;
  try {
    response = await fetchOnce(() => {
      invoked = true;
      return proxyAwareFetch(url, { method: 'POST', headers: postHeaders, body: postBody, redirect: 'error', signal: merged }, postProxy,
        preparedWire ? { singlePost: true, proxyEnvironment: preparedWire.proxyEnvironment, geminiTransport: preparedWire.geminiTransport } : { singlePost: true });
    }, merged);
  } catch (error) { transportError = { error }; }
  finally { clearTimeout(timer); }
  if (!transportError && response.ok && live) {
    let ownedBody;
    try {
      if (response.redirected || response.url && response.url !== url) throw new Error('Unexpected Gemini response destination');
      if (!response.body || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'text/event-stream') throw new Error('Unsupported raw Gemini SSE response');
      ownedBody = createAccountedOpenaiStream(response, { accounting, attempt, signal, parserFactory: createAccountingGeminiSseParser, expectedModel: model });
    } catch (error) { transportError = { error }; }
    // Transfer once to the existing sole stream terminal owner. Caller delivery
    // or response construction cannot start a second settlement/JSON fallback.
    if (ownedBody) {
      let replay;
      try { replay = new Response(ownedBody, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } }); }
      catch (error) { await ownedBody.cancel(error); throw error; }
      return { response: replay, url, headers, transformedBody: wireBody, accountingOwned: true, accountingLive: true };
    }
  }
  if (!transportError) {
    try {
      if (response.redirected || response.url && response.url !== url) throw new Error('Unexpected Gemini response destination');
      if (response.ok) {
        const inspected = await readBufferedGeminiAccounting(response, signal, { expectedModel: model });
        usage = inspected.usage; message = inspected.message;
      } else text = await readAccountingText(response, signal);
    } catch (error) { transportError = { error }; }
  }
  if (transportError && response?.body && !response.bodyUsed && !response.body.locked) {
    try { Promise.resolve(response.body.cancel(transportError.error)).catch(() => {}); } catch { /* unhanded cleanup only */ }
  }
  // Exact evidence already observed survives a cancellation while ACK is held.
  // Persistence and trusted authorization failures are not transport failures.
  const outcome = signal?.aborted ? 'aborted' : transportError ? 'network_unknown' : response.ok ? 'success' : 'failed';
  const completion = { usage, outcome };
  if (!invoked) completion.notDispatched = true;
  const terminal = await accounting.completeAttempt(attempt, completion);
  signal?.throwIfAborted();
  if (transportError || !response.ok) accounting.gate();
  else { await accounting.assertSuccessfulTerminal(terminal); signal?.throwIfAborted(); }
  if (transportError) throw transportError.error;
  const replay = message ? Response.json(message, { headers: { 'Cache-Control': 'no-store' } }) :
    new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers });
  return { response: replay, url, headers, transformedBody: wireBody, accountingOwned: true, accountingMessage: message };
}
