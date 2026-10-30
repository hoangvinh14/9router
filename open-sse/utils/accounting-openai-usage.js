// This profile requires explicit detail counters. Absence never means zero.
export const OPENAI_EXPLICIT_USAGE_PROFILE = "openai-chat-explicit-details";

export function normalizeOpenAIUsage(raw, profile) {
  if (profile !== OPENAI_EXPLICIT_USAGE_PROFILE || !raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw.prompt_tokens, output = raw.completion_tokens, total = raw.total_tokens;
  const cacheRead = raw.prompt_tokens_details?.cached_tokens;
  const reasoning = raw.completion_tokens_details?.reasoning_tokens;
  if (![input, output, total, cacheRead, reasoning].every(n => Number.isSafeInteger(n) && n >= 0) ||
      !Number.isSafeInteger(input + output) || total !== input + output || cacheRead > input || reasoning > output) return null;
  // Cache creation is outside this profile; never silently discard a declaration.
  const unsupported = ["cache_creation_input_tokens", "cache_creation", "cache_write_tokens", "cacheWrite", "cacheWrite5m", "cacheWrite1h"];
  if (unsupported.some(field => Object.hasOwn(raw, field)) ||
      Object.keys(raw.prompt_tokens_details).some(field => /creat|writ|5m|1h/i.test(field))) return null;
  return Object.freeze({ exact: true, input, output, cacheRead, cacheWrite: 0, reasoning,
    reasoningIncludedInOutput: true, cacheWrite5m: 0, cacheWrite1h: 0 });
}

export function createUsageObservation(profile) {
  let observed = null, malformed = false, conflicting = false;
  const kind = () => conflicting ? 'conflicting' : malformed ? 'malformed' : observed ? 'valid' : 'absent';
  return Object.freeze({
    observe(raw) {
      const next = normalizeOpenAIUsage(raw, profile);
      if (!next) malformed = true;
      if (next && observed && JSON.stringify(observed) !== JSON.stringify(next)) conflicting = true;
      if (next && !observed) observed = next;
    },
    // Retain observed evidence privately even after invalidation; it must never
    // become an unquestioned exact settlement or an absent-usage exemption.
    value: () => kind() === 'valid' ? observed : null,
    evidence: () => Object.freeze(kind() === 'valid' ? { kind: 'valid', usage: observed } : { kind: kind() }),
  });
}
