import { describe, it, expect, vi } from 'vitest';
import { costFromExactUsage, costFromExactUsageSnapshot } from '@/lib/pricing/money.js';
import { inspectRawGeminiAccounting, readBufferedGeminiAccounting } from 'open-sse/utils/accountingGeminiUsage.js';
import { createAccountingGeminiSseParser } from 'open-sse/utils/accountingGeminiSseParser.js';
const original = () => ({ contents: [{ role: 'user', parts: [{ text: 'private prompt' }, { inlineData: { mimeType: 'video/mp4', data: 'b3BhcXVl', displayName: 'private video' } }] }] });
const message = () => ({ modelVersion: 'fixture-gemini', candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'answer' }] } }],
  usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 40, candidatesTokenCount: 20, thoughtsTokenCount: 10, totalTokenCount: 130,
    promptTokensDetails: [{ modality: 'TEXT', tokenCount: 30 }, { modality: 'VIDEO', tokenCount: 70 }], cacheTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'VIDEO', tokenCount: 30 }] } });
const inspect = (raw, body = original()) => inspectRawGeminiAccounting(raw, 'fixture-gemini', { inlineVideoOriginal: body });
const parse = (frames, bindings = { inlineVideoOriginal: original() }) => {
  const events = [], parser = createAccountingGeminiSseParser(e => events.push(e), { expectedModel: 'fixture-gemini', ...bindings });
  const text = frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('');
  for (const byte of new TextEncoder().encode(text)) parser.push(Uint8Array.of(byte));
  return { usage: parser.finish(), events, text };
};
describe('video original-bound raw modality prerequisite, not rates/frames/duration/queued grant', () => {
  it('JSON and buffered owner retain observed VIDEO prompt/cache and opaque original bytes', async () => {
    const raw = message(), body = original(), before = structuredClone(body), result = inspect(raw, body);
    expect(result.message).toEqual(raw); expect(body).toEqual(before);
    expect(result.usage).toMatchObject({ input: 100, cacheRead: 40, output: 20, reasoning: 10, inputModalities: { TEXT: { input: 30, cacheRead: 10 }, VIDEO: { input: 70, cacheRead: 30 } }, provenance: { inputModalities: 'observed_gemini_inline_input_modalities' } });
    expect((await readBufferedGeminiAccounting(Response.json(raw), null, { expectedModel: 'fixture-gemini', inlineVideoOriginal: body })).usage).toEqual(result.usage);
    expect(() => inspectRawGeminiAccounting(raw, 'fixture-gemini')).toThrow();
    expect(() => inspectRawGeminiAccounting(raw, 'fixture-gemini', { inlineAudioOriginal: body })).toThrow();
  });
  it('one-byte SSE framing conserves terminal-only observed attribution; early metadata is not a final fallback', () => {
    const raw = message(), early = structuredClone(raw); delete early.candidates[0].finishReason;
    const result = parse([early, raw]); expect(result.usage.inputModalities.VIDEO).toEqual({ input: 70, cacheRead: 30 });
    expect(new TextDecoder().decode(Buffer.concat(result.events.map(e => Buffer.from(e.bytes))))).toBe(result.text);
    expect(result.events.map(e => e.terminal)).toEqual([false, true]);
    const missing = structuredClone(raw); delete missing.usageMetadata.cacheTokensDetails; expect(() => parse([early, missing])).toThrow();
    expect(parse([early]).usage).toBeNull();
  });
  it('video source allows explicitly observed VIDEO or frame IMAGE/audio AUDIO details without fabricating quantities', () => {
    expect(inspect(message()).usage.inputModalities.VIDEO.input).toBe(70);
    const raw = message(); raw.usageMetadata.promptTokensDetails = [{ modality: 'TEXT', tokenCount: 30 }, { modality: 'IMAGE', tokenCount: 50 }, { modality: 'AUDIO', tokenCount: 20 }];
    raw.usageMetadata.cacheTokensDetails = [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'IMAGE', tokenCount: 20 }, { modality: 'AUDIO', tokenCount: 10 }];
    expect(inspect(raw).usage.inputModalities).toEqual({ TEXT: { input: 30, cacheRead: 10 }, IMAGE: { input: 50, cacheRead: 20 }, AUDIO: { input: 20, cacheRead: 10 } });
    const zero = message(); zero.usageMetadata.promptTokensDetails = [{ modality: 'TEXT', tokenCount: 100 }, { modality: 'VIDEO', tokenCount: 0 }]; zero.usageMetadata.cacheTokensDetails = [{ modality: 'TEXT', tokenCount: 40 }, { modality: 'VIDEO', tokenCount: 0 }]; expect(inspect(zero).usage.inputModalities.VIDEO.input).toBe(0);
    for (const change of [v => { delete v.usageMetadata.promptTokensDetails; }, v => { v.usageMetadata.promptTokensDetails[1].tokenCount--; }, v => { v.usageMetadata.cacheTokensDetails[1].tokenCount = 71; }, v => { v.usageMetadata.promptTokensDetails.push(v.usageMetadata.promptTokensDetails[1]); }, v => { v.usageMetadata.promptTokensDetails[1].modality = 'DOCUMENT'; }, v => { v.usageMetadata.toolUsePromptTokenCount = 1; }, v => { v.usageMetadata.candidatesTokensDetails = [{ modality: 'VIDEO', tokenCount: 20 }]; }]) { const value = message(); change(value); expect(() => inspect(value)).toThrow(); }
  });
  it('video/client/image/audio bindings must independently grant kinds and bind the same full original', () => {
    const body = original(); body.tools = [{ functionDeclarations: [{ name: 'lookup', description: 'Lookup' }] }]; body.contents[0].parts.push({ inlineData: { mimeType: 'audio/opus', data: 'YQ==' } }, { inlineData: { mimeType: 'image/png', data: 'Yg==' } });
    const raw = message(); raw.candidates[0].content.parts = [{ functionCall: { id: 'opaque', name: 'lookup', args: { q: 'private' } }, thoughtSignature: 'b3BhcXVl' }];
    const bindings = { inlineVideoOriginal: body, inlineAudioOriginal: body, inlineMediaOriginal: body, clientToolsOriginal: body };
    expect(inspectRawGeminiAccounting(raw, 'fixture-gemini', bindings).usage.inputModalities.VIDEO.input).toBe(70);
    expect(parse([raw], bindings).usage.inputModalities.VIDEO.input).toBe(70);
    for (const key of Object.keys(bindings)) { const missing = { ...bindings }; delete missing[key]; expect(() => inspectRawGeminiAccounting(raw, 'fixture-gemini', missing)).toThrow(); }
    const different = structuredClone(body); different.contents[0].parts[0].text = 'different'; expect(() => inspectRawGeminiAccounting(raw, 'fixture-gemini', { ...bindings, inlineAudioOriginal: different })).toThrow();
    const foreign = structuredClone(raw); foreign.candidates[0].content.parts[0].functionCall.name = 'undeclared'; expect(() => inspectRawGeminiAccounting(foreign, 'fixture-gemini', bindings)).toThrow();
  });
  it('observed VIDEO is unavailable under flat/text or image/audio-only monetary authority; category erasure cannot lower charge', () => {
    const usage = inspect(message()).usage;
    expect(() => costFromExactUsage(usage, { input: '1', output: '2', cached: '0.1' })).toThrow();
    expect(() => costFromExactUsageSnapshot(usage, { rates: { input: '1', output: '2', cached: '0.1', input_image: '3', cached_image: '0.2', input_audio: '7', cached_audio: '0.4' },
      rateUnits: { input: 'USD/1M tokens', cached: 'USD/1M tokens', input_image: 'USD/1M tokens', cached_image: 'USD/1M tokens', input_audio: 'USD/1M tokens', cached_audio: 'USD/1M tokens' },
      usageSemantics: { inputModalities: 'observed_gemini_inline_input_modalities', allowedInputModalities: ['TEXT', 'VIDEO', 'IMAGE', 'AUDIO'] } })).toThrow();
  });
  it('video raw and independent original capture refuse programmable getters/proxies before reads, with explicit zero-cache detail still required', () => {
    expect(inspect(message()).usage.exact).toBe(true); const getter = vi.fn(), trap = vi.fn();
    const raw = message(); Object.defineProperty(raw.usageMetadata, 'promptTokensDetails', { enumerable: true, get: getter }); expect(() => inspect(raw)).toThrow();
    expect(() => inspect(new Proxy(message(), { ownKeys: trap }))).toThrow(); expect(getter).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
    const body = original(); Object.defineProperty(body.contents[0].parts[1].inlineData, 'data', { enumerable: true, get: getter }); expect(() => inspect(message(), body)).toThrow(); expect(getter).not.toHaveBeenCalled();
    const zero = message(); zero.usageMetadata.cachedContentTokenCount = 0; zero.usageMetadata.cacheTokensDetails = [];
    expect(inspect(zero).usage.inputModalities.VIDEO.cacheRead).toBe(0); delete zero.usageMetadata.cacheTokensDetails; expect(() => inspect(zero)).toThrow();
    const pdf = original(); pdf.contents[0].parts.push({ inlineData: { mimeType: 'application/pdf', data: 'YQ==' } });
    const document = message(); document.usageMetadata.promptTokensDetails[1].modality = 'DOCUMENT'; document.usageMetadata.cacheTokensDetails[1].modality = 'DOCUMENT';
    expect(inspectRawGeminiAccounting(document, 'fixture-gemini', { inlineVideoOriginal: pdf, inlineMediaOriginal: pdf }).usage.inputModalities.DOCUMENT.input).toBe(70);
    expect(() => inspect(document, pdf)).toThrow();
  });
  it('early foreign modality and output/processing/resource material cannot be erased by later valid VIDEO', () => {
    expect(parse([message()]).usage.inputModalities.VIDEO.input).toBe(70);
    const early = message(); delete early.candidates[0].finishReason; early.usageMetadata.promptTokensDetails[1].modality = 'DOCUMENT'; expect(() => parse([early, message()])).toThrow();
    const output = message(); output.candidates[0].content.parts = [{ inlineData: { mimeType: 'video/mp4', data: 'YQ==' } }]; expect(() => inspect(output)).toThrow();
    const noVideo = original(); noVideo.contents[0].parts.pop(); expect(() => inspect(message(), noVideo)).toThrow();
    const metadata = original(); metadata.contents[0].parts[1].videoMetadata = { fps: 1 }; expect(() => inspect(message(), metadata)).toThrow();
    const badEof = message(); delete badEof.candidates[0].finishReason; expect(parse([badEof]).usage).toBeNull();
  });
});
