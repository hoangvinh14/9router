import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { ACCOUNTING_GEMINI_INLINE_MIME_TYPES, ACCOUNTING_GEMINI_INLINE_AUDIO_MIME_TYPES, ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES } from './accountingGeminiInlineMedia.js';

// Observed upload metadata only. Project visibility is NOT gateway key tenancy.
// No network, current-time admission, resource registration or token inference.
export const ACCOUNTING_GEMINI_FILE_URI_BASE = 'https://generativelanguage.googleapis.com/v1beta/';
const REQUIRED_FIELDS = Object.freeze(['name', 'uri', 'mimeType', 'sizeBytes', 'sha256Hash', 'createTime', 'updateTime', 'expirationTime', 'state', 'source']);
const MIME_TYPES = Object.freeze([...ACCOUNTING_GEMINI_INLINE_MIME_TYPES, ...ACCOUNTING_GEMINI_INLINE_AUDIO_MIME_TYPES, ...ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES]);
const invalid = () => { throw new Error('Invalid observed Gemini uploaded file metadata'); };

// Provider output timestamps are Z-normalized with 0/3/6/9 fractional digits.
// Date validates the calendar at second precision; BigInt retains all nanos.
export function geminiFileTimestampNanos(value) {
  if (typeof value !== 'string') invalid();
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{3}|\d{6}|\d{9}))?Z(?![\s\S])/.exec(value);
  if (!match || match[1].startsWith('0000-')) invalid();
  const millis = Date.parse(match[1] + 'Z');
  if (!Number.isFinite(millis) || new Date(millis).toISOString() !== match[1] + '.000Z') invalid();
  return BigInt(millis) * 1_000_000n + BigInt((match[2] || '').padEnd(9, '0'));
}

export function captureGeminiUploadedFileMetadata(value) {
  return captureFileMetadata(value, 'ACTIVE');
}
export function captureGeminiProcessingFileMetadata(value) {
  return captureFileMetadata(value, 'PROCESSING');
}
function captureFileMetadata(value, state) {
  let observed;
  try { observed = snapshotAccountingPreparedData(value); } catch { invalid(); }
  if (!observed || typeof observed !== 'object' || Array.isArray(observed) ||
      REQUIRED_FIELDS.some(field => !Object.hasOwn(observed, field)) ||
      Object.keys(observed).some(field => !REQUIRED_FIELDS.includes(field) && field !== 'displayName') ||
      observed.state !== state || observed.source !== 'UPLOADED') invalid();
  if (typeof observed.name !== 'string' || !/^files\/[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?(?![\s\S])/.test(observed.name) ||
      observed.uri !== ACCOUNTING_GEMINI_FILE_URI_BASE + observed.name || !MIME_TYPES.includes(observed.mimeType)) invalid();
  if (typeof observed.sizeBytes !== 'string' || !/^(0|[1-9]\d{0,18})(?![\s\S])/.test(observed.sizeBytes) || BigInt(observed.sizeBytes) > 9_223_372_036_854_775_807n) invalid();
  if (typeof observed.sha256Hash !== 'string' || !/^[A-Za-z0-9+/]{43}=(?![\s\S])/.test(observed.sha256Hash) ||
      Buffer.from(observed.sha256Hash, 'base64').length !== 32 || Buffer.from(observed.sha256Hash, 'base64').toString('base64') !== observed.sha256Hash) invalid();
  if (Object.hasOwn(observed, 'displayName') && (typeof observed.displayName !== 'string' || Array.from(observed.displayName).length > 512)) invalid();
  const created = geminiFileTimestampNanos(observed.createTime), updated = geminiFileTimestampNanos(observed.updateTime), expires = geminiFileTimestampNanos(observed.expirationTime);
  if (created > updated || updated >= expires) invalid();
  // The bounded snapshot is already deeply frozen. Do not add inferred fields
  // or substitute a validation projection into the client's original request.
  return observed;
}
