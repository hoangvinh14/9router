import { CLAUDE_BLOCK } from '../translator/schema/blocks.js';
import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { supportsClaudeCitationConfig } from './accountingClaudeCitations.js';

// Client-supplied RAG text only, never provider search invocation or URL retrieval.
export const CLAUDE_ACCOUNTING_SEARCH_CITATION = 'search_result_location';
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
export function supportsClaudeSearchResult(block) {
  return object(block) && block.type === CLAUDE_BLOCK.SEARCH_RESULT &&
    Object.keys(block).every(key => ['type', 'source', 'title', 'content', 'citations', 'cache_control'].includes(key)) &&
    typeof block.source === 'string' && !!block.source && typeof block.title === 'string' &&
    (block.citations === undefined || supportsClaudeCitationConfig(block.citations)) &&
    Array.isArray(block.content) && block.content.length > 0 && block.content.every(child =>
      object(child) && Object.keys(child).length === 2 && child.type === CLAUDE_BLOCK.TEXT && typeof child.text === 'string' && !!child.text);
}
export function captureClaudeSearchResults(body) {
  const results = [];
  for (const message of Array.isArray(body?.messages) ? body.messages : []) {
    for (const block of Array.isArray(message?.content) ? message.content : []) {
      const blocks = block?.type === CLAUDE_BLOCK.TOOL_RESULT && Array.isArray(block.content) ? block.content : [block];
      for (const value of blocks) if (value?.type === CLAUDE_BLOCK.SEARCH_RESULT) results.push({
        source: value.source, title: value.title, enabled: value.citations?.enabled === true, content: Array.isArray(value.content) ? value.content.map(child => child?.text) : [],
      });
    }
  }
  return results.length ? results : null;
}
export function snapshotClaudeSearchResults(value) {
  if (value === null) return null;
  const results = snapshotAccountingPreparedData(value);
  if (!Array.isArray(results) || !results.length || results.some(result => !object(result) ||
      Object.keys(result).length !== 4 || !['source', 'title', 'enabled', 'content'].every(key => Object.hasOwn(result, key)) ||
      typeof result.source !== 'string' || !result.source || typeof result.title !== 'string' || typeof result.enabled !== 'boolean' ||
      !Array.isArray(result.content) || !result.content.length || result.content.some(text => typeof text !== 'string' || !text))) throw new Error('Invalid Claude search citation authority');
  return results;
}
export function supportsClaudeSearchCitation(value, results) {
  const fields = ['type', 'source', 'title', 'cited_text', 'search_result_index', 'start_block_index', 'end_block_index'];
  if (!object(value) || value.type !== CLAUDE_ACCOUNTING_SEARCH_CITATION || Object.keys(value).length !== fields.length ||
      !fields.every(key => Object.hasOwn(value, key)) || !Number.isSafeInteger(value.search_result_index) || value.search_result_index < 0 ||
      !Number.isSafeInteger(value.start_block_index) || value.start_block_index < 0 ||
      !Number.isSafeInteger(value.end_block_index) || value.end_block_index <= value.start_block_index) return false;
  const result = results?.[value.search_result_index];
  return !!result?.enabled && value.source === result.source && value.title === result.title &&
    value.end_block_index <= result.content.length && typeof value.cited_text === 'string' &&
    value.cited_text === result.content.slice(value.start_block_index, value.end_block_index).join('');
}
