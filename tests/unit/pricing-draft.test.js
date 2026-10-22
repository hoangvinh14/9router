import { describe, it, expect, vi } from 'vitest';
import { pricingDraft, changedPricingModels, submitPricingDraft } from '@/shared/utils/pricingDraft.js';
const source = { custom: { one: { input: '8999999.999999999', output: '2', cached: '0', input_image: '8765432.123456789' }, two: { input: '3', output: '4' } } };
describe('exact changed-only pricing editor draft', () => {
  it('untouched save and equivalent decimal edits do not create overrides or fetch', async () => {
    const baseline = pricingDraft(source), draft = pricingDraft(source), fetcher = vi.fn();
    draft.custom.one.output = '2.000000000';
    expect(changedPricingModels(baseline, draft)).toEqual({});
    expect(await submitPricingDraft(baseline, draft, fetcher)).toBe(false); expect(fetcher).not.toHaveBeenCalled();
    draft.custom.one.output = '5'; draft.custom.one.output = '2';
    expect(changedPricingModels(baseline, draft)).toEqual({});
  });
  it('edits one row without rounding untouched high magnitude fields or sending other models', async () => {
    const baseline = pricingDraft(source), draft = pricingDraft(source), fetcher = vi.fn(async () => ({ ok: true }));
    draft.custom.one.output = '3';
    expect(await submitPricingDraft(baseline, draft, fetcher)).toBe(true);
    expect(fetcher).toHaveBeenCalledOnce(); const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('/api/pricing'); expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ custom: { one: { ...source.custom.one, output: '3' } } });
    expect(baseline.custom.one.output).toBe('2'); expect(source.custom.one.output).toBe('2');
  });
  it('zero is explicit; optional blank omits rather than inventing zero or inherited price', () => {
    const baseline = pricingDraft(source), draft = pricingDraft(source);
    draft.custom.one.cached = ''; draft.custom.one.reasoning = '0'; draft.custom.one.input_image = '';
    const row = changedPricingModels(baseline, draft).custom.one;
    expect(row).not.toHaveProperty('cached'); expect(row).not.toHaveProperty('input_image'); expect(row.reasoning).toBe('0');
    expect(row.input).toBe('8999999.999999999'); expect(source.custom.one.cached).toBe('0');
  });
  it.each(['', '-1', '1e-9', 'NaN', '1.0000000001', '1.2foo', ' 1', '10000000'])('invalid required rate %j refuses before mutation', async value => {
    const baseline = pricingDraft(source), draft = pricingDraft(source), fetcher = vi.fn(); draft.custom.two.output = value;
    await expect(submitPricingDraft(baseline, draft, fetcher)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects numeric compatibility maps rather than reconstructing precision', () => {
    expect(() => pricingDraft({ custom: { fixture: { input: 0.000000001, output: 2 } } })).toThrow('Exact pricing unavailable');
    expect(() => pricingDraft(undefined)).toThrow('Exact pricing unavailable');
    expect(pricingDraft({ custom: { fixture: { input: '0.000000001', output: '0' } } }).custom.fixture).toMatchObject({ input: '0.000000001', output: '0', cached: '' });
  });
  it('does not submit invalid untouched rows but rejects editing them', () => {
    const data = { custom: { bad: { input: '1.00000000001', output: '3' }, good: { input: '2', output: '4' } } };
    const baseline = pricingDraft(data), draft = pricingDraft(data); draft.custom.good.output = '5';
    expect(changedPricingModels(baseline, draft)).toEqual({ custom: { good: { input: '2', output: '5' } } });
    draft.custom.bad.output = '4'; expect(() => changedPricingModels(baseline, draft)).toThrow();
  });
  it('failed save never claims success or echoes untrusted server error text', async () => {
    const baseline = pricingDraft(source), draft = pricingDraft(source); draft.custom.two.output = '5';
    const fetcher = vi.fn(async () => ({ ok: false, json: async () => ({ error: 'SECRET backend data' }) }));
    await expect(submitPricingDraft(baseline, draft, fetcher)).rejects.toThrow('Pricing save denied or unavailable');
    expect(fetcher).toHaveBeenCalledOnce(); expect(draft.custom.two.output).toBe('5');
  });
});
