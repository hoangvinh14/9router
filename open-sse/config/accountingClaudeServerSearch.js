import { CLAUDE_BLOCK } from '../translator/schema/blocks.js';
import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';

// Direct web search only. Dynamic filtering/containers, other tools and provider
// admission require separate original/raw/price authorities, not relaxed here.
export const CLAUDE_ACCOUNTING_SERVER_SEARCH_NAME = 'web_search';
export const CLAUDE_ACCOUNTING_SERVER_SEARCH_TYPES = Object.freeze([
  'web_search_20250305', 'web_search_20260209', 'web_search_20260318',
]);
export const CLAUDE_ACCOUNTING_SERVER_SEARCH_CITATION = 'web_search_result_location';
export const CLAUDE_ACCOUNTING_SERVER_SEARCH_ERRORS = Object.freeze([
  'too_many_requests', 'invalid_tool_input', 'max_uses_exceeded', 'query_too_long', 'request_too_large', 'unavailable',
]);
export const CLAUDE_ACCOUNTING_SERVER_SEARCH_RESULT = 'web_search_result';
export const CLAUDE_ACCOUNTING_SERVER_SEARCH_ERROR = 'web_search_tool_result_error';
export const CLAUDE_ACCOUNTING_SERVER_SEARCH_PAUSE = 'pause_turn';
const DIRECT = 'direct';
// Bound retained per-stream source/ID authority, not billable uses or work.
export const CLAUDE_ACCOUNTING_SERVER_SEARCH_AUTHORITY_BYTES = 262144;
export const CLAUDE_ACCOUNTING_SERVER_SEARCH_AUTHORITY_ENTRIES = 10000;
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length > 0;
const shape = (value, fields) => object(value) && Object.keys(value).every(key => fields.includes(key));
function domain(value) {
  if (!text(value) || /[\s\\?#@]/.test(value)) return false;
  const [host] = value.split('/');
  return host.length <= 253 && host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}
function location(value) {
  if (!shape(value, ['type', 'city', 'region', 'country', 'timezone']) || value.type !== 'approximate' ||
      !['city', 'region', 'country', 'timezone'].some(key => Object.hasOwn(value, key)) ||
      Object.entries(value).some(([key, entry]) => key !== 'type' && (!text(entry) || /[\u0000-\u001f\u007f]/.test(entry))) ||
      value.country !== undefined && !/^[A-Z]{2}$/.test(value.country)) return false;
  if (value.timezone !== undefined) {
    try { new Intl.DateTimeFormat('en', { timeZone: value.timezone }); } catch { return false; }
  }
  return true;
}
function definition(tool) {
  if (!shape(tool, ['type', 'name', 'max_uses', 'allowed_domains', 'blocked_domains', 'user_location', 'allowed_callers', 'response_inclusion', 'cache_control']) ||
      !CLAUDE_ACCOUNTING_SERVER_SEARCH_TYPES.includes(tool.type) || tool.name !== CLAUDE_ACCOUNTING_SERVER_SEARCH_NAME ||
      tool.max_uses !== undefined && (!Number.isSafeInteger(tool.max_uses) || tool.max_uses < 0) ||
      tool.allowed_domains !== undefined && tool.blocked_domains !== undefined) return false;
  const basic = tool.type === CLAUDE_ACCOUNTING_SERVER_SEARCH_TYPES[0];
  if (tool.allowed_callers === undefined ? !basic : !Array.isArray(tool.allowed_callers) || tool.allowed_callers.length !== 1 || tool.allowed_callers[0] !== DIRECT) return false;
  if (tool.response_inclusion !== undefined && (tool.type !== CLAUDE_ACCOUNTING_SERVER_SEARCH_TYPES[2] || !['full', 'excluded'].includes(tool.response_inclusion))) return false;
  for (const field of ['allowed_domains', 'blocked_domains']) {
    if (tool[field] !== undefined && (!Array.isArray(tool[field]) || !tool[field].every(domain))) return false;
  }
  return tool.user_location === undefined || location(tool.user_location);
}
export function supportsClaudeServerSearchTool(tool) {
  try { return definition(snapshotAccountingPreparedData(tool)); } catch { return false; }
}
function sourceUrl(value) {
  if (!text(value) || /[\s\\]/.test(value)) return false;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && !!parsed.hostname && !parsed.username && !parsed.password;
  } catch { return false; }
}
function resultSource(value) {
  return shape(value, ['type', 'url', 'title', 'encrypted_content', 'page_age']) &&
    value.type === CLAUDE_ACCOUNTING_SERVER_SEARCH_RESULT && sourceUrl(value.url) && typeof value.title === 'string' &&
    text(value.encrypted_content) && (value.page_age === undefined || value.page_age === null || typeof value.page_age === 'string');
}
// One original conversation (or later raw owner) owns this state. Never global,
// never decode encrypted_content/index, never infer billed uses from its size.
export function createClaudeServerSearchAuthority(tools, issued = new Set()) {
  let original;
  try { original = snapshotAccountingPreparedData(tools); } catch { return null; }
  const definitions = Array.isArray(original) ? original.filter(tool => tool?.name === CLAUDE_ACCOUNTING_SERVER_SEARCH_NAME) : [];
  if (definitions.length !== 1 || !definition(definitions[0])) return null;
  const pending = new Set(), sources = [];
  let retainedBytes = 0, entries = 0;
  const reserve = value => {
    const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    if (retainedBytes + bytes > CLAUDE_ACCOUNTING_SERVER_SEARCH_AUTHORITY_BYTES || entries + 1 > CLAUDE_ACCOUNTING_SERVER_SEARCH_AUTHORITY_ENTRIES) return false;
    retainedBytes += bytes; entries++; return true;
  };
  return {
    pendingCount() { return pending.size; },
    acceptClientId(id) {
      if (!text(id) || issued.has(id) || !reserve(id)) return false;
      issued.add(id); return true;
    },
    acceptCall(block) {
      try { block = snapshotAccountingPreparedData(block); } catch { return false; }
      if (!shape(block, ['type', 'id', 'name', 'input']) || block.type !== CLAUDE_BLOCK.SERVER_TOOL_USE ||
          !text(block.id) || !block.id.startsWith('srvtoolu_') || block.id.length <= 'srvtoolu_'.length || issued.has(block.id) ||
          block.name !== CLAUDE_ACCOUNTING_SERVER_SEARCH_NAME || !shape(block.input, ['query']) || !text(block.input.query)) return false;
      if (!reserve(block.id)) return false;
      issued.add(block.id); pending.add(block.id); return true;
    },
    acceptResult(block) {
      try { block = snapshotAccountingPreparedData(block); } catch { return false; }
      if (!shape(block, ['type', 'tool_use_id', 'content']) || block.type !== CLAUDE_BLOCK.WEB_SEARCH_TOOL_RESULT ||
          !pending.has(block.tool_use_id)) return false;
      const content = block.content;
      if (Array.isArray(content)) {
        if (!content.every(resultSource)) return false;
      } else if (!shape(content, ['type', 'error_code']) || content.type !== CLAUDE_ACCOUNTING_SERVER_SEARCH_ERROR ||
          !CLAUDE_ACCOUNTING_SERVER_SEARCH_ERRORS.includes(content.error_code)) return false;
      // Validation above retains no encrypted corpus; capture/wire owners keep
      // original payload bytes. Citation association needs only URL/title.
      const next = Array.isArray(content) ? content.map(({ url, title }) => Object.freeze({ url, title })) : [];
      if (!reserve(next)) return false;
      pending.delete(block.tool_use_id); sources.push(...next);
      return true;
    },
    supportsCitation(value) {
      try { value = snapshotAccountingPreparedData(value); } catch { return false; }
      return shape(value, ['type', 'url', 'title', 'encrypted_index', 'cited_text']) &&
        value.type === CLAUDE_ACCOUNTING_SERVER_SEARCH_CITATION && text(value.encrypted_index) &&
        typeof value.cited_text === 'string' && sources.some(source => source.url === value.url && source.title === value.title);
    },
  };
}
