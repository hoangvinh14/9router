import { describe, expect, it } from 'vitest';
import { decimalToNanoUsd, nanoUsdToDecimal, validateRate } from '../../src/lib/pricing/decimalMoney.js';
import { completeReferenceRates } from '../../src/lib/pricing/rateValidation.js';
import { parseCatalogJson, decimalLexeme } from '../../src/lib/pricing/catalogJson.js';

describe('pricing-owned exact decimals and complete source schema', () => {
  it('retains exact nanodollars and explicit zero without float scaling', () => {
    expect(decimalToNanoUsd('0.000000001')).toBe('1');
    expect(decimalToNanoUsd('9000000')).toBe('9000000000000000');
    expect(nanoUsdToDecimal('1234567890123456')).toBe('1234567.890123456');
    expect(validateRate('1.250000000')).toBe('1.25');
    expect(validateRate('0.000000000')).toBe('0');
    expect(nanoUsdToDecimal('9000000000000001')).toBe('9000000.000000001');
  });
  it('rejects lossy, negative, overprecision, malformed and out-of-bound ingress', () => {
    for (const value of [1, '', '-0', '-1', '01', '.1', '1.', '1e-9', '0.0000000001', '9000000.000000001', '10000000', 'NaN', ' 1', '1\n']) {
      expect(() => decimalToNanoUsd(value)).toThrow();
    }
    for (const value of ['-1', '01', '', 0]) expect(() => nanoUsdToDecimal(value)).toThrow();
  });
  it('keeps zero separate from optional absent fields and never fills a partial chat source', () => {
    expect(completeReferenceRates({ input: '0', output: '2', cached: '0' })).toEqual({ input: '0', output: '2', cached: '0' });
    expect(completeReferenceRates({ input: 1, output: 2 }).cached).toBeUndefined();
    expect(() => completeReferenceRates({ input: '1' })).toThrow(/Incomplete/);
    expect(completeReferenceRates({ input: '0' }, 'embeddings')).toEqual({ input: '0', output: '0' });
  });
  it('bounds legacy numeric compatibility and refuses implicit object/prototype schema', () => {
    for (const rates of [Object.create({ input: '1', output: '2' }), [], { input: NaN, output: 1 }, { input: Infinity, output: 1 }, { input: -1, output: 1 }, { input: 0.024999999999999998, output: 1 }, { input: '1', output: '2', evil: '0' }]) {
      expect(() => completeReferenceRates(rates)).toThrow();
    }
    expect(() => completeReferenceRates({ input: '1', web_search_per_1000: '0' }, 'embeddings')).toThrow();
    expect(() => completeReferenceRates({ input: '1', output: '2' }, 'image')).toThrow();
  });
  it('represents typed reference prices without asserting usage authority or free missing fields', () => {
    expect(completeReferenceRates({ input: '1', output: '2', input_audio: '3', web_search_per_1000: '0', processing_tool_video: '4' }))
      .toEqual({ input: '1', output: '2', input_audio: '3', web_search_per_1000: '0', processing_tool_video: '4' });
  });
});

describe('bounded catalog lexical JSON', () => {
  it('keeps numeric source bytes and expands exponent without rounding', () => {
    const data = parseCatalogJson('{"rate":0.024999999999999998,"small":1e-9,"zero":0.000,"x":true,"n":null}');
    expect(decimalLexeme(data.rate)).toBe('0.024999999999999998');
    expect(() => validateRate(decimalLexeme(data.rate))).toThrow();
    expect(validateRate(decimalLexeme(data.small))).toBe('0.000000001');
    expect(decimalLexeme(data.zero)).toBe('0');
    expect(data.x).toBe(true); expect(data.n).toBeNull();
    expect(Object.getPrototypeOf(data)).toBeNull();
  });
  it('rejects duplicate/prototype keys, invalid JSON, invalid number whitespace and oversized strings', () => {
    for (const source of ['{"a":1,"a":2}', '{"__proto__":{}}', '{"constructor":0}', '{"prototype":0}', '[1,]', '{"a":01}', '{"a":1}x', '\u00a0{}', `{"a":"${'x'.repeat(8193)}"}`, '[', '']) {
      expect(() => parseCatalogJson(source)).toThrow();
    }
  });
  it('bounds nesting, negative and huge exponent semantics', () => {
    expect(() => parseCatalogJson('['.repeat(18) + '0' + ']'.repeat(18))).toThrow(/depth/);
    for (const raw of ['-0', '-1', '1e31']) expect(() => decimalLexeme(parseCatalogJson(raw))).toThrow();
    expect(() => decimalLexeme(0)).toThrow();
  });
});
