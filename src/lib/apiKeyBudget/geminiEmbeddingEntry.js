import { getAdapter } from '../db/driver.js';
import { extractGatewayCredential } from './identity.js';
import { createRequestAccounting } from './requestAccounting.js';
import { bindGeminiEmbeddingAccounting } from './geminiEmbeddingAccounting.js';
import { resolveGeminiEmbeddingSelectionSync } from './geminiEmbeddingSelection.js';
import { ApiKeyBudgetError, isApiKeyBudgetError } from './errors.js';
import { BUDGET_ERROR } from '../../../open-sse/config/apiKeyBudgetConstants.js';
import { snapshotAccountingPreparedData } from '../../../open-sse/config/accountedBaseDispatch.js';
import { captureGeminiEmbeddingDispatch } from '../../../open-sse/config/accountedGeminiEmbeddingDispatch.js';
import { validatePersistedGlobalProxy } from '../../../open-sse/config/accountedProxyAuthority.js';
import { PROVIDER_MEDIA } from '../../../open-sse/providers/index.js';
import adapterGemini from '../../../open-sse/handlers/embeddingProviders/gemini.js';

// INTERNAL prerequisite only; public route does not call this helper yet.
// Canonical Gemini prefix, healthy synchronous accounting, fill-first API-key,
// saved-enabled global proxy with no pool/legacy override. No refresh/fallback,
// default activation, alias rewriting or saved-disabled policy expansion.
export async function handleHealthyGeminiEmbeddingEntry(request, body, invokeCore, { adapter = getAdapter } = {}) {
  const fail = code => { throw new ApiKeyBudgetError(code); };
  let original, caller, credential, db, context;
  try {
    original = snapshotAccountingPreparedData(body);
    if (typeof original.model !== 'string' || !original.model.startsWith('gemini/')) return null;
    caller = new Request(request.url, { headers: new Headers(request.headers), signal: request.signal });
    credential = extractGatewayCredential(caller);
    db = await adapter();
    if (!db.health().healthy) fail(BUDGET_ERROR.UNAVAILABLE);
    context = await createRequestAccounting(caller, { adapter: async () => db });
  } catch (error) {
    if (request.signal?.aborted) throw request.signal.reason;
    throw isApiKeyBudgetError(error) ? error : new ApiKeyBudgetError(BUDGET_ERROR.UNAVAILABLE);
  }
  if (!context) return null; // Authoritative OFF/exemption, never failure fallback.
  request.signal?.throwIfAborted();
  let prepared;
  try {
    if (!['/v1/embeddings', '/api/v1/embeddings'].includes(new URL(caller.url).pathname)) fail(BUDGET_ERROR.UNSUPPORTED);
    const model = original.model.slice('gemini/'.length);
    const selection = resolveGeminiEmbeddingSelectionSync(db, model);
    const connection = selection.selected, settings = selection.settings;
    if (connection.authType !== 'apikey' || settings.outboundProxyEnabled !== true) fail(BUDGET_ERROR.UNSUPPORTED);
    const specific = connection.providerSpecificData ?? {};
    if (specific.proxyPoolId && specific.proxyPoolId !== '__none__' || specific.connectionProxyEnabled === true ||
        specific.connectionProxyUrl || specific.connectionNoProxy || specific.vercelRelayUrl) fail(BUDGET_ERROR.UNSUPPORTED);
    const credentials = snapshotAccountingPreparedData({ apiKey: connection.apiKey,
      providerSpecificData: specific });
    const proxyOptions = { persistedGlobalProxy: validatePersistedGlobalProxy({ url: settings.outboundProxyUrl,
      noProxy: settings.outboundNoProxy ?? '' }) };
    // Complete original fields retained. Only the canonical provider prefix is
    // removed for the independently validated Gemini conversion/wire image.
    const wireOriginal = { ...original, model };
    const actual = adapterGemini.buildBody(model, wireOriginal);
    const image = captureGeminiEmbeddingDispatch({ model, original: wireOriginal, actual, credentials,
      mediaConfig: PROVIDER_MEDIA.gemini.embeddingConfig, headers: adapterGemini.buildHeaders(credentials),
      url: adapterGemini.buildUrl(model, credentials, { input: wireOriginal.input }), serialized: JSON.stringify(actual), proxyOptions });
    prepared = { model, credentials, proxyOptions, connectionId: connection.id,
      accounting: bindGeminiEmbeddingAccounting({ db, credential, accounting: context, connectionId: connection.id, image }) };
  } catch (error) {
    if (request.signal?.aborted) throw request.signal.reason;
    throw isApiKeyBudgetError(error) ? error : new ApiKeyBudgetError(BUDGET_ERROR.UNAVAILABLE);
  }
  request.signal?.throwIfAborted();
  // No catch around actual core/completion delivery: own ACK failures must
  // escape without retries, replacement terminal sinks or native error logs.
  const result = await invokeCore({ body: original, modelInfo: { provider: 'gemini', model: prepared.model },
    credentials: prepared.credentials, proxyOptions: prepared.proxyOptions, connectionId: prepared.connectionId,
    accounting: prepared.accounting, signal: request.signal });
  return result.response;
}
