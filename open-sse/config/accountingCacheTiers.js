// Distinct observed cache-write subsets. No TTL inference from request content,
// no default 1h rate, and no multiplication of a flat reference rate.
export const ACCOUNTING_CACHE_TIER_FIELDS = Object.freeze(['cacheWrite5m', 'cacheWrite1h']);
export const CLAUDE_CACHE_TIER_FIELDS = Object.freeze(['ephemeral_5m_input_tokens', 'ephemeral_1h_input_tokens']);
export const REFERENCE_RATE_FIELDS = Object.freeze(['input', 'output', 'cached', 'reasoning', 'cache_creation', 'cache_creation_1h']);
export function exactCacheWriteTiers(usage) {
  if (!ACCOUNTING_CACHE_TIER_FIELDS.some(field => Object.hasOwn(usage, field))) return null;
  if (![...ACCOUNTING_CACHE_TIER_FIELDS, 'cacheWrite'].every(field => Number.isSafeInteger(usage[field]) && usage[field] >= 0) ||
      BigInt(usage.cacheWrite5m) + BigInt(usage.cacheWrite1h) !== BigInt(usage.cacheWrite)) throw new Error('Invalid exact cache-write tiers');
  return { five: usage.cacheWrite5m, hour: usage.cacheWrite1h };
}
