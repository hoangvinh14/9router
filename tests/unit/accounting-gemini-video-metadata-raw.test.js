import { describe, it, expect, vi } from 'vitest';
import { inspectRawGeminiAccounting, readBufferedGeminiAccounting } from 'open-sse/utils/accountingGeminiUsage.js';
import { createAccountingGeminiSseParser } from 'open-sse/utils/accountingGeminiSseParser.js';
import { costFromExactUsageSnapshot } from '@/lib/pricing/money.js';
const original = (metadata = { fps: 0.5, startOffset: '0.000000001s', endOffset: '1.000000001s' }) => ({ contents: [{ role: 'user', parts: [{ text: 'private prompt' }, { inlineData: { mimeType: 'video/mp4', data: 'b3BhcXVl', displayName: 'private video' }, videoMetadata: metadata }] }] });
const message = () => ({ modelVersion: 'fixture-gemini', candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'answer' }] } }],
  usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 40, candidatesTokenCount: 20, thoughtsTokenCount: 10, totalTokenCount: 130,
    promptTokensDetails: [{ modality: 'TEXT', tokenCount: 30 }, { modality: 'VIDEO', tokenCount: 70 }], cacheTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'VIDEO', tokenCount: 30 }] } });
const bindings = (body = original()) => ({ inlineVideoOriginal: body, videoMetadataOriginal: body });
const inspect = (raw, authority = bindings()) => inspectRawGeminiAccounting(raw, 'fixture-gemini', authority);
const parse = (frames, authority = bindings()) => {
  const events = [], parser = createAccountingGeminiSseParser(e => events.push(e), { expectedModel: 'fixture-gemini', ...authority });
  const text = frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('');
  for (const byte of new TextEncoder().encode(text)) parser.push(Uint8Array.of(byte));
  return { usage: parser.finish(), events, text };
};
const snapshot = {
  rates: { input: '1', output: '2', cached: '0.1', input_image: '3', cached_image: '0.2', input_audio: '7', cached_audio: '0.4', input_video: '11', cached_video: '0.5' },
  rateUnits: Object.fromEntries(['input', 'cached', 'input_image', 'cached_image', 'input_audio', 'cached_audio', 'input_video', 'cached_video'].map(key => [key, 'USD/1M tokens'])),
  usageSemantics: { inputModalities: 'observed_gemini_inline_input_modalities', allowedInputModalities: ['TEXT', 'VIDEO', 'IMAGE', 'AUDIO'] },
};
describe('legacy video metadata original-bound raw prerequisite, never usage from offsets/FPS', () => {
  it('JSON/buffered/SSE retain full original metadata and only observed counters; video alone or metadata alone is not a composite grant', async () => {
    const body = original(), before = structuredClone(body), raw = message();
    const result = inspect(raw, bindings(body)); expect(result.message).toEqual(raw); expect(body).toEqual(before);
    expect(result.usage).toMatchObject({ exact: true, input: 100, cacheRead: 40, output: 20, reasoning: 10, inputModalities: { TEXT: { input: 30, cacheRead: 10 }, VIDEO: { input: 70, cacheRead: 30 } } });
    expect((await readBufferedGeminiAccounting(Response.json(raw), null, { expectedModel: 'fixture-gemini', ...bindings(body) })).usage).toEqual(result.usage);
    expect(parse([raw], bindings(body)).usage).toEqual(result.usage);
    for (const authority of [{}, { inlineVideoOriginal: body }, { videoMetadataOriginal: body }, { inlineAudioOriginal: body, videoMetadataOriginal: body }, { inlineMediaOriginal: body, videoMetadataOriginal: body }]) {
      expect(() => inspect(raw, authority)).toThrow(); expect(() => parse([raw], authority)).toThrow();
    }
  });
  it('full original equality covers offsets/FPS, bytes, prompt and independent client/image/audio bindings', () => {
    const body = original(); body.tools = [{ functionDeclarations: [{ name: 'lookup', description: 'Lookup' }] }];
    body.contents[0].parts.push({ inlineData: { mimeType: 'image/png', data: 'YQ==' } }, { inlineData: { mimeType: 'audio/opus', data: 'Yg==' } });
    const raw = message(); raw.candidates[0].content.parts = [{ functionCall: { id: 'opaque', name: 'lookup', args: { q: 'private' } }, thoughtSignature: 'b3BhcXVl' }];
    const authority = { ...bindings(body), clientToolsOriginal: body, inlineMediaOriginal: body, inlineAudioOriginal: body };
    expect(inspect(raw, authority).usage.inputModalities.VIDEO.input).toBe(70); expect(parse([raw], authority).usage.inputModalities.VIDEO.input).toBe(70);
    for (const key of Object.keys(authority)) { const missing = { ...authority }; delete missing[key]; expect(() => inspect(raw, missing)).toThrow(); }
    for (const change of [v => { v.contents[0].parts[1].videoMetadata.fps = 2; }, v => { v.contents[0].parts[1].videoMetadata.endOffset = '2s'; }, v => { v.contents[0].parts[1].inlineData.data = 'YQ=='; }, v => { v.contents[0].parts[0].text = 'different'; }]) {
      const different = structuredClone(body); change(different); expect(() => inspect(raw, { ...authority, videoMetadataOriginal: different })).toThrow(); expect(() => parse([raw], { ...authority, videoMetadataOriginal: different })).toThrow();
    }
    const undeclared = structuredClone(raw); undeclared.candidates[0].content.parts[0].functionCall.name = 'foreign'; expect(() => inspect(undeclared, authority)).toThrow();
  });
  it('wildly different valid offsets/FPS/byte lengths do not change exact typed observed cost, including IMAGE/AUDIO instead of VIDEO', () => {
    const raw = message();
    for (const metadata of [{}, { fps: 24, startOffset: '315575999999.999999999s', endOffset: '315576000000s' }, { fps: 0.000001, endOffset: '1s' }]) {
      const body = original(metadata); body.contents[0].parts[1].inlineData.data = Buffer.alloc(1000, 1).toString('base64');
      expect(costFromExactUsageSnapshot(inspect(raw, bindings(body)).usage, snapshot)).toBe('536000');
    }
    const frames = message(); frames.usageMetadata.promptTokensDetails = [{ modality: 'TEXT', tokenCount: 30 }, { modality: 'IMAGE', tokenCount: 50 }, { modality: 'AUDIO', tokenCount: 20 }];
    frames.usageMetadata.cacheTokensDetails = [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'IMAGE', tokenCount: 20 }, { modality: 'AUDIO', tokenCount: 10 }];
    expect(costFromExactUsageSnapshot(parse([frames]).usage, snapshot)).toBe('249000');
    const missingRate = structuredClone(snapshot); delete missingRate.rates.cached_video; expect(() => costFromExactUsageSnapshot(inspect(raw).usage, missingRate)).toThrow();
    const zero = message(); zero.usageMetadata.cachedContentTokenCount = 0; zero.usageMetadata.cacheTokensDetails = []; expect(inspect(zero).usage.inputModalities.VIDEO.cacheRead).toBe(0);
  });
  it('early counters are not terminal fallback; missing lists, foreign categories, durations, hosted work and output metadata remain unavailable', () => {
    const raw = message(), early = structuredClone(raw); delete early.candidates[0].finishReason;
    const result = parse([early, raw]); expect(result.events.map(e => e.terminal)).toEqual([false, true]); expect(new TextDecoder().decode(Buffer.concat(result.events.map(e => Buffer.from(e.bytes))))).toBe(result.text);
    expect(parse([early]).usage).toBeNull();
    for (const change of [v => { delete v.usageMetadata.promptTokensDetails; }, v => { delete v.usageMetadata.cacheTokensDetails; }, v => { v.usageMetadata.promptTokensDetails[1].modality = 'DOCUMENT'; },
      v => { v.usageMetadata.durationSeconds = 1; }, v => { v.usageMetadata.toolUsePromptTokenCount = 1; }, v => { v.usageMetadata.candidatesTokensDetails = [{ modality: 'VIDEO', tokenCount: 20 }]; },
      v => { v.candidates[0].content.parts[0].videoMetadata = { fps: 1 }; }, v => { v.candidates[0].content.parts = [{ inlineData: { mimeType: 'video/mp4', data: 'YQ==' } }]; }]) {
      const bad = message(); change(bad); expect(() => inspect(bad)).toThrow(); expect(() => parse([early, bad])).toThrow();
    }
    const foreignEarly = structuredClone(early); foreignEarly.usageMetadata.promptTokensDetails[1].modality = 'DOCUMENT'; expect(() => parse([foreignEarly, raw])).toThrow();
  });
  it('DOCUMENT permission still comes only from matching PDF input binding; metadata alone cannot add or erase categories', () => {
    const body = original(); body.contents[0].parts.push({ inlineData: { mimeType: 'application/pdf', data: 'YQ==' } });
    const raw = message(); raw.usageMetadata.promptTokensDetails[1].modality = 'DOCUMENT'; raw.usageMetadata.cacheTokensDetails[1].modality = 'DOCUMENT';
    const authority = { ...bindings(body), inlineMediaOriginal: body };
    expect(inspect(raw, authority).usage.inputModalities.DOCUMENT.input).toBe(70); expect(parse([raw], authority).usage.inputModalities.DOCUMENT.cacheRead).toBe(30);
    expect(() => inspect(raw, bindings(body))).toThrow(); expect(() => inspect(raw)).toThrow();
    const rates = structuredClone(snapshot); rates.usageSemantics.allowedInputModalities.push('DOCUMENT'); rates.rates.input_document = '4'; rates.rates.cached_document = '0.3';
    rates.rateUnits.input_document = rates.rateUnits.cached_document = 'USD/1M tokens';
    expect(costFromExactUsageSnapshot(inspect(raw, authority).usage, rates)).toBe('250000');
    delete rates.rates.cached_video; expect(() => costFromExactUsageSnapshot(inspect(raw, authority).usage, rates)).toThrow();
  });
  it('source bound capture is immutable after construction and terminal evidence still requires clean finish, with sticky framing/sink failure', () => {
    const body = original(), parser = createAccountingGeminiSseParser(() => {}, { expectedModel: 'fixture-gemini', ...bindings(body) });
    body.contents[0].parts[1].videoMetadata.fps = 0;
    const bytes = new TextEncoder().encode(`data: ${JSON.stringify(message())}\n\n`); parser.push(bytes); expect(parser.evidence()).toBeNull(); expect(parser.finish().inputModalities.VIDEO.input).toBe(70); expect(() => parser.finish()).toThrow();
    const broken = createAccountingGeminiSseParser(() => {}, { expectedModel: 'fixture-gemini', ...bindings() }); expect(() => broken.push(new TextEncoder().encode('event: foreign\n\n'))).toThrow(); expect(() => broken.push(bytes)).toThrow(); expect(() => broken.finish()).toThrow();
    const sink = createAccountingGeminiSseParser(() => { throw new Error('private sink failure'); }, { expectedModel: 'fixture-gemini', ...bindings() }); expect(() => sink.push(bytes)).toThrow('private sink failure'); expect(() => sink.finish()).toThrow();
  });
  it('metadata binding capture refuses getters/proxies without reads, invalid source-local offsets/resources/processing and no actual metadata', () => {
    expect(inspect(message()).usage.exact).toBe(true);
    const getter = vi.fn(), trap = vi.fn(), body = original(); Object.defineProperty(body.contents[0].parts[1].videoMetadata, 'fps', { enumerable: true, get: getter }); expect(() => inspect(message(), bindings(body))).toThrow();
    expect(() => inspect(message(), { ...bindings(), videoMetadataOriginal: new Proxy(original(), { ownKeys: trap }) })).toThrow();
    const raw = message(); Object.defineProperty(raw.usageMetadata, 'promptTokensDetails', { enumerable: true, get: getter }); expect(() => inspect(raw)).toThrow(); expect(getter).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
    for (const change of [v => { delete v.contents[0].parts[1].videoMetadata; }, v => { v.contents[0].parts[1].videoMetadata.startOffset = '2s'; },
      v => { v.contents[0].parts[1].mediaProcessing = 'AGENTIC'; }, v => { v.contents[0].parts[1].mediaResolution = { level: 'MEDIA_RESOLUTION_LOW' }; },
      v => { delete v.contents[0].parts[1].inlineData; v.contents[0].parts[1].fileData = { mimeType: 'video/mp4', fileUri: 'files/private' }; }]) {
      const bad = original(); change(bad); expect(() => inspect(message(), bindings(bad))).toThrow(); expect(() => parse([message()], bindings(bad))).toThrow();
    }
  });
});
