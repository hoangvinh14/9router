import { proxyAwareFetch } from '../utils/proxyFetch.js';
import { readBufferedResponsesAccounting } from '../utils/accountingResponsesUsage.js';
import { readAccountingText } from '../utils/readAccountingJson.js';
import { createAccountedOpenaiStream } from '../utils/accountedOpenaiStream.js';
import { createAccountingResponsesSseParser } from '../utils/accountingResponsesSseParser.js';
import { ACCOUNTED_RESPONSES_URL, ACCOUNTED_RESPONSES_SSE_MODE, supportsResponsesCandidate } from '../config/accountedResponsesCandidate.js';
import { FETCH_CONNECT_TIMEOUT_MS } from '../config/runtimeConfig.js';
import { ACCOUNTED_CODEX_URL, ACCOUNTED_CODEX_SSE_MODE, codexAccountingHeaders, supportsCodexCandidate } from '../config/accountedCodexCandidate.js';

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

// Native text-only Responses JSON or explicit SSE, one owner/POST, no retries.
// Explicit entry is distinct from a provider's existing Chat Completions URL.
export async function executeAccountedResponsesCandidate(executor, options) {
  const { model, accounting, signal, connectionId } = options;
  const credentials = structuredClone(options.credentials);
  const proxyOptions = options.proxyOptions ? structuredClone(options.proxyOptions) : null;
  const codex = options.accountingMode === ACCOUNTED_CODEX_SSE_MODE;
  const url = codex ? ACCOUNTED_CODEX_URL : ACCOUNTED_RESPONSES_URL;
  const body = structuredClone(options.body);
  const live = codex || options.accountingMode === ACCOUNTED_RESPONSES_SSE_MODE;
  const headers = new Headers({ ...(codex ? codexAccountingHeaders(credentials, executor.config.headers) : executor.buildHeaders(credentials, live, url, model, body)), ...(options.providerOverrides?.headers || {}) });
  const supports = codex ? supportsCodexCandidate : supportsResponsesCandidate;
  accounting.assertSupported(supports(executor, options, url, body, headers));
  // Native input must not pass Chat-Completions transforms/field stripping. Pin
  // exact serialization then authorize parsed wire; serialization faults deny.
  let serialized, wireBody;
  try { serialized = JSON.stringify(body); wireBody = JSON.parse(serialized); }
  catch (error) { accounting.assertSupported(false); throw error; }
  accounting.assertSupported(supports(executor, options, url, wireBody, headers));
  signal?.throwIfAborted();
  const attempt = await accounting.beforeAttempt({ provider: executor.provider, model, endpoint: 'chat', connectionId }, true);
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
      return proxyAwareFetch(url, { method: 'POST', headers, body: serialized, redirect: 'error', signal: merged }, proxyOptions, { singlePost: true });
    }, merged);
  } catch (error) { transportError = { error }; }
  finally { clearTimeout(timer); }
  if (!transportError && response.ok && live) {
    let ownedBody;
    try {
      if (response.redirected || response.url && response.url !== url) throw new Error('Unexpected Responses response destination');
      if (!response.body || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'text/event-stream') throw new Error('Unsupported raw Responses SSE response');
      ownedBody = createAccountedOpenaiStream(response, { accounting, attempt, signal, parserFactory: createAccountingResponsesSseParser, expectedModel: model });
    } catch (error) { transportError = { error }; }
    // After ownership transfer, only the stream may settle. Neither the caller
    // nor a construction failure can complete the same intent again.
    if (ownedBody) {
      let replay;
      try { replay = new Response(ownedBody, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } }); }
      catch (error) { await ownedBody.cancel(error); throw error; }
      return { response: replay, url, headers, transformedBody: wireBody, accountingOwned: true, accountingLive: true };
    }
  }
  if (!transportError) {
    try {
      if (response.redirected || response.url && response.url !== url) throw new Error('Unexpected Responses response destination');
      if (response.ok) {
        const inspected = await readBufferedResponsesAccounting(response, signal, { expectedModel: model });
        usage = inspected.usage; message = inspected.message;
      } else text = await readAccountingText(response, signal); // Failure status is never free evidence.
    } catch (error) { transportError = { error }; }
  }
  if (transportError && response?.body && !response.bodyUsed && !response.body.locked) {
    try { Promise.resolve(response.body.cancel(transportError.error)).catch(() => {}); } catch { /* untransferred cleanup only */ }
  }
  // Real persistence errors and terminal authorization stay outside transport
  // catches. Cancellation after valid evidence preserves incurred exact usage.
  let outcome = 'failed';
  if (signal?.aborted) outcome = 'aborted';
  else if (transportError) outcome = 'network_unknown';
  else if (response.ok) outcome = 'success';
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
