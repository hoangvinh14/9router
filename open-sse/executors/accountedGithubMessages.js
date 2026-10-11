import crypto from 'node:crypto';
import { proxyAwareFetch } from '../utils/proxyFetch.js';
import { createAccountedOpenaiStream } from '../utils/accountedOpenaiStream.js';
import { createAccountingClaudeSseParser } from '../utils/accountingClaudeSseParser.js';
import { readAccountingText } from '../utils/readAccountingJson.js';
import { snapshotAccountingPreparedData } from '../config/accountedBaseDispatch.js';
import { captureAccountingProxyEnvironment } from '../config/accountedProxyEnvironment.js';
import { FETCH_CONNECT_TIMEOUT_MS } from '../config/runtimeConfig.js';
import { ACCOUNTED_GITHUB_MESSAGES_URL, ACCOUNTED_GITHUB_MESSAGES_MODE, ACCOUNTED_GITHUB_MESSAGES_PROTOCOL, supportsGithubMessagesOriginal, githubMessagesAccountingBody, githubMessagesHeaders, githubMessagesIdentity } from '../config/accountedGithubMessagesCandidate.js';
import { captureAccountingGithubMessagesConfig, validateAccountingGithubMessagesPost } from '../config/accountedGithubMessagesDispatch.js';
import { ACCOUNTED_GITHUB_CHAT_MESSAGES_MODE, ACCOUNTED_GITHUB_CHAT_MESSAGES_PROTOCOL, supportsGithubChatMessagesOriginal } from '../config/accountedGithubChatMessagesCandidate.js';
import { validateAccountingGithubChatMessagesPost } from '../config/accountedGithubChatMessagesDispatch.js';
// Observe late foreign outcomes and dispose only unhanded responses. Abort is not
// a durable terminal ACK; completion remains outside transport catches.
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
// Separate internal native-Claude owner: never legacy OpenAI conversion, token
// fallback, route cache selection, beta/tool stripping, refresh or retries.
export async function executeAccountedGithubMessagesCandidate(executor, options, convertOriginal = null) {
  const { model, accounting, signal, connectionId } = options;
  const chat = options.accountingMode === ACCOUNTED_GITHUB_CHAT_MESSAGES_MODE;
  accounting.assertSupported(accounting.requiresPreparedBaseWire && executor.provider === 'github' && options.stream === true &&
    (chat ? typeof convertOriginal === 'function' : options.accountingMode === ACCOUNTED_GITHUB_MESSAGES_MODE));
  const original = snapshotAccountingPreparedData({ body: options.body, credentials: options.credentials,
    proxyOptions: options.proxyOptions ?? null, providerOverrides: options.providerOverrides ?? null });
  const { credentials, proxyOptions, providerOverrides } = original;
  const githubConfig = captureAccountingGithubMessagesConfig(executor.config);
  accounting.assertSupported((chat ? supportsGithubChatMessagesOriginal(original.body, model) : supportsGithubMessagesOriginal(original.body, model)) &&
    Object.keys(credentials).every(key => ['apiKey', 'accessToken', 'copilotToken', 'connectionId', 'providerSpecificData'].includes(key)) &&
    !credentials.apiKey && githubMessagesIdentity(credentials.accessToken) && githubMessagesIdentity(credentials.copilotToken) &&
    credentials.copilotToken === credentials.providerSpecificData?.copilotToken && connectionId === credentials.connectionId && !proxyOptions?.vercelRelayUrl);
  const url = ACCOUNTED_GITHUB_MESSAGES_URL, requestId = crypto.randomUUID();
  // Translator runs only on detached copies after original schema/plain guards.
  // Count and freeze its complete output; never erase unsupported wire fields.
  const body = snapshotAccountingPreparedData(chat ? convertOriginal(structuredClone(original.body), structuredClone(credentials)) : githubMessagesAccountingBody(original.body));
  const serializedBody = JSON.stringify(body);
  const transportField = chat ? 'githubChatMessagesTransport' : 'githubMessagesTransport';
  const validatePost = chat ? validateAccountingGithubChatMessagesPost : validateAccountingGithubMessagesPost;
  const headers = new Headers({ ...githubMessagesHeaders(credentials, requestId), ...(providerOverrides?.headers || {}) });
  const transport = { model, mode: options.accountingMode, githubConfig, requestId, serializedBody, originalSerializedBody: JSON.stringify(original.body) };
  validatePost(transport, url, { method: 'POST', redirect: 'error', body: serializedBody, headers });
  signal?.throwIfAborted();
  const wire = snapshotAccountingPreparedData({ protocol: chat ? ACCOUNTED_GITHUB_CHAT_MESSAGES_PROTOCOL : ACCOUNTED_GITHUB_MESSAGES_PROTOCOL, url, headers: Object.fromEntries(headers),
    credentials: { apiKey: credentials.apiKey ?? null, accessToken: credentials.accessToken, copilotToken: credentials.copilotToken,
      connectionId: credentials.connectionId, providerSpecificData: credentials.providerSpecificData },
    providerOverrides, proxyOptions, proxyEnvironment: captureAccountingProxyEnvironment(), [transportField]: transport });
  const attempt = await accounting.beforeAttempt({ provider: executor.provider, model, endpoint: 'chat', connectionId }, true, wire);
  if (signal?.aborted) { await accounting.completeAttempt(attempt, { notDispatched: true, outcome: 'aborted' }); signal.throwIfAborted(); }
  const control = new AbortController(), merged = signal ? AbortSignal.any([signal, control.signal]) : control.signal;
  const timer = setTimeout(() => control.abort(new Error('Chat connection deadline exceeded')), githubConfig.timeoutMs || FETCH_CONNECT_TIMEOUT_MS);
  let response, text, transportError = null, invoked = false;
  try {
    response = await fetchOnce(() => {
      invoked = true;
      return proxyAwareFetch(wire.url, { method: 'POST', headers: wire.headers, body: wire[transportField].serializedBody, redirect: 'error', signal: merged }, wire.proxyOptions,
        { singlePost: true, proxyEnvironment: wire.proxyEnvironment, [transportField]: wire[transportField] });
    }, merged);
  } catch (error) { transportError = { error }; }
  finally { clearTimeout(timer); }
  if (!transportError && response.ok) {
    let ownedBody;
    try {
      if (response.redirected || response.url && response.url !== url) throw new Error('Unexpected GitHub Messages response destination');
      if (!response.body || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'text/event-stream') throw new Error('Unsupported raw Claude SSE response');
      ownedBody = createAccountedOpenaiStream(response, { accounting, attempt, signal, parserFactory: createAccountingClaudeSseParser, expectedModel: model });
    } catch (error) { transportError = { error }; }
    if (ownedBody) {
      let replay;
      try { replay = new Response(ownedBody, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } }); }
      catch (error) { await ownedBody.cancel(error); throw error; }
      return { response: replay, url, headers: wire.headers, transformedBody: snapshotAccountingPreparedData(body), accountingOwned: true, accountingLive: true };
    }
  }
  if (!transportError) {
    try {
      if (response.redirected || response.url && response.url !== url) throw new Error('Unexpected GitHub Messages response destination');
      text = await readAccountingText(response, signal);
    } catch (error) { transportError = { error }; }
  }
  if (transportError && response?.body && !response.bodyUsed && !response.body.locked) {
    try { Promise.resolve(response.body.cancel(transportError.error)).catch(() => {}); } catch { /* untransferred cleanup only */ }
  }
  const completion = { usage: null, outcome: signal?.aborted ? 'aborted' : transportError ? 'network_unknown' : 'failed' };
  if (!invoked) completion.notDispatched = true;
  await accounting.completeAttempt(attempt, completion);
  signal?.throwIfAborted(); accounting.gate();
  if (transportError) throw transportError.error;
  return { response: new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers }),
    url, headers: wire.headers, transformedBody: snapshotAccountingPreparedData(body), accountingOwned: true };
}
