import { describe, expect, it } from 'vitest';
import { completeReferenceRates, resolveReferencePriceSync } from '@/lib/pricing/referenceResolver.js';
import { validatePricingMutation } from '@/lib/pricing/pricingValidation.js';
import { validateCatalog } from '@/lib/pricing/catalogSync.js';
import { pricingDraft, changedPricingModels } from '@/shared/utils/pricingDraft.js';
import { costFromExactUsage } from '@/lib/pricing/money.js';

const rates = { input: '1', output: '2', web_search_per_1000: '10' };
function store(original = rates) {
  let selected = original;
  return { readReferencePricing: (scope, key) => scope === 'pricing' && key === 'fixture' ? { fixture: selected } : null,
    replace: value => { selected = value; } };
}
const exact = { exact: true, input: 1, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0,
  reasoningIncludedInOutput: true, toolUses: { webSearchRequests: 1 }, provenance: { serverToolUses: 'observed_claude_server_tool_use' } };

describe('explicit embedded per-use reference rates (provider gate unchanged)', () => {
  it('validates complete lexical manual rate and legacy numeric zero without token fallback', () => {
    expect(completeReferenceRates(rates)).toEqual(rates);
    expect(validatePricingMutation({ fixture: { fixture: { ...rates, web_search_per_1000: 0 } } }).fixture.fixture).toEqual({ ...rates, web_search_per_1000: '0' });
    for (const value of [null, undefined, '-1', '1e1', '0.0000000001', Number.NaN]) {
      expect(() => completeReferenceRates({ ...rates, web_search_per_1000: value })).toThrow();
    }
    expect(() => completeReferenceRates({ output: '1', web_search_per_1000: '1' })).toThrow();
    expect(() => completeReferenceRates({ ...rates, web_fetch_per_1000: '0' })).toThrow();
    expect(() => completeReferenceRates(rates, 'embeddings')).toThrow();
  });
  it('binds per-field units in immutable snapshot and retains original rate after drift', () => {
    const db = store(); const original = resolveReferencePriceSync(db, 'fixture', 'fixture');
    expect(original.status).toBe('priced');
    expect(original.snapshot).toMatchObject({ source: 'manual', virtual: true, unit: 'USD/1M tokens', rates,
      rateUnits: { web_search_per_1000: 'USD/1000 uses' } });
    expect(Object.isFrozen(original.snapshot.rateUnits)).toBe(true);
    expect(Object.isFrozen(original.snapshot.rates)).toBe(true);
    expect(costFromExactUsage(exact, original.snapshot.rates)).toBe('10001000');
    db.replace({ ...rates, web_search_per_1000: '20' });
    const changed = resolveReferencePriceSync(db, 'fixture', 'fixture');
    expect(changed.snapshot.revision).not.toBe(original.snapshot.revision);
    expect(costFromExactUsage(exact, original.snapshot.rates)).toBe('10001000');
    expect(costFromExactUsage(exact, changed.snapshot.rates)).toBe('20001000');
  });
  it('missing tool rate retains legacy snapshot shape and cannot produce tool debit', () => {
    const flat = { input: '1', output: '2' }, snapshot = resolveReferencePriceSync(store(flat), 'fixture', 'fixture').snapshot;
    expect(snapshot).not.toHaveProperty('rateUnits'); expect(snapshot.rates).toEqual(flat);
    expect(snapshot.fallbackSemantics).toEqual({ cached: 'input_rate', cache_creation: 'input_rate', reasoning: 'output_rate' });
    expect(() => costFromExactUsage(exact, snapshot.rates)).toThrow();
    const invalid = resolveReferencePriceSync(store({ ...rates, web_search_per_1000: null }), 'fixture', 'fixture');
    expect(invalid).toMatchObject({ status: 'unavailable', reason: 'invalid_complete_reference_rates' });
  });
  it('draft keeps explicit per-use rate and edited complete row; blank stays unavailable, no zero/default', () => {
    const baseline = pricingDraft({ fixture: { fixture: rates } }), draft = pricingDraft({ fixture: { fixture: rates } });
    expect(draft.fixture.fixture.web_search_per_1000).toBe('10');
    expect(changedPricingModels(baseline, draft)).toEqual({});
    draft.fixture.fixture.web_search_per_1000 = '0';
    expect(changedPricingModels(baseline, draft).fixture.fixture).toEqual({ ...rates, web_search_per_1000: '0' });
    draft.fixture.fixture.web_search_per_1000 = '';
    expect(changedPricingModels(baseline, draft).fixture.fixture).toEqual({ input: '1', output: '2' });
    draft.fixture.fixture.web_search_per_1000 = '0.0000000001';
    expect(() => changedPricingModels(baseline, draft)).toThrow();
  });
  it('catalog token rates do not fabricate or import standalone operation fees', () => {
    const catalog = cost => validateCatalog(JSON.stringify({ fixture: { id: 'fixture', models: { fixture: { id: 'fixture', cost } } } }));
    const tokenOnly = catalog({ input: 1, output: 2 }).entries['fixture/fixture'];
    expect(tokenOnly.rates).toEqual({ input: '1', output: '2' });
    expect(tokenOnly.rates).not.toHaveProperty('web_search_per_1000');
    expect(catalog({ input: 1, output: 2, web_search_per_1000: 10 }).entries['fixture/fixture'].status).toBe('unsupported');
  });
});
