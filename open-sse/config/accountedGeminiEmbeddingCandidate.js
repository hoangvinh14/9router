import { isDeepStrictEqual } from 'node:util';
import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { ACCOUNTED_GEMINI_MODEL } from './accountedGeminiCandidate.js';

export const ACCOUNTED_GEMINI_EMBED_CONVERSION_FIELDS = Object.freeze(['model', 'original', 'actual']);
export const ACCOUNTED_GEMINI_EMBED_ORIGINAL_FIELDS = Object.freeze(['model', 'input', 'encoding_format', 'dimensions']);
const unavailable = () => { throw new Error('Gemini embedding conversion unavailable'); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = (value, allowed) => record(value) && Object.keys(value).every(key => allowed.includes(key));
const text = value => typeof value === 'string' && value.length > 0;

// Whole original/prepared equality only; no adapter invocation, model discovery,
// credential-origin grant, URL permission, pricing snapshot or intent ACK.
export function captureGeminiEmbeddingConversion(value) {
  let evidence;
  try { evidence = snapshotAccountingPreparedData(value); } catch { unavailable(); }
  if (!fields(evidence, ACCOUNTED_GEMINI_EMBED_CONVERSION_FIELDS) ||
      Object.keys(evidence).length !== ACCOUNTED_GEMINI_EMBED_CONVERSION_FIELDS.length ||
      !ACCOUNTED_GEMINI_EMBED_CONVERSION_FIELDS.every(key => Object.hasOwn(evidence, key)) ||
      typeof evidence.model !== 'string' || !ACCOUNTED_GEMINI_MODEL.test(evidence.model)) unavailable();
  const { model, original, actual } = evidence;
  if (!fields(original, ACCOUNTED_GEMINI_EMBED_ORIGINAL_FIELDS) || original.model !== model ||
      Object.hasOwn(original, 'encoding_format') && original.encoding_format !== 'float' ||
      Object.hasOwn(original, 'dimensions') && (!Number.isSafeInteger(original.dimensions) || original.dimensions <= 0)) unavailable();
  const batch = Array.isArray(original.input);
  if (!(batch ? original.input.length > 0 && original.input.every(text) : text(original.input))) unavailable();
  const dimensions = Object.hasOwn(original, 'dimensions') ? { dimensions: original.dimensions } : {};
  const entry = input => ({ model: `models/${model}`, content: { parts: [{ text: input }] },
    ...(Object.hasOwn(original, 'dimensions') ? { outputDimensionality: original.dimensions } : {}) });
  const expected = batch ? { requests: original.input.map(entry) } : entry(original.input);
  if (!isDeepStrictEqual(actual, expected)) unavailable();
  // Rebound the complete output, including inspection inputs and generated
  // oracle, so aggregate ceilings are not bypassed by internal duplication.
  try {
    return snapshotAccountingPreparedData({ ...evidence,
      inspection: { inputCount: batch ? original.input.length : 1, batch, ...dimensions } });
  } catch { unavailable(); }
}
