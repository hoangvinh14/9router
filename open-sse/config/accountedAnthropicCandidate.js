import { FORMATS } from '../translator/formats.js';
import { CLAUDE_BLOCK } from '../translator/schema/blocks.js';
import { ROLE } from '../translator/schema/roles.js';
import { ANTHROPIC_API_VERSION } from '../providers/shared.js';

// Unconnected standard API-key candidate, not application provider approval.
export const ACCOUNTED_ANTHROPIC_GATEWAY_PATHS = Object.freeze(['/v1/messages', '/api/v1/messages']);
export const ACCOUNTED_ANTHROPIC_CANDIDATE_URL = 'https://api.anthropic.com/v1/messages';
export const ACCOUNTED_ANTHROPIC_REQUEST_FIELDS = Object.freeze([
  'model', 'messages', 'max_tokens', 'stream', 'system', 'temperature', 'top_p', 'top_k', 'stop_sequences', 'tools', 'tool_choice',
]);
export const ACCOUNTED_ANTHROPIC_CANDIDATE_MODE = 'buffered-claude-sse';
export const ACCOUNTED_ANTHROPIC_LIVE_MODE = 'native-claude-sse';
export const ACCOUNTED_ANTHROPIC_LIVE_FIELDS = Object.freeze(ACCOUNTED_ANTHROPIC_REQUEST_FIELDS.filter(field => !['tools', 'tool_choice'].includes(field)));
export const ANTHROPIC_OAUTH_TOKEN_PREFIX = 'sk-ant-oat';
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
function supportedCache(block) {
  if (!object(block)) return false;
  if (block.cache_control === undefined) return true;
  const cache = block.cache_control;
  return object(cache) && cache.type === 'ephemeral' && (cache.ttl === undefined || cache.ttl === '5m') &&
    Object.keys(cache).every(key => key === 'type' || key === 'ttl');
}
function supportedRequestCache(body) {
  if (Array.isArray(body.system) && !body.system.every(supportedCache)) return false;
  if (!Array.isArray(body.messages) || body.messages.some(message => !object(message) ||
      ![ROLE.USER, ROLE.ASSISTANT].includes(message.role) ||
      message.cache_control !== undefined || Array.isArray(message.content) && !message.content.every(supportedCache))) return false;
  return !Array.isArray(body.tools) || body.tools.every(supportedCache);
}
// Initial live slice is text-only. Validate original input before transforms can
// remove unsupported work, then independently validate the pinned serialized wire.
export function supportsAnthropicLiveRequest(body, model) {
  const textBlock = block => object(block) && block.type === CLAUDE_BLOCK.TEXT && typeof block.text === 'string' &&
    Object.keys(block).every(key => ['type', 'text', 'cache_control'].includes(key)) && supportedCache(block);
  return object(body) && body.model === model && body.stream === true &&
    Object.keys(body).every(key => ACCOUNTED_ANTHROPIC_LIVE_FIELDS.includes(key)) &&
    Number.isSafeInteger(body.max_tokens) && body.max_tokens > 0 &&
    Array.isArray(body.messages) && body.messages.every(message => object(message) &&
      Object.keys(message).every(key => ['role', 'content'].includes(key)) && [ROLE.USER, ROLE.ASSISTANT].includes(message.role) &&
      (typeof message.content === 'string' || Array.isArray(message.content) && message.content.every(textBlock))) &&
    (body.system === undefined || typeof body.system === 'string' || Array.isArray(body.system) && body.system.every(textBlock)) &&
    (body.stop_sequences === undefined || Array.isArray(body.stop_sequences) && body.stop_sequences.every(value => typeof value === 'string')) &&
    ['temperature', 'top_p', 'top_k'].every(key => body[key] === undefined || typeof body[key] === 'number' && Number.isFinite(body[key]) && body[key] >= 0);
}
export const ACCOUNTED_ANTHROPIC_HEADER_FIELDS = Object.freeze(['content-type', 'x-api-key', 'anthropic-version', 'accept']);
export function supportsAnthropicCandidate(executor, options, url, body, headers) {
  if (executor.provider !== 'anthropic' || executor.config?.format !== FORMATS.CLAUDE || url !== ACCOUNTED_ANTHROPIC_CANDIDATE_URL ||
      options.proxyOptions?.vercelRelayUrl ||
      options.credentials?.runtimeTransport || typeof options.credentials?.apiKey !== 'string' || !options.credentials.apiKey ||
      options.credentials.apiKey.startsWith(ANTHROPIC_OAUTH_TOKEN_PREFIX) || options.credentials?.accessToken ||
      ![ACCOUNTED_ANTHROPIC_CANDIDATE_MODE, ACCOUNTED_ANTHROPIC_LIVE_MODE].includes(options.accountingMode) || options.stream !== true ||
      options.body?.stream !== (options.accountingMode === ACCOUNTED_ANTHROPIC_LIVE_MODE) || body?.stream !== true ||
      options.accountingMode === ACCOUNTED_ANTHROPIC_LIVE_MODE && (!supportsAnthropicLiveRequest(options.body, options.model) || !supportsAnthropicLiveRequest(body, options.model)) ||
      !body || typeof body !== 'object' || Array.isArray(body) || body.model !== options.model ||
      Object.keys(body).some(key => !ACCOUNTED_ANTHROPIC_REQUEST_FIELDS.includes(key)) ||
      !supportedRequestCache(body) || !supportedRequestCache(options.body)) return false;
  if (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.some(tool => !tool || typeof tool !== 'object' || Array.isArray(tool) ||
      tool.type !== undefined && tool.type !== CLAUDE_BLOCK.TOOL_USE || typeof tool.name !== 'string' || !object(tool.input_schema)))) return false;
  const normalized = new Headers(headers);
  return [...normalized.keys()].every(key => ACCOUNTED_ANTHROPIC_HEADER_FIELDS.includes(key)) &&
    normalized.get('x-api-key') === options.credentials.apiKey && normalized.get('anthropic-version') === ANTHROPIC_API_VERSION &&
    normalized.get('content-type') === 'application/json';
}
