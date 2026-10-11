import { FORMATS } from '../translator/formats.js';
import { supportsResponsesRequest } from './accountedResponsesCandidate.js';
import { getProviderModels } from './providerModels.js';

export const ACCOUNTED_CODEX_URL = 'https://chatgpt.com/backend-api/codex/responses';
export const ACCOUNTED_CODEX_SSE_MODE = 'native-codex-responses-sse';
export const ACCOUNTED_CODEX_GATEWAY_PATHS = Object.freeze(['/v1/responses', '/api/v1/responses']);
const REQUEST_FIELDS = Object.freeze(['model', 'input', 'instructions', 'stream', 'store', 'service_tier']);
export const ACCOUNTED_CODEX_HEADER_FIELDS = Object.freeze(['content-type', 'accept', 'authorization', 'originator', 'user-agent', 'version', 'session_id', 'chatgpt-account-id']);
const identity = value => typeof value === 'string' && value.length > 0 && !/[\x00-\x20\x7f]/.test(value);
export function supportsCodexRequest(body, model) {
  // Initial native text-only full Responses transport. Lite prefix, compact,
  // hosted work and optional transformations need separate certified owners.
  return supportsResponsesRequest(body, model) && Object.keys(body).every(key => REQUEST_FIELDS.includes(key)) && body.stream === true && body.store === false &&
    typeof body.instructions === 'string' && body.instructions.trim().length > 0 &&
    getProviderModels('cx').some(entry => entry.id === model && entry.responsesLite !== true && !entry.upstreamModelId);
}
export function codexAccountingHeaders(credentials, configHeaders) {
  const account = credentials.providerSpecificData?.workspaceId || credentials.providerSpecificData?.chatgptAccountId || credentials.providerSpecificData?.accountId;
  // Request-local identity only; never consult executor._currentSessionId.
  return { ...configHeaders, 'Content-Type': 'application/json', Accept: 'text/event-stream',
    Authorization: `Bearer ${credentials.accessToken}`, session_id: credentials.connectionId,
    'ChatGPT-Account-ID': account };
}
export function supportsCodexCandidate(executor, options, url, body, headers) {
  const credentials = options.credentials, normalized = new Headers(headers);
  const account = credentials?.providerSpecificData?.workspaceId || credentials?.providerSpecificData?.chatgptAccountId || credentials?.providerSpecificData?.accountId;
  return executor.provider === 'codex' && executor.config?.format === FORMATS.OPENAI_RESPONSES && executor.config.baseUrl === ACCOUNTED_CODEX_URL &&
    url === ACCOUNTED_CODEX_URL && options.accountingMode === ACCOUNTED_CODEX_SSE_MODE && options.stream === true &&
    options.body?.stream === true && supportsCodexRequest(body, options.model) &&
    !options.proxyOptions?.vercelRelayUrl && !credentials?.runtimeTransport && !credentials?.apiKey &&
    identity(credentials?.accessToken) && identity(credentials?.connectionId) && identity(account) &&
    [...normalized.keys()].every(key => ACCOUNTED_CODEX_HEADER_FIELDS.includes(key)) &&
    normalized.get('authorization') === `Bearer ${credentials.accessToken}` &&
    normalized.get('session_id') === credentials.connectionId && normalized.get('chatgpt-account-id') === account &&
    normalized.get('originator') === executor.config.headers?.originator &&
    normalized.get('user-agent') === executor.config.headers?.['User-Agent'] && normalized.get('version') === executor.config.headers?.version &&
    normalized.get('content-type') === 'application/json' && normalized.get('accept') === 'text/event-stream';
}
