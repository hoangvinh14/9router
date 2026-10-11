import { isDeepStrictEqual } from 'node:util';
import { PROVIDERS } from './providers.js';
import { FORMATS } from '../translator/formats.js';
import { captureAccountingBaseTransport } from './accountedBaseTransport.js';
import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { ACCOUNTED_GEMINI_BASE, ACCOUNTED_GEMINI_ACTION, ACCOUNTED_GEMINI_STREAM_ACTION, ACCOUNTED_GEMINI_MODEL, ACCOUNTED_GEMINI_MODE, ACCOUNTED_GEMINI_SSE_MODE, ACCOUNTED_GEMINI_HEADER_FIELDS, supportsGeminiRequest } from './accountedGeminiCandidate.js';

const unavailable = () => { throw new Error('Accounting Gemini transport unavailable'); };
// Fixed native API-key route only. Registry equality is not permission for a
// custom endpoint, OAuth/envelope or a different request transform.
export function validateAccountingGeminiDispatch(value, url) {
  const evidence = snapshotAccountingPreparedData(value);
  if (!evidence || Array.isArray(evidence) || Object.keys(evidence).length !== 4 ||
      !['model', 'mode', 'baseTransport', 'serializedBody'].every(key => Object.hasOwn(evidence, key)) ||
      typeof evidence.model !== 'string' || !ACCOUNTED_GEMINI_MODEL.test(evidence.model) ||
      ![ACCOUNTED_GEMINI_MODE, ACCOUNTED_GEMINI_SSE_MODE].includes(evidence.mode) ||
      !isDeepStrictEqual(evidence.baseTransport, captureAccountingBaseTransport(PROVIDERS.gemini)) || evidence.baseTransport.format !== FORMATS.GEMINI ||
      url !== `${ACCOUNTED_GEMINI_BASE}/${evidence.model}${evidence.mode === ACCOUNTED_GEMINI_SSE_MODE ? ACCOUNTED_GEMINI_STREAM_ACTION + '?alt=sse' : ACCOUNTED_GEMINI_ACTION}`) unavailable();
  let body;
  try { body = JSON.parse(evidence.serializedBody); } catch { unavailable(); }
  if (!supportsGeminiRequest(body)) unavailable();
  return evidence;
}
export function validateAccountingGeminiPost(evidence, url, options) {
  const original = validateAccountingGeminiDispatch(evidence, url), headers = new Headers(options.headers);
  if (options.method !== 'POST' || options.redirect !== 'error' || options.body !== original.serializedBody ||
      [...headers.keys()].some(key => !ACCOUNTED_GEMINI_HEADER_FIELDS.includes(key)) ||
      headers.get('content-type') !== 'application/json' || !headers.get('x-goog-api-key')) unavailable();
  return original;
}
