import { describe, expect, it } from 'vitest';
import { normalizeExactUsage } from 'open-sse/utils/exactUsage.js';
import { FORMATS } from 'open-sse/translator/formats.js';

// Selected explicit-zero raw metrics contract, not an assertion that Kiro
// supplies this shape. Credits, context percentages and converter defaults
// cannot establish these counters; binary terminal/EOF still need an owner.
const raw = () => ({ inputTokens: 100, outputTokens: 20, totalTokens: 120,
  cacheReadInputTokens: 0, cacheCreationInputTokens: 0, reasoningTokens: 0 });
const normalize = value => normalizeExactUsage(value, FORMATS.KIRO);

describe('Kiro conservative raw metrics exactness prerequisite', () => {
  it('preserves explicit raw counts and schema without mutating evidence', () => {
    const value = Object.freeze(raw());
    expect(normalize(value)).toEqual({ exact: true, input: 100, output: 20,
      cacheRead: 0, cacheWrite: 0, reasoning: 0, reasoningIncludedInOutput: true,
      provenance: { schema: FORMATS.KIRO, endpoint: 'chat', inputIncludesCache: true } });
    expect(value).toEqual(raw());
  });
  it('accepts explicit zero rather than ignoring it as missing metadata', () => {
    const value = Object.fromEntries(Object.keys(raw()).map(key => [key, 0]));
    expect(normalize(value)).toMatchObject({ exact: true, input: 0, output: 0 });
  });
  it('compares totals at safe-integer boundaries without derived rounding', () => {
    expect(normalize({ ...raw(), inputTokens: Number.MAX_SAFE_INTEGER - 1,
      outputTokens: 1, totalTokens: Number.MAX_SAFE_INTEGER })).toMatchObject({ exact: true });
    expect(normalize({ ...raw(), inputTokens: Number.MAX_SAFE_INTEGER,
      outputTokens: 1, totalTokens: Number.MAX_SAFE_INTEGER })).toBeNull();
  });
  it.each(Object.keys(raw()))('does not infer missing %s', key => {
    expect(normalize(raw())).toMatchObject({ exact: true });
    const value = raw(); delete value[key];
    expect(normalize(value)).toBeNull();
  });
  it.each([
    ['string input', { inputTokens: '100' }],
    ['fraction output', { outputTokens: 0.5 }],
    ['negative input', { inputTokens: -1 }],
    ['unsafe total', { totalTokens: Number.MAX_SAFE_INTEGER + 1 }],
    ['NaN output', { outputTokens: NaN }],
    ['infinite output', { outputTokens: Infinity }],
    ['mismatched total', { totalTokens: 121 }],
    ['positive read cache', { cacheReadInputTokens: 1 }],
    ['positive creation cache', { cacheCreationInputTokens: 1 }],
    ['positive reasoning', { reasoningTokens: 1 }],
    ['null cache', { cacheReadInputTokens: null }],
    ['unknown billing', { futureCost: 0 }],
    ['credit metering', { usage: 2, unit: 'credit' }],
    ['context estimate', { contextUsagePercentage: 10 }],
    ['snake-case alias', { cache_read_input_tokens: 0 }],
    ['estimated', { estimated: true }],
    ['buffered', { buffered: true }],
  ])('%s cannot silently become token-only exact', (_label, changes) => {
    expect(normalize(raw())).toMatchObject({ exact: true });
    expect(normalize({ ...raw(), ...changes })).toBeNull();
  });
  it('rejects translator-produced Chat usage rather than adopting its totals', () => {
    expect(normalize(raw())).toMatchObject({ exact: true });
    expect(normalize({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 })).toBeNull();
  });
  it('does not unwrap envelopes or approve embeddings', () => {
    expect(normalize(raw())).toMatchObject({ exact: true });
    expect(normalize({ metricsEvent: raw() })).toBeNull();
    expect(normalizeExactUsage(raw(), FORMATS.KIRO, 'embeddings')).toBeNull();
  });
});
