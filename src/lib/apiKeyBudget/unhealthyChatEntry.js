import { isDeepStrictEqual } from 'node:util';
import { getAdapter } from '../db/driver.js';
import { mergeWithDefaults } from '../db/repos/settingsRepo.js';
import { extractGatewayCredential } from './identity.js';
import { createRequestAccounting } from './requestAccounting.js';
import { ApiKeyBudgetError } from './errors.js';
import { BUDGET_ERROR } from '../../../open-sse/config/apiKeyBudgetConstants.js';
import { supportsResponsesRequest, ACCOUNTED_RESPONSES_URL } from '../../../open-sse/config/accountedResponsesCandidate.js';
import { supportsUnhealthyChatRequest } from '../../../open-sse/config/accountedChatProviders.js';
import { captureUnhealthyChatDispatch } from '../../../open-sse/config/accountedUnhealthyChatDispatch.js';
import { captureUnhealthyEmbeddingsDispatch } from '../../../open-sse/config/accountedUnhealthyEmbeddingsDispatch.js';
import { captureAccountingEmbeddingsConfig, validateAccountingEmbeddingsDispatch } from '../../../open-sse/config/accountedEmbeddingsDispatch.js';
import { ACCOUNTED_EMBEDDINGS_URL } from '../../../open-sse/config/accountedEmbeddingsCandidate.js';
import { PROVIDERS } from '../../../open-sse/config/providers.js';
import { FORMATS } from '../../../open-sse/translator/formats.js';
import { validatePersistedGlobalProxy, validatePersistedPoolProxy, resolvePersistedPoolProxy } from '../../../open-sse/config/accountedProxyAuthority.js';
import { snapshotAccountingPreparedData } from '../../../open-sse/config/accountedBaseDispatch.js';

// Narrow entry only. This does not activate accounting, resolve aliases/combos,
// read normal repos after poison, heal a writer, refresh OAuth, or rotate accounts.
// Actual core/POST owner must still validate original/wire/transport/terminal.
export function handleUnhealthyChatEntry(request, body, invokeCore, log) {
  return handleUnhealthyEntry(request, body, invokeCore, log, false);
}
export function handleUnhealthyEmbeddingsEntry(request, body, invokeCore, log) {
  return handleUnhealthyEntry(request, body, invokeCore, log, true);
}
async function handleUnhealthyEntry(request, body, invokeCore, log, embeddings) {
  const caller = new Request(request.url, { headers: new Headers(request.headers), signal: request.signal });
  const credential = extractGatewayCredential(caller);
  let db;
  const fail = code => { throw new ApiKeyBudgetError(code); };
  try { db = await getAdapter(); } catch { fail(BUDGET_ERROR.UNAVAILABLE); }
  if (db.health().healthy) return null; // Never catch a healthy read into exception.
  if (request.signal?.aborted) throw request.signal.reason;
  // Descriptor-safe bounded detachment before any original-body getters,
  // coercion or clone. This grants no schema/selection/dispatch permission.
  let original;
  try { original = snapshotAccountingPreparedData(body); }
  catch { fail(BUDGET_ERROR.UNAVAILABLE); }
  let pathname;
  try { pathname = new URL(request.url).pathname; } catch { fail(BUDGET_ERROR.UNAVAILABLE); }
  const chat = ['/v1/chat/completions', '/api/v1/chat/completions'].includes(pathname);
  const supportedPath = embeddings ? ['/v1/embeddings', '/api/v1/embeddings'].includes(pathname)
    : chat || ['/v1/responses', '/api/v1/responses'].includes(pathname);
  if (!supportedPath ||
      typeof original.model !== 'string' || !original.model.startsWith('openai/') || !original.model.slice(7)) fail(BUDGET_ERROR.UNSUPPORTED);
  const model = original.model.slice(7), provider = 'openai';
  const wireBody = { ...original, model };
  if (embeddings) {
    try {
      validateAccountingEmbeddingsDispatch({ model, mediaConfig: captureAccountingEmbeddingsConfig(), originalSerializedBody: JSON.stringify(wireBody),
        serializedBody: JSON.stringify({ ...wireBody, encoding_format: wireBody.encoding_format ?? 'float' }) }, ACCOUNTED_EMBEDDINGS_URL);
    } catch { fail(BUDGET_ERROR.UNSUPPORTED); }
  } else if (!(chat ? supportsUnhealthyChatRequest(wireBody, model) : supportsResponsesRequest(wireBody, model))) fail(BUDGET_ERROR.UNSUPPORTED);
  function prove() {
    try {
      const health = db.health();
      if (health.healthy || !health.poisoned || health.closed || typeof db.provePersistedSelection !== 'function') fail(BUDGET_ERROR.UNAVAILABLE);
      return db.provePersistedSelection({ credential, provider, model, excludeConnectionIds: [] }, db.coverage);
    } catch { fail(BUDGET_ERROR.UNAVAILABLE); }
  }
  const pinned = prove();
  const connection = pinned.connection;
  const settings = mergeWithDefaults(structuredClone(pinned.settings));
  const specific = connection.providerSpecificData || {};
  // Resolve saved global policy from this independently durable snapshot only.
  // Fresh settings equality at every gate/attempt/terminal retains its authority.
  // No process-global env writes or reads substitute for the saved policy.
  let persistedGlobalProxy = chat || embeddings ? null : undefined;
  if (settings.outboundProxyEnabled) {
    try { persistedGlobalProxy = validatePersistedGlobalProxy({ url: settings.outboundProxyUrl, noProxy: settings.outboundNoProxy }); }
    catch { fail(BUDGET_ERROR.UNSUPPORTED); }
  }
  // Only an active independently proved HTTP(S) pool may become transport. Its
  // full saved evidence is equality-pinned above, not obtained via normal repos.
  let persistedPoolProxy;
  if (pinned.proxyPool) {
    const pool = pinned.proxyPool;
    try { persistedPoolProxy = validatePersistedPoolProxy({ id: pool.id, url: pool.proxyUrl,
      noProxy: pool.noProxy ?? '', strictProxy: pool.strictProxy ?? false,
      type: pool.type ?? 'http', isActive: pool.isActive }); }
    catch { fail(BUDGET_ERROR.UNSUPPORTED); }
  }
  // Required pool cannot disappear into legacy/global/direct fallback.
  const poolId = specific.proxyPoolId?.trim();
  if (poolId && poolId !== '__none__' && persistedPoolProxy?.id !== poolId) fail(BUDGET_ERROR.UNAVAILABLE);
  if (persistedPoolProxy) {
    try { resolvePersistedPoolProxy(embeddings ? ACCOUNTED_EMBEDDINGS_URL : chat ? PROVIDERS.openai.baseUrl : ACCOUNTED_RESPONSES_URL, persistedPoolProxy, persistedGlobalProxy || undefined); }
    catch { fail(BUDGET_ERROR.UNSUPPORTED); }
  }
  if (connection.authType !== 'apikey' || typeof connection.apiKey !== 'string' || !connection.apiKey ||
      connection.accessToken || connection.runtimeTransport ||
      specific.vercelRelayUrl ||
      specific.connectionProxyPoolId ||
      settings.headroomEnabled || settings.pxpipeEnabled ||
      settings.cavemanEnabled || settings.ponytailEnabled ||
      (settings.providerThinking?.[provider]?.mode && settings.providerThinking[provider].mode !== 'auto')) fail(BUDGET_ERROR.UNSUPPORTED);
  const context = await createRequestAccounting(caller, { adapter: async () => db,
    persistedTarget: { provider, model, connectionId: connection.id }, persistedSelection: true });
  if (!context) fail(BUDGET_ERROR.UNAVAILABLE);
  function gate() {
    if (request.signal?.aborted) throw request.signal.reason;
    const fresh = prove();
    for (const key of ['apiKeyId', 'policyVersion', 'coverageId', 'ledgerStartedAt', 'provider', 'model', 'settings', 'connection', 'proxyPool']) {
      if (!isDeepStrictEqual(fresh[key], pinned[key])) fail(BUDGET_ERROR.UNAVAILABLE);
    }
    return context.gate();
  }
  // One service context and terminal sink; wrapper adds selection authority only.
  const accounting = Object.freeze({ ...context, gate, ...(embeddings ? { requiresUnhealthyEmbeddingsWire: true } : chat ? { requiresUnhealthyChatWire: true } : {}),
    assertSupported(supported) { gate(); context.assertSupported(supported); },
    beforeAttempt(meta, supported) { gate(); return context.beforeAttempt(meta, supported); },
    assertSuccessfulTerminal(terminal) { gate(); return context.assertSuccessfulTerminal(terminal); },
  });
  gate();
  const credentials = {
    authType: connection.authType, apiKey: connection.apiKey, connectionId: connection.id,
    connectionName: connection.displayName || connection.name || connection.email || connection.id,
    providerSpecificData: { ...structuredClone(specific),
      connectionProxyEnabled: specific.connectionProxyEnabled === true,
      connectionProxyUrl: specific.connectionProxyUrl == null ? '' : String(specific.connectionProxyUrl).trim(),
      connectionNoProxy: specific.connectionNoProxy == null ? '' : String(specific.connectionNoProxy).trim(),
      connectionProxyPoolId: null, vercelRelayUrl: '' },
  };
  let selectedProxyOptions;
  if (chat || embeddings) {
    // Validate the complete independently proved credential/settings envelope
    // before invoking core or admission. Do not erase unsupported PSD semantics.
    const selectedCredentials = { ...credentials, providerSpecificData: structuredClone(specific) };
    const pool = persistedPoolProxy;
    const proxyOptions = { connectionProxyEnabled: !!pool, connectionProxyUrl: pool ? pool.url : '',
      connectionNoProxy: pool ? pool.noProxy : '', strictProxy: pool ? pool.strictProxy : false,
      proxyPoolUnavailable: false, proxyPoolId: pool ? pool.id : null, vercelRelayUrl: '',
      persistedGlobalProxy, ...(pool ? { persistedPoolProxy: pool } : {}) };
    try {
      if (embeddings) {
        if (settings.providerOverrides?.[provider] != null) fail(BUDGET_ERROR.UNSUPPORTED);
        const actual = { ...wireBody, encoding_format: wireBody.encoding_format ?? 'float' };
        captureUnhealthyEmbeddingsDispatch({ model, body: wireBody, actual, mediaConfig: captureAccountingEmbeddingsConfig(),
          credentials: selectedCredentials, proxyOptions, url: ACCOUNTED_EMBEDDINGS_URL,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${connection.apiKey}` }, serialized: JSON.stringify(actual) });
      } else captureUnhealthyChatDispatch({ provider, model, body: wireBody, config: PROVIDERS.openai,
        credentials: selectedCredentials, proxyOptions, providerOverrides: settings.providerOverrides?.[provider] ?? null,
        url: PROVIDERS.openai.baseUrl, headers: { 'Content-Type': 'application/json', ...PROVIDERS.openai.headers,
          Authorization: `Bearer ${connection.apiKey}` }, serialized: JSON.stringify(wireBody) });
    } catch { fail(BUDGET_ERROR.UNSUPPORTED); }
    credentials.providerSpecificData = selectedCredentials.providerSpecificData;
    selectedProxyOptions = proxyOptions;
  }
  const raw = { endpoint: pathname, body: original, headers: Object.fromEntries(caller.headers.entries()) };
  const result = await invokeCore({ body: { ...original, model: `${provider}/${model}` }, modelInfo: { provider, model },
    credentials, connectionId: connection.id, accounting, signal: request.signal, log,
    clientRawRequest: raw, userAgent: caller.headers.get('user-agent') || '', apiKey: credential,
    ...(embeddings ? { proxyOptions: selectedProxyOptions } : {}),
    persistedGlobalProxy, persistedPoolProxy, sourceFormatOverride: chat ? FORMATS.OPENAI : FORMATS.OPENAI_RESPONSES, ccFilterNaming: !!settings.ccFilterNaming,
    rtkEnabled: !!settings.rtkEnabled, headroomEnabled: !!settings.headroomEnabled,
    cavemanEnabled: !!settings.cavemanEnabled, ponytailEnabled: !!settings.ponytailEnabled,
    pxpipeEnabled: !!settings.pxpipeEnabled, providerThinking: settings.providerThinking?.[provider] || null,
    providerOverrides: settings.providerOverrides?.[provider] || null,
  });
  // Without durable account-lock/refresh updates, a failed predecessor grants no
  // successor selection. No normal control-plane callback touches poisoned RAM.
  return result.response;
}
