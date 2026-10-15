import { CLAUDE_BLOCK } from '../translator/schema/blocks.js';
import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';

// Inline document citations only, not file/search/server-tool or retrieval approval.
// Metadata is response content, never an estimate or an additional billing counter.
export const CLAUDE_ACCOUNTING_CUSTOM_SOURCE = 'content';
export const CLAUDE_ACCOUNTING_CITATION_DELTA = 'citations_delta';
export const CLAUDE_ACCOUNTING_CITATION_FIELD = 'citations';
export const CLAUDE_ACCOUNTING_CITATION_RANGES = Object.freeze({
  char_location: Object.freeze({ kind: 'text', start: 'start_char_index', end: 'end_char_index', minimum: 0 }),
  page_location: Object.freeze({ kind: 'pdf', start: 'start_page_number', end: 'end_page_number', minimum: 1 }),
  content_block_location: Object.freeze({ kind: CLAUDE_ACCOUNTING_CUSTOM_SOURCE, start: 'start_block_index', end: 'end_block_index', minimum: 0 }),
});
export function supportsClaudeCitationConfig(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && typeof value.enabled === 'boolean';
}
export function captureClaudeCitationDocuments(body) {
  const documents = (Array.isArray(body.messages) ? body.messages : []).flatMap(message => Array.isArray(message?.content)
    ? message.content.filter(block => block?.type === CLAUDE_BLOCK.DOCUMENT).map(block => ({
      kind: block.source?.type === CLAUDE_ACCOUNTING_CUSTOM_SOURCE ? CLAUDE_ACCOUNTING_CUSTOM_SOURCE : block.source?.type === 'text' ? 'text' : 'pdf',
      enabled: block.citations?.enabled === true,
      ...(block.source?.type === CLAUDE_ACCOUNTING_CUSTOM_SOURCE ? { blockCount: Array.isArray(block.source.content) ? block.source.content.length : 0 } : {}),
    })) : []);
  return documents.length ? documents : null;
}
export function snapshotClaudeCitationDocuments(value) {
  if (value === null) return null;
  const documents = snapshotAccountingPreparedData(value);
  if (!Array.isArray(documents) || !documents.length || documents.some(document =>
    !document || typeof document !== 'object' || Array.isArray(document) ||
    !Object.hasOwn(document, 'kind') || !Object.hasOwn(document, 'enabled') ||
    !['text', 'pdf', CLAUDE_ACCOUNTING_CUSTOM_SOURCE].includes(document.kind) || typeof document.enabled !== 'boolean' ||
    (document.kind === CLAUDE_ACCOUNTING_CUSTOM_SOURCE
      ? Object.keys(document).length !== 3 || !Object.hasOwn(document, 'blockCount') || !Number.isSafeInteger(document.blockCount) || document.blockCount <= 0
      : Object.keys(document).length !== 2))) throw new Error('Invalid Claude citation authority');
  return documents;
}
export function supportsClaudeDocumentCitation(value, documents) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !documents) return false;
  const range = Object.hasOwn(CLAUDE_ACCOUNTING_CITATION_RANGES, value.type) ? CLAUDE_ACCOUNTING_CITATION_RANGES[value.type] : null;
  if (!range || !Number.isSafeInteger(value.document_index) || value.document_index < 0) return false;
  const document = documents[value.document_index];
  if (!document?.enabled || document.kind !== range.kind) return false;
  const required = ['type', 'cited_text', 'document_index', 'document_title', range.start, range.end];
  return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || key === 'file_id') &&
    typeof value.cited_text === 'string' && (value.document_title === null || typeof value.document_title === 'string') &&
    (!Object.hasOwn(value, 'file_id') || value.file_id === null) &&
    Number.isSafeInteger(value[range.start]) && value[range.start] >= range.minimum &&
    Number.isSafeInteger(value[range.end]) && value[range.end] > value[range.start] &&
    (range.kind !== CLAUDE_ACCOUNTING_CUSTOM_SOURCE || value[range.end] <= document.blockCount);
}
