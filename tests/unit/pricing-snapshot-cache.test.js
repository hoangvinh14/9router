import { describe, expect, it } from 'vitest';
import { resolveReferencePriceSync } from '../../src/lib/pricing/referenceResolver.js';
import { MAPPING_REVISION, mappedReference, providerIdentity } from '../../src/lib/pricing/catalogMapping.js';

function view(rows = {}) {
  return { readReferencePricing(scope, key) { return rows[`${scope}:${key}`] ?? null; } };
}
function catalog(entry) {
  return { revision: 'a'.repeat(64), syncedAt: '2026-10-19T00:00:00.000Z', entries: { 'openai/fixture': entry } };
}
const resolve = db => resolveReferencePriceSync(db, 'openai', 'fixture');
describe('exact immutable reference source selection', () => {
  it('chooses one complete manual source, preserving zero without borrowing synced fields', () => {
    const db = view({ 'pricing:openai': { fixture: { input: '0', output: '2' } },
      'referencePricing:catalog': catalog({ status: 'priced', rates: { input: '9', output: '9', cached: '8' } }) });
    const result = resolve(db);
    expect(result.snapshot.source).toBe('manual');
    expect(result.snapshot.rates).toEqual({ input: '0', output: '2' });
    expect(result.snapshot.fallbackSemantics.cached).toBe('input_rate');
    expect(result.snapshot.catalogRevision).toBeNull();
    expect(result.snapshot.mapping.revision).toBe(MAPPING_REVISION);
    expect(Object.isFrozen(result.snapshot)).toBe(true);
  });
  it('partial, null and invalid manual sources remain barriers rather than inherited/free', () => {
    for (const rates of [{ input: '1' }, null, { input: '0.0000000001', output: '1' }]) {
      const db = view({ 'pricing:openai': { fixture: rates }, 'referencePricing:catalog': catalog({ status: 'priced', rates: { input: '9', output: '9' } }) });
      expect(resolve(db)).toMatchObject({ status: 'unavailable', reason: 'invalid_complete_reference_rates' });
    }
    const alias = view({ 'pricing:cx': { fixture: null }, 'pricing:codex': { fixture: { input: '1', output: '2' } } });
    expect(resolveReferencePriceSync(alias, 'cx', 'fixture').status).toBe('unavailable');
  });
  it('synced revision/provenance changes only new snapshots, old units/rates stay frozen', () => {
    const stored = catalog({ status: 'priced', rates: { input: '1.000000001', output: '2' } });
    const db = view({ 'referencePricing:catalog': stored });
    const first = resolve(db);
    expect(first.snapshot.source).toBe('synced'); expect(first.snapshot.catalogRevision).toBe('a'.repeat(64));
    stored.entries['openai/fixture'].rates.input = '3'; stored.revision = 'b'.repeat(64);
    const next = resolve(db);
    expect(first.snapshot.rates.input).toBe('1.000000001');
    expect(first.snapshot.unit).toBe('USD/1M tokens');
    expect(next.snapshot.revision).not.toBe(first.snapshot.revision);
    expect(next.snapshot.catalogRevision).toBe('b'.repeat(64));
  });
  it('unsupported catalog semantics block fallback and do not imply zero', () => {
    expect(resolve(view({ 'referencePricing:catalog': catalog({ status: 'unsupported' }) })))
      .toMatchObject({ status: 'unavailable', reason: 'unsupported_catalog_price_semantics' });
    expect(resolve(view()).status).toBe('unavailable');
  });
  it('exact provider mapping never strips suffix or trusts custom reseller/free namespaces', () => {
    expect(providerIdentity('cx')).toBe('codex');
    expect(mappedReference('custom-openai', 'gpt-5')).toBeNull();
    expect(mappedReference('openai', 'fixture(high)').model).toBe('fixture(high)');
    expect(resolveReferencePriceSync(view(), 'custom-openai', 'gpt-5').status).toBe('unavailable');
    expect(resolveReferencePriceSync(view(), 'custom-openai', 'vendor/model:free').status).toBe('unavailable');
  });
  it('typed units retained explicitly without usage certification', () => {
    const db = view({ 'pricing:openai': { fixture: { input: '1', output: '2', input_audio: '3', web_search_per_1000: '0' } } });
    const result = resolve(db);
    expect(result.snapshot.rateUnits).toEqual({ input_audio: 'USD/1M tokens', web_search_per_1000: 'USD/1000 uses' });
    expect(Object.isFrozen(result.snapshot.rateUnits)).toBe(true);
    expect(result.usageCertified).toBeUndefined();
  });
});
