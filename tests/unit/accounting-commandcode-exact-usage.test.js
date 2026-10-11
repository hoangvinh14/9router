import { describe, expect, it } from 'vitest';
import { normalizeExactUsage } from 'open-sse/utils/exactUsage.js';
import { FORMATS } from 'open-sse/translator/formats.js';
// Initial explicit-zero token-only prerequisite. No absent-cache assumption,
// synthetic total/translated usage, provider quotas, or retry/owner approval.
const raw = () => ({ inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 0, reasoningTokens: 0 });
describe('CommandCode raw token-only exactness (test-first, not NDJSON owner approval)', () => {
  it('explicit raw counters preserve schema/provenance and do not mutate evidence', () => {
    const value = Object.freeze(raw());
    expect(normalizeExactUsage(value, FORMATS.COMMANDCODE)).toEqual({ exact: true, input: 100, output: 20, cacheRead: 0, cacheWrite: 0, reasoning: 0,
      reasoningIncludedInOutput: true, provenance: { schema: FORMATS.COMMANDCODE, endpoint: 'chat', inputIncludesCache: true } });
    expect(value).toEqual(raw());
  });
  it('explicit all-zero counters are exact, not missing metadata', () => {
    expect(normalizeExactUsage({ inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, reasoningTokens: 0 }, FORMATS.COMMANDCODE)).toMatchObject({ exact: true, input: 0, output: 0 });
  });
  it.each(['inputTokens', 'outputTokens', 'totalTokens', 'cachedInputTokens', 'reasoningTokens'])('missing %s cannot be fabricated from translator defaults', field => {
    const value = raw(); delete value[field]; expect(normalizeExactUsage(value, FORMATS.COMMANDCODE)).toBeNull();
  });
  it.each([
    ['string input', { inputTokens: '100' }],
    ['fractional output', { outputTokens: 0.5 }],
    ['negative output', { outputTokens: -1 }],
    ['unsafe total', { totalTokens: Number.MAX_SAFE_INTEGER + 1 }],
    ['mismatched total', { totalTokens: 121 }],
    ['cache not token-only', { cachedInputTokens: 1 }],
    ['reasoning not token-only', { reasoningTokens: 1 }],
    ['unknown billing field', { futureCost: 0 }],
    ['cache-write metadata', { cacheCreationTokens: 0 }],
    ['estimated', { estimated: true }],
    ['buffered', { buffered: true }],
    ['null cache', { cachedInputTokens: null }],
  ])('%s remains unresolved in this narrow schema', (_label, changes) => {
    expect(normalizeExactUsage({ ...raw(), ...changes }, FORMATS.COMMANDCODE)).toBeNull();
  });
  it('embeddings cannot use generation NDJSON token evidence', () => {
    expect(normalizeExactUsage(raw(), FORMATS.COMMANDCODE, 'embeddings')).toBeNull();
  });
});
