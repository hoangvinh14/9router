import { proxyAwareFetch } from '../utils/proxyFetch.js';
import { readBufferedResponsesAccounting } from '../utils/accountingResponsesUsage.js';
import { readAccountingText } from '../utils/readAccountingJson.js';
import { createAccountedOpenaiStream } from '../utils/accountedOpenaiStream.js';
import { createAccountingResponsesSseParser } from '../utils/accountingResponsesSseParser.js';
import { ACCOUNTED_RESPONSES_URL, ACCOUNTED_RESPONSES_SSE_MODE, supportsResponsesCandidate } from '../config/accountedResponsesCandidate.js';
import { FETCH_CONNECT_TIMEOUT_MS } from '../config/runtimeConfig.js';
import { captureAccountingBaseTransport } from '../config/accountedBaseTransport.js';
import { captureAccountingProxyEnvironment } from '../config/accountedProxyEnvironment.js';
import { snapshotAccountingPreparedData } from '../config/accountedBaseDispatch.js';
import { ACCOUNTED_CODEX_URL, ACCOUNTED_CODEX_SSE_MODE, codexAccountingHeaders, supportsCodexCandidate } from '../config/accountedCodexCandidate.js';
import crypto from 'node:crypto';
import { ACCOUNTED_GROK_CLI_URL, ACCOUNTED_GROK_CLI_MODE, ACCOUNTED_GROK_CLI_PROTOCOL, supportsGrokCliOriginal, grokCliAccountingBody, grokCliAccountingHeaders, grokCliIdentityString } from '../config/accountedGrokCliCandidate.js';
import { captureAccountingGrokCliConfig, validateAccountingGrokCliDispatch, validateAccountingGrokCliPost } from '../config/accountedGrokCliDispatch.js';
import { ACCOUNTED_GITHUB_RESPONSES_URL, ACCOUNTED_GITHUB_RESPONSES_MODE, ACCOUNTED_GITHUB_RESPONSES_PROTOCOL, supportsGithubResponsesRequest, githubResponsesHeaders, githubResponsesIdentity } from '../config/accountedGithubResponsesCandidate.js';
import { captureAccountingGithubResponsesConfig, validateAccountingGithubResponsesPost } from '../config/accountedGithubResponsesDispatch.js';

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
export async function executeAccountedResponsesCandidate(executor, options, grokIdentityResolvers = null) {
  const { model, accounting, signal, connectionId } = options;
  const codex = options.accountingMode === ACCOUNTED_CODEX_SSE_MODE;
  const grok = options.accountingMode === ACCOUNTED_GROK_CLI_MODE;
  const github = options.accountingMode === ACCOUNTED_GITHUB_RESPONSES_MODE;
  if (grok || github) accounting.assertSupported(accounting.requiresPreparedBaseWire && executor.provider === (github ? 'github' : 'grok-cli') && options.stream === true);
  // Guard queued OAuth inputs before clones, header construction or serialization.
  const original = accounting.requiresPreparedBaseWire && (codex || grok || github) ? snapshotAccountingPreparedData({
    body: options.body, credentials: options.credentials, proxyOptions: options.proxyOptions ?? null,
    providerOverrides: options.providerOverrides ?? null,
  }) : null;
  const credentials = original ? original.credentials : structuredClone(options.credentials);
  const proxyOptions = original ? original.proxyOptions : options.proxyOptions ? structuredClone(options.proxyOptions) : null;
  const url = github ? ACCOUNTED_GITHUB_RESPONSES_URL : grok ? ACCOUNTED_GROK_CLI_URL : codex ? ACCOUNTED_CODEX_URL : ACCOUNTED_RESPONSES_URL;
  const grokConfig = grok ? captureAccountingGrokCliConfig(executor.config) : null;
  const githubConfig = github ? captureAccountingGithubResponsesConfig(executor.config) : null;
  const githubRequestId = github ? crypto.randomUUID() : null;
  if (github) accounting.assertSupported(supportsGithubResponsesRequest(original.body, model) &&
    Object.keys(credentials).every(key => ['apiKey', 'accessToken', 'copilotToken', 'connectionId', 'providerSpecificData'].includes(key)) &&
    !credentials.apiKey && githubResponsesIdentity(credentials.accessToken) && githubResponsesIdentity(credentials.copilotToken) &&
    credentials.copilotToken === credentials.providerSpecificData?.copilotToken && !proxyOptions?.vercelRelayUrl);
  let identity = null;
  if (grok) {
    accounting.assertSupported(supportsGrokCliOriginal(original.body, model) && Object.keys(credentials).every(key => ['apiKey', 'accessToken', 'connectionId', 'providerSpecificData'].includes(key)) && !credentials.apiKey && !credentials.runtimeTransport &&
      !proxyOptions?.vercelRelayUrl && grokCliIdentityString(credentials.accessToken) && grokCliIdentityString(credentials.providerSpecificData?.deviceId) &&
      ['email', 'userId'].every(key => credentials.providerSpecificData[key] === undefined || grokCliIdentityString(credentials.providerSpecificData[key])));
    accounting.assertSupported(!!grokIdentityResolvers);
    const sessionId = grokIdentityResolvers.resolveSession(credentials, original.body);
    identity = { sessionId, requestId: crypto.randomUUID(), turn: grokIdentityResolvers.resolveTurn(sessionId, original.body.input, original.body) };
  }
  const body = grok ? grokCliAccountingBody(original.body) : original ? original.body : structuredClone(options.body);
  const live = github || grok || codex || options.accountingMode === ACCOUNTED_RESPONSES_SSE_MODE;
  const baseTransport = original ? captureAccountingBaseTransport(executor.config) : null;
  const overrides = original ? original.providerOverrides : options.providerOverrides;
  const headers = new Headers({ ...(github ? githubResponsesHeaders(credentials, githubRequestId) : grok ? grokCliAccountingHeaders(credentials, grokConfig, identity) : codex ? codexAccountingHeaders(credentials, baseTransport ? baseTransport.headers : executor.config.headers) : executor.buildHeaders(credentials, live, url, model, body)), ...(overrides?.headers || {}) });
  const supports = codex ? supportsCodexCandidate : supportsResponsesCandidate;
  const supportOptions = original ? { ...options, ...original } : options;
  if (!grok && !github) accounting.assertSupported(supports(executor, supportOptions, url, body, headers));
  // Native input must not pass Chat-Completions transforms/field stripping. Pin
  // exact serialization then authorize parsed wire; serialization faults deny.
  let serialized, wireBody;
  try { serialized = JSON.stringify(body); wireBody = JSON.parse(serialized); }
  catch (error) { accounting.assertSupported(false); throw error; }
  if (!grok && !github) accounting.assertSupported(supports(executor, supportOptions, url, wireBody, headers));
  signal?.throwIfAborted();
  // Legacy synchronous flow unchanged. OAuth and API-key evidence stay distinct;
  // neither admits refresh/retry or re-selects token/account after admission.
  if (original) accounting.assertSupported(connectionId === credentials.connectionId);
  const transportField = github ? 'githubResponsesTransport' : grok ? 'grokCliTransport' : codex ? 'codexTransport' : 'responsesTransport';
  const transport = !accounting.requiresPreparedBaseWire ? null : github ? { model, mode: options.accountingMode, githubConfig, requestId: githubRequestId, serializedBody: serialized } : grok ? { model, mode: options.accountingMode, grokConfig, identity, serializedBody: serialized, originalSerializedBody: JSON.stringify(original.body) } :
    { model, mode: options.accountingMode, baseTransport: baseTransport || captureAccountingBaseTransport(executor.config), serializedBody: serialized };
  if (grok) {
    validateAccountingGrokCliDispatch(transport, url);
    validateAccountingGrokCliPost(transport, url, { method: 'POST', redirect: 'error', body: serialized, headers });
  }
  if (github) validateAccountingGithubResponsesPost(transport, url, { method: 'POST', redirect: 'error', body: serialized, headers });
  const preparedWire = accounting.requiresPreparedBaseWire ? snapshotAccountingPreparedData({
    protocol: github ? ACCOUNTED_GITHUB_RESPONSES_PROTOCOL : grok ? ACCOUNTED_GROK_CLI_PROTOCOL : codex ? 'native-codex' : 'native-responses', url, headers: Object.fromEntries(headers),
    credentials: github ? { apiKey: credentials.apiKey ?? null, accessToken: credentials.accessToken, copilotToken: credentials.copilotToken,
      connectionId: credentials.connectionId, providerSpecificData: credentials.providerSpecificData } : (codex || grok) ? { apiKey: credentials?.apiKey ?? null, accessToken: credentials?.accessToken ?? null,
      connectionId: credentials.connectionId, providerSpecificData: credentials.providerSpecificData } :
      { apiKey: credentials?.apiKey ?? null, accessToken: credentials?.accessToken ?? null },
    providerOverrides: overrides ?? null, proxyOptions, proxyEnvironment: captureAccountingProxyEnvironment(),
    [transportField]: transport,
  }) : null;
  const postHeaders = preparedWire ? preparedWire.headers : headers;
  const postProxy = preparedWire ? preparedWire.proxyOptions : proxyOptions;
  const postBody = preparedWire ? preparedWire[transportField].serializedBody : serialized;
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
        preparedWire ? { singlePost: true, proxyEnvironment: preparedWire.proxyEnvironment, [transportField]: preparedWire[transportField] } : { singlePost: true });
    }, merged);
  } catch (error) { transportError = { error }; }
  finally { clearTimeout(timer); }
  if (!transportError && response.ok && live) {
    let ownedBody;
    try {
      if (response.redirected || response.url && response.url !== url) throw new Error('Unexpected Responses response destination');
      if (!response.body || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'text/event-stream') throw new Error('Unsupported raw Responses SSE response');
      ownedBody = createAccountedOpenaiStream(response, { accounting, attempt, signal, parserFactory: createAccountingResponsesSseParser, expectedModel: model, ...(grok ? { limits: { allowReasoning: true } } : {}) });
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
