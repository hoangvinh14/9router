import { describe, expect, it } from 'vitest';
import { costFromExactUsageSnapshot as cost } from '../../src/lib/accounting/exact-money.js';
import { exactUsage, priceSnapshot } from '../fixtures/accounting/test-database.js';

describe('exact attempt reference cost', () => {
  it('rounds half up once across all components instead of per category', () => {
    const snapshot = priceSnapshot({ input: '0.000000001', output: '0.000000001' });
    expect(cost(exactUsage(250000, 250000), snapshot)).toBe('1');
    expect(cost(exactUsage(249999, 250000), snapshot)).toBe('0');
    expect(cost(exactUsage(500000, 500000), snapshot)).toBe('1');
  });
  it('distinguishes explicit zero, missing, estimates, invalid subsets, unsafe quantities and overflow', () => {
    expect(cost(exactUsage(), priceSnapshot({ input: '0', output: '0' }))).toBe('0');
    for (const usage of [{ ...exactUsage(), input: undefined }, { ...exactUsage(), exact: false }, { ...exactUsage(), input: -1 }, { ...exactUsage(), cacheRead: 1001 }, { ...exactUsage(), reasoning: 101 }, { ...exactUsage(), input: Number.MAX_SAFE_INTEGER + 1 }, { ...exactUsage(), toolUses: 1 }]) {
      expect(() => cost(usage, priceSnapshot())).toThrow();
    }
    expect(() => cost(exactUsage(Number.MAX_SAFE_INTEGER, 0), priceSnapshot({ input: '9000000', output: '0' }))).toThrow(/nanoUSD/);
    expect(() => cost(exactUsage(), priceSnapshot({ input: '1' }))).toThrow();
  });
  it('uses explicit cache/reasoning inclusions and original cache tier rates', () => {
    const snapshot = priceSnapshot({ input: '1', output: '2', cached: '0', cache_creation: '3', cache_creation_1h: '6', reasoning: '4' });
    const usage = { ...exactUsage(1000, 100), cacheRead: 100, cacheWrite: 100, cacheWrite5m: 50, cacheWrite1h: 50, reasoning: 20 };
    expect(cost(usage, snapshot)).toBe('1490000');
    expect(cost({ ...usage, reasoningIncludedInOutput: false }, snapshot)).toBe('1530000');
    expect(() => cost({ ...usage, cacheWrite1h: 51 }, snapshot)).toThrow(/subset/);
    expect(() => cost(exactUsage(), snapshot)).toThrow(/cache tiers/);
    const absent = structuredClone(snapshot); delete absent.rates.cache_creation_1h;
    expect(() => cost(usage, absent)).toThrow();
  });
  it('requires all extended categories from the original reference snapshot', () => {
    const snapshot = { ...priceSnapshot({ input: '1', output: '2', web_search_per_1000: '3' }), rateUnits: { web_search_per_1000: 'USD/1000 uses' } };
    expect(() => cost(exactUsage(), snapshot)).toThrow(/component evidence/);
    const usage = { exact: true, provenance: 'observed-disjoint-v1', components: [
      { category: 'input', count: 1000, unit: 'USD/1M tokens' },
      { category: 'output', count: 100, unit: 'USD/1M tokens' },
      { category: 'web_search_per_1000', count: 2, unit: 'USD/1000 uses' },
    ] };
    expect(cost(usage, snapshot)).toBe('7200000');
    expect(() => cost({ ...usage, components: usage.components.slice(0, 2) }, snapshot)).toThrow(/Missing/);
  });
  it('includes typed per-use and token components using original required-category authority', () => {
    const snapshot = { ...priceSnapshot({ input: '0.000000001', output: '0', web_search_per_1000: '0.000000001' }),
      rateUnits: { input: 'USD/1M tokens', web_search_per_1000: 'USD/1000 uses' }, usageSemantics: { requiredCategories: ['input', 'web_search_per_1000'] } };
    const usage = { exact: true, provenance: 'observed-fixture-v1', components: [{ category: 'input', count: 250000, unit: 'USD/1M tokens' }, { category: 'web_search_per_1000', count: 250, unit: 'USD/1000 uses' }] };
    expect(cost(usage, snapshot)).toBe('1');
    expect(() => cost({ ...usage, components: usage.components.slice(0, 1) }, snapshot)).toThrow(/Missing/);
    expect(() => cost({ ...usage, components: [usage.components[0], usage.components[0]] }, snapshot)).toThrow(/category/);
    const wrong = structuredClone(usage); wrong.components[1].unit = 'USD/1M tokens';
    expect(() => cost(wrong, snapshot)).toThrow(/unit/);
  });
});
