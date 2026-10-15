import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';

// Legacy VideoMetadata structural contract; not decoded duration, frame count,
// upstream model eligibility or a processing_options migration. Preserve bytes.
export const ACCOUNTING_GEMINI_VIDEO_FPS_MAX = 24;
export const ACCOUNTING_GEMINI_VIDEO_OFFSET_MAX_SECONDS = 315576000000n;
const billion = 1000000000n;
function offset(value) {
  if (typeof value !== 'string') return null;
  const match = /^(0|[1-9][0-9]{0,11})(?:\.([0-9]{1,9}))?s$/.exec(value);
  if (!match) return null;
  const seconds = BigInt(match[1]), nanos = BigInt((match[2] || '').padEnd(9, '0'));
  const total = seconds * billion + nanos;
  return total <= ACCOUNTING_GEMINI_VIDEO_OFFSET_MAX_SECONDS * billion ? total : null;
}
export function supportsGeminiVideoMetadata(value) {
  try {
    const metadata = snapshotAccountingPreparedData(value);
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) ||
        Object.keys(metadata).some(key => !['fps', 'startOffset', 'endOffset'].includes(key)) ||
        Object.hasOwn(metadata, 'fps') && (typeof metadata.fps !== 'number' || !Number.isFinite(metadata.fps) || metadata.fps <= 0 || metadata.fps > ACCOUNTING_GEMINI_VIDEO_FPS_MAX)) return false;
    const start = Object.hasOwn(metadata, 'startOffset') ? offset(metadata.startOffset) : undefined;
    const end = Object.hasOwn(metadata, 'endOffset') ? offset(metadata.endOffset) : undefined;
    return start !== null && end !== null && (start === undefined || end === undefined || start < end);
  } catch { return false; }
}
