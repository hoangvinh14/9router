import { isDeepStrictEqual, types } from 'node:util';
import { PROVIDERS } from './providers.js';

// Only transport inputs used by the narrow Base/Default URL/header slice.
// Does not certify transformations, custom executors, OAuth or provider-nodes.
const FIELDS = Object.freeze(['baseUrl', 'baseUrls', 'urlSuffix', 'headers', 'noAuth', 'format', 'forceStream', 'transports']);
const unavailable = () => { throw new Error('Accounting Base transport unavailable'); };
export function captureAccountingBaseTransport(config) {
  if (!config || types.isProxy(config) || typeof config !== 'object') unavailable();
  const result = {};
  for (const field of FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(config, field);
    if (descriptor && !Object.hasOwn(descriptor, 'value')) unavailable();
    result[field] = descriptor?.value ?? null;
  }
  return result;
}

// The caller supplies the bounded detached plain-data wire snapshot. Registry
// equality never grants authority for arbitrary fixture or custom endpoint URLs.
export function validateAccountingBaseTransport(provider, evidence, url, urlIndex, runtimeTransport) {
  if (!Number.isSafeInteger(urlIndex) || urlIndex < 0 || !isDeepStrictEqual(evidence, captureAccountingBaseTransport(PROVIDERS[provider]))) unavailable();
  if (runtimeTransport !== null) return; // Separate exact runtime registry gate.
  const bases = evidence.baseUrls ?? (evidence.baseUrl ? [evidence.baseUrl] : []);
  if (!Array.isArray(bases) || urlIndex >= bases.length || typeof bases[urlIndex] !== 'string') unavailable();
  if (url !== `${bases[urlIndex]}${evidence.urlSuffix || ''}`) unavailable();
}
