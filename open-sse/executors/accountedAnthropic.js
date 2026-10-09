import { proxyAwareFetch } from '../utils/proxyFetch.js';
import { readBufferedClaudeAccounting } from '../utils/accountingClaudeUsage.js';
import { readAccountingText } from '../utils/readAccountingJson.js';
import { createAccountedOpenaiStream } from '../utils/accountedOpenaiStream.js';
import { createAccountingClaudeSseParser } from '../utils/accountingClaudeSseParser.js';
import { ACCOUNTED_ANTHROPIC_LIVE_MODE, supportsAnthropicLiveRequest, supportsAnthropicCandidate } from '../config/accountedAnthropicCandidate.js';
import { FETCH_CONNECT_TIMEOUT_MS } from '../config/runtimeConfig.js';

// Cancellation may win locally while foreign fetch continues; observe late
// outcomes and dispose an unhanded response without awaiting foreign cleanup.
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

// Standard API-key Messages candidate, buffered or explicit text-only live.
// Beta/OAuth transports remain independently denied; one owner per actual POST.
export async function executeAccountedAnthropicCandidate(executor, options) {
  const { model, credentials, accounting, signal, connectionId } = options;
  const proxyOptions = options.proxyOptions ? structuredClone(options.proxyOptions) : null;
  const live = options.accountingMode === ACCOUNTED_ANTHROPIC_LIVE_MODE;
  if (live) accounting.assertSupported(supportsAnthropicLiveRequest(options.body, model));
  const url = executor.buildUrl(model, true, 0, credentials);
  const transformed = executor.transformRequest(model, structuredClone(options.body), true, credentials);
  const body = { ...transformed, stream: true };
  const headers = { ...executor.buildHeaders(credentials, true, url, model, body), ...(options.providerOverrides?.headers || {}) };
  accounting.assertSupported(supportsAnthropicCandidate(executor, options, url, body, headers));
  // Wire/header/model material is frozen before asynchronous admission; neither
  // executor singleton nor mutable credential/request objects are reread afterward.
  let serialized, wireBody;
  try { serialized = JSON.stringify(body); wireBody = JSON.parse(serialized); }
  catch (error) { accounting.assertSupported(false); throw error; }
  accounting.assertSupported(wireBody.stream === true && supportsAnthropicCandidate(executor, options, url, wireBody, headers));
  signal?.throwIfAborted();
  const attempt = await accounting.beforeAttempt({ provider: executor.provider, model, endpoint: 'chat', connectionId }, true);
  if (signal?.aborted) {
    await accounting.completeAttempt(attempt, { notDispatched: true, outcome: 'aborted' });
    signal.throwIfAborted();
  }
  const control = new AbortController();
  const merged = signal ? AbortSignal.any([signal, control.signal]) : control.signal;
  const timer = setTimeout(() => control.abort(new Error('Chat connection deadline exceeded')), executor.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS);
  let response, text, message = null, usage = null, transportError = null, invoked = false;
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
      if (response.redirected || response.url && response.url !== url) throw new Error('Unexpected Anthropic response destination');
      if (!response.body || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'text/event-stream') throw new Error('Unsupported raw Claude SSE response');
      ownedBody = createAccountedOpenaiStream(response, { accounting, attempt, signal, parserFactory: createAccountingClaudeSseParser, expectedModel: model });
    } catch (error) { transportError = { error }; }
    // Transfer once. Stream construction/terminal ownership is distinct from
    // caller delivery; never settle again after the stream claimed this intent.
    if (ownedBody) {
      let replay;
      try { replay = new Response(ownedBody, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } }); }
      catch (error) { await ownedBody.cancel(error); throw error; }
      return { response: replay, url, headers, transformedBody: wireBody, accountingOwned: true, accountingLive: true };
    }
  }
  if (!transportError) {
    try {
      if (response.redirected || response.url && response.url !== url) throw new Error('Unexpected Anthropic response destination');
      if (response.ok) {
        const inspected = await readBufferedClaudeAccounting(response, signal, { expectedModel: model, captureMessage: true });
        text = inspected.text; usage = inspected.usage; message = inspected.message;
      } else text = await readAccountingText(response, signal); // Never infer zero from failure status.
    } catch (error) { transportError = { error }; }
  }
  // Sole readers clean up their acquired bodies. Only dispose untransferred,
  // unconsumed material here, without awaiting arbitrary foreign cancellation.
  if (transportError && response?.body && !response.bodyUsed && !response.body.locked) {
    try { Promise.resolve(response.body.cancel(transportError.error)).catch(() => {}); } catch { /* cleanup only */ }
  }
  // Persistence/authorization deliberately outside transport/parser catches.
  // A failed settlement cannot become a synthetic network response or successor.
  let outcome = 'failed';
  if (signal?.aborted) outcome = 'aborted';
  else if (transportError) outcome = 'network_unknown';
  else if (response.ok) outcome = 'success';
  const completion = { usage: transportError ? null : usage, outcome };
  if (!invoked) completion.notDispatched = true;
  const terminal = await accounting.completeAttempt(attempt, completion);
  signal?.throwIfAborted();
  if (transportError || !response.ok) accounting.gate();
  else { await accounting.assertSuccessfulTerminal(terminal); signal?.throwIfAborted(); }
  if (transportError) throw transportError.error;
  return { response: new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers }),
    url, headers, transformedBody: wireBody, accountingOwned: true, accountingMessage: message };
}
