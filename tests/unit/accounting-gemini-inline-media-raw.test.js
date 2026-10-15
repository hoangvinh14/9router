import { describe, it, expect, vi } from 'vitest';
import { inspectRawGeminiAccounting, readBufferedGeminiAccounting } from 'open-sse/utils/accountingGeminiUsage.js';
import { createAccountingGeminiSseParser } from 'open-sse/utils/accountingGeminiSseParser.js';
import { costFromExactUsage, costFromExactUsageSnapshot } from '@/lib/pricing/money.js';
const original = (mimeType = 'image/png') => ({ contents: [{ role: 'user', parts: [{ text: 'private prompt' }, { inlineData: { mimeType, data: 'b3BhcXVl' } }] }] });
const raw = () => ({ modelVersion: 'fixture-gemini', candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'private answer' }] } }], usageMetadata: {
  promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 130, cachedContentTokenCount: 40, thoughtsTokenCount: 10,
  promptTokensDetails: [{ modality: 'TEXT', tokenCount: 30 }, { modality: 'IMAGE', tokenCount: 70 }],
  cacheTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'IMAGE', tokenCount: 30 }], candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 20 }],
} });
const inspect = (message, body = original()) => inspectRawGeminiAccounting(message, 'fixture-gemini', { inlineMediaOriginal: body });
const event = value => `data: ${JSON.stringify(value)}\n\n`, encoder = new TextEncoder();
const parse = (values, config = {}) => { const events = [], parser = createAccountingGeminiSseParser(value => events.push(value), { expectedModel: 'fixture-gemini', inlineMediaOriginal: original(), ...config }); for (const value of values) parser.push(encoder.encode(event(value))); return { events, usage: parser.finish() }; };
describe('isolated observed Gemini inline input modality authority, not pricing/dispatch approval', () => {
  it('raw JSON retains exact observed modality/cache attribution separately from aggregate counts and opaque original corpus', async () => {
    const value = raw(), before = structuredClone(value);
    const result = await readBufferedGeminiAccounting(Response.json(value), undefined, { expectedModel: 'fixture-gemini', inlineMediaOriginal: original() });
    expect(result.message).toEqual(before); expect(result.usage).toMatchObject({ exact: true, input: 100, cacheRead: 40, output: 20, reasoning: 10,
      inputModalities: { TEXT: { input: 30, cacheRead: 10 }, IMAGE: { input: 70, cacheRead: 30 } }, provenance: { inputModalities: 'observed_gemini_inline_input_modalities' } });
    expect(JSON.stringify(result.usage)).not.toMatch(/private|b3BhcXVl/); expect(() => inspectRawGeminiAccounting(value, 'fixture-gemini')).toThrow(); expect(value).toEqual(before);
  });
  it('SSE early modality details validate but cannot supply missing terminal details or infer token counts from media bytes', () => {
    const last = raw(), early = structuredClone(last); delete early.candidates[0].finishReason;
    expect(parse([early, last]).usage.inputModalities.IMAGE).toEqual({ input: 70, cacheRead: 30 });
    expect(parse([early]).usage).toBeNull(); const result = parse([last]); expect(new TextDecoder().decode(Buffer.concat(result.events.map(value => value.bytes)))).toBe(event(last));
    const missing = raw(); delete missing.usageMetadata.promptTokensDetails; expect(() => parse([early, missing])).toThrow();
    const parser = createAccountingGeminiSseParser(() => {}, { expectedModel: 'fixture-gemini', inlineMediaOriginal: original() });
    for (const byte of encoder.encode(event(last))) parser.push(Uint8Array.of(byte)); expect(parser.finish().inputModalities.TEXT.input).toBe(30);
  });
  it('PDF permits documented IMAGE or DOCUMENT attribution but not audio/video/output media; original unknown source cannot acquire authority', () => {
    expect(inspect(raw(), original('application/pdf')).usage.exact).toBe(true);
    const doc = raw(); for (const key of ['promptTokensDetails', 'cacheTokensDetails']) doc.usageMetadata[key][1].modality = 'DOCUMENT';
    expect(inspect(doc, original('application/pdf')).usage.inputModalities.DOCUMENT.input).toBe(70);
    expect(() => inspect(doc)).toThrow();
    for (const modality of ['AUDIO', 'VIDEO', 'MODALITY_UNSPECIFIED', 'UNKNOWN']) { const value = raw(); value.usageMetadata.promptTokensDetails[1].modality = modality; expect(() => inspect(value, original('application/pdf'))).toThrow(); }
    const value = raw(); value.usageMetadata.candidatesTokensDetails = [{ modality: 'IMAGE', tokenCount: 20 }]; expect(() => inspect(value)).toThrow();
    expect(() => inspect(raw(), { contents: [{ parts: [{ fileData: { mimeType: 'image/png', fileUri: 'https://example.com/unowned' } }] }] })).toThrow();
  });
  it('missing/duplicate/mismatched/subset/unsafe modality counts are unavailable; absent cache details are not fabricated zero', () => {
    expect(inspect(raw()).usage.exact).toBe(true);
    for (const mutate of [v => { delete v.promptTokensDetails; }, v => { delete v.cacheTokensDetails; }, v => { v.promptTokensDetails.push(v.promptTokensDetails[0]); },
      v => { v.promptTokensDetails[1].tokenCount = 69; }, v => { v.cacheTokensDetails = [{ modality: 'IMAGE', tokenCount: 40 }]; v.promptTokensDetails = [{ modality: 'TEXT', tokenCount: 70 }, { modality: 'IMAGE', tokenCount: 30 }]; },
      v => { v.cacheTokensDetails[0].unknown = 1; }, v => { v.promptTokensDetails[0].tokenCount = Number.MAX_SAFE_INTEGER + 1; },
      v => { v.toolUsePromptTokenCount = 1; v.totalTokenCount = 131; }]) { const value = raw(); mutate(value.usageMetadata); expect(() => inspect(value)).toThrow(); }
    const zero = raw(); zero.usageMetadata.cachedContentTokenCount = 0; zero.usageMetadata.cacheTokensDetails = [];
    expect(inspect(zero).usage.inputModalities.IMAGE.cacheRead).toBe(0); delete zero.usageMetadata.cacheTokensDetails; expect(() => inspect(zero)).toThrow();
  });
  it('client functions compose only with the same full inline original and separate current name/config authority', () => {
    const body = original(); body.tools = [{ functionDeclarations: [{ name: 'lookup', description: 'Client lookup' }] }];
    const value = raw(); value.candidates[0].content.parts = [{ functionCall: { id: 'opaque', name: 'lookup', args: {} }, thoughtSignature: 'b3BhcXVl' }];
    const opts = { inlineMediaOriginal: body, clientToolsOriginal: body };
    expect(inspectRawGeminiAccounting(value, 'fixture-gemini', opts).usage.inputModalities.IMAGE.input).toBe(70);
    expect(parse([value], opts).usage.exact).toBe(true);
    const divergent = structuredClone(body); divergent.contents[0].parts[0].text = 'different';
    expect(() => inspectRawGeminiAccounting(value, 'fixture-gemini', { ...opts, clientToolsOriginal: divergent })).toThrow();
    value.candidates[0].content.parts[0].functionCall.name = 'Task'; expect(() => inspectRawGeminiAccounting(value, 'fixture-gemini', opts)).toThrow();
  });
  it('early complete-looking counts replace at terminal; no output detail or input attribution can be borrowed across frames', () => {
    const early = raw(); delete early.candidates[0].finishReason;
    early.usageMetadata.promptTokenCount = 50; early.usageMetadata.cachedContentTokenCount = 10;
    early.usageMetadata.promptTokensDetails = [{ modality: 'TEXT', tokenCount: 20 }, { modality: 'IMAGE', tokenCount: 30 }];
    early.usageMetadata.cacheTokensDetails = [{ modality: 'IMAGE', tokenCount: 10 }]; early.usageMetadata.totalTokenCount = 80;
    expect(parse([early, raw()]).usage.inputModalities).toEqual({ TEXT: { input: 30, cacheRead: 10 }, IMAGE: { input: 70, cacheRead: 30 } });
    const value = raw(); delete value.usageMetadata.candidatesTokensDetails;
    expect(inspect(value).usage.output).toBe(20); // aggregate output remains required; optional TEXT-only details are not invented.
    const missing = raw(); delete missing.usageMetadata.cacheTokensDetails; expect(() => parse([early, missing])).toThrow();
  });
  it('new observed modality evidence cannot settle through legacy flat rates or a fabricated snapshot marker', () => {
    const usage = inspect(raw()).usage, rates = { input: '1', output: '2', cached: '0.1' };
    expect(() => costFromExactUsage(usage, rates)).toThrow(); // missing explicit IMAGE input/cache rates, never fallback to aggregate rates
    expect(() => costFromExactUsageSnapshot(usage, { rates })).toThrow('Invalid exact Gemini input modality authority');
    expect(() => costFromExactUsageSnapshot(usage, { rates, usageSemantics: { inputModalities: 'observed_gemini_inline_input_modalities' } })).toThrow('Invalid exact Gemini input modality authority');
  });
  it('guarded original/raw captures reject programmable modality evidence and malformed/postterminal streams without getter reads', () => {
    expect(inspect(raw()).usage.exact).toBe(true); const getter = vi.fn(), trap = vi.fn();
    const value = raw(); Object.defineProperty(value.usageMetadata, 'promptTokensDetails', { enumerable: true, get: getter });
    expect(() => inspect(value)).toThrow(); expect(getter).not.toHaveBeenCalled(); expect(() => inspect(new Proxy(raw(), { ownKeys: trap }))).toThrow(); expect(trap).not.toHaveBeenCalled();
    const early = raw(); delete early.candidates[0].finishReason; early.usageMetadata.promptTokensDetails[1].modality = 'AUDIO'; expect(() => parse([early, raw()])).toThrow();
    expect(() => parse([raw(), raw()])).toThrow();
  });
});
