import { CLAUDE_BLOCK } from '../translator/schema/blocks.js';

// Inline data only. This validator does not retrieve URLs or inspect file bytes;
// observed raw provider token counters, never MIME/size estimates, own debit.
export const CLAUDE_ACCOUNTING_IMAGE_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
export const CLAUDE_ACCOUNTING_PDF_TYPE = 'application/pdf';
export const CLAUDE_ACCOUNTING_TEXT_TYPE = 'text/plain';
export const CLAUDE_ACCOUNTING_INLINE_SOURCE = Object.freeze({ BASE64: 'base64', TEXT: 'text' });
export function supportsClaudeInlineMedia(block, { allowDocument = true } = {}) {
  if (!block || typeof block !== 'object' || Array.isArray(block) ||
      ![CLAUDE_BLOCK.IMAGE, CLAUDE_BLOCK.DOCUMENT].includes(block.type) || !allowDocument && block.type === CLAUDE_BLOCK.DOCUMENT) return false;
  const image = block.type === CLAUDE_BLOCK.IMAGE;
  const fields = image ? ['type', 'source', 'cache_control'] : ['type', 'source', 'cache_control', 'title', 'context'];
  if (Object.keys(block).some(key => !fields.includes(key)) ||
      !image && ['title', 'context'].some(key => block[key] !== undefined && typeof block[key] !== 'string')) return false;
  const source = block.source;
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
