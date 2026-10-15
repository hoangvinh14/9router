import { describe, it, expect, vi } from 'vitest';
import { inspectRawGeminiAccounting, readBufferedGeminiAccounting } from 'open-sse/utils/accountingGeminiUsage.js';
import { createAccountingGeminiSseParser } from 'open-sse/utils/accountingGeminiSseParser.js';
import { costFromExactUsageSnapshot } from '@/lib/pricing/money.js';
const original = (mode = 'STATIC') => ({ contents: [{ role: 'user', parts: [{ text: 'private prompt' }, { inlineData: { mimeType: 'video/mp4', data: 'b3BhcXVl', displayName: 'private video' }, mediaProcessing: mode }] }] });
const message = () => ({ modelVersion: 'fixture-gemini', candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'answer' }] } }], usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 40, candidatesTokenCount: 20, thoughtsTokenCount: 10, toolUsePromptTokenCount: 0, totalTokenCount: 130, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 30 }, { modality: 'VIDEO', tokenCount: 70 }], cacheTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'VIDEO', tokenCount: 30 }] } });
const bindings = (body = original()) => ({ inlineVideoOriginal: body, videoProcessingOriginal: body });
const inspect = (raw, authority = bindings()) => inspectRawGeminiAccounting(raw, 'fixture-gemini', authority);
const parse = (frames, authority = bindings()) => {
  const events = [], parser = createAccountingGeminiSseParser(e => events.push(e), { expectedModel: 'fixture-gemini', ...authority });
  const text = frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join(''); for (const byte of new TextEncoder().encode(text)) parser.push(Uint8Array.of(byte));
  return { usage: parser.finish(), events, text };
};
const snapshot = () => ({ rates: { input: '1', output: '2', cached: '0.1', input_image: '3', cached_image: '0.2', input_audio: '7', cached_audio: '0.4', input_video: '11', cached_video: '0.5' }, rateUnits: Object.fromEntries(['input', 'cached', 'input_image', 'cached_image', 'input_audio', 'cached_audio', 'input_video', 'cached_video'].map(key => [key, 'USD/1M tokens'])), usageSemantics: { inputModalities: 'observed_gemini_inline_input_modalities', allowedInputModalities: ['TEXT', 'VIDEO', 'IMAGE', 'AUDIO'], videoProcessingToolPrompt: 'observed_gemini_video_processing_tool_prompt_zero' } });
describe('video processing full-original raw token-only slice; unobserved/nonzero processing tools remain unresolved work', () => {
  it('JSON/buffered/one-byte SSE retain original STATIC/AGENTIC/UNSPECIFIED and require independent processing/video bindings', async () => {
    for (const mode of ['STATIC', 'AGENTIC', 'MEDIA_PROCESSING_UNSPECIFIED']) {
      const body = original(mode), copy = structuredClone(body), raw = message(), result = inspect(raw, bindings(body)); expect(result.message).toEqual(raw); expect(body).toEqual(copy);
      expect(result.usage.inputModalities.VIDEO).toEqual({ input: 70, cacheRead: 30 });
      expect((await readBufferedGeminiAccounting(Response.json(raw), null, { expectedModel: 'fixture-gemini', ...bindings(body) })).usage).toEqual(result.usage);
      const stream = parse([raw], bindings(body)); expect(stream.usage).toEqual(result.usage); expect(new TextDecoder().decode(Buffer.concat(stream.events.map(e => Buffer.from(e.bytes))))).toBe(stream.text);
      for (const authority of [{}, { inlineVideoOriginal: body }, { videoProcessingOriginal: body }, { inlineAudioOriginal: body, videoProcessingOriginal: body }, { inlineVideoOriginal: body, videoResolutionOriginal: body }]) { expect(() => inspect(raw, authority)).toThrow(); expect(() => parse([raw], authority)).toThrow(); }
    }
  });
  it('observed VIDEO536000 or IMAGE/AUDIO249000 are mode/byte independent, require unobserved rates and explicit terminal zero processing-tool evidence', () => {
    for (const mode of ['STATIC', 'AGENTIC', 'MEDIA_PROCESSING_UNSPECIFIED']) { const body = original(mode); body.contents[0].parts[1].inlineData.data = Buffer.alloc(1000, 1).toString('base64'); expect(costFromExactUsageSnapshot(inspect(message(), bindings(body)).usage, snapshot())).toBe('536000'); }
    const frames = message(); frames.usageMetadata.promptTokensDetails = [{ modality: 'TEXT', tokenCount: 30 }, { modality: 'IMAGE', tokenCount: 50 }, { modality: 'AUDIO', tokenCount: 20 }]; frames.usageMetadata.cacheTokensDetails = [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'IMAGE', tokenCount: 20 }, { modality: 'AUDIO', tokenCount: 10 }]; expect(costFromExactUsageSnapshot(parse([frames], bindings(original('AGENTIC'))).usage, snapshot())).toBe('249000');
    const missing = snapshot(); delete missing.rates.cached_video; expect(() => costFromExactUsageSnapshot(inspect(frames).usage, missing)).toThrow();
    for (const change of [v => { delete v.usageMetadata.toolUsePromptTokenCount; }, v => { v.usageMetadata.toolUsePromptTokenCount = 1; v.usageMetadata.totalTokenCount = 131; }, v => { v.usageMetadata.processingCallCount = 1; }, v => { v.usageMetadata.toolUsePromptTokensDetails = [{ modality: 'TEXT', tokenCount: 1 }]; }]) { const raw = message(); change(raw); expect(() => inspect(raw)).toThrow(); expect(() => parse([raw])).toThrow(); }
    const zero = message(); zero.usageMetadata.cachedContentTokenCount = 0; zero.usageMetadata.cacheTokensDetails = []; expect(inspect(zero).usage.inputModalities.VIDEO.cacheRead).toBe(0); delete zero.usageMetadata.cacheTokensDetails; expect(() => inspect(zero)).toThrow();
  });
  it('mixed metadata/resolution/client/media/audio controls require all independent full-source bindings without mode/source divergence', () => {
    const body = original('AGENTIC'); body.contents[0].parts[1].videoMetadata = { fps: 24, endOffset: '1s' }; body.contents[0].parts[1].mediaResolution = {}; body.generationConfig = { mediaResolution: 'MEDIA_RESOLUTION_HIGH' };
    body.tools = [{ functionDeclarations: [{ name: 'lookup', description: 'Lookup' }] }]; body.contents[0].parts.push({ inlineData: { mimeType: 'application/pdf', data: 'YQ==' }, mediaResolution: {} }, { inlineData: { mimeType: 'audio/opus', data: 'Yg==' }, mediaResolution: {} });
    const authority = { ...bindings(body), videoMetadataOriginal: body, videoResolutionOriginal: body, inlineMediaOriginal: body, inlineResolutionOriginal: body, inlineAudioOriginal: body, audioResolutionOriginal: body, clientToolsOriginal: body }, raw = message(); raw.candidates[0].content.parts = [{ functionCall: { id: 'opaque', name: 'lookup', args: { q: 'private' } }, thoughtSignature: 'b3BhcXVl' }];
    expect(inspect(raw, authority).usage.inputModalities.VIDEO.input).toBe(70); expect(parse([raw], authority).usage.inputModalities.VIDEO.input).toBe(70);
    for (const key of Object.keys(authority)) { const missing = { ...authority }; delete missing[key]; expect(() => inspect(raw, missing)).toThrow(); }
    for (const change of [v => { v.contents[0].parts[1].mediaProcessing = 'STATIC'; }, v => { v.contents[0].parts[1].inlineData.data = 'YQ=='; }, v => { v.contents[0].parts[0].text = 'different'; }]) { const different = structuredClone(body); change(different); expect(() => inspect(raw, { ...authority, videoProcessingOriginal: different })).toThrow(); expect(() => parse([raw], { ...authority, videoProcessingOriginal: different })).toThrow(); }
  });
  it('early evidence cannot fill missing terminal attribution or erase output/foreign/resource/processing work', () => {
    const early = message(); delete early.candidates[0].finishReason; expect(parse([early]).usage).toBeNull(); expect(parse([early, message()]).events.map(e => e.terminal)).toEqual([false, true]);
    for (const change of [v => { delete v.usageMetadata.promptTokensDetails; }, v => { delete v.usageMetadata.cacheTokensDetails; }, v => { delete v.usageMetadata.toolUsePromptTokenCount; }, v => { v.usageMetadata.promptTokensDetails[1].modality = 'DOCUMENT'; }, v => { v.candidates[0].content.parts[0].mediaProcessing = 'STATIC'; }, v => { v.candidates[0].content.parts = [{ inlineData: { mimeType: 'video/mp4', data: 'YQ==' } }]; }]) { const raw = message(); change(raw); expect(() => inspect(raw)).toThrow(); expect(() => parse([early, raw])).toThrow(); }
    for (const change of [v => { delete v.contents[0].parts[1].mediaProcessing; }, v => { v.contents[0].parts[1].mediaProcessing = 'UNKNOWN'; }, v => { v.contents[0].parts[1].inlineData.mimeType = 'audio/opus'; }, v => { v.processing_options = {}; }, v => { delete v.contents[0].parts[1].inlineData; v.contents[0].parts[1].fileData = { fileUri: 'files/private', mimeType: 'video/mp4' }; }]) { const body = original(); change(body); expect(() => inspect(message(), bindings(body))).toThrow(); expect(() => parse([message()], bindings(body))).toThrow(); }
  });
  it('PDF DOCUMENT needs its own original grant and required unobserved video prices, never processing-derived counts', () => {
    const body = original('AGENTIC'); body.contents[0].parts.push({ inlineData: { mimeType: 'application/pdf', data: 'YQ==' } });
    const raw = message(); raw.usageMetadata.promptTokensDetails[1].modality = raw.usageMetadata.cacheTokensDetails[1].modality = 'DOCUMENT';
    const authority = { ...bindings(body), inlineMediaOriginal: body }, rates = snapshot();
    rates.rates.input_document = '4'; rates.rates.cached_document = '0.3'; rates.rateUnits.input_document = rates.rateUnits.cached_document = 'USD/1M tokens'; rates.usageSemantics.allowedInputModalities.push('DOCUMENT');
    expect(costFromExactUsageSnapshot(parse([raw], authority).usage, rates)).toBe('250000'); expect(() => inspect(raw, bindings(body))).toThrow();
    delete rates.rates.cached_video; expect(() => costFromExactUsageSnapshot(inspect(raw, authority).usage, rates)).toThrow();
  });
  it('early nonzero processing-tool/foreign evidence and framing or sink failure stay sticky across valid terminal zero', () => {
    for (const change of [v => { v.usageMetadata.toolUsePromptTokenCount = 1; }, v => { v.usageMetadata.promptTokensDetails[1].modality = 'DOCUMENT'; }]) { const early = message(); delete early.candidates[0].finishReason; change(early); expect(() => parse([early, message()])).toThrow(); }
    const bytes = new TextEncoder().encode(`data: ${JSON.stringify(message())}\n\n`);
    const broken = createAccountingGeminiSseParser(() => {}, { expectedModel: 'fixture-gemini', ...bindings() }); expect(() => broken.push(new TextEncoder().encode('event: foreign\n\n'))).toThrow(); expect(() => broken.push(bytes)).toThrow(); expect(() => broken.finish()).toThrow();
    const sink = createAccountingGeminiSseParser(() => { throw new Error('private processing sink failure'); }, { expectedModel: 'fixture-gemini', ...bindings() }); expect(() => sink.push(bytes)).toThrow('private processing sink failure'); expect(() => sink.finish()).toThrow();
  });
  it('guarded programmable evidence fails before reads; immutable SSE processing source survives external mutation', () => {
    const body = original(), parser = createAccountingGeminiSseParser(() => {}, { expectedModel: 'fixture-gemini', ...bindings(body) }); body.contents[0].parts[1].mediaProcessing = 'UNKNOWN'; parser.push(new TextEncoder().encode(`data: ${JSON.stringify(message())}\n\n`)); expect(parser.evidence()).toBeNull(); expect(parser.finish().inputModalities.VIDEO.input).toBe(70); expect(() => parser.finish()).toThrow();
    const getter = vi.fn(), trap = vi.fn(), programmable = original(); Object.defineProperty(programmable.contents[0].parts[1], 'mediaProcessing', { enumerable: true, get: getter }); expect(() => inspect(message(), bindings(programmable))).toThrow(); expect(() => inspect(message(), { ...bindings(), videoProcessingOriginal: new Proxy(original(), { ownKeys: trap }) })).toThrow(); const raw = message(); Object.defineProperty(raw.usageMetadata, 'toolUsePromptTokenCount', { enumerable: true, get: getter }); expect(() => inspect(raw)).toThrow(); expect(getter).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
  });
});
