import { randomUUID } from 'node:crypto';
import { proxyAwareFetch } from '../utils/proxyFetch.js';
import { snapshotAccountingPreparedData } from '../config/accountedBaseDispatch.js';
import { captureAccountingKiroConfig, validateAccountingKiroPost, ACCOUNTED_KIRO_MODE, ACCOUNTED_KIRO_URL, ACCOUNTED_KIRO_FIXED_HEADERS, kiroAccountingToken } from '../config/accountedKiroDispatch.js';
import { captureAccountingProxyEnvironment } from '../config/accountedProxyEnvironment.js';
import { supportsKiroOriginal } from '../config/accountedKiroCandidate.js';
import { createAccountingKiroEventStreamParser } from '../utils/accountingKiroEventStreamParser.js';
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
// Internal explicit caller-native, queued-only single generation. It does not
// enter Base fallback, translation or legacy integrity regeneration. This is
// not certification of the legacy retry family; its implementation is unchanged.
export async function executeAccountedKiroCandidate(executor, options) {
  const { accounting, signal } = options;
  accounting.assertSupported(accounting.requiresPreparedBaseWire && options.accountingMode === ACCOUNTED_KIRO_MODE && executor.provider === 'kiro' && options.stream === true);
  const original = snapshotAccountingPreparedData({ model: options.model, connectionId: options.connectionId,
    body: options.body, credentials: options.credentials, proxyOptions: options.proxyOptions ?? null, providerOverrides: options.providerOverrides ?? null });
  const { model, connectionId, credentials } = original, config = captureAccountingKiroConfig(executor.config);
  accounting.assertSupported(supportsKiroOriginal(original.body, model) && credentials &&
    Object.keys(credentials).every(key => ['apiKey', 'accessToken', 'connectionId', 'providerSpecificData'].includes(key)) &&
    credentials.providerSpecificData?.authMethod === 'api_key' && credentials.providerSpecificData.region === 'us-east-1' &&
    kiroAccountingToken(credentials.accessToken) && (credentials.apiKey == null || credentials.apiKey === credentials.accessToken) &&
    credentials.connectionId === connectionId && !original.proxyOptions?.vercelRelayUrl &&
    (original.body.profileArn ?? null) === (credentials.providerSpecificData.profileArn ?? null));
  const invocationId = randomUUID(), serializedBody = JSON.stringify(original.body), headers = new Headers(config.headers);
  for (const [name, value] of Object.entries(ACCOUNTED_KIRO_FIXED_HEADERS)) headers.set(name, value);
  headers.set('authorization', `Bearer ${credentials.apiKey ?? credentials.accessToken}`);
  headers.set('x-amz-sso-bearer', credentials.accessToken); headers.set('amz-sdk-invocation-id', invocationId);
  if (Object.hasOwn(original.body, 'profileArn')) headers.set('x-amzn-codewhisperer-profile-arn', original.body.profileArn);
  if (original.providerOverrides?.headers !== undefined) {
    const overrides = original.providerOverrides.headers, seen = new Set();
    accounting.assertSupported(overrides && typeof overrides === 'object' && !Array.isArray(overrides));
    for (const [name, value] of Object.entries(overrides)) {
      accounting.assertSupported(typeof value === 'string' && !seen.has(name.toLowerCase()));
      seen.add(name.toLowerCase()); headers.set(name, value);
    }
  }
  const transport = { model, mode: ACCOUNTED_KIRO_MODE, kiroConfig: config, invocationId, serializedBody };
  validateAccountingKiroPost(transport, ACCOUNTED_KIRO_URL, { method: 'POST', redirect: 'error', body: serializedBody, headers });
  const prepared = snapshotAccountingPreparedData({ protocol: 'native-kiro', url: ACCOUNTED_KIRO_URL, headers: Object.fromEntries(headers),
    credentials: { apiKey: credentials.apiKey ?? null, accessToken: credentials.accessToken, connectionId, providerSpecificData: credentials.providerSpecificData },
    providerOverrides: original.providerOverrides, proxyOptions: original.proxyOptions, proxyEnvironment: captureAccountingProxyEnvironment(), kiroTransport: transport });
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
      return proxyAwareFetch(prepared.url, { method: 'POST', redirect: 'error', headers: prepared.headers, body: prepared.kiroTransport.serializedBody, signal: merged }, prepared.proxyOptions,
        { singlePost: true, proxyEnvironment: prepared.proxyEnvironment, kiroTransport: prepared.kiroTransport });
    }, merged);
  } catch (error) { transportError = error; }
  finally { clearTimeout(timer); }
  let text = null, ownedBody = null;
  if (!transportError) {
    try {
      if (response.redirected || response.url && response.url !== prepared.url) throw new Error('Unexpected Kiro response destination');
      if (response.ok) {
        if (!response.body || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== ACCOUNTED_KIRO_FIXED_HEADERS.accept) throw new Error('Unsupported raw Kiro EventStream response');
        ownedBody = createAccountedOpenaiStream(response, { accounting, attempt, signal, provider: 'kiro', parserFactory: createAccountingKiroEventStreamParser });
      } else text = await readAccountingText(response, signal);
    } catch (error) { transportError = error; }
  }
  if (ownedBody) {
    let replay;
    try { replay = new Response(ownedBody, { headers: { 'Content-Type': ACCOUNTED_KIRO_FIXED_HEADERS.accept, 'Cache-Control': 'no-store' } }); }
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
