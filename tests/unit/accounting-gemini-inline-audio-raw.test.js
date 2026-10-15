import { describe, it, expect, vi } from 'vitest';
import { inspectRawGeminiAccounting, readBufferedGeminiAccounting } from 'open-sse/utils/accountingGeminiUsage.js';
import { createAccountingGeminiSseParser } from 'open-sse/utils/accountingGeminiSseParser.js';
import { costFromExactUsage, costFromExactUsageSnapshot } from '@/lib/pricing/money.js';
const original = () => ({ contents: [{ role: 'user', parts: [{ text: 'private prompt' }, { inlineData: { mimeType: 'audio/wav', data: 'b3BhcXVl', displayName: 'private audio' } }] }] });
const raw = () => ({ modelVersion: 'fixture-gemini', candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'private transcript' }] } }], usageMetadata: {
  promptTokenCount: 100, cachedContentTokenCount: 40, candidatesTokenCount: 20, thoughtsTokenCount: 10, totalTokenCount: 130,
  promptTokensDetails: [{ modality: 'TEXT', tokenCount: 30 }, { modality: 'AUDIO', tokenCount: 70 }],
  cacheTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'AUDIO', tokenCount: 30 }], candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 20 }],
} });
const inspect = (value, opts = {}) => inspectRawGeminiAccounting(value, 'fixture-gemini', { inlineAudioOriginal: original(), ...opts });
const event = value => `data: ${JSON.stringify(value)}\n\n`, encoder = new TextEncoder();
const parse = (values, opts = {}) => { const events = [], parser = createAccountingGeminiSseParser(value => events.push(value), { expectedModel: 'fixture-gemini', inlineAudioOriginal: original(), ...opts }); for (const value of values) parser.push(encoder.encode(event(value))); return { usage: parser.finish(), events }; };
describe('isolated original-bound observed input AUDIO attribution, not duration/pricing/admission support', () => {
  it('JSON preserves raw bytes and observed AUDIO/cache attribution without duration/token estimates or flat-price authority', async () => {
    const value = raw(), before = structuredClone(value);
    const result = await readBufferedGeminiAccounting(Response.json(value), undefined, { expectedModel: 'fixture-gemini', inlineAudioOriginal: original() });
    expect(result.message).toEqual(before); expect(value).toEqual(before); expect(result.usage).toMatchObject({ exact: true, input: 100, cacheRead: 40, output: 20, reasoning: 10,
      inputModalities: { TEXT: { input: 30, cacheRead: 10 }, AUDIO: { input: 70, cacheRead: 30 } }, provenance: { inputModalities: 'observed_gemini_inline_input_modalities' } });
    expect(JSON.stringify(result.usage)).not.toMatch(/private|b3BhcXVl|duration|seconds/);
    expect(() => inspectRawGeminiAccounting(value, 'fixture-gemini')).toThrow(); expect(() => inspectRawGeminiAccounting(value, 'fixture-gemini', { inlineMediaOriginal: original() })).toThrow();
    expect(() => costFromExactUsage(result.usage, { input: '1', output: '2', cached: '0.1' })).toThrow();
    expect(() => costFromExactUsageSnapshot(result.usage, { rates: { input: '1', output: '2' }, usageSemantics: { inputModalities: 'observed_gemini_inline_input_modalities', allowedInputModalities: ['TEXT', 'AUDIO'] } })).toThrow();
  });
  it('SSE replaces early attribution with terminal observed details and clean EOF; framing/one-byte splits unchanged', () => {
    const last = raw(), early = structuredClone(last); delete early.candidates[0].finishReason;
    early.usageMetadata.promptTokenCount = 50; early.usageMetadata.cachedContentTokenCount = 0; early.usageMetadata.totalTokenCount = 80;
    early.usageMetadata.promptTokensDetails = [{ modality: 'AUDIO', tokenCount: 50 }]; early.usageMetadata.cacheTokensDetails = [];
    const result = parse([early, last]); expect(result.usage.inputModalities.AUDIO).toEqual({ input: 70, cacheRead: 30 });
    expect(new TextDecoder().decode(Buffer.concat(result.events.map(value => value.bytes)))).toBe(event(early) + event(last));
    expect(parse([early]).usage).toBeNull(); const missing = raw(); delete missing.usageMetadata.cacheTokensDetails; expect(() => parse([early, missing])).toThrow();
    const parser = createAccountingGeminiSseParser(() => {}, { expectedModel: 'fixture-gemini', inlineAudioOriginal: original() });
    for (const byte of encoder.encode(event(last))) parser.push(Uint8Array.of(byte)); expect(parser.finish().inputModalities.AUDIO.input).toBe(70);
    expect(() => parse([last, last])).toThrow();
  });
  it('required prompt/cache lists and exact safe sums/subsets cannot infer missing AUDIO counts, zero, hosted or output dimensions', () => {
    expect(inspect(raw()).usage.exact).toBe(true);
    for (const change of [v => { delete v.promptTokensDetails; }, v => { delete v.cacheTokensDetails; }, v => { v.promptTokensDetails.push(v.promptTokensDetails[1]); },
      v => { v.promptTokensDetails[1].tokenCount = 69; }, v => { v.cacheTokensDetails[1].tokenCount = 71; }, v => { v.promptTokensDetails[1].tokenCount = Number.MAX_SAFE_INTEGER + 1; },
      v => { v.promptTokensDetails[1].seconds = 1; }, v => { v.promptTokensDetails[1].modality = 'IMAGE'; }, v => { v.promptTokensDetails[1].modality = 'VIDEO'; },
      v => { v.candidatesTokensDetails = [{ modality: 'AUDIO', tokenCount: 20 }]; }, v => { v.toolUsePromptTokenCount = 1; v.totalTokenCount = 131; }]) {
      const value = raw(); change(value.usageMetadata); expect(() => inspect(value)).toThrow();
    }
    const zero = raw(); zero.usageMetadata.cachedContentTokenCount = 0; zero.usageMetadata.cacheTokensDetails = [];
    expect(inspect(zero).usage.inputModalities.AUDIO.cacheRead).toBe(0); delete zero.usageMetadata.cacheTokensDetails; expect(() => inspect(zero)).toThrow();
    const output = raw(); output.candidates[0].content.parts = [{ inlineData: { mimeType: 'audio/wav', data: 'YQ==' } }]; expect(() => inspect(output)).toThrow();
  });
  it('mixed audio/image/client original requires identical full independent original bindings and current declared client authority', () => {
    const body = original(); body.contents[0].parts.push({ inlineData: { mimeType: 'image/png', data: 'YQ==' } }); body.tools = [{ functionDeclarations: [{ name: 'lookup', description: 'Lookup' }] }];
    const value = raw(); value.usageMetadata.promptTokensDetails[1].tokenCount = 60; value.usageMetadata.promptTokensDetails.push({ modality: 'IMAGE', tokenCount: 10 });
    value.usageMetadata.cacheTokensDetails[1].tokenCount = 20; value.usageMetadata.cacheTokensDetails.push({ modality: 'IMAGE', tokenCount: 10 });
    value.candidates[0].content.parts = [{ functionCall: { id: 'opaque', name: 'lookup', args: { private: 'args' } }, thoughtSignature: 'b3BhcXVl' }];
    const opts = { inlineAudioOriginal: body, inlineMediaOriginal: body, clientToolsOriginal: body };
    expect(inspect(value, opts).usage.inputModalities).toEqual({ TEXT: { input: 30, cacheRead: 10 }, AUDIO: { input: 60, cacheRead: 20 }, IMAGE: { input: 10, cacheRead: 10 } });
    expect(parse([value], opts).usage.exact).toBe(true);
    expect(() => inspect(value, { ...opts, inlineMediaOriginal: null })).toThrow(); expect(() => inspect(value, { ...opts, clientToolsOriginal: null })).toThrow();
    const changed = structuredClone(body); changed.contents[0].parts[0].text = 'diverged'; expect(() => inspect(value, { ...opts, inlineMediaOriginal: changed })).toThrow();
    expect(() => parse([value], { ...opts, inlineAudioOriginal: changed })).toThrow(); value.candidates[0].content.parts[0].functionCall.name = 'Task'; expect(() => inspect(value, opts)).toThrow();
  });
  it('audio permission grants no IMAGE/DOCUMENT attribution absent original sources; terminal explicit zero quantities remain observed, not defaulted', () => {
    const value = raw(); value.usageMetadata.promptTokensDetails = [{ modality: 'TEXT', tokenCount: 100 }, { modality: 'AUDIO', tokenCount: 0 }];
    value.usageMetadata.cacheTokensDetails = [{ modality: 'TEXT', tokenCount: 40 }, { modality: 'AUDIO', tokenCount: 0 }];
    expect(inspect(value).usage.inputModalities.AUDIO).toEqual({ input: 0, cacheRead: 0 });
    for (const modality of ['IMAGE', 'DOCUMENT', 'VIDEO', 'UNKNOWN']) { const foreign = raw(); foreign.usageMetadata.promptTokensDetails[1].modality = modality; expect(() => inspect(foreign)).toThrow(); }
    const early = raw(); delete early.candidates[0].finishReason; early.usageMetadata.promptTokensDetails[1].modality = 'DOCUMENT';
    expect(() => parse([early, raw()])).toThrow();
    const empty = { contents: [{ parts: [{ text: 'not media' }] }] }; expect(() => inspect(raw(), { inlineAudioOriginal: empty })).toThrow();
  });
  it('mixed audio/PDF original bounds DOCUMENT separately; missing independent audio binding and foreign client history never acquire raw authority', () => {
    const body = original(); body.contents[0].parts.push({ inlineData: { mimeType: 'application/pdf', data: 'YQ==' } });
    const value = raw(); value.usageMetadata.promptTokensDetails[1].tokenCount = 60; value.usageMetadata.promptTokensDetails.push({ modality: 'DOCUMENT', tokenCount: 10 });
    value.usageMetadata.cacheTokensDetails[1].tokenCount = 20; value.usageMetadata.cacheTokensDetails.push({ modality: 'DOCUMENT', tokenCount: 10 });
    const opts = { inlineAudioOriginal: body, inlineMediaOriginal: body };
    expect(inspect(value, opts).usage.inputModalities.DOCUMENT).toEqual({ input: 10, cacheRead: 10 });
    expect(() => inspect(value, { ...opts, inlineAudioOriginal: null })).toThrow();
    const foreign = original(); expect(() => inspect(value, { ...opts, clientToolsOriginal: foreign })).toThrow();
    expect(() => parse([value], { ...opts, inlineMediaOriginal: original() })).toThrow();
  });
  it('guarded original/raw inputs reject nested getter/proxy/foreign audio MIME before programmable reads; no original token fallback', () => {
    expect(inspect(raw()).usage.exact).toBe(true); const getter = vi.fn(), trap = vi.fn();
    const value = raw(); Object.defineProperty(value.usageMetadata, 'promptTokensDetails', { enumerable: true, get: getter }); expect(() => inspect(value)).toThrow();
    expect(() => inspect(new Proxy(raw(), { ownKeys: trap }))).toThrow(); expect(getter).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
    const body = original(); Object.defineProperty(body.contents[0].parts[1].inlineData, 'data', { enumerable: true, get: getter }); expect(() => inspect(raw(), { inlineAudioOriginal: body })).toThrow(); expect(getter).not.toHaveBeenCalled();
    const foreign = original(); foreign.contents[0].parts[1].inlineData.mimeType = 'audio/unknown'; expect(() => inspect(raw(), { inlineAudioOriginal: foreign })).toThrow();
  });
});
