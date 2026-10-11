import { randomUUID } from 'node:crypto';
import { types } from 'node:util';
import { proxyAwareFetch } from '../utils/proxyFetch.js';
import { snapshotAccountingPreparedData } from '../config/accountedBaseDispatch.js';
import { captureAccountingAbortSignal } from '../config/accountedAbortSignal.js';
import { captureAccountingProxyEnvironment } from '../config/accountedProxyEnvironment.js';
import { supportsKiroOriginal } from '../config/accountedKiroCandidate.js';
import { captureAccountingKiroConfig, validateAccountingKiroPost, kiroAccountingToken,
  ACCOUNTED_KIRO_MODE, ACCOUNTED_KIRO_URL, ACCOUNTED_KIRO_FIXED_HEADERS } from '../config/accountedKiroDispatch.js';
import { ACCOUNTED_KIRO_ELLIPSIS_INSTRUCTION, captureKiroEllipsisRepairConversion } from '../config/accountedKiroRepairConversion.js';
import { validateAccountingKiroRepairOptions } from '../config/accountedKiroRepairDispatch.js';
import { ACCOUNTED_KIRO_ELLIPSIS_MODE, ACCOUNTED_KIRO_ELLIPSIS_GENERATIONS, ACCOUNTED_KIRO_ELLIPSIS_EXHAUSTED } from '../config/accountedKiroEllipsisRepair.js';
import { observeAccountingKiroRepairGeneration } from '../utils/accountedKiroRepairGeneration.js';
import { readAccountingText } from '../utils/readAccountingJson.js';
import { FETCH_CONNECT_TIMEOUT_MS } from '../config/runtimeConfig.js';

const unavailable = () => { throw new Error('Accounting Kiro ellipsis owner unavailable'); };
function descriptors(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value)) unavailable();
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).some(key => typeof key !== 'string' || !Object.hasOwn(fields[key], 'value') || !fields[key].enumerable)) unavailable();
  return fields;
}
function fetchOnce(invoke, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; signal.removeEventListener('abort', abort); fn(value); };
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

// Narrow standalone/internal request-local owner; no app routing activation.
// Retain original once, never refresh/rebuild/reselect it for a successor.
export async function executeAccountedKiroEllipsisRepairCandidate(executor, options) {
  const fields = descriptors(options), owner = descriptors(executor);
  if (![Object.prototype, null].includes(Object.getPrototypeOf(options))) unavailable();
  const allowed = ['model', 'body', 'stream', 'credentials', 'connectionId', 'providerOverrides', 'proxyOptions', 'accounting', 'signal', 'accountingMode'];
  if (Object.keys(fields).some(key => !allowed.includes(key)) ||
      fields.accountingMode && fields.accountingMode.value !== ACCOUNTED_KIRO_ELLIPSIS_MODE) unavailable();
  const input = snapshotAccountingPreparedData({ model: fields.model?.value, body: fields.body?.value, stream: fields.stream?.value,
    credentials: fields.credentials?.value, connectionId: fields.connectionId?.value, providerOverrides: fields.providerOverrides?.value ?? null,
    proxyOptions: fields.proxyOptions?.value ?? null, config: owner.config?.value, provider: owner.provider?.value });
  const signal = captureAccountingAbortSignal(fields.signal?.value), accounting = fields.accounting?.value;
  if (!accounting?.requiresPreparedBaseWire || input.provider !== 'kiro' || input.stream !== true) unavailable();
  accounting.assertSupported(true);
  const credentials = input.credentials, config = captureAccountingKiroConfig(input.config), environment = captureAccountingProxyEnvironment();
  if (!supportsKiroOriginal(input.body, input.model) || !credentials || typeof credentials !== 'object' || Array.isArray(credentials) ||
      Object.keys(credentials).some(key => !['apiKey', 'accessToken', 'connectionId', 'providerSpecificData'].includes(key)) ||
      credentials.connectionId !== input.connectionId || !kiroAccountingToken(credentials.accessToken) ||
      credentials.apiKey != null && credentials.apiKey !== credentials.accessToken ||
      credentials.providerSpecificData?.authMethod !== 'api_key' || credentials.providerSpecificData.region !== 'us-east-1' ||
      (input.body.profileArn ?? null) !== (credentials.providerSpecificData.profileArn ?? null) || input.proxyOptions?.vercelRelayUrl) unavailable();
  let repair = null;
  for (let index = 0; index < ACCOUNTED_KIRO_ELLIPSIS_GENERATIONS; index++) {
    signal?.throwIfAborted();
    if (index) {
      accounting.gate();
      const actual = structuredClone(input.body);
      actual.conversationState.currentMessage.userInputMessage.content += '\n\n' + ACCOUNTED_KIRO_ELLIPSIS_INSTRUCTION;
      repair = captureKiroEllipsisRepairConversion({ model: input.model, original: input.body, actual });
    }
    const body = repair ? repair.actual : input.body, invocationId = randomUUID(), headers = new Headers(config.headers);
    for (const [key, value] of Object.entries(ACCOUNTED_KIRO_FIXED_HEADERS)) headers.set(key, value);
    headers.set('authorization', `Bearer ${credentials.apiKey ?? credentials.accessToken}`);
    headers.set('x-amz-sso-bearer', credentials.accessToken); headers.set('amz-sdk-invocation-id', invocationId);
    if (Object.hasOwn(body, 'profileArn')) headers.set('x-amzn-codewhisperer-profile-arn', body.profileArn);
    for (const [key, value] of Object.entries(input.providerOverrides?.headers || {})) headers.set(key, value);
    const transport = { model: input.model, mode: ACCOUNTED_KIRO_MODE, kiroConfig: config, invocationId, serializedBody: JSON.stringify(body) };
    validateAccountingKiroPost(transport, ACCOUNTED_KIRO_URL, { method: 'POST', redirect: 'error', body: transport.serializedBody, headers });
    const prepared = snapshotAccountingPreparedData({ protocol: 'native-kiro', url: ACCOUNTED_KIRO_URL, headers: Object.fromEntries(headers),
      credentials: { apiKey: credentials.apiKey ?? null, accessToken: credentials.accessToken, connectionId: input.connectionId, providerSpecificData: credentials.providerSpecificData },
      providerOverrides: input.providerOverrides, proxyOptions: input.proxyOptions, proxyEnvironment: environment, kiroTransport: transport,
      ...(repair ? { kiroRepairCapture: repair } : {}) });
    const post = { method: 'POST', redirect: 'error', body: prepared.kiroTransport.serializedBody, headers: prepared.headers };
    if (repair) validateAccountingKiroRepairOptions(prepared, prepared.url, post, prepared.proxyOptions);
    signal?.throwIfAborted();
    const attempt = await accounting.beforeAttempt({ provider: input.provider, model: input.model, endpoint: 'chat', connectionId: input.connectionId }, true, prepared);
    if (!attempt || attempt.unrecorded) { accounting.gate(); unavailable(); }
    if (signal?.aborted) { await accounting.completeAttempt(attempt, { notDispatched: true, outcome: 'aborted' }); signal.throwIfAborted(); }
    const control = new AbortController(), merged = signal ? AbortSignal.any([signal, control.signal]) : control.signal;
    const timer = setTimeout(() => control.abort(new Error('Chat connection deadline exceeded')), config.timeoutMs || FETCH_CONNECT_TIMEOUT_MS);
    let response, fault = null, invoked = false, text = null;
    try {
      response = await fetchOnce(() => {
        invoked = true;
        return proxyAwareFetch(prepared.url, { ...post, signal: merged }, prepared.proxyOptions,
          { singlePost: true, proxyEnvironment: environment, ...(repair ? { kiroRepairTransport: prepared } : { kiroTransport: prepared.kiroTransport }) });
      }, merged);
    } catch (error) { fault = { error }; }
    finally { clearTimeout(timer); }
    if (!fault) {
      try {
        if (response.redirected || response.url && response.url !== prepared.url) throw new Error('Unexpected Kiro response destination');
        if (response.ok) {
          if (!response.body || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== ACCOUNTED_KIRO_FIXED_HEADERS.accept) throw new Error('Unsupported raw Kiro EventStream response');
        } else text = await readAccountingText(response, signal);
      } catch (error) { fault = { error }; }
    }
    if (fault || !response.ok) {
      if (response?.body && !response.bodyUsed && !response.body.locked) { try { Promise.resolve(response.body.cancel(fault?.error)).catch(() => {}); } catch { /* cleanup only */ } }
      await accounting.completeAttempt(attempt, { usage: null, outcome: signal?.aborted ? 'aborted' : fault ? 'network_unknown' : 'failed', ...(!invoked ? { notDispatched: true } : {}) });
      signal?.throwIfAborted(); accounting.gate();
      if (fault) throw fault.error;
      return { response: new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers }),
        url: prepared.url, headers: prepared.headers, transformedBody: body, accountingOwned: true };
    }
    // Raw completion/ACK/auth failures are outside transport/parser catches.
    // They cannot cause another completion or authorize a successor.
    const result = await observeAccountingKiroRepairGeneration(response, { accounting, attempt, signal });
    if (result.repairKind) {
      if (index + 1 === ACCOUNTED_KIRO_ELLIPSIS_GENERATIONS) throw new Error(ACCOUNTED_KIRO_ELLIPSIS_EXHAUSTED);
      continue;
    }
    return { response: new Response(result.bytes, { headers: { 'Content-Type': ACCOUNTED_KIRO_FIXED_HEADERS.accept, 'Cache-Control': 'no-store' } }),
      url: prepared.url, headers: prepared.headers, transformedBody: body, accountingOwned: true };
  }
  unavailable();
}
