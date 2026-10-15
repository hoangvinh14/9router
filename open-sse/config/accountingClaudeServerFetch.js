import { CLAUDE_BLOCK } from '../translator/schema/blocks.js';
import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { supportsClaudeAccountingUrl, supportsClaudeInlineMedia } from './accountingClaudeMedia.js';
import { supportsClaudeCitationConfig, captureClaudeCitationDocuments } from './accountingClaudeCitations.js';

// Direct fetch only; dynamic execution and resource ownership are independent.
export const CLAUDE_ACCOUNTING_SERVER_FETCH_NAME = 'web_fetch';
export const CLAUDE_ACCOUNTING_SERVER_FETCH_TYPES = Object.freeze(['web_fetch_20250910', 'web_fetch_20260209', 'web_fetch_20260309', 'web_fetch_20260318']);
export const CLAUDE_ACCOUNTING_SERVER_FETCH_RESULT = 'web_fetch_result';
export const CLAUDE_ACCOUNTING_SERVER_FETCH_ERROR = 'web_fetch_tool_result_error';
export const CLAUDE_ACCOUNTING_SERVER_FETCH_ERRORS = Object.freeze(['invalid_tool_input', 'url_too_long', 'url_not_allowed', 'url_not_in_prior_context', 'url_not_accessible', 'too_many_requests', 'unsupported_content_type', 'max_uses_exceeded', 'unavailable']);
export const CLAUDE_ACCOUNTING_SERVER_FETCH_AUTHORITY_BYTES = 262144;
export const CLAUDE_ACCOUNTING_SERVER_FETCH_AUTHORITY_ENTRIES = 10000;
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const shape = (value, fields) => record(value) && Object.keys(value).every(key => fields.includes(key));
function domain(value) {
  return typeof value === 'string' && value.length <= 253 && value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}
function definition(tool) {
  if (!shape(tool, ['type', 'name', 'max_uses', 'max_content_tokens', 'allowed_domains', 'blocked_domains', 'allowed_callers', 'citations', 'use_cache', 'response_inclusion', 'cache_control']) ||
      !CLAUDE_ACCOUNTING_SERVER_FETCH_TYPES.includes(tool.type) || tool.name !== CLAUDE_ACCOUNTING_SERVER_FETCH_NAME ||
      tool.max_uses !== undefined && (!Number.isSafeInteger(tool.max_uses) || tool.max_uses < 0) ||
      tool.max_content_tokens !== undefined && (!Number.isSafeInteger(tool.max_content_tokens) || tool.max_content_tokens <= 0) ||
      tool.allowed_domains !== undefined && tool.blocked_domains !== undefined ||
      tool.citations !== undefined && !supportsClaudeCitationConfig(tool.citations)) return false;
  if (tool.allowed_callers === undefined ? tool.type !== CLAUDE_ACCOUNTING_SERVER_FETCH_TYPES[0] :
    !Array.isArray(tool.allowed_callers) || tool.allowed_callers.length !== 1 || tool.allowed_callers[0] !== 'direct') return false;
  if (tool.use_cache !== undefined && (typeof tool.use_cache !== 'boolean' || !CLAUDE_ACCOUNTING_SERVER_FETCH_TYPES.slice(2).includes(tool.type)) ||
      tool.response_inclusion !== undefined && (tool.type !== CLAUDE_ACCOUNTING_SERVER_FETCH_TYPES[3] || !['full', 'excluded'].includes(tool.response_inclusion))) return false;
  return ['allowed_domains', 'blocked_domains'].every(field => tool[field] === undefined || Array.isArray(tool[field]) && tool[field].every(domain));
}
export function supportsClaudeServerFetchTool(tool) {
  try { return definition(snapshotAccountingPreparedData(tool)); } catch { return false; }
}
export function createClaudeServerFetchAuthority(tools, issued = new Set(), documents = []) {
  let definitions;
  try { definitions = snapshotAccountingPreparedData(tools)?.filter(tool => tool?.name === CLAUDE_ACCOUNTING_SERVER_FETCH_NAME); } catch { return null; }
  if (!Array.isArray(definitions) || definitions.length !== 1 || !definition(definitions[0])) return null;
  const enabled = definitions[0].citations?.enabled === true, pending = new Map();
  let bytes = 0, entries = 0;
  const reserve = value => {
    const size = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    if (bytes + size > CLAUDE_ACCOUNTING_SERVER_FETCH_AUTHORITY_BYTES || entries + 1 > CLAUDE_ACCOUNTING_SERVER_FETCH_AUTHORITY_ENTRIES) return false;
    bytes += size; entries++; return true;
  };
  return {
    pendingCount() { return pending.size; },
    acceptClientId(id) {
      if (typeof id !== 'string' || !id || issued.has(id) || !reserve(id)) return false;
      issued.add(id); return true;
    },
    acceptCall(value) {
      let block; try { block = snapshotAccountingPreparedData(value); } catch { return false; }
      if (!shape(block, ['type', 'id', 'name', 'input']) || block.type !== CLAUDE_BLOCK.SERVER_TOOL_USE || block.name !== CLAUDE_ACCOUNTING_SERVER_FETCH_NAME ||
          typeof block.id !== 'string' || !/^srvtoolu_[a-zA-Z0-9_]+$/.test(block.id) || issued.has(block.id) ||
          !shape(block.input, ['url']) || Object.keys(block.input).length !== 1 || !supportsClaudeAccountingUrl(block.input.url) || !reserve([block.id, block.input.url])) return false;
      issued.add(block.id); pending.set(block.id, block.input.url); return true;
    },
    acceptResult(value) {
      let block; try { block = snapshotAccountingPreparedData(value); } catch { return false; }
      if (!shape(block, ['type', 'tool_use_id', 'content']) || block.type !== CLAUDE_BLOCK.WEB_FETCH_TOOL_RESULT || !pending.has(block.tool_use_id)) return false;
      const result = block.content;
      if (shape(result, ['type', 'error_code']) && result.type === CLAUDE_ACCOUNTING_SERVER_FETCH_ERROR && CLAUDE_ACCOUNTING_SERVER_FETCH_ERRORS.includes(result.error_code)) {
        pending.delete(block.tool_use_id); return true;
      }
      if (!shape(result, ['type', 'url', 'retrieved_at', 'content']) || result.type !== CLAUDE_ACCOUNTING_SERVER_FETCH_RESULT ||
          !supportsClaudeAccountingUrl(result.url) || result.retrieved_at !== undefined && (typeof result.retrieved_at !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(result.retrieved_at) || !Number.isFinite(Date.parse(result.retrieved_at)))) return false;
      const document = result.content;
      if (!record(document) || document.type !== CLAUDE_BLOCK.DOCUMENT || document.cache_control !== undefined || document.context !== undefined ||
          !['text', 'base64'].includes(document.source?.type) || !supportsClaudeInlineMedia(document, { allowCitations: true }) ||
          document.citations?.enabled === true && !enabled) return false;
      const inventory = captureClaudeCitationDocuments({ messages: [{ content: [document] }] });
      if (!reserve([block.tool_use_id, inventory])) return false;
      pending.delete(block.tool_use_id); documents.push(...inventory); return true;
    },
  };
}
