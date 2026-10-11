import { randomUUID } from 'node:crypto';
import { types } from 'node:util';
import { proxyAwareFetch } from '../utils/proxyFetch.js';
import { snapshotAccountingPreparedData } from '../config/accountedBaseDispatch.js';
import { captureCommandCodeChatConversion } from '../config/accountedCommandCodeChatCapture.js';
import { captureAccountingCommandCodeConfig } from '../config/accountedCommandCodeDispatch.js';
import { validateAccountingCommandCodeChatOptions } from '../config/accountedCommandCodeChatDispatch.js';
import { captureAccountingProxyEnvironment } from '../config/accountedProxyEnvironment.js';
import { ACCOUNTED_COMMANDCODE_MODE, ACCOUNTED_COMMANDCODE_PROTOCOL, ACCOUNTED_COMMANDCODE_URL } from '../config/accountedCommandCodeCandidate.js';
import { openaiToCommandCodeRequest } from '../translator/request/openai-to-commandcode.js';
import { routeAccountingCommandCodeResponse } from '../utils/accountingCommandCodeResponseRoute.js';
import { observeCommandCodeInitialFailure } from '../utils/accountedCommandCodeInitialFailure.js';
import { createAccountingCommandCodeNdjsonParser } from '../utils/accountingCommandCodeNdjsonParser.js';
import { createAccountedOpenaiStream } from '../utils/accountedOpenaiStream.js';
import { readAccountingText } from '../utils/readAccountingJson.js';
import { FETCH_CONNECT_TIMEOUT_MS } from '../config/runtimeConfig.js';
import { captureAccountingAbortSignal } from '../config/accountedAbortSignal.js';

const unavailable = () => { throw new Error('Accounting CommandCode Chat generation unavailable'); };
function descriptors(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value)) unavailable();
  const result = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(result)) {
    if (typeof key !== 'string' || !Object.hasOwn(result[key], 'value') || !result[key].enumerable) unavailable();
  }
  return result;
}
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
    Promise.resolve(work).then(response => {
      if (settled) { try { Promise.resolve(response?.body?.cancel(signal.reason)).catch(() => {}); } catch { /* late cleanup only */ } }
      else finish(resolve, response);
    }, error => finish(reject, error));
  });
}

// Internal ONE generation, not a retry loop or an application mode. No callback
// can substitute for own queued intent/completion delivery or fresh authority.
export async function executeAccountedCommandCodeChatGeneration(executor, options) {
  return captureAccountedCommandCodeChatOwner(executor, options).executeGeneration();
}

// Closure retains the original conversion/config/environment; callers cannot
// supply a rebuilt capture for a successor or replace its owner handles.
export function captureAccountedCommandCodeChatOwner(executor, options) {
  const fields = descriptors(options), owner = descriptors(executor);
  if (![Object.prototype, null].includes(Object.getPrototypeOf(options))) unavailable();
  const allowed = ['model', 'body', 'stream', 'credentials', 'connectionId', 'providerOverrides', 'proxyOptions', 'accounting', 'signal'];
  if (Object.keys(fields).some(key => !allowed.includes(key))) unavailable();
  const input = snapshotAccountingPreparedData({ model: fields.model?.value, body: fields.body?.value, stream: fields.stream?.value,
    credentials: fields.credentials?.value, connectionId: fields.connectionId?.value, providerOverrides: fields.providerOverrides?.value ?? null,
    proxyOptions: fields.proxyOptions?.value ?? null, config: owner.config?.value, provider: owner.provider?.value });
  const accounting = fields.accounting?.value, signal = captureAccountingAbortSignal(fields.signal?.value);
  if (!accounting || !accounting.requiresPreparedBaseWire || input.provider !== 'commandcode' || input.stream !== true) unavailable();
  accounting.assertSupported(true);
  const credentials = input.credentials;
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials) ||
      Object.keys(credentials).some(key => !['apiKey', 'accessToken', 'connectionId', 'providerSpecificData'].includes(key)) ||
      credentials.connectionId !== input.connectionId) unavailable();
  const runtime = snapshotAccountingPreparedData({ workingDir: process.cwd(), date: new Date().toISOString().slice(0, 10), environment: process.platform });
  const capture = captureCommandCodeChatConversion({ body: input.body, model: input.model, stream: input.stream,
    credentials: { apiKey: credentials.apiKey, accessToken: credentials.accessToken ?? null, connectionId: input.connectionId, providerSpecificData: credentials.providerSpecificData ?? {} },
    config: input.config, providerOverrides: input.providerOverrides, proxyOptions: input.proxyOptions, runtime },
  (model, body, stream, heldCredentials) => openaiToCommandCodeRequest(model, body, stream, heldCredentials, runtime));
  const config = captureAccountingCommandCodeConfig(capture.original.config);
  const environment = captureAccountingProxyEnvironment();
  let firstGeneration = true;
  return Object.freeze({ executeGeneration: async () => {
  // Initial support/admission already gates. Only successors need this extra
  // fresh gate before creating their new session/wire after the backoff.
  if (!firstGeneration) accounting.gate();
  firstGeneration = false; signal?.throwIfAborted();
  const sessionId = randomUUID();
  const headers = new Headers(capture.original.config.headers || {});
  headers.set('Content-Type', 'application/json'); headers.set('Accept', 'text/event-stream');
  headers.set('Authorization', `Bearer ${capture.original.credentials.apiKey}`); headers.set('x-session-id', sessionId);
  for (const [key, value] of Object.entries(capture.original.providerOverrides?.headers || {})) headers.set(key, value);
  const transport = { model: input.model, mode: ACCOUNTED_COMMANDCODE_MODE, commandCodeConfig: config, sessionId, serializedBody: JSON.stringify(capture.actual) };
  const prepared = snapshotAccountingPreparedData({ protocol: ACCOUNTED_COMMANDCODE_PROTOCOL, url: ACCOUNTED_COMMANDCODE_URL, headers: Object.fromEntries(headers),
    credentials: capture.original.credentials, providerOverrides: capture.original.providerOverrides, proxyOptions: capture.original.proxyOptions,
    proxyEnvironment: environment, commandCodeTransport: transport, commandCodeChatCapture: capture });
  const evidence = { capture: prepared.commandCodeChatCapture, nativeTransport: prepared.commandCodeTransport };
  validateAccountingCommandCodeChatOptions(evidence, prepared.url,
    { method: 'POST', redirect: 'error', body: transport.serializedBody, headers: prepared.headers }, prepared.proxyOptions);
  signal?.throwIfAborted();
  const attempt = await accounting.beforeAttempt({ provider: input.provider, model: input.model, endpoint: 'chat', connectionId: input.connectionId }, true, prepared);
  // Unlimited service gap-latch fallback is NOT this generation's delivered
  // durable intent ACK. This narrow owner refuses it, without rewriting the
  // service contract or attempting a completion against an uncertain intent.
  if (!attempt || attempt.unrecorded) { accounting.gate(); unavailable(); }
  if (signal?.aborted) { await accounting.completeAttempt(attempt, { notDispatched: true, outcome: 'aborted' }); signal.throwIfAborted(); }
  const control = new AbortController(), merged = signal ? AbortSignal.any([signal, control.signal]) : control.signal;
  const timer = setTimeout(() => control.abort(new Error('Chat connection deadline exceeded')), config.timeoutMs || FETCH_CONNECT_TIMEOUT_MS);
  let response, selected, text = null, fault = null, invoked = false;
  try {
    response = await fetchOnce(() => {
      invoked = true;
      return proxyAwareFetch(prepared.url, { method: 'POST', redirect: 'error', body: prepared.commandCodeTransport.serializedBody, headers: prepared.headers, signal: merged },
        prepared.proxyOptions, { singlePost: true, proxyEnvironment: prepared.proxyEnvironment, commandCodeChatTransport: evidence });
    }, merged);
  } catch (error) { fault = { error }; }
  finally { clearTimeout(timer); }
  if (!fault) {
    try {
      if (response.redirected || response.url && response.url !== prepared.url) throw new Error('Unexpected CommandCode response destination');
      if (!response.ok) text = await readAccountingText(response, signal);
      else {
        if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/x-ndjson') throw new Error('Unsupported raw CommandCode NDJSON response');
        selected = await routeAccountingCommandCodeResponse(response, signal);
      }
    } catch (error) { fault = { error }; }
  }
  const result = reply => ({ response: reply, url: prepared.url, headers: prepared.headers, transformedBody: capture.actual, accountingOwned: true });
  if (selected?.kind === 'initial-error') {
    // Completion/persistence errors MUST escape this call, never enter a parse
    // catch that attempts another terminal mutation or rewrites its winner.
    const receipt = await observeCommandCodeInitialFailure(selected.response, { accounting, attempt, signal });
    return { ...result(new Response(null, { status: receipt.statusCode, headers: { 'Cache-Control': 'no-store' } })), commandCodeInitialFailure: receipt };
  }
  if (selected?.kind === 'success') {
    const body = createAccountedOpenaiStream(selected.response, { accounting, attempt, signal, parserFactory: createAccountingCommandCodeNdjsonParser });
    let reply;
    try { reply = new Response(body, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' } }); }
    catch (error) { await body.cancel(error); throw error; }
    return { ...result(reply), accountingLive: true };
  }
  if (response?.body && !response.bodyUsed && !response.body.locked) {
    try { Promise.resolve(response.body.cancel(fault?.error)).catch(() => {}); } catch { /* unhanded cleanup */ }
  }
  await accounting.completeAttempt(attempt, { usage: null, outcome: signal?.aborted ? 'aborted' : fault ? 'network_unknown' : 'failed', ...(!invoked ? { notDispatched: true } : {}) });
  signal?.throwIfAborted(); accounting.gate();
  if (fault) throw fault.error;
  return result(new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers }));
  } });
}
