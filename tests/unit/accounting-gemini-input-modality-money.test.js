import { describe, it, expect, vi } from 'vitest';
import { costFromExactUsage, costFromExactUsageSnapshot } from '@/lib/pricing/money.js';
const provenance = 'observed_gemini_inline_input_modalities';
const usage = () => ({ exact: true, input: 100, output: 20, cacheRead: 40, cacheWrite: 0, reasoning: 10, reasoningIncludedInOutput: false,
  inputModalities: { TEXT: { input: 30, cacheRead: 10 }, IMAGE: { input: 70, cacheRead: 30 } },
  provenance: { schema: 'gemini', endpoint: 'chat', inputIncludesCache: true, inputModalities: provenance } });
const rates = () => ({ input: '1', output: '2', cached: '0.1', input_image: '3', cached_image: '0.2' });
const snapshot = () => ({ rates: rates(), rateUnits: { input: 'USD/1M tokens', cached: 'USD/1M tokens', input_image: 'USD/1M tokens', cached_image: 'USD/1M tokens' },
  usageSemantics: { inputModalities: provenance, allowedInputModalities: ['TEXT', 'IMAGE'] } });
describe('explicit reference input-modality money kernel, no rate ingress/provider grant', () => {
  it('combines observed per-modality uncached/cache tokens and separate output/thoughts once without double input charging', () => {
    // TEXT:20*1+10*0.1; IMAGE:40*3+30*0.2; output:20*2;
    // Gemini thoughts are separate:10*2. Total207000 nanoUSD, not187000.
    expect(costFromExactUsage(usage(), rates())).toBe('207000'); expect(costFromExactUsageSnapshot(usage(), snapshot())).toBe('207000');
    const document = usage(); document.inputModalities.DOCUMENT = document.inputModalities.IMAGE; delete document.inputModalities.IMAGE;
    const original = snapshot(); original.usageSemantics.allowedInputModalities = ['TEXT', 'DOCUMENT'];
    original.rates.input_document = original.rates.input_image; original.rates.cached_document = original.rates.cached_image;
    delete original.rates.input_image; delete original.rates.cached_image;
    original.rateUnits.input_document = original.rateUnits.input_image; original.rateUnits.cached_document = original.rateUnits.cached_image;
    expect(costFromExactUsageSnapshot(document, original)).toBe('207000');
  });
  it('one attempt round-half-up spans modality and output components; explicit zero rates remain priced', () => {
    const value = usage(); Object.assign(value, { input: 2, output: 1, reasoning: 0, cacheRead: 0 }); value.inputModalities = { TEXT: { input: 1, cacheRead: 0 }, IMAGE: { input: 1, cacheRead: 0 } };
    expect(costFromExactUsage(value, { input: '0.0002', cached: '0', input_image: '0.0002', cached_image: '0', output: '0.0002' })).toBe('1');
    expect(costFromExactUsage(usage(), { input: '0', output: '0', cached: '0', input_image: '0', cached_image: '0' })).toBe('0');
  });
  it('original marker/allowed modality/rate/unit authority cannot be erased, replaced or laundered into flat rates', () => {
    expect(costFromExactUsageSnapshot(usage(), snapshot())).toBe('207000');
    for (const mutate of [s => { delete s.usageSemantics; }, s => { s.usageSemantics.inputModalities = 'foreign'; },
      s => { delete s.usageSemantics.allowedInputModalities; }, s => { s.usageSemantics.allowedInputModalities = ['TEXT']; },
      s => { delete s.rates.input_image; }, s => { delete s.rates.cached_image; }, s => { delete s.rateUnits.input_image; }, s => { s.rateUnits.cached_image = 'USD/1000 uses'; }]) {
      const original = snapshot(); mutate(original); expect(() => costFromExactUsageSnapshot(usage(), original)).toThrow();
    }
    const erased = usage(); delete erased.inputModalities; delete erased.provenance.inputModalities; expect(() => costFromExactUsageSnapshot(erased, snapshot())).toThrow();
    const zero = usage(); zero.inputModalities.IMAGE = { input: 0, cacheRead: 0 }; zero.inputModalities.TEXT = { input: 100, cacheRead: 40 };
    const missing = snapshot(); delete missing.rates.input_image; expect(() => costFromExactUsageSnapshot(zero, missing)).toThrow();
  });
  it('category/provenance/aggregate sums/subsets/schema/range errors refuse rather than use fallback rates or invented quantity', () => {
    expect(costFromExactUsage(usage(), rates())).toBe('207000');
    for (const mutate of [v => { v.provenance.inputModalities = 'foreign'; }, v => { v.provenance.schema = 'claude'; },
      v => { v.inputModalities.IMAGE.input = 69; }, v => { v.inputModalities.IMAGE.cacheRead = 71; },
      v => { v.inputModalities.IMAGE.unknown = 0; }, v => { v.inputModalities.UNKNOWN = { input: 0, cacheRead: 0 }; },
      v => { v.cacheWrite = 1; }, v => { v.cacheWrite5m = 0; v.cacheWrite1h = 0; }, v => { v.reasoningIncludedInOutput = true; }, v => { v.inputModalities = {}; }]) {
      const value = usage(); mutate(value); expect(() => costFromExactUsage(value, rates())).toThrow();
    }
    expect(() => costFromExactUsage(usage(), { input: '1', output: '2', cached: '0.1' })).toThrow();
  });
  it('guarded pure attribution rejects getter/proxy/inherited categories without evaluating programmable monetary evidence', () => {
    expect(costFromExactUsage(usage(), rates())).toBe('207000'); const getter = vi.fn(), trap = vi.fn();
    const value = usage(); Object.defineProperty(value, 'inputModalities', { enumerable: true, get: getter });
    expect(() => costFromExactUsage(value, rates())).toThrow(); expect(getter).not.toHaveBeenCalled();
    expect(() => costFromExactUsage(new Proxy(usage(), { ownKeys: trap }), rates())).toThrow(); expect(trap).not.toHaveBeenCalled();
    const inherited = usage(); const evidence = inherited.inputModalities; delete inherited.inputModalities; Object.setPrototypeOf(inherited, { inputModalities: evidence });
    expect(() => costFromExactUsage(inherited, rates())).toThrow();
  });
  it('legacy text usage and tool per-use arithmetic remain separate; no unapproved cross-family/category combination', () => {
    const text = usage(); delete text.inputModalities; delete text.provenance.inputModalities; expect(costFromExactUsage(text, rates())).toBe('124000');
    const mixed = usage(); mixed.toolUses = { webSearchRequests: 1 }; mixed.provenance.serverToolUses = 'observed_claude_server_tool_use';
    expect(() => costFromExactUsage(mixed, { ...rates(), web_search_per_1000: '10' })).toThrow();
  });
});
