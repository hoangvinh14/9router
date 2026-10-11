import { beforeAll, describe, expect, it } from 'vitest';
import adapter from '../../open-sse/handlers/embeddingProviders/gemini.js';
let captureGeminiEmbeddingConversion;
beforeAll(async () => ({ captureGeminiEmbeddingConversion } = await import('../../open-sse/config/accountedGeminiEmbeddingCandidate.js')));
const model = 'gemini-embedding-001';
function input(batch = false) {
  const original = { model, input: batch ? ['fixture-one', 'fixture-two'] : 'fixture-one', dimensions: 3 };
  const actual = adapter.buildBody(model, original);
  return { model, original, actual };
}
describe('complete Gemini text embedding conversion, not registry/credential/dispatch permission', () => {
  it.each([false, true])('captures exact current adapter single/batch %s without rerunning it', batch => {
    const value = input(batch), captured = captureGeminiEmbeddingConversion(value);
    expect(captured.original).toEqual(value.original); expect(captured.actual).toEqual(value.actual);
    expect(captured.inspection).toEqual({ inputCount: batch ? 2 : 1, batch, dimensions: 3 });
    expect(Object.isFrozen(captured)).toBe(true); expect(Object.isFrozen(captured.original)).toBe(true);
    value.original.input = 'caller-mutated'; expect(captured.original.input).not.toBe('caller-mutated');
  });
  it('only float default may disappear; absent dimensions are not invented', () => {
    const original = { model, input: 'fixture', encoding_format: 'float' };
    const captured = captureGeminiEmbeddingConversion({ model, original, actual: adapter.buildBody(model, original) });
    expect(captured.actual).toEqual({ model: `models/${model}`, content: { parts: [{ text: 'fixture' }] } });
    expect(captured.inspection).toEqual({ inputCount: 1, batch: false });
  });
  it.each(['original-extra', 'numeric-text', 'mixed-array', 'empty-array', 'base64', 'string-dimensions', 'wrong-model', 'path-model', 'actual-extra', 'actual-text', 'actual-dimensions', 'batch-drop', 'batch-reorder'])('complete original/actual fault %s after positive', fault => {
    expect(captureGeminiEmbeddingConversion(input(true)).inspection.inputCount).toBe(2);
    const value = input(true);
    if (fault === 'original-extra') value.original.user = 'must-not-strip';
    else if (fault === 'numeric-text') value.original.input = 123;
    else if (fault === 'mixed-array') value.original.input = ['fixture-one', 123];
    else if (fault === 'empty-array') value.original.input = [];
    else if (fault === 'base64') value.original.encoding_format = 'base64';
    else if (fault === 'string-dimensions') value.original.dimensions = '3';
    else if (fault === 'wrong-model') value.original.model = 'gemini-other';
    else if (fault === 'path-model') value.model = '../gemini-embedding-001';
    else if (fault === 'actual-extra') value.actual.extra = true;
    else if (fault === 'actual-text') value.actual.requests[0].content.parts[0].text = 'changed';
    else if (fault === 'actual-dimensions') value.actual.requests[0].outputDimensionality = 2;
    else if (fault === 'batch-drop') value.actual.requests.pop();
    else value.actual.requests.reverse();
    expect(() => captureGeminiEmbeddingConversion(value)).toThrow('Gemini embedding conversion unavailable');
  });
  it.each(['original-getter', 'actual-getter', 'proxy', 'cycle', 'oversize'])('guard complete evidence %s before programmable reads', fault => {
    expect(captureGeminiEmbeddingConversion(input()).inspection.batch).toBe(false);
    let reads = 0; const trap = () => { reads++; throw new Error('Fixture programmable conversion read'); };
    let value = input();
    if (fault === 'original-getter') Object.defineProperty(value.original, 'input', { enumerable: true, get: trap });
    else if (fault === 'actual-getter') Object.defineProperty(value.actual.content, 'parts', { enumerable: true, get: trap });
    else if (fault === 'proxy') value = new Proxy(value, { get: trap, ownKeys: trap });
    else if (fault === 'cycle') value.actual.content.parts = [value];
    else value.original.input = 'x'.repeat(262145);
    expect(() => captureGeminiEmbeddingConversion(value)).toThrow('Gemini embedding conversion unavailable'); expect(reads).toBe(0);
  });
});
