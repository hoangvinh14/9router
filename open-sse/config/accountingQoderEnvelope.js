import { ACCOUNTING_SSE_EVENT_MAX_BYTES, ACCOUNTING_SSE_CHUNK_MAX_BYTES } from './accountingStreamLimits.js';

// Structural raw envelope limits only; not semantic usage/terminal authority.
export const QODER_ACCOUNTING_ENVELOPE_LIMITS = Object.freeze({
  maxEventBytes: ACCOUNTING_SSE_EVENT_MAX_BYTES,
  maxChunkBytes: ACCOUNTING_SSE_CHUNK_MAX_BYTES,
  maxRecords: 1024,
  maxTotalBytes: 8 * 1024 * 1024,
});
export const QODER_ACCOUNTING_ENVELOPE_FIELDS = Object.freeze(['statusCodeValue', 'body']);
export const QODER_ACCOUNTING_STATUS_MIN = 100;
export const QODER_ACCOUNTING_STATUS_MAX = 599;
export const QODER_ACCOUNTING_RAW_DONE = '[DONE]';
