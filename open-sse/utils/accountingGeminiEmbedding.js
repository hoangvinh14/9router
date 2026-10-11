import { snapshotAccountingPreparedData } from '../config/accountedBaseDispatch.js';
import { ACCOUNTING_GEMINI_EMBED_SINGLE_FIELDS, ACCOUNTING_GEMINI_EMBED_BATCH_FIELDS,
  ACCOUNTING_GEMINI_EMBED_VECTOR_FIELDS, ACCOUNTING_GEMINI_EMBED_INSPECTION_FIELDS } from '../config/accountingGeminiSchema.js';
import { FORMATS } from '../translator/formats.js';
import { normalizeExactUsage } from './exactUsage.js';
import { readAccountingJson } from './readAccountingJson.js';

const unavailable = () => { throw new Error('Gemini embedding response unavailable'); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;

// Detached raw response only. Callers must separately establish original request,
// selected model/credentials/route, own POST admission and terminal ACK authority.
export function inspectRawGeminiEmbedding(message, options) {
  let detached;
  try { detached = snapshotAccountingPreparedData({ message, options }); } catch { unavailable(); }
  message = detached.message; options = detached.options;
  if (!fields(options, ACCOUNTING_GEMINI_EMBED_INSPECTION_FIELDS) ||
      typeof options.batch !== 'boolean' || !positiveInteger(options.inputCount) ||
      !options.batch && options.inputCount !== 1 ||
      Object.hasOwn(options, 'dimensions') && !positiveInteger(options.dimensions)) unavailable();
  const batch = options.batch;
  if (!fields(message, batch ? ACCOUNTING_GEMINI_EMBED_BATCH_FIELDS : ACCOUNTING_GEMINI_EMBED_SINGLE_FIELDS) ||
      !Object.hasOwn(message, batch ? 'embeddings' : 'embedding')) unavailable();
  const vectors = batch ? message.embeddings : [message.embedding];
  if (!Array.isArray(vectors) || vectors.length !== options.inputCount) unavailable();
  let width;
  for (const vector of vectors) {
    if (!fields(vector, ACCOUNTING_GEMINI_EMBED_VECTOR_FIELDS) || !Object.hasOwn(vector, 'values') ||
        !Array.isArray(vector.values) || !vector.values.length ||
        !vector.values.every(value => typeof value === 'number' && Number.isFinite(value))) unavailable();
    if (width === undefined) width = vector.values.length;
    if (vector.values.length !== width || Object.hasOwn(options, 'dimensions') && vector.values.length !== options.dimensions) unavailable();
  }
  let usage = null;
  if (Object.hasOwn(message, 'usageMetadata')) {
    usage = normalizeExactUsage(message.usageMetadata, FORMATS.GEMINI, 'embeddings');
    if (!usage) unavailable();
  }
  // Missing usage is unknown, never inferred from vector length or normalized
  // zeros. The official envelope has no model ID to certify request selection.
  return Object.freeze({ message, usage });
}

export async function readBufferedGeminiEmbedding(response, signal, options) {
  signal?.throwIfAborted();
  // Exact raw evidence is independent of HTTP success. A failed status may
  // carry the same complete documented envelope; callers must still settle it
  // as failed, never authorize success from usage alone. Unknown error grammar
  // remains rejected by the full inspector, and redirects stay unsupported.
  if (response.status < 200 || response.status >= 300 && response.status < 400 || response.status >= 600 || response.redirected ||
      response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') unavailable();
  const message = await readAccountingJson(response, signal);
  signal?.throwIfAborted();
  return inspectRawGeminiEmbedding(message, options);
}
