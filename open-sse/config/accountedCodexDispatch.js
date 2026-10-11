import { isDeepStrictEqual } from 'node:util';
import { PROVIDERS } from './providers.js';
import { captureAccountingBaseTransport } from './accountedBaseTransport.js';
import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { ACCOUNTED_CODEX_URL, ACCOUNTED_CODEX_SSE_MODE, ACCOUNTED_CODEX_HEADER_FIELDS, supportsCodexRequest } from './accountedCodexCandidate.js';
import { FORMATS } from '../translator/formats.js';

const unavailable = () => { throw new Error('Accounting Codex transport unavailable'); };
// Fixed native full Responses OAuth SSE, no lite/compact/refresh/retry authority.
export function validateAccountingCodexDispatch(value, url) {
  const evidence = snapshotAccountingPreparedData(value);
  if (!evidence || Array.isArray(evidence) || Object.keys(evidence).length !== 4 ||
      !['model', 'mode', 'baseTransport', 'serializedBody'].every(key => Object.hasOwn(evidence, key)) ||
      url !== ACCOUNTED_CODEX_URL || typeof evidence.model !== 'string' || evidence.mode !== ACCOUNTED_CODEX_SSE_MODE ||
      !isDeepStrictEqual(evidence.baseTransport, captureAccountingBaseTransport(PROVIDERS.codex)) ||
      evidence.baseTransport.baseUrl !== url || evidence.baseTransport.format !== FORMATS.OPENAI_RESPONSES) unavailable();
  let body;
  try { body = JSON.parse(evidence.serializedBody); } catch { unavailable(); }
  if (!supportsCodexRequest(body, evidence.model)) unavailable();
  return evidence;
}
export function validateAccountingCodexPost(evidence, url, options) {
  const original = validateAccountingCodexDispatch(evidence, url), headers = new Headers(options.headers);
  const identity = value => typeof value === 'string' && value.length > 0 && !/[\x00-\x20\x7f]/.test(value);
  if (options.method !== 'POST' || options.redirect !== 'error' || options.body !== original.serializedBody ||
      [...headers.keys()].some(key => !ACCOUNTED_CODEX_HEADER_FIELDS.includes(key)) ||
      headers.get('content-type') !== 'application/json' || headers.get('accept') !== 'text/event-stream' ||
      !headers.get('authorization')?.startsWith('Bearer ') || !identity(headers.get('authorization')?.slice(7)) ||
      !identity(headers.get('session_id')) || !identity(headers.get('chatgpt-account-id')) ||
      headers.get('originator') !== original.baseTransport.headers?.originator ||
      headers.get('user-agent') !== original.baseTransport.headers?.['User-Agent'] ||
      headers.get('version') !== original.baseTransport.headers?.version) unavailable();
  return original;
}
