import { randomUUID } from 'node:crypto';
import { prepareAccountedDirectPost } from '../../../open-sse/utils/proxyFetch.js';
import { ANTHROPIC_API_VERSION } from '../../../open-sse/providers/shared.js';
import { snapshotPayload, canonical, unavailable } from './attempt-payload.js';
import { budgetInstant } from './budget-windows.js';
import { ANTHROPIC_REFERENCE_MODEL, isAnthropicReferenceGeo } from './anthropic-reference-price.js';
import { anthropicJsonUsage, createAnthropicUsageAccumulator } from './anthropic-usage.js';
import { ACCOUNTED_ANTHROPIC_URL, credentialDigest, directAccountData, isSingleWorkspaceBinding } from './node-anthropic-account.js';

// Internal candidate, disabled by default. Does NOT bypass existing routing or
// own a second response reader. Profile readiness must come from executable
// coverage, never request JSON or a client header. C0 remains unadmitted.
const WIRE_HEADERS = ['anthropic-version', 'content-type', 'x-api-key'];
export function createAnthropicDispatchContext({ identity, routeProof, credentials, profile, clock, stream = false }) {
  const config = snapshotPayload(profile);
  if (config?.enabled !== true || config?.producerAdmitted !== true ||
      config.provider !== 'anthropic' || config.auth !== 'api-key' ||
      config.model !== ANTHROPIC_REFERENCE_MODEL || !isAnthropicReferenceGeo(config.inferenceGeo) ||
      config.serviceTier !== 'standard_only' ||
      Object.keys(config).sort().join(',') !== 'auth,enabled,inferenceGeo,model,producerAdmitted,provider,serviceTier,workspaceBinding' ||
      typeof stream !== 'boolean' ||
      !routeProof || typeof identity?.prepare !== 'function' || typeof identity?.dispatch !== 'function') throw unavailable();
  const { connectionId, apiKey, authType, providerSpecificData, accessToken, refreshToken } = credentials ?? {};
  if (!connectionId || typeof apiKey !== 'string' || !apiKey || authType !== 'apikey' || accessToken || refreshToken ||
      !directAccountData(providerSpecificData) || typeof identity.bindAnthropicAccount !== 'function') throw unavailable();
  // Only a trusted profile may attest provider scope for this exact key.
  // Never infer it from key format, account fields, or a request header.
  const binding = config.workspaceBinding;
  if (!isSingleWorkspaceBinding(binding) || binding.connectionId !== connectionId ||
      binding.keyDigest !== credentialDigest(apiKey)) throw unavailable();
  let acceptedBody = null;
  let preparationStarted = false;
  const validateShape = body => {
    const request = snapshotPayload(body);
    const allowed = ['model','messages','system','max_tokens','temperature','top_p','top_k','stop_sequences','stream','inference_geo','service_tier'];
    if (!request || ![config.model, `${config.provider}/${config.model}`].includes(request.model) || request.stream !== stream ||
        request.inference_geo !== config.inferenceGeo || request.service_tier !== config.serviceTier ||
        Object.keys(request).some(key => !allowed.includes(key)) ||
        !Array.isArray(request.messages) || !request.messages.length) throw unavailable();
    for (const message of request.messages) {
      if (!message || !['user','assistant'].includes(message.role) || typeof message.content !== 'string' ||
          Object.keys(message).sort().join(',') !== 'content,role') throw unavailable();
    }
    if (request.system !== undefined && typeof request.system !== 'string') throw unavailable();
    // Only this enumerated top-level model spelling is equivalent. Preserve
    // all other presence/values and nested/array ordering without defaults.
    return canonical({ ...request, model: config.model });
  };
  return Object.freeze({
    stream,
    validateInput(body) {
      if (acceptedBody !== null || preparationStarted) throw unavailable();
      acceptedBody = validateShape(body); // detached pre-helper immutable JSON
    },
    buildHeaders({ provider, url, model, stream: wireStream, credentials: effective }) {
      // The ordinary executor merges a client beta header. This contract does
      // not support that request; refuse instead of silently dropping it.
      const rawHeaders = new Headers(effective?.rawHeaders);
      if (provider !== config.provider || url !== ACCOUNTED_ANTHROPIC_URL || model !== config.model || wireStream !== stream ||
          effective?.connectionId !== connectionId || effective.apiKey !== apiKey || effective.authType !== 'apikey' ||
          effective.accessToken || effective.refreshToken || rawHeaders.has('anthropic-beta') ||
          rawHeaders.has('anthropic-workspace-id')) throw unavailable();
      return { 'anthropic-version': ANTHROPIC_API_VERSION, 'content-type': 'application/json', 'x-api-key': apiKey };
    },
    async prepare({ url, options, proxyOptions, provider, model, stream: wireStream }) {
      if (preparationStarted) throw unavailable();
      preparationStarted = true; // no rebind/reuse after refusal or failed prep
      if (acceptedBody === null || provider !== config.provider || model !== config.model || url !== ACCOUNTED_ANTHROPIC_URL) throw unavailable();
      const encodedBody = options.body;
      const body = JSON.parse(encodedBody);
      if (validateShape(body) !== acceptedBody) throw unavailable();
      const headers = new Headers(options.headers);
      if (headers.get('anthropic-version') !== ANTHROPIC_API_VERSION || headers.get('x-api-key') !== apiKey ||
          headers.get('content-type') !== 'application/json' || [...headers.keys()].some(name => !WIRE_HEADERS.includes(name)) ||
          body.model !== model || body.inference_geo !== config.inferenceGeo ||
          body.stream !== wireStream || !Array.isArray(body.messages)) throw unavailable();
      // validateInput also runs BEFORE core helpers/transforms. Recheck final
      // wire here; no silently stripped tools/media/premium or geography.
      // Transport snapshots method, headers, body and proxy prohibitions
      // before its first await. The selected account is rechecked at COMMIT.
      const initiate = await prepareAccountedDirectPost(url, { ...options, body: encodedBody, headers }, proxyOptions);
      const { proof: accountProof, price } = await identity.bindAnthropicAccount(routeProof, connectionId, apiKey, body.inference_geo);
      const attempt = identity.prepare({ attemptId: randomUUID(), provider, model,
        startedAt: budgetInstant(clock), price }, routeProof, accountProof);
      const usage = createAnthropicUsageAccumulator();
      return Object.freeze({
        dispatch() {
          // The ledger checks current route, account, key policy and spend together.
          return identity.dispatch(attempt.ack, budgetInstant(clock), initiate);
        },
        observe(event) { usage.observe(event); }, // existing native SSE owner only
        settleJson(rawUsage) { return attempt.settle(anthropicJsonUsage(rawUsage)); },
        settleStream() {
          const result = usage.result();
          if (!result.completed) throw unavailable();
          return attempt.settle(result.usage);
        },
      });
    },
  });
}
