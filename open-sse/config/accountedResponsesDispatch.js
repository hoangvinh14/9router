import { isDeepStrictEqual } from 'node:util';
import { PROVIDERS } from './providers.js';
import { captureAccountingBaseTransport } from './accountedBaseTransport.js';
import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { ACCOUNTED_RESPONSES_URL, ACCOUNTED_RESPONSES_MODE, ACCOUNTED_RESPONSES_SSE_MODE, ACCOUNTED_RESPONSES_HEADER_FIELDS, supportsResponsesRequest } from './accountedResponsesCandidate.js';
import { FORMATS } from '../translator/formats.js';

const unavailable = () => { throw new Error('Accounting Responses transport unavailable'); };
// API-key/text-only fixed native Responses route. A registry Chat Completions
// base URL is an equality input, never the Responses URL construction authority.
export function validateAccountingResponsesDispatch(value, url) {
  const evidence = snapshotAccountingPreparedData(value);
  if (!evidence || Array.isArray(evidence) || Object.keys(evidence).length !== 4 ||
      !['model', 'mode', 'baseTransport', 'serializedBody'].every(key => Object.hasOwn(evidence, key)) ||
      url !== ACCOUNTED_RESPONSES_URL || typeof evidence.model !== 'string' ||
      ![ACCOUNTED_RESPONSES_MODE, ACCOUNTED_RESPONSES_SSE_MODE].includes(evidence.mode) ||
      !isDeepStrictEqual(evidence.baseTransport, captureAccountingBaseTransport(PROVIDERS.openai)) || evidence.baseTransport.format !== FORMATS.OPENAI) unavailable();
  let body;
  try { body = JSON.parse(evidence.serializedBody); } catch { unavailable(); }
  if (!supportsResponsesRequest(body, evidence.model) || body.stream !== (evidence.mode === ACCOUNTED_RESPONSES_SSE_MODE)) unavailable();
  return evidence;
}
export function validateAccountingResponsesPost(evidence, url, options) {
  const original = validateAccountingResponsesDispatch(evidence, url);
  const headers = new Headers(options.headers);
  if (options.method !== 'POST' || options.redirect !== 'error' || options.body !== original.serializedBody ||
      [...headers.keys()].some(key => !ACCOUNTED_RESPONSES_HEADER_FIELDS.includes(key)) ||
      headers.get('content-type') !== 'application/json' || !headers.get('authorization')?.startsWith('Bearer ')) unavailable();
  return original;
}
