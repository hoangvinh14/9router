import { isDeepStrictEqual } from 'node:util';
import { PROVIDERS } from './providers.js';
import { captureAccountingBaseTransport } from './accountedBaseTransport.js';
import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { ACCOUNTED_GROK_CLI_URL, ACCOUNTED_GROK_CLI_MODE, ACCOUNTED_GROK_CLI_HEADER_FIELDS, grokCliIdentityString, supportsGrokCliOriginal, grokCliAccountingBody } from './accountedGrokCliCandidate.js';
const unavailable = () => { throw new Error('Accounting Grok CLI transport unavailable'); };
export function captureAccountingGrokCliConfig(config) {
  return snapshotAccountingPreparedData({ baseTransport: captureAccountingBaseTransport(config), clientIdentifier: config.clientIdentifier ?? null, clientVersion: config.clientVersion ?? null });
}
export function validateAccountingGrokCliDispatch(value, url) {
  const evidence = snapshotAccountingPreparedData(value);
  if (!evidence || Object.keys(evidence).length !== 6 || !['model', 'mode', 'grokConfig', 'identity', 'serializedBody', 'originalSerializedBody'].every(key => Object.hasOwn(evidence, key)) ||
      url !== ACCOUNTED_GROK_CLI_URL || evidence.mode !== ACCOUNTED_GROK_CLI_MODE ||
      !isDeepStrictEqual(evidence.grokConfig, captureAccountingGrokCliConfig(PROVIDERS['grok-cli'])) || evidence.grokConfig.baseTransport.baseUrl !== url) unavailable();
  const id = evidence.identity;
  if (!id || Object.keys(id).length !== 3 || !grokCliIdentityString(id.sessionId) || !grokCliIdentityString(id.requestId) || !Number.isSafeInteger(id.turn) || id.turn < 1) unavailable();
  let body, original;
  try { body = JSON.parse(evidence.serializedBody); original = JSON.parse(evidence.originalSerializedBody); } catch { unavailable(); }
  if (!supportsGrokCliOriginal(original, evidence.model) || !isDeepStrictEqual(body, grokCliAccountingBody(original))) unavailable();
  return evidence;
}
export function validateAccountingGrokCliPost(value, url, options) {
  const evidence = validateAccountingGrokCliDispatch(value, url), headers = new Headers(options.headers), config = evidence.grokConfig;
  if (options.method !== 'POST' || options.redirect !== 'error' || options.body !== evidence.serializedBody ||
      [...headers.keys()].some(key => !ACCOUNTED_GROK_CLI_HEADER_FIELDS.includes(key)) || headers.get('content-type') !== 'application/json' || headers.get('accept') !== 'text/event-stream' ||
      !headers.get('authorization')?.startsWith('Bearer ') || !grokCliIdentityString(headers.get('authorization')?.slice(7)) ||
      headers.get('x-grok-session-id') !== evidence.identity.sessionId || headers.get('x-grok-conv-id') !== evidence.identity.sessionId ||
      headers.get('x-grok-req-id') !== evidence.identity.requestId || headers.get('x-grok-turn-idx') !== String(evidence.identity.turn) ||
      headers.get('x-grok-model-override') !== evidence.model || !grokCliIdentityString(headers.get('x-grok-agent-id')) ||
      headers.get('user-agent') !== new Headers(config.baseTransport.headers).get('user-agent') ||
      headers.get('x-grok-client-identifier') !== config.clientIdentifier || headers.get('x-grok-client-version') !== config.clientVersion) unavailable();
  return evidence;
}
