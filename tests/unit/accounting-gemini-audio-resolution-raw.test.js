import { describe, it, expect, vi } from 'vitest';
import { inspectRawGeminiAccounting, readBufferedGeminiAccounting } from 'open-sse/utils/accountingGeminiUsage.js';
import { createAccountingGeminiSseParser } from 'open-sse/utils/accountingGeminiSseParser.js';
import { costFromExactUsageSnapshot } from '@/lib/pricing/money.js';
const original = (mimeType = 'audio/opus') => ({ contents: [{ role: 'user', parts: [{ text: 'private prompt' }, { inlineData: { mimeType, data: 'b3BhcXVl', displayName: 'private audio' }, mediaResolution: { level: 'MEDIA_RESOLUTION_ULTRA_HIGH' } }] }], generationConfig: { mediaResolution: 'MEDIA_RESOLUTION_HIGH' } });
const message = () => ({ modelVersion: 'fixture-gemini', candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'answer' }] } }], usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 40, candidatesTokenCount: 20, thoughtsTokenCount: 10, totalTokenCount: 130, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 30 }, { modality: 'AUDIO', tokenCount: 70 }], cacheTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'AUDIO', tokenCount: 30 }] } });
const bindings = (body = original()) => ({ inlineAudioOriginal: body, audioResolutionOriginal: body });
const inspect = (raw, authority = bindings()) => inspectRawGeminiAccounting(raw, 'fixture-gemini', authority);
const parse = (frames, authority = bindings()) => {
  const events = [], parser = createAccountingGeminiSseParser(e => events.push(e), { expectedModel: 'fixture-gemini', ...authority });
  const text = frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join(''); for (const byte of new TextEncoder().encode(text)) parser.push(Uint8Array.of(byte));
  return { usage: parser.finish(), events, text };
};
const snapshot = () => ({ rates: { input: '1', output: '2', cached: '0.1', input_audio: '7', cached_audio: '0.4' }, rateUnits: Object.fromEntries(['input', 'cached', 'input_audio', 'cached_audio'].map(key => [key, 'USD/1M tokens'])), usageSemantics: { inputModalities: 'observed_gemini_inline_input_modalities', allowedInputModalities: ['TEXT', 'AUDIO'] } });
describe('audio resolution bound raw authority, no quantity or model authority from labels', () => {
  it('JSON/buffered/one-byte SSE preserve full original and observed AUDIO with independent resolution/audio grants', async () => {
    const body = original(), copy = structuredClone(body), raw = message(), result = inspect(raw, bindings(body)); expect(result.message).toEqual(raw); expect(body).toEqual(copy);
    expect(result.usage.inputModalities).toEqual({ TEXT: { input: 30, cacheRead: 10 }, AUDIO: { input: 70, cacheRead: 30 } });
    expect((await readBufferedGeminiAccounting(Response.json(raw), null, { expectedModel: 'fixture-gemini', ...bindings(body) })).usage).toEqual(result.usage);
    const stream = parse([raw], bindings(body)); expect(stream.usage).toEqual(result.usage); expect(new TextDecoder().decode(Buffer.concat(stream.events.map(e => Buffer.from(e.bytes))))).toBe(stream.text);
    for (const authority of [{}, { inlineAudioOriginal: body }, { audioResolutionOriginal: body }, { inlineMediaOriginal: body, audioResolutionOriginal: body }, { inlineAudioOriginal: body, inlineResolutionOriginal: body }, { inlineAudioOriginal: body, videoResolutionOriginal: body }]) { expect(() => inspect(raw, authority)).toThrow(); expect(() => parse([raw], authority)).toThrow(); }
  });
  it('all thirteen selected MIME/opaque bytes/control shapes keep observed373000 and require original AUDIO cache price even unobserved zero', () => {
    for (const mime of ['audio/wav', 'audio/mp3', 'audio/aiff', 'audio/aac', 'audio/ogg', 'audio/flac', 'audio/mpeg', 'audio/m4a', 'audio/l16', 'audio/opus', 'audio/alaw', 'audio/mulaw', 'audio/webm']) {
      const body = original(mime); body.contents[0].parts[1].inlineData.data = Buffer.alloc(1000, 1).toString('base64'); expect(costFromExactUsageSnapshot(inspect(message(), bindings(body)).usage, snapshot())).toBe('373000');
    }
    for (const shape of ['low', 'part-only', 'generation-only', 'empty']) { const body = original(); if (shape === 'low') body.contents[0].parts[1].mediaResolution.level = body.generationConfig.mediaResolution = 'MEDIA_RESOLUTION_LOW'; if (shape === 'part-only') delete body.generationConfig.mediaResolution; if (shape === 'generation-only') delete body.contents[0].parts[1].mediaResolution; if (shape === 'empty') body.contents[0].parts[1].mediaResolution = {}; expect(costFromExactUsageSnapshot(parse([message()], bindings(body)).usage, snapshot())).toBe('373000'); }
    const text = message(); text.usageMetadata.promptTokensDetails = [{ modality: 'TEXT', tokenCount: 100 }]; text.usageMetadata.cacheTokensDetails = [{ modality: 'TEXT', tokenCount: 40 }]; expect(costFromExactUsageSnapshot(inspect(text).usage, snapshot())).toBe('124000'); const missing = snapshot(); delete missing.rates.cached_audio; expect(() => costFromExactUsageSnapshot(inspect(text).usage, missing)).toThrow();
    const zero = message(); zero.usageMetadata.cachedContentTokenCount = 0; zero.usageMetadata.cacheTokensDetails = []; expect(inspect(zero).usage.inputModalities.AUDIO.cacheRead).toBe(0); delete zero.usageMetadata.cacheTokensDetails; expect(() => inspect(zero)).toThrow();
  });
  it('mixed full-source bindings require client/media/video/metadata/inline-resolution/video-resolution independently and exact source equality', () => {
    const body = original(); body.tools = [{ functionDeclarations: [{ name: 'lookup', description: 'Lookup' }] }];
    body.contents[0].parts.push({ inlineData: { mimeType: 'application/pdf', data: 'YQ==' }, mediaResolution: {} }, { inlineData: { mimeType: 'video/mp4', data: 'Yg==' }, mediaResolution: { level: 'MEDIA_RESOLUTION_LOW' }, videoMetadata: { fps: 24, endOffset: '1s' } });
    const authority = { ...bindings(body), inlineMediaOriginal: body, inlineResolutionOriginal: body, inlineVideoOriginal: body, videoMetadataOriginal: body, videoResolutionOriginal: body, clientToolsOriginal: body }, raw = message(); raw.candidates[0].content.parts = [{ functionCall: { id: 'opaque', name: 'lookup', args: { q: 'private' } }, thoughtSignature: 'b3BhcXVl' }];
    expect(inspect(raw, authority).usage.inputModalities.AUDIO.input).toBe(70); expect(parse([raw], authority).usage.inputModalities.AUDIO.input).toBe(70);
    for (const key of Object.keys(authority)) { const missing = { ...authority }; delete missing[key]; expect(() => inspect(raw, missing)).toThrow(); }
    for (const change of [v => { v.contents[0].parts[1].mediaResolution.level = 'MEDIA_RESOLUTION_LOW'; }, v => { v.generationConfig.mediaResolution = 'MEDIA_RESOLUTION_LOW'; }, v => { v.contents[0].parts[1].inlineData.data = 'YQ=='; }, v => { v.contents[0].parts[0].text = 'different'; }]) { const different = structuredClone(body); change(different); expect(() => inspect(raw, { ...authority, audioResolutionOriginal: different })).toThrow(); expect(() => parse([raw], { ...authority, audioResolutionOriginal: different })).toThrow(); }
  });
  it('early counters never fill terminal details or erase foreign/hosted/output/resource/processing work', () => {
    const early = message(); delete early.candidates[0].finishReason; expect(parse([early]).usage).toBeNull(); expect(parse([early, message()]).events.map(e => e.terminal)).toEqual([false, true]);
    for (const change of [v => { delete v.usageMetadata.promptTokensDetails; }, v => { delete v.usageMetadata.cacheTokensDetails; }, v => { v.usageMetadata.promptTokensDetails[1].modality = 'VIDEO'; }, v => { v.usageMetadata.resolutionTokenCount = 64; }, v => { v.usageMetadata.toolUsePromptTokenCount = 1; }, v => { v.candidates[0].content.parts[0].mediaResolution = {}; }, v => { v.candidates[0].content.parts = [{ inlineData: { mimeType: 'audio/opus', data: 'YQ==' } }]; }]) { const raw = message(); change(raw); expect(() => inspect(raw)).toThrow(); expect(() => parse([early, raw])).toThrow(); }
    for (const change of [v => { delete v.generationConfig.mediaResolution; delete v.contents[0].parts[1].mediaResolution; }, v => { v.contents[0].parts[1].mediaResolution.level = 'UNKNOWN'; }, v => { v.generationConfig.mediaResolution = 'MEDIA_RESOLUTION_ULTRA_HIGH'; }, v => { v.contents[0].parts[1].mediaProcessing = 'AGENTIC'; }, v => { delete v.contents[0].parts[1].inlineData; v.contents[0].parts[1].fileData = { fileUri: 'files/private', mimeType: 'audio/opus' }; }]) { const body = original(); change(body); expect(() => inspect(message(), bindings(body))).toThrow(); expect(() => parse([message()], bindings(body))).toThrow(); }
  });
  it('audio resolution binding cannot grant image/video resolution or foreign input attribution', () => {
    expect(inspect(message()).usage.inputModalities.AUDIO.input).toBe(70);
    for (const mimeType of ['image/png', 'application/pdf', 'video/mp4']) {
      const body = original(mimeType), authority = { ...bindings(body), inlineMediaOriginal: body, inlineVideoOriginal: body };
      expect(() => inspect(message(), authority)).toThrow(); expect(() => parse([message()], authority)).toThrow();
    }
    const raw = message(); raw.usageMetadata.promptTokensDetails[1].modality = 'IMAGE'; expect(() => inspect(raw)).toThrow();
    const body = original(); body.contents[0].parts[1].inlineData.mimeType = 'audio/unknown'; expect(() => inspect(message(), bindings(body))).toThrow();
  });
  it('early foreign attribution and framing/sink failure remain sticky across later valid terminal data', () => {
    const early = message(); delete early.candidates[0].finishReason; early.usageMetadata.promptTokensDetails[1].modality = 'VIDEO'; expect(() => parse([early, message()])).toThrow();
    const bytes = new TextEncoder().encode(`data: ${JSON.stringify(message())}\n\n`);
    const broken = createAccountingGeminiSseParser(() => {}, { expectedModel: 'fixture-gemini', ...bindings() }); expect(() => broken.push(new TextEncoder().encode('event: foreign\n\n'))).toThrow(); expect(() => broken.push(bytes)).toThrow(); expect(() => broken.finish()).toThrow();
    const sink = createAccountingGeminiSseParser(() => { throw new Error('private audio resolution sink failure'); }, { expectedModel: 'fixture-gemini', ...bindings() }); expect(() => sink.push(bytes)).toThrow('private audio resolution sink failure'); expect(() => sink.finish()).toThrow();
  });
  it('programmable original/raw evidence fails before reads; immutable SSE originals survive external source resolution mutation', () => {
    const body = original(), parser = createAccountingGeminiSseParser(() => {}, { expectedModel: 'fixture-gemini', ...bindings(body) }); body.generationConfig.mediaResolution = 'UNKNOWN'; body.contents[0].parts[1].mediaResolution.level = 'UNKNOWN'; parser.push(new TextEncoder().encode(`data: ${JSON.stringify(message())}\n\n`)); expect(parser.evidence()).toBeNull(); expect(parser.finish().inputModalities.AUDIO.input).toBe(70); expect(() => parser.finish()).toThrow();
    const getter = vi.fn(), trap = vi.fn(), programmable = original(); Object.defineProperty(programmable.contents[0].parts[1].mediaResolution, 'level', { enumerable: true, get: getter }); expect(() => inspect(message(), bindings(programmable))).toThrow(); expect(() => inspect(message(), { ...bindings(), audioResolutionOriginal: new Proxy(original(), { ownKeys: trap }) })).toThrow(); const raw = message(); Object.defineProperty(raw.usageMetadata, 'promptTokensDetails', { enumerable: true, get: getter }); expect(() => inspect(raw)).toThrow(); expect(getter).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
  });
});
