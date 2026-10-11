import { isDeepStrictEqual } from 'node:util';
import { PROVIDER_MEDIA } from '../providers/index.js';
import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';

import { ACCOUNTED_EMBEDDINGS_URL } from './accountedEmbeddingsCandidate.js';
const unavailable = () => { throw new Error('Accounting embeddings transport unavailable'); };
const record = value => value && typeof value === 'object' && !Array.isArray(value);
export function captureAccountingEmbeddingsConfig() {
  return snapshotAccountingPreparedData(PROVIDER_MEDIA.openai?.embeddingConfig ?? null);
}
// Narrow text-input native API-key work only. Preserve the original request too:
// the normal adapter must not silently erase unsupported options/token arrays.
export function validateAccountingEmbeddingsDispatch(value, url) {
  const evidence = snapshotAccountingPreparedData(value);
  const fields = ['model', 'mediaConfig', 'serializedBody', 'originalSerializedBody'];
  if (!record(evidence) || Object.keys(evidence).length !== fields.length || fields.some(key => !Object.hasOwn(evidence, key)) ||
      typeof evidence.model !== 'string' || !evidence.model || !isDeepStrictEqual(evidence.mediaConfig, captureAccountingEmbeddingsConfig()) ||
      evidence.mediaConfig?.baseUrl !== ACCOUNTED_EMBEDDINGS_URL || url !== ACCOUNTED_EMBEDDINGS_URL ||
      evidence.mediaConfig.authType !== 'apikey' || evidence.mediaConfig.authHeader !== 'bearer') unavailable();
  let original, body;
  try { original = JSON.parse(evidence.originalSerializedBody); body = JSON.parse(evidence.serializedBody); } catch { unavailable(); }
  if (!record(original) || Object.keys(original).some(key => !['model', 'input', 'encoding_format', 'dimensions'].includes(key)) ||
      original.model !== evidence.model || !(typeof original.input === 'string' && original.input.length ||
      Array.isArray(original.input) && original.input.length && original.input.every(item => typeof item === 'string' && item.length)) ||
      original.encoding_format !== undefined && original.encoding_format !== 'float' ||
      original.dimensions !== undefined && (!Number.isSafeInteger(original.dimensions) || original.dimensions <= 0)) unavailable();
  const expected = { model: evidence.model, input: original.input, encoding_format: 'float' };
  if (original.dimensions !== undefined) expected.dimensions = original.dimensions;
  if (!isDeepStrictEqual(body, expected)) unavailable();
  return evidence;
}
export function validateAccountingEmbeddingsPost(evidence, url, options) {
  const original = validateAccountingEmbeddingsDispatch(evidence, url), headers = new Headers(options.headers);
  if (options.method !== 'POST' || options.redirect !== 'error' || options.body !== original.serializedBody ||
      [...headers.keys()].some(key => !['content-type', 'authorization'].includes(key)) ||
      headers.get('content-type') !== 'application/json' || !headers.get('authorization')?.startsWith('Bearer ')) unavailable();
  return original;
}
