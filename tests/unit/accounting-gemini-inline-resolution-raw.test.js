import { describe, it, expect, vi } from 'vitest';
import { inspectRawGeminiAccounting, readBufferedGeminiAccounting } from 'open-sse/utils/accountingGeminiUsage.js';
import { createAccountingGeminiSseParser } from 'open-sse/utils/accountingGeminiSseParser.js';
import { costFromExactUsageSnapshot } from '@/lib/pricing/money.js';
const original = (mimeType = 'image/png') => ({ contents: [{ role: 'user', parts: [{ text: 'private prompt' }, { inlineData: { mimeType, data: 'b3BhcXVl', displayName: 'private media' }, mediaResolution: { level: 'MEDIA_RESOLUTION_ULTRA_HIGH' } }] }], generationConfig: { mediaResolution: 'MEDIA_RESOLUTION_HIGH' } });
const message = (modality = 'IMAGE') => ({ modelVersion: 'fixture-gemini', candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'answer' }] } }], usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 40, candidatesTokenCount: 20, thoughtsTokenCount: 10, totalTokenCount: 130, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 30 }, { modality, tokenCount: 70 }], cacheTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }, { modality, tokenCount: 30 }] } });
const bindings = (body = original()) => ({ inlineMediaOriginal: body, inlineResolutionOriginal: body });
const inspect = (raw, authority = bindings()) => inspectRawGeminiAccounting(raw, 'fixture-gemini', authority);
const parse = (frames, authority = bindings()) => {
  const events = [], parser = createAccountingGeminiSseParser(e => events.push(e), { expectedModel: 'fixture-gemini', ...authority });
  const text = frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join(''); for (const byte of new TextEncoder().encode(text)) parser.push(Uint8Array.of(byte));
  return { usage: parser.finish(), events, text };
};
const snapshot = (pdf = false) => ({ rates: { input: '1', output: '2', cached: '0.1', input_image: '3', cached_image: '0.2', ...(pdf ? { input_document: '4', cached_document: '0.3' } : {}) }, rateUnits: Object.fromEntries(['input', 'cached', 'input_image', 'cached_image', ...(pdf ? ['input_document', 'cached_document'] : [])].map(key => [key, 'USD/1M tokens'])), usageSemantics: { inputModalities: 'observed_gemini_inline_input_modalities', allowedInputModalities: ['TEXT', 'IMAGE', ...(pdf ? ['DOCUMENT'] : [])] } });
describe('inline image/PDF resolution bound raw authority, no quantities from labels or bytes', () => {
  it('JSON/buffered/one-byte SSE retain original source and only observed input attribution with separate resolution/media grants', async () => {
    const body = original(), copy = structuredClone(body), raw = message(), result = inspect(raw, bindings(body)); expect(result.message).toEqual(raw); expect(body).toEqual(copy);
    expect(result.usage.inputModalities).toEqual({ TEXT: { input: 30, cacheRead: 10 }, IMAGE: { input: 70, cacheRead: 30 } });
    expect((await readBufferedGeminiAccounting(Response.json(raw), null, { expectedModel: 'fixture-gemini', ...bindings(body) })).usage).toEqual(result.usage);
    const stream = parse([raw], bindings(body)); expect(stream.usage).toEqual(result.usage); expect(new TextDecoder().decode(Buffer.concat(stream.events.map(e => Buffer.from(e.bytes))))).toBe(stream.text);
    for (const authority of [{}, { inlineMediaOriginal: body }, { inlineResolutionOriginal: body }, { inlineVideoOriginal: body, inlineResolutionOriginal: body }, { inlineMediaOriginal: body, videoResolutionOriginal: body }]) { expect(() => inspect(raw, authority)).toThrow(); expect(() => parse([raw], authority)).toThrow(); }
  });
  it('IMAGE207000 and PDF DOCUMENT250000 depend on observed counters and typed rates, never labels/shapes or fabricated PDF/image equivalence', () => {
    for (const shape of ['low', 'part-only', 'generation-only', 'empty']) {
      const body = original(); if (shape === 'low') body.contents[0].parts[1].mediaResolution.level = body.generationConfig.mediaResolution = 'MEDIA_RESOLUTION_LOW';
      if (shape === 'part-only') delete body.generationConfig.mediaResolution; if (shape === 'generation-only') delete body.contents[0].parts[1].mediaResolution; if (shape === 'empty') body.contents[0].parts[1].mediaResolution = {};
      expect(costFromExactUsageSnapshot(inspect(message(), bindings(body)).usage, snapshot())).toBe('207000');
    }
    const body = original('application/pdf'); expect(costFromExactUsageSnapshot(parse([message('DOCUMENT')], bindings(body)).usage, snapshot(true))).toBe('250000');
    expect(() => inspect(message('DOCUMENT'))).toThrow(); const missing = snapshot(true); delete missing.rates.cached_image; expect(() => costFromExactUsageSnapshot(inspect(message('DOCUMENT'), bindings(body)).usage, missing)).toThrow();
    const zero = message(); zero.usageMetadata.cachedContentTokenCount = 0; zero.usageMetadata.cacheTokensDetails = []; expect(inspect(zero).usage.inputModalities.IMAGE.cacheRead).toBe(0); delete zero.usageMetadata.cacheTokensDetails; expect(() => inspect(zero)).toThrow();
  });
  it('mixed full-source bindings must grant client/audio/video/metadata/video resolution independently; all resolution and source divergences refuse', () => {
    const body = original(); body.tools = [{ functionDeclarations: [{ name: 'lookup', description: 'Lookup' }] }];
    body.contents[0].parts.push({ inlineData: { mimeType: 'audio/opus', data: 'YQ==' } }, { inlineData: { mimeType: 'video/mp4', data: 'Yg==' }, mediaResolution: { level: 'MEDIA_RESOLUTION_LOW' }, videoMetadata: { fps: 24, endOffset: '1s' } });
    const authority = { ...bindings(body), inlineAudioOriginal: body, inlineVideoOriginal: body, videoMetadataOriginal: body, videoResolutionOriginal: body, clientToolsOriginal: body }, raw = message(); raw.candidates[0].content.parts = [{ functionCall: { id: 'opaque', name: 'lookup', args: { q: 'private' } }, thoughtSignature: 'b3BhcXVl' }];
    expect(inspect(raw, authority).usage.inputModalities.IMAGE.input).toBe(70); expect(parse([raw], authority).usage.inputModalities.IMAGE.input).toBe(70);
    for (const key of Object.keys(authority)) { const missing = { ...authority }; delete missing[key]; expect(() => inspect(raw, missing)).toThrow(); }
    for (const change of [v => { v.contents[0].parts[1].mediaResolution.level = 'MEDIA_RESOLUTION_LOW'; }, v => { v.generationConfig.mediaResolution = 'MEDIA_RESOLUTION_LOW'; }, v => { v.contents[0].parts[1].inlineData.data = 'YQ=='; }, v => { v.contents[0].parts[0].text = 'different'; }]) { const different = structuredClone(body); change(different); expect(() => inspect(raw, { ...authority, inlineResolutionOriginal: different })).toThrow(); expect(() => parse([raw], { ...authority, inlineResolutionOriginal: different })).toThrow(); }
  });
  it('early usage cannot fill missing terminal details or erase foreign/hosted/output/resource/processing work', () => {
    const early = message(); delete early.candidates[0].finishReason; expect(parse([early]).usage).toBeNull(); expect(parse([early, message()]).events.map(e => e.terminal)).toEqual([false, true]);
    for (const change of [v => { delete v.usageMetadata.promptTokensDetails; }, v => { delete v.usageMetadata.cacheTokensDetails; }, v => { v.usageMetadata.promptTokensDetails[1].modality = 'VIDEO'; }, v => { v.usageMetadata.resolutionTokenCount = 64; }, v => { v.usageMetadata.toolUsePromptTokenCount = 1; }, v => { v.candidates[0].content.parts[0].mediaResolution = {}; }, v => { v.candidates[0].content.parts = [{ inlineData: { mimeType: 'image/png', data: 'YQ==' } }]; }]) { const raw = message(); change(raw); expect(() => inspect(raw)).toThrow(); expect(() => parse([early, raw])).toThrow(); }
    for (const change of [v => { delete v.generationConfig.mediaResolution; delete v.contents[0].parts[1].mediaResolution; }, v => { v.contents[0].parts[1].mediaResolution.level = 'UNKNOWN'; }, v => { v.generationConfig.mediaResolution = 'MEDIA_RESOLUTION_ULTRA_HIGH'; }, v => { v.contents[0].parts[1].mediaProcessing = 'AGENTIC'; }, v => { delete v.contents[0].parts[1].inlineData; v.contents[0].parts[1].fileData = { fileUri: 'files/private', mimeType: 'image/png' }; }]) { const body = original(); change(body); expect(() => inspect(message(), bindings(body))).toThrow(); expect(() => parse([message()], bindings(body))).toThrow(); }
  });
  it('every selected image/PDF MIME binds its own original; media grant cannot enable audio/video resolution or foreign provenance', () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'image/avif', 'application/pdf']) {
      const body = original(mime), raw = message(mime === 'application/pdf' ? 'DOCUMENT' : 'IMAGE');
      expect(inspect(raw, bindings(body)).usage.inputModalities[mime === 'application/pdf' ? 'DOCUMENT' : 'IMAGE'].input).toBe(70);
    }
    const audio = original('audio/opus'); expect(() => inspect(message('AUDIO'), { ...bindings(audio), inlineAudioOriginal: audio })).toThrow();
    const video = original('video/mp4'); expect(() => inspect(message('VIDEO'), { ...bindings(video), inlineVideoOriginal: video })).toThrow();
    const source = original(); source.contents[0].parts[1].inlineData.data = Buffer.alloc(1000, 1).toString('base64'); expect(costFromExactUsageSnapshot(inspect(message(), bindings(source)).usage, snapshot())).toBe('207000');
  });
  it('early foreign category and framing/sink failure stay sticky, never repaired by later valid terminal frames', () => {
    const early = message(); delete early.candidates[0].finishReason; early.usageMetadata.promptTokensDetails[1].modality = 'VIDEO'; expect(() => parse([early, message()])).toThrow();
    const bytes = new TextEncoder().encode(`data: ${JSON.stringify(message())}\n\n`);
    const broken = createAccountingGeminiSseParser(() => {}, { expectedModel: 'fixture-gemini', ...bindings() }); expect(() => broken.push(new TextEncoder().encode('event: foreign\n\n'))).toThrow(); expect(() => broken.push(bytes)).toThrow(); expect(() => broken.finish()).toThrow();
    const sink = createAccountingGeminiSseParser(() => { throw new Error('private inline resolution sink failure'); }, { expectedModel: 'fixture-gemini', ...bindings() }); expect(() => sink.push(bytes)).toThrow('private inline resolution sink failure'); expect(() => sink.finish()).toThrow();
  });
  it('programmable bindings/raw fail before reads and immutable SSE source captures survive external resolution mutation', () => {
    const body = original(), parser = createAccountingGeminiSseParser(() => {}, { expectedModel: 'fixture-gemini', ...bindings(body) }); body.generationConfig.mediaResolution = 'UNKNOWN'; body.contents[0].parts[1].mediaResolution.level = 'UNKNOWN';
    parser.push(new TextEncoder().encode(`data: ${JSON.stringify(message())}\n\n`)); expect(parser.evidence()).toBeNull(); expect(parser.finish().inputModalities.IMAGE.input).toBe(70); expect(() => parser.finish()).toThrow();
    const getter = vi.fn(), trap = vi.fn(), programmable = original(); Object.defineProperty(programmable.contents[0].parts[1].mediaResolution, 'level', { enumerable: true, get: getter }); expect(() => inspect(message(), bindings(programmable))).toThrow(); expect(() => inspect(message(), { ...bindings(), inlineResolutionOriginal: new Proxy(original(), { ownKeys: trap }) })).toThrow();
    const raw = message(); Object.defineProperty(raw.usageMetadata, 'promptTokensDetails', { enumerable: true, get: getter }); expect(() => inspect(raw)).toThrow(); expect(getter).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
  });
});
