import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';

// Structural input controls only. Resolution labels do not prove model support,
// frame extraction, actual token quantities, rate equivalence or precedence.
export const ACCOUNTING_GEMINI_GENERATION_RESOLUTION_LEVELS = Object.freeze([
  'MEDIA_RESOLUTION_UNSPECIFIED', 'MEDIA_RESOLUTION_LOW', 'MEDIA_RESOLUTION_MEDIUM', 'MEDIA_RESOLUTION_HIGH',
]);
export const ACCOUNTING_GEMINI_PART_RESOLUTION_LEVELS = Object.freeze([
  ...ACCOUNTING_GEMINI_GENERATION_RESOLUTION_LEVELS, 'MEDIA_RESOLUTION_ULTRA_HIGH',
]);
export function supportsGeminiVideoPartResolution(value) {
  try {
    const resolution = snapshotAccountingPreparedData(value);
    return !!resolution && typeof resolution === 'object' && !Array.isArray(resolution) &&
      Object.keys(resolution).every(key => key === 'level') &&
      (!Object.hasOwn(resolution, 'level') || ACCOUNTING_GEMINI_PART_RESOLUTION_LEVELS.includes(resolution.level));
  } catch { return false; }
}
export const supportsGeminiVideoGenerationResolution = value => typeof value === 'string' && ACCOUNTING_GEMINI_GENERATION_RESOLUTION_LEVELS.includes(value);
