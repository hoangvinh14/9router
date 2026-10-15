import { CLAUDE_BLOCK } from '../translator/schema/blocks.js';
import { CLAUDE_ACCOUNTING_CUSTOM_SOURCE, supportsClaudeCitationConfig } from './accountingClaudeCitations.js';
import { assertPublicUrl } from '../../src/shared/utils/ssrfGuard.js';

// Inline data or explicit queued URL references. No local retrieval/DNS/file inspection;
// literal-host checks do not establish upstream DNS/redirect/retrieval safety.
// observed raw provider token counters, never MIME/size estimates, own debit.
export const CLAUDE_ACCOUNTING_IMAGE_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
export const CLAUDE_ACCOUNTING_PDF_TYPE = 'application/pdf';
export const CLAUDE_ACCOUNTING_TEXT_TYPE = 'text/plain';
export const CLAUDE_ACCOUNTING_INLINE_SOURCE = Object.freeze({ BASE64: 'base64', TEXT: 'text' });
export const CLAUDE_ACCOUNTING_URL_SOURCE = 'url';
export function supportsClaudeAccountingUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\/[^/?#]+/i.test(value) || /[\s\u0000-\u001f\u007f\\]/.test(value) ||
      value.split(/[/?#]/)[2]?.includes('@')) return false;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.hash || value.includes('#')) return false;
    assertPublicUrl(value); return true;
  } catch { return false; }
}
export function supportsClaudeInlineMedia(block, { allowDocument = true, allowCitations = false, allowUrlMedia = false } = {}) {
  if (!block || typeof block !== 'object' || Array.isArray(block) ||
      ![CLAUDE_BLOCK.IMAGE, CLAUDE_BLOCK.DOCUMENT].includes(block.type) || !allowDocument && block.type === CLAUDE_BLOCK.DOCUMENT) return false;
  const image = block.type === CLAUDE_BLOCK.IMAGE;
  const fields = image ? ['type', 'source', 'cache_control'] : ['type', 'source', 'cache_control', 'title', 'context', ...(allowCitations ? ['citations'] : [])];
  if (Object.keys(block).some(key => !fields.includes(key)) ||
      block.citations !== undefined && (!allowCitations || image || !supportsClaudeCitationConfig(block.citations)) ||
      !image && ['title', 'context'].some(key => block[key] !== undefined && typeof block[key] !== 'string')) return false;
  const source = block.source;
  if (allowUrlMedia === true && source?.type === CLAUDE_ACCOUNTING_URL_SOURCE) {
    return !Array.isArray(source) && Object.keys(source).length === 2 && Object.hasOwn(source, 'url') && supportsClaudeAccountingUrl(source.url);
  }
  // Explicit queued document opt-in only. Custom chunks stay in original order;
  // reject nested documents/cache/citations rather than normalize or drop them.
  if (!image && allowCitations && source?.type === CLAUDE_ACCOUNTING_CUSTOM_SOURCE) {
    return Object.keys(source).length === 2 && Object.hasOwn(source, 'content') &&
      Array.isArray(source.content) && source.content.length > 0 && source.content.every(child => {
        if (!child || typeof child !== 'object' || Array.isArray(child)) return false;
        if (child.type === CLAUDE_BLOCK.TEXT) return Object.keys(child).length === 2 && typeof child.text === 'string';
        return child.type === CLAUDE_BLOCK.IMAGE && Object.keys(child).length === 2 &&
          Object.hasOwn(child, 'source') && supportsClaudeInlineMedia(child, { allowDocument: false, allowUrlMedia });
      });
  }
  if (!source || typeof source !== 'object' || Array.isArray(source) || Object.keys(source).length !== 3 ||
      !['type', 'media_type', 'data'].every(key => Object.hasOwn(source, key)) || typeof source.data !== 'string' || !source.data) return false;
  if (!image && source.type === CLAUDE_ACCOUNTING_INLINE_SOURCE.TEXT) return source.media_type === CLAUDE_ACCOUNTING_TEXT_TYPE;
  if (source.type !== CLAUDE_ACCOUNTING_INLINE_SOURCE.BASE64 ||
      !(image ? CLAUDE_ACCOUNTING_IMAGE_TYPES.includes(source.media_type) : source.media_type === CLAUDE_ACCOUNTING_PDF_TYPE)) return false;
  // Canonical padded base64; no data URLs, whitespace, ignored garbage or
  // decoder permissiveness. Plain-data/serialized bounds run before traversal.
  if (source.data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(source.data)) return false;
  return Buffer.from(source.data, 'base64').toString('base64') === source.data;
}
