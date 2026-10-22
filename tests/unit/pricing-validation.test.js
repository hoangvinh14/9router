import { describe, expect, it } from 'vitest';
import { validatePricingMutation, readPricingMutation, PricingValidationError } from '../../src/lib/pricing/pricingValidation.js';

describe('complete pricing mutation boundary', () => {
  it('rejects inherited/prototype-sensitive records, invalid numeric rates and excessive batches', () => {
    const inherited = Object.create({ openai: {} }); inherited.fixture = {};
    const cases = [inherited, { openai: { fixture: Object.create({ input: 1, output: 2 }) } }, JSON.parse('{"openai":{"constructor":{"input":1,"output":2}}}'),
      { openai: { fixture: { input: NaN, output: 1 } } }, { openai: { fixture: { input: Infinity, output: 1 } } },
      { openai: { fixture: { input: -1, output: 1 } } }, { openai: { fixture: { input: 0.024999999999999998, output: 1 } } },
      { openai: { fixture: { input: '9000000.000000001', output: '1' } } }, Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`p${i}`, {}]))];
    for (const value of cases) expect(() => validatePricingMutation(value)).toThrow(PricingValidationError);
  });
  it('bounds declared and actual chunked ingress before storage', async () => {
    const oversized = new Request('http://localhost/api/pricing', { method: 'PATCH', body: '{}', headers: { 'content-length': String(20 * 1024 * 1024 + 1) } });
    await expect(readPricingMutation(oversized)).rejects.toThrow(PricingValidationError);
    let cancelled = false;
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(20 * 1024 * 1024)); controller.enqueue(new Uint8Array(1)); }, cancel() { cancelled = true; } });
    await expect(readPricingMutation(new Request('http://localhost/api/pricing', { method: 'PATCH', body, duplex: 'half' }))).rejects.toThrow(PricingValidationError);
    expect(cancelled).toBe(true);
  });
  it('only exact known embedding IDs allow input-only; no suffix inference', () => {
    for (const provider of ['github', 'gh']) {
      expect(validatePricingMutation({ [provider]: { 'text-embedding-3-small': { input: '0', cached: '0' } } })[provider]['text-embedding-3-small']).toEqual({ input: '0', output: '0', cached: '0' });
      for (const model of ['unknown-embedding', 'text-embedding-3-small(high)', 'gpt-4o']) expect(() => validatePricingMutation({ [provider]: { [model]: { input: '1' } } })).toThrow(PricingValidationError);
    }
  });
  it('accepts empty save as no-op data and keeps explicit zero vs missing optional rates', () => {
    expect(Object.keys(validatePricingMutation({}))).toEqual([]);
    expect(validatePricingMutation({ custom: { fixture: { input: '1', output: '0', cached: '0' } } }).custom.fixture).toEqual({ input: '1', output: '0', cached: '0' });
  });
});
