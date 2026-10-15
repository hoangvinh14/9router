import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { completeReferenceRates, resolveReferencePriceSync } from '@/lib/pricing/referenceResolver.js';
import { validatePricingMutation } from '@/lib/pricing/pricingValidation.js';
import { validateCatalog } from '@/lib/pricing/catalogSync.js';
import { pricingDraft, changedPricingModels } from '@/shared/utils/pricingDraft.js';
const rates = () => ({ input: '1', output: '2', processing_tool_text: '13.000000001', processing_tool_image: '17', processing_tool_document: '29', processing_tool_audio: '19', processing_tool_video: '23' });
const fields = ['processing_tool_text', 'processing_tool_image', 'processing_tool_document', 'processing_tool_audio', 'processing_tool_video'];
describe('manual processing tool-prompt reference pricing ingress, not producer usage or per-call fees', () => {
  it('retains each lexical independent USD/1M token rate and freezes units/revision without creating usage semantics', () => {
    expect(completeReferenceRates(rates())).toEqual(rates()); expect(validatePricingMutation({ gemini: { fixture: rates() } }).gemini.fixture).toEqual(rates());
    const numeric = validatePricingMutation({ gemini: { fixture: { ...rates(), processing_tool_video: 0 } } }); expect(numeric.gemini.fixture.processing_tool_video).toBe('0');
    let current = rates(); const db = { readReferencePricing: (scope, key) => scope === 'pricing' && key === 'gemini' ? { fixture: current } : null };
    const original = resolveReferencePriceSync(db, 'gemini', 'fixture').snapshot; expect(original.rates).toEqual(rates()); expect(original).not.toHaveProperty('usageSemantics'); expect(Object.isFrozen(original.rates)).toBe(true); expect(Object.isFrozen(original.rateUnits)).toBe(true);
    for (const key of fields) expect(original.rateUnits[key]).toBe('USD/1M tokens');
    current = { ...rates(), processing_tool_image: '170' }; const changed = resolveReferencePriceSync(db, 'gemini', 'fixture').snapshot; expect(changed.revision).not.toBe(original.revision); expect(original.rates.processing_tool_image).toBe('17');
  });
  it('rejects embedding claims, precision/exponents/poison/unknown fields and catalog semantics instead of copying prices or assuming input equivalence', () => {
    expect(completeReferenceRates(rates())).toEqual(rates()); expect(() => completeReferenceRates(rates(), 'embeddings')).toThrow();
    for (const key of fields) for (const value of [null, '-1', '1e1', '0.0000000001', undefined]) expect(() => validatePricingMutation({ gemini: { fixture: { ...rates(), [key]: value } } })).toThrow();
    expect(() => completeReferenceRates({ ...rates(), processing_tool_per_call: '1' })).toThrow();
    const catalog = validateCatalog(JSON.stringify({ fixture: { id: 'fixture', models: { fixture: { id: 'fixture', cost: { input: 1, output: 2, processing_tool_image: 17 } } } } })); expect(catalog.entries['fixture/fixture'].status).toBe('unsupported');
  });
  it('draft roundtrips independent lexical values, explicit zero and optional blank-unavailable with complete row replacements', () => {
    const baseline = pricingDraft({ gemini: { fixture: rates() } }), draft = pricingDraft({ gemini: { fixture: rates() } });
    for (const key of fields) expect(draft.gemini.fixture[key]).toBe(rates()[key]); expect(changedPricingModels(baseline, draft)).toEqual({});
    draft.gemini.fixture.processing_tool_video = ''; draft.gemini.fixture.processing_tool_audio = '0'; const changed = changedPricingModels(baseline, draft); expect(changed.gemini.fixture).not.toHaveProperty('processing_tool_video'); expect(changed.gemini.fixture.processing_tool_audio).toBe('0'); expect(changed.gemini.fixture.processing_tool_text).toBe('13.000000001');
    draft.gemini.fixture.processing_tool_text = '1e-9'; expect(() => changedPricingModels(baseline, draft)).toThrow();
  });
  it('editor/settings/coverage explicitly distinguish loaded tool-prompt token references and unavailable rates from initial input or usage certification', () => {
    const modal = fs.readFileSync(new URL('../../src/shared/components/PricingModal.js', import.meta.url), 'utf8'); const page = fs.readFileSync(new URL('../../src/app/dashboard/settings/pricing/page.js', import.meta.url), 'utf8'); const coverage = fs.readFileSync(new URL('../../src/shared/components/PricingCoverage.js', import.meta.url), 'utf8');
    expect(modal).toContain('ACCOUNTING_GEMINI_PROCESSING_RATES'); expect(modal).toContain('Processing tool'); expect(modal).toContain('ACCOUNTING_GEMINI_PROCESSING_RATE_FIELDS.includes(field)');
    expect(page).toContain('Processing tool-prompt'); expect(coverage).toContain('ACCOUNTING_GEMINI_PROCESSING_RATES'); expect(coverage).toContain('Unavailable; no processing fallback');
  });
});
