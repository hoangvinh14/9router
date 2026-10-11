import { randomUUID } from 'node:crypto';
import { proxyAwareFetch } from '../utils/proxyFetch.js';
import { snapshotAccountingPreparedData } from '../config/accountedBaseDispatch.js';
import { captureAccountingCommandCodeConfig, validateAccountingCommandCodePost } from '../config/accountedCommandCodeDispatch.js';
import { captureAccountingProxyEnvironment } from '../config/accountedProxyEnvironment.js';
import { ACCOUNTED_COMMANDCODE_MODE, ACCOUNTED_COMMANDCODE_PROTOCOL, ACCOUNTED_COMMANDCODE_URL, commandCodeToken, supportsCommandCodeOriginal } from '../config/accountedCommandCodeCandidate.js';
import { createAccountingCommandCodeNdjsonParser } from '../utils/accountingCommandCodeNdjsonParser.js';
import { createAccountedOpenaiStream } from '../utils/accountedOpenaiStream.js';
import { readAccountingText } from '../utils/readAccountingJson.js';
import { FETCH_CONNECT_TIMEOUT_MS } from '../config/runtimeConfig.js';

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
  });
}
// Internal caller-native, queued-only one generation/POST. No translator,
// initial-error inspection/replay, response synthesis, refresh or legacy retry.
export async function executeAccountedCommandCodeCandidate(executor, options) {
  const { model, accounting, signal, connectionId } = options;
  accounting.assertSupported(accounting.requiresPreparedBaseWire && options.accountingMode === ACCOUNTED_COMMANDCODE_MODE && executor.provider === 'commandcode' && options.stream === true);
  const original = snapshotAccountingPreparedData({ body: options.body, credentials: options.credentials,
    proxyOptions: options.proxyOptions ?? null, providerOverrides: options.providerOverrides ?? null });
  const config = captureAccountingCommandCodeConfig(executor.config), credentials = original.credentials;
  accounting.assertSupported(supportsCommandCodeOriginal(original.body, model) && credentials &&
    Object.keys(credentials).every(key => ['apiKey', 'accessToken', 'connectionId', 'providerSpecificData'].includes(key)) &&
    commandCodeToken(credentials.apiKey) && !credentials.accessToken && credentials.connectionId === connectionId &&
    !original.proxyOptions?.vercelRelayUrl);
  const sessionId = randomUUID(), serializedBody = JSON.stringify(original.body);
  const headers = new Headers({ ...config.baseTransport.headers, 'Content-Type': 'application/json', Accept: 'text/event-stream',
    Authorization: `Bearer ${credentials.apiKey}`, 'x-session-id': sessionId, ...(original.providerOverrides?.headers || {}) });
  const transport = { model, mode: ACCOUNTED_COMMANDCODE_MODE, commandCodeConfig: config, sessionId, serializedBody };
  validateAccountingCommandCodePost(transport, ACCOUNTED_COMMANDCODE_URL, { method: 'POST', redirect: 'error', body: serializedBody, headers });
  const prepared = snapshotAccountingPreparedData({ protocol: ACCOUNTED_COMMANDCODE_PROTOCOL, url: ACCOUNTED_COMMANDCODE_URL, headers: Object.fromEntries(headers),
    credentials: { apiKey: credentials.apiKey, accessToken: null, connectionId, providerSpecificData: credentials.providerSpecificData ?? {} },
    providerOverrides: original.providerOverrides, proxyOptions: original.proxyOptions, proxyEnvironment: captureAccountingProxyEnvironment(), commandCodeTransport: transport });
  signal?.throwIfAborted();
  const attempt = await accounting.beforeAttempt({ provider: executor.provider, model, endpoint: 'chat', connectionId }, true, prepared);
  if (signal?.aborted) {
    await accounting.completeAttempt(attempt, { notDispatched: true, outcome: 'aborted' }); signal.throwIfAborted();
  }
  const control = new AbortController(), merged = signal ? AbortSignal.any([signal, control.signal]) : control.signal;
  const timer = setTimeout(() => control.abort(new Error('Chat connection deadline exceeded')), config.timeoutMs || FETCH_CONNECT_TIMEOUT_MS);
  let response, transportError = null, invoked = false;
  try {
    response = await fetchOnce(() => {
      invoked = true;
      return proxyAwareFetch(prepared.url, { method: 'POST', redirect: 'error', headers: prepared.headers, body: prepared.commandCodeTransport.serializedBody, signal: merged }, prepared.proxyOptions,
        { singlePost: true, proxyEnvironment: prepared.proxyEnvironment, commandCodeTransport: prepared.commandCodeTransport });
    }, merged);
  } catch (error) { transportError = error; }
  finally { clearTimeout(timer); }
  let text = null, ownedBody = null;
  if (!transportError) {
    try {
      if (response.redirected || response.url && response.url !== prepared.url) throw new Error('Unexpected CommandCode response destination');
      if (response.ok) {
        if (!response.body || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/x-ndjson') throw new Error('Unsupported raw CommandCode NDJSON response');
        ownedBody = createAccountedOpenaiStream(response, { accounting, attempt, signal, parserFactory: createAccountingCommandCodeNdjsonParser });
      } else text = await readAccountingText(response, signal);
    } catch (error) { transportError = error; }
  }
  if (ownedBody) {
    let replay;
    try { replay = new Response(ownedBody, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' } }); }
    catch (error) { await ownedBody.cancel(error); throw error; }
    return { response: replay, url: prepared.url, headers: prepared.headers, transformedBody: original.body, accountingOwned: true, accountingLive: true };
  }
  if (response?.body && !response.bodyUsed && !response.body.locked) {
    try { Promise.resolve(response.body.cancel(transportError)).catch(() => {}); } catch { /* unhanded cleanup only */ }
  }
  await accounting.completeAttempt(attempt, { usage: null, outcome: signal?.aborted ? 'aborted' : transportError ? 'network_unknown' : 'failed', ...(!invoked ? { notDispatched: true } : {}) });
  signal?.throwIfAborted(); accounting.gate();
  if (transportError) throw transportError;
  return { response: new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers }),
    url: prepared.url, headers: prepared.headers, transformedBody: original.body, accountingOwned: true };
}
