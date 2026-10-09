import { describe, it, expect } from 'vitest';
import { inspectRawGeminiAccounting, readBufferedGeminiAccounting } from 'open-sse/utils/accountingGeminiUsage.js';
import { supportsGeminiRequest, supportsGeminiInternalRequest } from 'open-sse/config/accountedGeminiCandidate.js';
const message = () => ({ modelVersion: 'fixture-gemini', responseId: 'fixture', candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'answer' }] } }],
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 130, cachedContentTokenCount: 40, thoughtsTokenCount: 10, serviceTier: 'standard' } });
describe('sole native Gemini JSON raw monetary evidence', () => {
  it('prompt includes cache, thoughts separate from candidates, exact total at clean EOF', async () => {
    const raw = message(); const result = await readBufferedGeminiAccounting(Response.json(raw), undefined, { expectedModel: 'fixture-gemini' });
    expect(result.message).toEqual(raw); expect(result.usage).toMatchObject({ exact: true, input: 100, output: 20, cacheRead: 40, cacheWrite: 0, reasoning: 10, reasoningIncludedInOutput: false });
  });
  it('documented absent optional counters/tier use zero/default but required counters never do', () => {
    const raw = message(); delete raw.usageMetadata.cachedContentTokenCount; delete raw.usageMetadata.thoughtsTokenCount; delete raw.usageMetadata.serviceTier; raw.usageMetadata.totalTokenCount = 120;
    expect(inspectRawGeminiAccounting(raw, 'fixture-gemini').usage).toMatchObject({ cacheRead: 0, reasoning: 0 });
  });
  const mutations = {
    'model-version mismatch': m => { m.modelVersion = 'fixture-gemini-001'; },
    'missing model': m => { delete m.modelVersion; },
    'no terminal': m => { delete m.candidates[0].finishReason; },
    'safety terminal': m => { m.candidates[0].finishReason = 'SAFETY'; },
    'multiple candidates': m => { m.candidates.push(m.candidates[0]); },
    'missing index': m => { delete m.candidates[0].index; },
    'nontext output': m => { m.candidates[0].content.parts = [{ inlineData: { data: 'AA==' } }]; },
    'hosted work': m => { m.candidates[0].groundingMetadata = {}; },
    'tool-use prompt': m => { m.usageMetadata.toolUsePromptTokenCount = 1; },
    'flex tier': m => { m.usageMetadata.serviceTier = 'flex'; },
    'total mismatch': m => { m.usageMetadata.totalTokenCount = 129; },
    'missing output': m => { delete m.usageMetadata.candidatesTokenCount; },
    'null reasoning': m => { m.usageMetadata.thoughtsTokenCount = null; },
    'null cache': m => { m.usageMetadata.cachedContentTokenCount = null; },
    'cache exceeds input': m => { m.usageMetadata.cachedContentTokenCount = 101; },
    'unsafe integer': m => { m.usageMetadata.promptTokenCount = Number.MAX_SAFE_INTEGER + 1; },
    'unknown monetary field': m => { m.usageMetadata.newBillableCounter = 1; },
    'audio detail': m => { m.usageMetadata.promptTokensDetails = [{ modality: 'AUDIO', tokenCount: 100 }]; },
    'detail mismatch': m => { m.usageMetadata.promptTokensDetails = [{ modality: 'TEXT', tokenCount: 99 }]; },
    'negative detail': m => { m.usageMetadata.cacheTokensDetails = [{ modality: 'TEXT', tokenCount: -1 }]; },
    'blocked prompt': m => { m.promptFeedback = { blockReason: 'SAFETY' }; },
  };
  it.each(Object.entries(mutations))('rejects %s rather than estimates/remaps', (_name, mutate) => { const raw = message(); mutate(raw); expect(() => inspectRawGeminiAccounting(raw, 'fixture-gemini')).toThrow(); });
  it('accepts consistent text-only details and explicit zero tool-use', () => {
    const raw = message(); Object.assign(raw.usageMetadata, { toolUsePromptTokenCount: 0, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 100 }], cacheTokensDetails: [{ modality: 'TEXT', tokenCount: 40 }], candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 20 }], toolUsePromptTokensDetails: [] });
    expect(inspectRawGeminiAccounting(raw, 'fixture-gemini').usage.exact).toBe(true);
  });
  it('does not settle a complete-looking JSON before EOF and rejects trailing invalid bytes', async () => {
    let controller; const response = new Response(new ReadableStream({ start(c) { controller = c; c.enqueue(new TextEncoder().encode(JSON.stringify(message()))); } }), { headers: { 'content-type': 'application/json' } });
    let ended = false; const work = readBufferedGeminiAccounting(response, undefined, { expectedModel: 'fixture-gemini' }).then(v => { ended = true; return { v }; }, error => { ended = true; return { error }; });
    await new Promise(resolve => setImmediate(resolve)); expect(ended).toBe(false); controller.enqueue(new TextEncoder().encode('x')); controller.close(); expect((await work).error).toBeInstanceOf(Error);
  });
  it('fatal UTF8 prevents valid-looking replacement text', async () => {
    const bytes = new Uint8Array([...new TextEncoder().encode(JSON.stringify(message()).replace('answer', '')), 0xff]);
    await expect(readBufferedGeminiAccounting(new Response(bytes, { headers: { 'content-type': 'application/json' } }), undefined, { expectedModel: 'fixture-gemini' })).rejects.toThrow();
  });
});
describe('original/wire native Gemini text-only policy', () => {
  const body = () => ({ contents: [{ role: 'user', parts: [{ text: 'fixture' }] }], generationConfig: { maxOutputTokens: 100, candidateCount: 1 } });
  it('preserves native config without conversion and requires explicit false internally', () => {
    expect(supportsGeminiRequest(body())).toBe(true);
    for (const serviceTier of ['standard', 'unspecified']) expect(supportsGeminiRequest({ ...body(), serviceTier })).toBe(true);
    expect(supportsGeminiRequest({ ...body(), serviceTier: 'priority' })).toBe(false);
    expect(supportsGeminiRequest({ ...body(), generationConfig: { serviceTier: 'standard' } })).toBe(false);
    expect(supportsGeminiInternalRequest({ ...body(), model: 'fixture-gemini', stream: false }, 'fixture-gemini')).toBe(true);
    expect(supportsGeminiInternalRequest({ ...body(), model: 'fixture-gemini' }, 'fixture-gemini')).toBe(false);
  });
  it.each(['tools', 'toolConfig', 'cachedContent', 'unknown', 'labels', 'serviceTier'])('top-level %s cannot be stripped to eligible', key => { expect(supportsGeminiRequest({ ...body(), [key]: {} })).toBe(false); });
  it.each(['responseModalities', 'responseSchema', 'responseMimeType', 'mediaResolution', 'serviceTier', 'unknown'])('config %s cannot be stripped to eligible', key => { const raw = body(); raw.generationConfig[key] = {}; expect(supportsGeminiRequest(raw)).toBe(false); });
  it('denies image, thought-signature, multiple candidates, priority and traversal', () => {
    expect(supportsGeminiRequest({ contents: [{ parts: [{ inlineData: {} }] }] })).toBe(false);
    expect(supportsGeminiRequest({ contents: [{ parts: [{ text: 'x', thoughtSignature: 'x' }] }] })).toBe(false);
    for (const extra of [{ candidateCount: 2 }, { serviceTier: 'priority' }]) expect(supportsGeminiRequest({ ...body(), generationConfig: extra })).toBe(false);
    expect(supportsGeminiInternalRequest({ ...body(), model: '../x', stream: false }, '../x')).toBe(false);
  });
});
