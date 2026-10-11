import { FORMATS } from '../translator/formats.js';
import { CLAUDE_BLOCK } from '../translator/schema/blocks.js';
import { ROLE } from '../translator/schema/roles.js';
import { ANTHROPIC_API_VERSION } from '../providers/shared.js';
import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import anthropicRegistry from '../providers/registry/anthropic.js';
import { CLAUDE_ACCOUNTING_THINKING_TYPES, CLAUDE_ACCOUNTING_THINKING_DISPLAYS, CLAUDE_ACCOUNTING_EFFORTS } from './accountingClaudeSchema.js';
import { isValidClaudeSignature } from '../utils/claudeSignature.js';
import { supportsClaudeInlineMedia } from './accountingClaudeMedia.js';

// Unconnected standard API-key candidate, not application provider approval.
export const ACCOUNTED_ANTHROPIC_GATEWAY_PATHS = Object.freeze(['/v1/messages', '/api/v1/messages']);
export const ACCOUNTED_ANTHROPIC_CANDIDATE_URL = 'https://api.anthropic.com/v1/messages';
export const ACCOUNTED_ANTHROPIC_REQUEST_FIELDS = Object.freeze([
  'model', 'messages', 'max_tokens', 'stream', 'system', 'temperature', 'top_p', 'top_k', 'stop_sequences', 'tools', 'tool_choice',
]);
export const ACCOUNTED_ANTHROPIC_CANDIDATE_MODE = 'buffered-claude-sse';
export const ACCOUNTED_ANTHROPIC_LIVE_MODE = 'native-claude-sse';
// Independent queued-only opt-in; ordinary app/synchronous mode stays standard.
export const ACCOUNTED_ANTHROPIC_BETA_LIVE_MODE = 'native-claude-beta-sse';
export const ACCOUNTED_ANTHROPIC_BETA_FLAGS = new Headers(anthropicRegistry.transport.headers).get('anthropic-beta');
export const ACCOUNTED_ANTHROPIC_MODES = Object.freeze([ACCOUNTED_ANTHROPIC_CANDIDATE_MODE, ACCOUNTED_ANTHROPIC_LIVE_MODE, ACCOUNTED_ANTHROPIC_BETA_LIVE_MODE]);
export const isAnthropicLiveMode = mode => [ACCOUNTED_ANTHROPIC_LIVE_MODE, ACCOUNTED_ANTHROPIC_BETA_LIVE_MODE].includes(mode);
export const ACCOUNTED_ANTHROPIC_LIVE_FIELDS = ACCOUNTED_ANTHROPIC_REQUEST_FIELDS;
export const ACCOUNTED_ANTHROPIC_TOOL_FIELDS = Object.freeze(['name', 'description', 'input_schema', 'cache_control']);
export const ACCOUNTED_ANTHROPIC_TOOL_CHOICE_TYPES = Object.freeze(['auto', 'any', 'tool', 'none']);
export const ANTHROPIC_OAUTH_TOKEN_PREFIX = 'sk-ant-oat';
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
function supportedCache(block, allowCache1h = false) {
  if (!object(block)) return false;
  if (block.cache_control === undefined) return true;
  const cache = block.cache_control;
  return object(cache) && cache.type === 'ephemeral' && (cache.ttl === undefined || cache.ttl === '5m' || allowCache1h && cache.ttl === '1h') &&
    Object.keys(cache).every(key => key === 'type' || key === 'ttl');
}
export function anthropicRequestHasCache1h(body) {
  return [...(body?.tools || []), ...(Array.isArray(body?.system) ? body.system : []),
    ...(body?.messages || []).flatMap(message => Array.isArray(message.content) ? message.content : [])]
    .some(block => block.cache_control?.ttl === '1h');
}
function supportedRequestCache(body, allowCache1h = false) {
  const cache = block => supportedCache(block, allowCache1h);
  if (body.tools !== undefined && !Array.isArray(body.tools)) return false;
  if (Array.isArray(body.system) && !body.system.every(cache)) return false;
  if (!Array.isArray(body.messages) || body.messages.some(message => !object(message) ||
      ![ROLE.USER, ROLE.ASSISTANT].includes(message.role) ||
      message.cache_control !== undefined || Array.isArray(message.content) && !message.content.every(cache))) return false;
  if (Array.isArray(body.tools) && !body.tools.every(cache)) return false;
  // Official mixed-TTL ordering: tools -> system -> messages, longer first.
  let shortSeen = false;
  const blocks = [...(body.tools || []), ...(Array.isArray(body.system) ? body.system : []),
    ...body.messages.flatMap(message => Array.isArray(message.content) ? message.content : [])];
  for (const block of blocks) {
    if (!block.cache_control) continue;
    if (block.cache_control.ttl === '1h') { if (shortSeen) return false; }
    else shortSeen = true;
  }
  return true;
}
const TOOL_HISTORY_USE_FIELDS = Object.freeze(['type', 'id', 'name', 'input', 'cache_control']);
const TOOL_HISTORY_RESULT_FIELDS = Object.freeze(['type', 'tool_use_id', 'content', 'is_error', 'cache_control']);
// Native client tools only. Match each assistant use to exactly one result in
// the immediately following user turn; results precede that turn's text. No
// normalization, content erasure, usage inference or current-tool-name rewrite.
function supportedMessages(messages, textBlock, allowClientTools, allowCache1h, allowThinking, allowInlineMedia) {
  if (!Array.isArray(messages)) return false;
  const issued = new Set(); let pending = new Set();
  for (const message of messages) {
    if (!object(message) || Object.keys(message).some(key => !['role', 'content'].includes(key)) ||
        ![ROLE.USER, ROLE.ASSISTANT].includes(message.role)) return false;
    if (typeof message.content === 'string') { if (pending.size) return false; continue; }
    if (!Array.isArray(message.content) || pending.size && message.role !== ROLE.USER) return false;
    const next = new Set(); let textSeen = false;
    for (const block of message.content) {
      if (textBlock(block)) { if (pending.size) return false; textSeen = true; continue; }
      if (allowInlineMedia && supportsClaudeInlineMedia(block) && supportedCache(block, allowCache1h)) {
        if (message.role !== ROLE.USER || pending.size) return false;
        textSeen = true; continue;
      }
      if (allowThinking && object(block) && block.type === CLAUDE_BLOCK.THINKING) {
        if (message.role !== ROLE.ASSISTANT || textSeen || next.size ||
            Object.keys(block).some(key => !['type', 'thinking', 'signature'].includes(key)) ||
            typeof block.thinking !== 'string' || typeof block.signature !== 'string' || !isValidClaudeSignature(block.signature)) return false;
        continue;
      }
      if (!allowClientTools || !object(block) || !supportedCache(block, allowCache1h)) return false;
      if (block.type === CLAUDE_BLOCK.TOOL_USE) {
        if (message.role !== ROLE.ASSISTANT || Object.keys(block).some(key => !TOOL_HISTORY_USE_FIELDS.includes(key)) ||
            typeof block.id !== 'string' || !block.id || issued.has(block.id) ||
            typeof block.name !== 'string' || !block.name || !object(block.input)) return false;
        issued.add(block.id); next.add(block.id);
      } else if (block.type === CLAUDE_BLOCK.TOOL_RESULT) {
        if (message.role !== ROLE.USER || textSeen || Object.keys(block).some(key => !TOOL_HISTORY_RESULT_FIELDS.includes(key)) ||
            typeof block.tool_use_id !== 'string' || !pending.delete(block.tool_use_id) ||
            block.is_error !== undefined && typeof block.is_error !== 'boolean' ||
            !(typeof block.content === 'string' || Array.isArray(block.content) && block.content.every(child => (textBlock(child) || allowInlineMedia && supportsClaudeInlineMedia(child, { allowDocument: false }) && supportedCache(child, allowCache1h)) && child.cache_control?.ttl !== '1h'))) return false;
      } else return false;
    }
    if (pending.size) return false;
    pending = next;
  }
  return pending.size === 0;
}
// Default stays text-only for app/synchronous/GitHub consumers. A distinct
// explicit queued candidate may opt into declared tools and text-result history.
// Prepared-data bounds reject programmable/non-JSON/oversize history before any
// traversal; strict dispatch still binds the entire original and actual wire.
export function supportsAnthropicLiveRequest(body, model, allowClientTools = false, allowCache1h = false, allowThinking = false, allowInlineMedia = false) {
  if (typeof allowClientTools !== 'boolean' || typeof allowCache1h !== 'boolean' || typeof allowThinking !== 'boolean' || typeof allowInlineMedia !== 'boolean') return false;
  if (allowClientTools || allowCache1h || allowThinking || allowInlineMedia) { try { body = snapshotAccountingPreparedData(body); } catch { return false; } }
  const textBlock = block => object(block) && block.type === CLAUDE_BLOCK.TEXT && typeof block.text === 'string' &&
    Object.keys(block).every(key => ['type', 'text', 'cache_control'].includes(key)) && supportedCache(block, allowCache1h);
  return object(body) && body.model === model && body.stream === true &&
    (allowClientTools || body.tools === undefined && body.tool_choice === undefined) &&
    Object.keys(body).every(key => ACCOUNTED_ANTHROPIC_LIVE_FIELDS.includes(key) || allowThinking && ['thinking', 'output_config'].includes(key)) &&
    (allowThinking ? supportedThinking(body) : body.thinking === undefined && body.output_config === undefined) &&
    Number.isSafeInteger(body.max_tokens) && body.max_tokens > 0 &&
    supportedMessages(body.messages, textBlock, allowClientTools, allowCache1h, allowThinking, allowInlineMedia) && supportedRequestCache(body, allowCache1h) &&
    (body.system === undefined || typeof body.system === 'string' || Array.isArray(body.system) && body.system.every(textBlock)) &&
    (body.stop_sequences === undefined || Array.isArray(body.stop_sequences) && body.stop_sequences.every(value => typeof value === 'string')) &&
    (body.tools === undefined || Array.isArray(body.tools) && body.tools.every(tool => object(tool) &&
      Object.keys(tool).every(key => ACCOUNTED_ANTHROPIC_TOOL_FIELDS.includes(key)) &&
      typeof tool.name === 'string' && !!tool.name && object(tool.input_schema) &&
      (tool.description === undefined || typeof tool.description === 'string') && supportedCache(tool, allowCache1h))) &&
    (body.tool_choice === undefined || object(body.tool_choice) && ACCOUNTED_ANTHROPIC_TOOL_CHOICE_TYPES.includes(body.tool_choice.type) &&
      Object.keys(body.tool_choice).every(key => ['type', 'name', 'disable_parallel_tool_use'].includes(key)) &&
      (body.tool_choice.type === 'tool' ? typeof body.tool_choice.name === 'string' && body.tools?.some(tool => tool.name === body.tool_choice.name) : body.tool_choice.name === undefined) &&
      (body.tool_choice.disable_parallel_tool_use === undefined || typeof body.tool_choice.disable_parallel_tool_use === 'boolean')) &&
    ['temperature', 'top_p', 'top_k'].every(key => body[key] === undefined || typeof body[key] === 'number' && Number.isFinite(body[key]) && body[key] >= 0);
}
function supportedThinking(body) {
  const thinking = body.thinking;
  if (thinking !== undefined && (!object(thinking) || !CLAUDE_ACCOUNTING_THINKING_TYPES.includes(thinking.type) ||
      Object.keys(thinking).some(key => !['type', 'budget_tokens', 'display'].includes(key)) ||
      (thinking.type === 'enabled' ? !Number.isSafeInteger(thinking.budget_tokens) || thinking.budget_tokens < 1024 || thinking.budget_tokens >= body.max_tokens : thinking.budget_tokens !== undefined) ||
      thinking.display !== undefined && !CLAUDE_ACCOUNTING_THINKING_DISPLAYS.includes(thinking.display))) return false;
  const output = body.output_config;
  return output === undefined || object(output) && Object.keys(output).every(key => key === 'effort') && CLAUDE_ACCOUNTING_EFFORTS.includes(output.effort);
}
export const ACCOUNTED_ANTHROPIC_HEADER_FIELDS = Object.freeze(['content-type', 'x-api-key', 'anthropic-version', 'accept']);
export const ACCOUNTED_ANTHROPIC_BETA_HEADER_FIELDS = Object.freeze([...ACCOUNTED_ANTHROPIC_HEADER_FIELDS, 'anthropic-beta']);
export function supportsAnthropicAccountingHeaders(headers, mode) {
  if (!ACCOUNTED_ANTHROPIC_MODES.includes(mode)) return false;
  const normalized = new Headers(headers), beta = mode === ACCOUNTED_ANTHROPIC_BETA_LIVE_MODE;
  return [...normalized.keys()].every(key => (beta ? ACCOUNTED_ANTHROPIC_BETA_HEADER_FIELDS : ACCOUNTED_ANTHROPIC_HEADER_FIELDS).includes(key)) &&
    normalized.get('anthropic-beta') === (beta ? ACCOUNTED_ANTHROPIC_BETA_FLAGS : null) &&
    normalized.get('anthropic-version') === ANTHROPIC_API_VERSION && normalized.get('content-type') === 'application/json' &&
    (!beta || normalized.get('accept') === 'text/event-stream');
}
export function supportsAnthropicCandidate(executor, options, url, body, headers) {
  const live = isAnthropicLiveMode(options.accountingMode), beta = options.accountingMode === ACCOUNTED_ANTHROPIC_BETA_LIVE_MODE;
  if (beta && (options.accounting?.requiresPreparedBaseWire !== true || options.credentials?.rawHeaders?.['anthropic-beta'] !== undefined ||
      new Headers(executor.config?.headers).get('anthropic-beta') !== ACCOUNTED_ANTHROPIC_BETA_FLAGS)) return false;
  if (executor.provider !== 'anthropic' || executor.config?.format !== FORMATS.CLAUDE || url !== ACCOUNTED_ANTHROPIC_CANDIDATE_URL ||
      options.proxyOptions?.vercelRelayUrl ||
      options.credentials?.runtimeTransport || typeof options.credentials?.apiKey !== 'string' || !options.credentials.apiKey ||
      options.credentials.apiKey.startsWith(ANTHROPIC_OAUTH_TOKEN_PREFIX) || options.credentials?.accessToken ||
      !ACCOUNTED_ANTHROPIC_MODES.includes(options.accountingMode) || options.stream !== true ||
      options.body?.stream !== live || body?.stream !== true ||
      live && (!supportsAnthropicLiveRequest(options.body, options.model, options.accounting?.requiresPreparedBaseWire === true, beta) || !supportsAnthropicLiveRequest(body, options.model, options.accounting?.requiresPreparedBaseWire === true, beta)) ||
      !body || typeof body !== 'object' || Array.isArray(body) || body.model !== options.model ||
      Object.keys(body).some(key => !ACCOUNTED_ANTHROPIC_REQUEST_FIELDS.includes(key)) ||
      !supportedRequestCache(body, beta) || !supportedRequestCache(options.body, beta)) return false;
  if (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.some(tool => !tool || typeof tool !== 'object' || Array.isArray(tool) ||
      tool.type !== undefined && tool.type !== CLAUDE_BLOCK.TOOL_USE || typeof tool.name !== 'string' || !object(tool.input_schema)))) return false;
  const normalized = new Headers(headers);
  return supportsAnthropicAccountingHeaders(normalized, options.accountingMode) && normalized.get('x-api-key') === options.credentials.apiKey;
}
