import { FORMATS } from '../translator/formats.js';
import { ROLE } from '../translator/schema/roles.js';
import { RESPONSES_ITEM } from '../translator/schema/blocks.js';
import { ACCOUNTING_RESPONSES_TIER } from './accountingResponsesSchema.js';

export const ACCOUNTED_RESPONSES_URL = 'https://api.openai.com/v1/responses';
export const ACCOUNTED_RESPONSES_MODE = 'native-responses-json';
export const ACCOUNTED_RESPONSES_SSE_MODE = 'native-responses-sse';
export const ACCOUNTED_RESPONSES_REQUEST_FIELDS = Object.freeze([
  'model', 'input', 'instructions', 'stream', 'store', 'max_output_tokens', 'temperature', 'top_p', 'service_tier',
]);
export const ACCOUNTED_RESPONSES_HEADER_FIELDS = Object.freeze(['content-type', 'authorization', 'accept']);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const fields = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
function supportedInput(input) {
  if (typeof input === 'string') return true;
  return Array.isArray(input) && input.every(item => fields(item, ['type', 'role', 'content']) &&
    (item.type === undefined || item.type === RESPONSES_ITEM.MESSAGE) &&
    [ROLE.USER, ROLE.ASSISTANT, ROLE.SYSTEM, ROLE.DEVELOPER].includes(item.role) &&
    (typeof item.content === 'string' || Array.isArray(item.content) && item.content.every(block =>
      fields(block, ['type', 'text']) && block.type === RESPONSES_ITEM.INPUT_TEXT && typeof block.text === 'string')));
}

// Initial API-key/text-only native JSON or explicit SSE slice. Stateful/background/hosted work,
// tools, beta/tier/long-cache options and custom transports are not silently
// stripped into a supported request. This is not general Responses approval.
export function supportsResponsesCandidate(executor, options, url, body, headers) {
  if (executor.provider !== 'openai' || executor.config?.format !== FORMATS.OPENAI || url !== ACCOUNTED_RESPONSES_URL ||
      ![ACCOUNTED_RESPONSES_MODE, ACCOUNTED_RESPONSES_SSE_MODE].includes(options.accountingMode) ||
      options.stream !== (options.accountingMode === ACCOUNTED_RESPONSES_SSE_MODE) || options.body?.stream !== options.stream || body.stream !== options.stream ||
      options.proxyOptions?.vercelRelayUrl || options.credentials?.runtimeTransport || options.credentials?.accessToken ||
      typeof options.credentials?.apiKey !== 'string' || !options.credentials.apiKey ||
      !supportsResponsesRequest(body, options.model)) return false;
  const normalized = new Headers(headers);
  return [...normalized.keys()].every(key => ACCOUNTED_RESPONSES_HEADER_FIELDS.includes(key)) &&
    normalized.get('authorization') === `Bearer ${options.credentials.apiKey}` && normalized.get('content-type') === 'application/json';
}

// Reused before any core saver/transformation; final serialized wire is validated
// independently by the POST owner. Model argument is resolved, never a fuzzy alias.
export function supportsResponsesRequest(body, model) {
  return fields(body, ACCOUNTED_RESPONSES_REQUEST_FIELDS) && body.model === model && typeof body.stream === 'boolean' &&
    supportedInput(body.input) && (body.instructions === undefined || typeof body.instructions === 'string') &&
    (body.store === undefined || typeof body.store === 'boolean') &&
    (body.service_tier === undefined || body.service_tier === ACCOUNTING_RESPONSES_TIER) &&
    (body.max_output_tokens === undefined || Number.isSafeInteger(body.max_output_tokens) && body.max_output_tokens > 0) &&
    ['temperature', 'top_p'].every(key => body[key] === undefined || typeof body[key] === 'number' && Number.isFinite(body[key]) && body[key] >= 0);
}
