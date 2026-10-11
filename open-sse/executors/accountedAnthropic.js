import { proxyAwareFetch } from '../utils/proxyFetch.js';
import { readBufferedClaudeAccounting } from '../utils/accountingClaudeUsage.js';
import { readAccountingText } from '../utils/readAccountingJson.js';
import { createAccountedOpenaiStream } from '../utils/accountedOpenaiStream.js';
import { createAccountingClaudeSseParser } from '../utils/accountingClaudeSseParser.js';
import { createAccountingClaudeOauthParser } from '../utils/accountingClaudeOauthSseParser.js';
import { ACCOUNTED_ANTHROPIC_BETA_LIVE_MODE, isAnthropicLiveMode, supportsAnthropicLiveRequest, supportsAnthropicCandidate, anthropicRequestHasCache1h } from '../config/accountedAnthropicCandidate.js';
import { FETCH_CONNECT_TIMEOUT_MS } from '../config/runtimeConfig.js';
import { captureAccountingBaseTransport } from '../config/accountedBaseTransport.js';
import { captureAccountingProxyEnvironment } from '../config/accountedProxyEnvironment.js';
import { snapshotAccountingPreparedData } from '../config/accountedBaseDispatch.js';
import { errorResponse } from '../utils/error.js';
import { DEFAULT_ERROR_MESSAGES } from '../config/errorConfig.js';
import { upstreamResponseHeaders } from '../utils/upstreamHeaders.js';
import { PROVIDER_OAUTH } from '../config/providers.js';
import { readAccountingJson } from '../utils/readAccountingJson.js';
import { ACCOUNTED_CLAUDE_OAUTH_MODE, claudeOauthToken, supportsClaudeOauthOriginal, prepareAccountingClaudeOauthBody, validateAccountingClaudeOauthPost } from '../config/accountedClaudeOauth.js';

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
async function refreshAccountedClaudeOauth(credentials, proxyOptions, proxyEnvironment, signal, timeoutMs, authorityGate) {
  const grant = PROVIDER_OAUTH.claude;
  const url = grant?.tokenUrl;
  if (typeof url !== 'string' || grant.refresh?.encoding !== 'json' || typeof grant.clientId !== 'string') throw new Error('Accounting OAuth refresh unavailable');
  const control = new AbortController();
  const merged = signal ? AbortSignal.any([signal, control.signal]) : control.signal;
  const timer = setTimeout(() => control.abort(new Error('Accounting OAuth refresh deadline exceeded')), timeoutMs || FETCH_CONNECT_TIMEOUT_MS);
  try {
    const response = await fetchOnce(() => proxyAwareFetch(url, { method: 'POST', redirect: 'error', signal: merged,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: credentials.refreshToken, client_id: grant.clientId }) }, proxyOptions,
    { singlePost: true, proxyEnvironment, routingGate: authorityGate }), merged);
    if (response.redirected || response.url && response.url !== url) throw new Error('Accounting OAuth refresh destination unavailable');
    if (!response.ok) { try { Promise.resolve(response.body?.cancel()).catch(() => {}); } catch { /* cleanup only */ } return null; }
    const tokens = await readAccountingJson(response, merged);
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || credentials.refreshToken, expiresIn: tokens.expires_in };
  } finally { clearTimeout(timer); }
}

export async function executeAccountedAnthropicCandidate(executor, options) {
  const { model, accounting, signal, connectionId } = options;
  // Guard plain bounded material before cloning/serialization can invoke getters
  // or let toJSON erase original work. Never admit a caller-shaped transform.
  const oauthInput = options.accountingMode === ACCOUNTED_CLAUDE_OAUTH_MODE;
  const credentials = oauthInput ? structuredClone(snapshotAccountingPreparedData(options.credentials)) : structuredClone(options.credentials);
  const originalBody = oauthInput ? structuredClone(snapshotAccountingPreparedData(options.body)) : structuredClone(options.body);
  const proxyOptions = options.proxyOptions ? structuredClone(oauthInput ? snapshotAccountingPreparedData(options.proxyOptions) : options.proxyOptions) : null;
  const oauth = options.accountingMode === ACCOUNTED_CLAUDE_OAUTH_MODE;
  const live = oauth || isAnthropicLiveMode(options.accountingMode);
  const allowClientTools = accounting.requiresPreparedBaseWire === true;
  const beta = oauth || options.accountingMode === ACCOUNTED_ANTHROPIC_BETA_LIVE_MODE;
  if (oauth) accounting.assertSupported(allowClientTools && executor.provider === 'claude' && options.stream === true &&
    !credentials.runtimeTransport && !credentials.rawHeaders?.['anthropic-beta'] && !options.providerOverrides &&
    !proxyOptions?.vercelRelayUrl && typeof accounting.assertClaudeOauthTerminal === 'function' && supportsClaudeOauthOriginal(originalBody, model));
  if (beta && !oauth) accounting.assertSupported(typeof accounting.assertAnthropicBetaTerminal === 'function');
  if (live && !oauth) accounting.assertSupported(supportsAnthropicLiveRequest(options.body, model, allowClientTools, beta));
  const url = executor.buildUrl(model, true, 0, credentials);
  const originalSerializedBody = accounting.requiresPreparedBaseWire ? JSON.stringify(originalBody) : null;
  const transformed = oauth ? prepareAccountingClaudeOauthBody(originalBody, claudeOauthToken(credentials))
    : executor.transformRequest(model, structuredClone(originalBody), true, credentials);
  const body = { ...transformed, stream: true };
  const headers = { ...executor.buildHeaders(credentials, true, url, model, body), ...(options.providerOverrides?.headers || {}) };
  if (!oauth) accounting.assertSupported(supportsAnthropicCandidate(executor, options, url, body, headers));
  // Wire/header/model material is frozen before asynchronous admission; neither
  // executor singleton nor mutable credential/request objects are reread afterward.
  let serialized, wireBody;
  try { serialized = JSON.stringify(body); wireBody = JSON.parse(serialized); }
  catch (error) { accounting.assertSupported(false); throw error; }
  if (!oauth) accounting.assertSupported(wireBody.stream === true && supportsAnthropicCandidate(executor, options, url, wireBody, headers));
  signal?.throwIfAborted();
  const preparedWire = accounting.requiresPreparedBaseWire ? snapshotAccountingPreparedData({
    protocol: 'native-anthropic', url, headers: Object.fromEntries(new Headers(headers)),
    credentials: { apiKey: credentials?.apiKey ?? null, accessToken: credentials?.accessToken ?? null },
    providerOverrides: options.providerOverrides ?? null, proxyOptions, proxyEnvironment: captureAccountingProxyEnvironment(),
    anthropicTransport: { model, mode: options.accountingMode, baseTransport: captureAccountingBaseTransport(executor.config), serializedBody: serialized, originalSerializedBody,
      ...(oauth ? { credentials: { apiKey: credentials.apiKey ?? null, accessToken: credentials.accessToken ?? null } } : {}) },
  }) : null;
  if (oauth) validateAccountingClaudeOauthPost(preparedWire.anthropicTransport, url, { method: 'POST', redirect: 'error', body: serialized, headers });
  const requireCacheTiers = beta && anthropicRequestHasCache1h(wireBody);
  const postHeaders = preparedWire ? preparedWire.headers : headers;
  const postProxy = preparedWire ? preparedWire.proxyOptions : proxyOptions;
  const postBody = preparedWire ? preparedWire.anthropicTransport.serializedBody : serialized;
  const attempt = await (preparedWire
    ? accounting.beforeAttempt({ provider: executor.provider, model, endpoint: 'chat', connectionId }, true, preparedWire)
    : accounting.beforeAttempt({ provider: executor.provider, model, endpoint: 'chat', connectionId }, true));
  if (oauth) accounting.assertSupported(!!attempt && attempt.unrecorded !== true);
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
      return proxyAwareFetch(url, { method: 'POST', headers: postHeaders, body: postBody, redirect: 'error', signal: merged }, postProxy,
        preparedWire ? { singlePost: true, proxyEnvironment: preparedWire.proxyEnvironment, anthropicTransport: preparedWire.anthropicTransport } : { singlePost: true });
    }, merged);
  } catch (error) { transportError = { error }; }
  finally { clearTimeout(timer); }
  if (!transportError && response.ok && live) {
    let ownedBody;
    try {
      if (response.redirected || response.url && response.url !== url) throw new Error('Unexpected Anthropic response destination');
      if (!response.body || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'text/event-stream') throw new Error('Unsupported raw Claude SSE response');
      ownedBody = createAccountedOpenaiStream(response, { accounting: beta ? {
          ...accounting, async assertSuccessfulTerminal(terminal) {
            await accounting.assertSuccessfulTerminal(terminal);
            if (oauth) await accounting.assertClaudeOauthTerminal(attempt, terminal);
            else await accounting.assertAnthropicBetaTerminal(attempt, terminal);
          },
        } : accounting, attempt, signal,
        limits: { allowClientTools, allowCache1h: beta, requireCacheTiers, allowThinking: oauth },
        parserFactory: oauth ? createAccountingClaudeOauthParser(originalBody) : createAccountingClaudeSseParser, expectedModel: model });
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
      if (response.ok || response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
        const inspected = await readBufferedClaudeAccounting(response, signal, {
          // Failed streams owe the same full block/tool JSON validation as
          // success. Capture for validation only, never successful delivery.
          expectedModel: model, captureMessage: true, allowFailedHttp: !response.ok, allowCache1h: beta, requireCacheTiers, allowThinking: oauth,
        });
        text = inspected.text; usage = inspected.usage; message = response.ok ? inspected.message : null;
      } else text = await readAccountingText(response, signal); // JSON/error text is not a raw usage schema.
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
  if (!transportError && !response.ok && usage !== null) {
    // Separate failed-terminal authority never uses the success hook or repeats
    // budget admission after a legitimate dispatched debit crosses its limit.
    if (typeof accounting.assertFailedTerminal !== 'function') accounting.assertSupported(false);
    await accounting.assertFailedTerminal(attempt, terminal); signal?.throwIfAborted();
  } else if (transportError || !response.ok) accounting.gate();
  else { await accounting.assertSuccessfulTerminal(terminal); signal?.throwIfAborted(); }
  if (transportError) throw transportError.error;
  if (oauth && [401, 403].includes(response.status) && usage !== null && options.oauthRefreshGeneration !== true) {
    accounting.assertSupported(typeof accounting.prepareClaudeOauthRefresh === 'function' && typeof accounting.completeClaudeOauthRefresh === 'function');
    const refreshCredentials = accounting.prepareClaudeOauthRefresh(attempt, terminal);
    const refreshed = await refreshAccountedClaudeOauth(refreshCredentials, postProxy, preparedWire.proxyEnvironment, signal, executor.config?.timeoutMs,
      () => { accounting.prepareClaudeOauthRefresh(attempt, terminal); });
    signal?.throwIfAborted();
    if (refreshed) {
      const nextCredentials = accounting.completeClaudeOauthRefresh(attempt, terminal, refreshed);
      signal?.throwIfAborted();
      return executeAccountedAnthropicCandidate(executor, { ...options, body: originalBody, credentials: nextCredentials,
        proxyOptions: postProxy, oauthRefreshGeneration: true });
    }
  }
  // Raw failed response is accounting evidence only. Do not feed it into
  // generic core error parsing/logs/client envelopes after the own ACK.
  const replay = response.ok
    ? new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers })
    : errorResponse(response.status, DEFAULT_ERROR_MESSAGES[response.status] || DEFAULT_ERROR_MESSAGES[502],
      { ...upstreamResponseHeaders(response.headers), 'Cache-Control': 'no-store' });
  return { response: replay, url, headers, transformedBody: wireBody, accountingOwned: true, accountingMessage: message };
}
