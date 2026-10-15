import { describe, it, expect, vi } from 'vitest';
import { inspectRawGeminiAccounting, readBufferedGeminiAccounting } from 'open-sse/utils/accountingGeminiUsage.js';
import { createAccountingGeminiSseParser } from 'open-sse/utils/accountingGeminiSseParser.js';
import { costFromExactUsageSnapshot } from '@/lib/pricing/money.js';
const original = () => ({ contents: [{ role: 'user', parts: [{ text: 'private prompt' }, { inlineData: { mimeType: 'video/mp4', data: 'b3BhcXVl', displayName: 'private video' }, mediaResolution: { level: 'MEDIA_RESOLUTION_ULTRA_HIGH' } }] }], generationConfig: { mediaResolution: 'MEDIA_RESOLUTION_HIGH' } });
const message = () => ({ modelVersion: 'fixture-gemini', candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'answer' }] } }], usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 40, candidatesTokenCount: 20, thoughtsTokenCount: 10, totalTokenCount: 130, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 30 }, { modality: 'VIDEO', tokenCount: 70 }], cacheTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'VIDEO', tokenCount: 30 }] } });
const bindings = (body = original()) => ({ inlineVideoOriginal: body, videoResolutionOriginal: body });
const inspect = (raw, authority = bindings()) => inspectRawGeminiAccounting(raw, 'fixture-gemini', authority);
const parse = (frames, authority = bindings()) => {
  const events = [], parser = createAccountingGeminiSseParser(e => events.push(e), { expectedModel: 'fixture-gemini', ...authority });
  const text = frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join(''); for (const byte of new TextEncoder().encode(text)) parser.push(Uint8Array.of(byte));
  return { usage: parser.finish(), events, text };
};
const snapshot = { rates: { input: '1', output: '2', cached: '0.1', input_image: '3', cached_image: '0.2', input_audio: '7', cached_audio: '0.4', input_video: '11', cached_video: '0.5' }, rateUnits: Object.fromEntries(['input', 'cached', 'input_image', 'cached_image', 'input_audio', 'cached_audio', 'input_video', 'cached_video'].map(key => [key, 'USD/1M tokens'])), usageSemantics: { inputModalities: 'observed_gemini_inline_input_modalities', allowedInputModalities: ['TEXT', 'VIDEO', 'IMAGE', 'AUDIO'] } };
describe('video resolution original-bound raw prerequisite, not resolution-label token inference', () => {
  it('JSON/buffered/one-byte SSE require independent resolution plus video full-source bindings and retain only observed counters', async () => {
    const body = original(), copy = structuredClone(body), raw = message(), usage = inspect(raw, bindings(body)).usage;
    expect(usage.inputModalities.VIDEO).toEqual({ input: 70, cacheRead: 30 }); expect(body).toEqual(copy);
    expect((await readBufferedGeminiAccounting(Response.json(raw), null, { expectedModel: 'fixture-gemini', ...bindings(body) })).usage).toEqual(usage);
    const result = parse([raw], bindings(body)); expect(result.usage).toEqual(usage); expect(new TextDecoder().decode(Buffer.concat(result.events.map(e => Buffer.from(e.bytes))))).toBe(result.text);
    for (const authority of [{}, { inlineVideoOriginal: body }, { videoResolutionOriginal: body }, { inlineAudioOriginal: body, videoResolutionOriginal: body }, { inlineVideoOriginal: body, videoMetadataOriginal: body }]) { expect(() => inspect(raw, authority)).toThrow(); expect(() => parse([raw], authority)).toThrow(); }
  });
  it('matching full metadata/client/image/audio original permissions are independent; level, generation, bytes and prompt divergence refuse', () => {
    const body = original(); body.contents[0].parts[1].videoMetadata = { fps: 24, endOffset: '1s' }; body.tools = [{ functionDeclarations: [{ name: 'lookup', description: 'Lookup' }] }]; body.contents[0].parts.push({ inlineData: { mimeType: 'image/png', data: 'YQ==' } }, { inlineData: { mimeType: 'audio/opus', data: 'Yg==' } });
    const authority = { ...bindings(body), videoMetadataOriginal: body, clientToolsOriginal: body, inlineMediaOriginal: body, inlineAudioOriginal: body }, raw = message(); raw.candidates[0].content.parts = [{ functionCall: { id: 'opaque', name: 'lookup', args: { q: 'private' } }, thoughtSignature: 'b3BhcXVl' }];
    expect(inspect(raw, authority).usage.inputModalities.VIDEO.input).toBe(70); expect(parse([raw], authority).usage.inputModalities.VIDEO.input).toBe(70);
    for (const key of Object.keys(authority)) { const missing = { ...authority }; delete missing[key]; expect(() => inspect(raw, missing)).toThrow(); }
    for (const change of [v => { v.contents[0].parts[1].mediaResolution.level = 'MEDIA_RESOLUTION_LOW'; }, v => { v.generationConfig.mediaResolution = 'MEDIA_RESOLUTION_LOW'; }, v => { v.contents[0].parts[1].inlineData.data = 'YQ=='; }, v => { v.contents[0].parts[0].text = 'different'; }]) { const different = structuredClone(body); change(different); expect(() => inspect(raw, { ...authority, videoResolutionOriginal: different })).toThrow(); expect(() => parse([raw], { ...authority, videoResolutionOriginal: different })).toThrow(); }
  });
  it('all resolution shapes/labels keep observed typed cost unchanged; terminal details cannot be estimated from public token hints', () => {
    for (const location of ['low', 'ultra', 'part-only', 'generation-only', 'empty']) {
      const body = original(); if (location === 'low') body.contents[0].parts[1].mediaResolution.level = body.generationConfig.mediaResolution = 'MEDIA_RESOLUTION_LOW';
      if (location === 'part-only') delete body.generationConfig.mediaResolution; if (location === 'generation-only') delete body.contents[0].parts[1].mediaResolution; if (location === 'empty') body.contents[0].parts[1].mediaResolution = {};
      expect(costFromExactUsageSnapshot(inspect(message(), bindings(body)).usage, snapshot)).toBe('536000');
    }
    const frames = message(); frames.usageMetadata.promptTokensDetails = [{ modality: 'TEXT', tokenCount: 30 }, { modality: 'IMAGE', tokenCount: 50 }, { modality: 'AUDIO', tokenCount: 20 }]; frames.usageMetadata.cacheTokensDetails = [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'IMAGE', tokenCount: 20 }, { modality: 'AUDIO', tokenCount: 10 }]; expect(costFromExactUsageSnapshot(parse([frames]).usage, snapshot)).toBe('249000');
    const missing = structuredClone(snapshot); delete missing.rates.cached_video; expect(() => costFromExactUsageSnapshot(inspect(frames).usage, missing)).toThrow();
    const early = message(); delete early.candidates[0].finishReason; expect(parse([early]).usage).toBeNull();
    for (const change of [v => { delete v.usageMetadata.promptTokensDetails; }, v => { delete v.usageMetadata.cacheTokensDetails; }, v => { v.usageMetadata.resolutionTokenCount = 64; }, v => { v.usageMetadata.promptTokensDetails[1].tokenCount = 64; }, v => { v.usageMetadata.toolUsePromptTokenCount = 1; }, v => { v.usageMetadata.candidatesTokensDetails = [{ modality: 'VIDEO', tokenCount: 20 }]; }]) { const raw = message(); change(raw); expect(() => inspect(raw)).toThrow(); expect(() => parse([early, raw])).toThrow(); }
  });
  it('output resolution/media, foreign input categories, resource/processing and absent original resolution cannot be erased for admission', () => {
    expect(inspect(message()).usage.exact).toBe(true);
    for (const change of [v => { v.candidates[0].content.parts[0].mediaResolution = { level: 'MEDIA_RESOLUTION_LOW' }; }, v => { v.candidates[0].content.parts = [{ inlineData: { mimeType: 'video/mp4', data: 'YQ==' } }]; }, v => { v.usageMetadata.promptTokensDetails[1].modality = 'DOCUMENT'; }]) { const raw = message(); change(raw); expect(() => inspect(raw)).toThrow(); expect(() => parse([raw])).toThrow(); }
    for (const change of [v => { delete v.generationConfig.mediaResolution; delete v.contents[0].parts[1].mediaResolution; }, v => { v.contents[0].parts[1].mediaResolution.level = 'UNKNOWN'; }, v => { v.generationConfig.mediaResolution = 'MEDIA_RESOLUTION_ULTRA_HIGH'; }, v => { v.contents[0].parts[1].mediaProcessing = 'AGENTIC'; }, v => { delete v.contents[0].parts[1].inlineData; v.contents[0].parts[1].fileData = { fileUri: 'files/private', mimeType: 'video/mp4' }; }]) { const body = original(); change(body); expect(() => inspect(message(), bindings(body))).toThrow(); expect(() => parse([message()], bindings(body))).toThrow(); }
  });
  it('PDF DOCUMENT still needs its own original binding and all video-allowed original rates, including unobserved VIDEO', () => {
    const body = original(); body.contents[0].parts.push({ inlineData: { mimeType: 'application/pdf', data: 'YQ==' } });
    const raw = message(); raw.usageMetadata.promptTokensDetails[1].modality = 'DOCUMENT'; raw.usageMetadata.cacheTokensDetails[1].modality = 'DOCUMENT';
    const authority = { ...bindings(body), inlineMediaOriginal: body }, rates = structuredClone(snapshot);
    rates.rates.input_document = '4'; rates.rates.cached_document = '0.3'; rates.rateUnits.input_document = rates.rateUnits.cached_document = 'USD/1M tokens'; rates.usageSemantics.allowedInputModalities.push('DOCUMENT');
    expect(costFromExactUsageSnapshot(parse([raw], authority).usage, rates)).toBe('250000'); expect(() => inspect(raw, bindings(body))).toThrow();
    delete rates.rates.cached_video; expect(() => costFromExactUsageSnapshot(inspect(raw, authority).usage, rates)).toThrow();
    const zero = message(); zero.usageMetadata.cachedContentTokenCount = 0; zero.usageMetadata.cacheTokensDetails = []; expect(inspect(zero).usage.inputModalities.VIDEO.cacheRead).toBe(0);
    delete zero.usageMetadata.cacheTokensDetails; expect(() => inspect(zero)).toThrow();
  });
  it('early foreign details cannot be laundered and framing/sink failure stays sticky without successful terminal evidence', () => {
    const early = message(); delete early.candidates[0].finishReason; early.usageMetadata.promptTokensDetails[1].modality = 'DOCUMENT'; expect(() => parse([early, message()])).toThrow();
    const bytes = new TextEncoder().encode(`data: ${JSON.stringify(message())}\n\n`);
    const broken = createAccountingGeminiSseParser(() => {}, { expectedModel: 'fixture-gemini', ...bindings() }); expect(() => broken.push(new TextEncoder().encode('event: foreign\n\n'))).toThrow(); expect(() => broken.push(bytes)).toThrow(); expect(() => broken.finish()).toThrow();
    const sink = createAccountingGeminiSseParser(() => { throw new Error('private resolution sink failure'); }, { expectedModel: 'fixture-gemini', ...bindings() }); expect(() => sink.push(bytes)).toThrow('private resolution sink failure'); expect(() => sink.finish()).toThrow();
  });
  it('programmable binding/raw capture fails before reads; SSE immutable original remains bound despite caller mutation and no evidence before finish', () => {
    const body = original(), parser = createAccountingGeminiSseParser(() => {}, { expectedModel: 'fixture-gemini', ...bindings(body) }); body.generationConfig.mediaResolution = 'UNKNOWN'; body.contents[0].parts[1].mediaResolution.level = 'UNKNOWN';
    parser.push(new TextEncoder().encode(`data: ${JSON.stringify(message())}\n\n`)); expect(parser.evidence()).toBeNull(); expect(parser.finish().inputModalities.VIDEO.input).toBe(70); expect(() => parser.finish()).toThrow();
    const getter = vi.fn(), trap = vi.fn(), programmable = original(); Object.defineProperty(programmable.generationConfig, 'mediaResolution', { enumerable: true, get: getter }); expect(() => inspect(message(), bindings(programmable))).toThrow();
    expect(() => inspect(message(), { ...bindings(), videoResolutionOriginal: new Proxy(original(), { ownKeys: trap }) })).toThrow(); const raw = message(); Object.defineProperty(raw.usageMetadata, 'promptTokensDetails', { enumerable: true, get: getter }); expect(() => inspect(raw)).toThrow(); expect(getter).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
  });
});
