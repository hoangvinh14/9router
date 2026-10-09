import { isDeepStrictEqual } from 'node:util';
import { PROVIDERS } from './providers.js';

// Equality with the original registry transport, not an arbitrary endpoint
// permission. Does not certify a custom executor's config/buildUrl or nodes.
// Internal caller must supply its bounded detached plain-data wire snapshot.
export function validateAccountingRuntimeTransport(provider, transport, url) {
  if (transport === null) return null;
  const allowed = PROVIDERS[provider]?.transports;
  if (!Array.isArray(allowed) || !allowed.some(entry => entry.format === 'openai' && isDeepStrictEqual(entry, transport)) ||
      typeof transport.baseUrl !== 'string' || url !== `${transport.baseUrl}${transport.urlSuffix || ''}`) {
    throw new Error('Accounting runtime transport unavailable');
  }
  return transport;
}
