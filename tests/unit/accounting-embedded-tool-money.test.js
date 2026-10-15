import { describe, expect, it, vi } from 'vitest';
import { costFromExactUsage } from '@/lib/pricing/money.js';

const usage = (toolUses = { webSearchRequests: 1 }) => ({ exact: true, input: 1, output: 0,
  cacheRead: 0, cacheWrite: 0, reasoning: 0, reasoningIncludedInOutput: true, toolUses,
  provenance: { serverToolUses: 'observed_claude_server_tool_use' } });
const rates = { input: '0', output: '0', web_search_per_1000: '10' };

describe('embedded tool monetary foundation (no provider admission)', () => {
  it('adds observed searches using USD/1000 uses, not the token rate', () => {
    expect(costFromExactUsage(usage(), rates)).toBe('10000000');
    expect(costFromExactUsage(usage({ webSearchRequests: 3 }), { ...rates, input: '2' })).toBe('30002000');
  });
  it('rounds once after token and tool-use components, not separately', () => {
    // Each component contributes .25 nanoUSD; only their sum rounds to 1.
    expect(costFromExactUsage(usage(), { ...rates, input: '0.00025', web_search_per_1000: '0.00000025' })).toBe('1');
    expect(costFromExactUsage(usage(), { ...rates, input: '0.000249999', web_search_per_1000: '0.00000025' })).toBe('0');
  });
  it('supports explicit zero but refuses absent/null/invalid tool rates even for observed zero', () => {
    expect(costFromExactUsage(usage(), { ...rates, web_search_per_1000: '0' })).toBe('0');
    for (const value of [undefined, null, 0, '-1', '1e-3', '0.0000000001']) {
      for (const count of [0, 1]) expect(() => costFromExactUsage(usage({ webSearchRequests: count }), { ...rates, web_search_per_1000: value })).toThrow();
    }
  });
  it('refuses unknown/malformed categories, counts and unobserved provenance', () => {
    for (const tools of [null, [], {}, { webSearchRequests: -1 }, { webSearchRequests: 0.5 },
      { webSearchRequests: Number.MAX_SAFE_INTEGER + 1 }, { webSearchRequests: 1, webFetchRequests: 0 },
      { webFetchRequests: 0 }]) expect(() => costFromExactUsage(usage(tools), rates)).toThrow();
    for (const provenance of [undefined, {}, { serverToolUses: true }, { serverToolUses: 'estimated' }]) {
      expect(() => costFromExactUsage({ ...usage(), provenance }, rates)).toThrow();
    }
    expect(() => costFromExactUsage({ ...usage(), exact: false }, rates)).toThrow();
  });
  it('refuses programmable tool inventory without executing getters/proxy traps', () => {
    const getter = vi.fn(() => 1), trap = vi.fn(() => ['webSearchRequests']);
    const accessor = Object.defineProperty({}, 'webSearchRequests', { enumerable: true, get: getter });
    const proxy = new Proxy({ webSearchRequests: 1 }, { ownKeys: trap });
    for (const tools of [accessor, proxy, { webSearchRequests: 1, toJSON: () => ({}) }]) {
      expect(() => costFromExactUsage(usage(tools), rates)).toThrow();
    }
    expect(getter).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
  });
  it('refuses programmable rate/provenance/top-level evidence and inherited tool categories', () => {
    const getter = vi.fn(() => '10'), trap = vi.fn(() => ['toolUses']);
    const rateGetter = Object.defineProperty({ input: '0', output: '0' }, 'web_search_per_1000', { enumerable: true, get: getter });
    const evidenceGetter = Object.defineProperty({ ...usage() }, 'toolUses', { enumerable: true, get: getter });
    const provenanceGetter = Object.defineProperty({}, 'serverToolUses', { enumerable: true, get: getter });
    expect(() => costFromExactUsage(usage(), rateGetter)).toThrow();
    expect(() => costFromExactUsage(evidenceGetter, rates)).toThrow();
    expect(() => costFromExactUsage({ ...usage(), provenance: provenanceGetter }, rates)).toThrow();
    expect(() => costFromExactUsage(new Proxy(usage(), { ownKeys: trap }), rates)).toThrow();
    const { toolUses, ...legacy } = usage();
    expect(() => costFromExactUsage(Object.assign(Object.create({ toolUses }), legacy), rates)).toThrow();
    expect(getter).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
  });
  it('combines cache tiers/reasoning with tools without duplicate or component rounding', () => {
    const mixed = { ...usage(), input: 3, cacheRead: 1, cacheWrite: 2, cacheWrite5m: 1, cacheWrite1h: 1,
      output: 2, reasoning: 1 };
    const price = { ...rates, output: '0.0001', cached: '0.0001', cache_creation: '0.0001',
      cache_creation_1h: '0.0001', reasoning: '0.0001', web_search_per_1000: '0.000000001' };
    expect(costFromExactUsage(mixed, price, { requireCacheTiers: true })).toBe('1');
    expect(costFromExactUsage({ ...mixed, reasoningIncludedInOutput: false }, price)).toBe('1');
    expect(() => costFromExactUsage(mixed, { ...price, cache_creation_1h: undefined })).toThrow();
  });
  it('bounds combined costs before storage and does not mutate original evidence/rates', () => {
    const original = Object.freeze({ ...usage(Object.freeze({ webSearchRequests: 1 })), provenance: Object.freeze({ serverToolUses: 'observed_claude_server_tool_use' }) });
    const price = Object.freeze({ ...rates });
    expect(costFromExactUsage(original, price)).toBe('10000000');
    expect(original.toolUses).toEqual({ webSearchRequests: 1 }); expect(price).toEqual(rates);
    expect(() => costFromExactUsage(usage({ webSearchRequests: Number.MAX_SAFE_INTEGER }), rates)).toThrow(/range/);
  });
  it('keeps legacy token-only shape and unknown-tool refusal even with zero rates', () => {
    const { toolUses, provenance, ...legacy } = usage();
    expect(costFromExactUsage(legacy, { input: '0.0028', output: '0' })).toBe('3');
    expect(() => costFromExactUsage(usage({ unknown: 0 }), { ...rates, web_search_per_1000: '0' })).toThrow();
    // The fixture's default parameter supplies a category; it is not absence.
    expect(costFromExactUsage(usage(undefined), rates)).toBe('10000000');
    expect(() => costFromExactUsage({ ...usage(), toolUses: undefined }, rates)).toThrow();
  });
});
