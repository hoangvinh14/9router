import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { completeReferenceRates, resolveReferencePriceSync } from '@/lib/pricing/referenceResolver.js';
import { validatePricingMutation } from '@/lib/pricing/pricingValidation.js';
import { validateCatalog } from '@/lib/pricing/catalogSync.js';
import { pricingDraft, changedPricingModels } from '@/shared/utils/pricingDraft.js';
const rates = () => ({ input: '1', output: '2', cached: '0.1', input_image: '3', cached_image: '0.2', input_document: '4', cached_document: '0' });
function store(value = rates()) { let current = value; return { readReferencePricing: (scope, key) => scope === 'pricing' && key === 'gemini' ? { 'fixture-modality': current } : null, replace: value => { current = value; } }; }
describe('explicit reference image/document fields ingress and UI contract, no provider opt-in', () => {
  it('complete lexical rates accept manual image/document cache units, explicit zero and reject malformed/unknown/output media/embedding fields', () => {
    expect(completeReferenceRates(rates())).toEqual(rates());
    expect(validatePricingMutation({ gemini: { 'fixture-modality': { ...rates(), input_image: 0 } } }).gemini['fixture-modality'].input_image).toBe('0');
    for (const value of [null, undefined, '-1', '1e1', '0.0000000001', Number.NaN]) expect(() => completeReferenceRates({ ...rates(), input_image: value })).toThrow();
    for (const field of ['input_unknown', 'input_video_seconds', 'output_image', 'image_per_request']) expect(() => completeReferenceRates({ ...rates(), [field]: '0' })).toThrow();
    expect(() => completeReferenceRates(rates(), 'embeddings')).toThrow();
  });
  it('resolver retains explicit per-field token units/revision through drift; rate availability alone never manufactures modality usage semantics', () => {
    const db = store(), original = resolveReferencePriceSync(db, 'gemini', 'fixture-modality'); expect(original.status).toBe('priced');
    expect(original.snapshot.rates).toEqual(rates()); expect(original.snapshot.rateUnits).toEqual({ input: 'USD/1M tokens', cached: 'USD/1M tokens', input_image: 'USD/1M tokens', cached_image: 'USD/1M tokens', input_document: 'USD/1M tokens', cached_document: 'USD/1M tokens' });
    expect(Object.isFrozen(original.snapshot.rateUnits)).toBe(true); expect(Object.isFrozen(original.snapshot.rates)).toBe(true); expect(original.snapshot).not.toHaveProperty('usageSemantics');
    db.replace({ ...rates(), input_image: '30' }); expect(resolveReferencePriceSync(db, 'gemini', 'fixture-modality').snapshot.revision).not.toBe(original.snapshot.revision); expect(original.snapshot.rates.input_image).toBe('3');
    db.replace({ input: '1', output: '2' }); const flat = resolveReferencePriceSync(db, 'gemini', 'fixture-modality').snapshot; expect(flat).not.toHaveProperty('rateUnits'); expect(flat.rates).toEqual({ input: '1', output: '2' });
  });
  it('draft edited rows retain exact modality rates; blank remains unavailable rather than input/cache fallback or fabricated free', () => {
    const baseline = pricingDraft({ gemini: { 'fixture-modality': rates() } }), draft = pricingDraft({ gemini: { 'fixture-modality': rates() } });
    expect(draft.gemini['fixture-modality'].cached_document).toBe('0'); expect(changedPricingModels(baseline, draft)).toEqual({});
    draft.gemini['fixture-modality'].input_image = '0'; expect(changedPricingModels(baseline, draft).gemini['fixture-modality'].input_image).toBe('0');
    draft.gemini['fixture-modality'].cached_image = ''; expect(changedPricingModels(baseline, draft).gemini['fixture-modality']).not.toHaveProperty('cached_image');
    draft.gemini['fixture-modality'].input_image = '0.0000000001'; expect(() => changedPricingModels(baseline, draft)).toThrow();
  });
  it('catalog does not import a flat or unknown modality equality contract or copy standalone media endpoint prices', () => {
    const catalog = cost => validateCatalog(JSON.stringify({ fixture: { id: 'fixture', models: { fixture: { id: 'fixture', cost } } } }));
    expect(catalog({ input: 1, output: 2 }).entries['fixture/fixture'].rates).toEqual({ input: '1', output: '2' });
    expect(catalog({ input: 1, output: 2, input_image: 3 }).entries['fixture/fixture'].status).toBe('unsupported');
  });
  it('both pricing surfaces describe explicit unavailable modality fields and coverage exposes units without usage-certification promise', () => {
    const modal = fs.readFileSync(new URL('../../src/shared/components/PricingModal.js', import.meta.url), 'utf8');
    const page = fs.readFileSync(new URL('../../src/app/dashboard/settings/pricing/page.js', import.meta.url), 'utf8');
    const coverage = fs.readFileSync(new URL('../../src/shared/components/PricingCoverage.js', import.meta.url), 'utf8');
    expect(modal).toContain('ACCOUNTING_GEMINI_MODALITY_RATE_FIELDS'); expect(modal).toContain('Image input'); expect(modal).toContain('Document cached');
    expect(page).toContain('Image/document input'); expect(coverage).toContain('ACCOUNTING_GEMINI_MODALITY_RATES'); expect(coverage).toContain('Unavailable; no modality fallback');
  });
});
