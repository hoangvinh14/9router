import { GROK_CLI_BASE_URL, GROK_CLI_MODEL, GROK_CLI_CLIENT_IDENTIFIER, GROK_CLI_VERSION } from './grokCli.js';
import { supportsResponsesRequest } from './accountedResponsesCandidate.js';
import { isDeepStrictEqual } from 'node:util';
export const ACCOUNTED_GROK_CLI_URL = `${GROK_CLI_BASE_URL}/responses`;
export const ACCOUNTED_GROK_CLI_MODE = 'native-grok-cli-responses-sse';
export const ACCOUNTED_GROK_CLI_PROTOCOL = 'native-grok-cli';
export const ACCOUNTED_GROK_CLI_HEADER_FIELDS = Object.freeze(['content-type', 'accept', 'authorization', 'user-agent', 'x-grok-client-identifier', 'x-grok-client-version', 'x-grok-session-id', 'x-grok-conv-id', 'x-grok-req-id', 'x-grok-turn-idx', 'x-grok-agent-id', 'x-grok-model-override', 'x-email', 'x-userid']);
export const grokCliIdentityString = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x20\x7f]/.test(value);
// Narrow registered Build only. No alias/effort rewriting, tools, input reasoning,
// machine fallback or erased unsupported original fields are authorized here.
export function supportsGrokCliOriginal(body, model) {
  if (model !== GROK_CLI_MODEL || !body || body.store !== false || body.stream !== true || !Array.isArray(body.input) || !body.input.length ||
      ['service_tier', 'temperature', 'top_p'].some(key => Object.hasOwn(body, key))) return false;
  const { reasoning, include, ...text } = body;
  if (!supportsResponsesRequest(text, model)) return false;
  if (reasoning !== undefined && !isDeepStrictEqual(reasoning, { summary: 'concise' })) return false;
  return include === undefined || isDeepStrictEqual(include, ['reasoning.encrypted_content']);
}
export function grokCliAccountingBody(original) {
  return { ...original, reasoning: { summary: 'concise' }, include: ['reasoning.encrypted_content'] };
}
export function grokCliAccountingHeaders(credentials, config, identity) {
  const data = credentials.providerSpecificData;
  return { ...config.baseTransport.headers, 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${credentials.accessToken}`,
    'x-grok-client-identifier': config.clientIdentifier || GROK_CLI_CLIENT_IDENTIFIER, 'x-grok-client-version': config.clientVersion || GROK_CLI_VERSION,
    'x-grok-session-id': identity.sessionId, 'x-grok-conv-id': identity.sessionId, 'x-grok-req-id': identity.requestId, 'x-grok-turn-idx': String(identity.turn),
    'x-grok-agent-id': data.deviceId, 'x-grok-model-override': GROK_CLI_MODEL,
    ...(data.email ? { 'x-email': data.email } : {}), ...(data.userId ? { 'x-userid': data.userId } : {}) };
}
