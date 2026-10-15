import { describe, expect, it, vi } from 'vitest';
import { inspectRawGeminiAccounting, readBufferedGeminiAccounting } from 'open-sse/utils/accountingGeminiUsage.js';
import { createAccountingGeminiSseParser } from 'open-sse/utils/accountingGeminiSseParser.js';
import { costFromExactUsageSnapshot } from '@/lib/pricing/money.js';
const original = () => ({ contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'video/mp4', data: 'b3BhcXVl' }, mediaProcessing: 'AGENTIC' }, { text: 'private prompt' }] }] });
const call = () => ({ toolCall: { toolType: 'MEDIA_PROCESSING', id: 'load_1', args: { private: { opaque: ['transcript', 2] } } }, thoughtSignature: 'YQ==' });
const result = () => ({ toolResponse: { toolType: 'MEDIA_PROCESSING', id: 'load_1', response: { private: 'opaque loaded' } }, thoughtSignature: 'Yg==' });
const message = () => ({ modelVersion: 'fixture-gemini', candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'private thought', thought: true }, call(), result(), { text: 'answer', thoughtSignature: 'Yw==' }] } }], usageMetadata: {
  promptTokenCount: 100, cachedContentTokenCount: 40, candidatesTokenCount: 20, thoughtsTokenCount: 10, toolUsePromptTokenCount: 50, totalTokenCount: 180,
  promptTokensDetails: [{ modality: 'TEXT', tokenCount: 30 }, { modality: 'VIDEO', tokenCount: 70 }], cacheTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'VIDEO', tokenCount: 30 }],
  toolUsePromptTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'IMAGE', tokenCount: 30 }, { modality: 'AUDIO', tokenCount: 10 }],
} });
const bindings = (body = original()) => ({ inlineVideoOriginal: body, videoProcessingOriginal: body, processingToolsOriginal: body });
const inspect = (raw, authority = bindings()) => inspectRawGeminiAccounting(raw, 'fixture-gemini', authority);
const parser = (authority = bindings(), onEvent = () => {}) => createAccountingGeminiSseParser(onEvent, { expectedModel: 'fixture-gemini', ...authority });
const push = (p, frame) => { const text = `data: ${JSON.stringify(frame)}\n\n`; for (const byte of new TextEncoder().encode(text)) p.push(Uint8Array.of(byte)); return text; };
describe('bound processing tool traces and observed tool-prompt modalities, no monetary/queued admission grant', () => {
  it('JSON/buffered/one-byte SSE conserve complete processing traces and terminal quantities separate from initial prompt and reasoning', async () => {
    const body = original(), copy = structuredClone(body), raw = message(), authority = bindings(body), usage = inspect(raw, authority).usage;
    expect(usage).toMatchObject({ input: 100, cacheRead: 40, output: 20, reasoning: 10, reasoningIncludedInOutput: false, processingToolPromptTokens: 50, processingToolModalities: { TEXT: 10, IMAGE: 30, AUDIO: 10 }, provenance: { videoProcessingToolPrompt: 'observed_gemini_video_processing_tool_prompt_modalities' } });
    expect(inspect(raw, authority).message).toEqual(raw); expect((await readBufferedGeminiAccounting(Response.json(raw), null, { expectedModel: 'fixture-gemini', ...authority })).usage).toEqual(usage);
    const events = [], p = parser(authority, event => events.push(event)); const text = push(p, raw); expect(p.finish()).toEqual(usage); expect(Buffer.concat(events.map(e => Buffer.from(e.bytes))).toString()).toBe(text); expect(body).toEqual(copy);
  });
  it('requires separate full-original processing-tools owner and exact equal video/processing/history permissions', () => {
    const body = original(), raw = message(); expect(inspect(raw, bindings(body)).usage.processingToolPromptTokens).toBe(50);
    for (const change of [a => { delete a.processingToolsOriginal; }, a => { delete a.inlineVideoOriginal; }, a => { delete a.videoProcessingOriginal; }, a => { a.processingToolsOriginal = structuredClone(body); a.processingToolsOriginal.contents[0].parts[0].mediaProcessing = 'STATIC'; }]) { const a = bindings(body); change(a); expect(() => inspect(raw, a)).toThrow(); }
    const history = original(), oldCall = call(), oldResult = result(); oldCall.toolCall.id = oldResult.toolResponse.id = 'old_1'; history.contents.push({ role: 'model', parts: [oldCall, oldResult, { text: 'answer' }] }, { role: 'user', parts: [{ text: 'follow up' }] }); expect(inspect(message(), bindings(history)).usage.processingToolPromptTokens).toBe(50);
  });
  it('requires explicit terminal scalar/detail sums, unique allowed modalities and exact total; never substitutes initial input/cache or guesses missing usage', () => {
    expect(inspect(message()).usage.processingToolModalities).toEqual({ TEXT: 10, IMAGE: 30, AUDIO: 10 });
    for (const change of [r => { delete r.usageMetadata.toolUsePromptTokenCount; }, r => { delete r.usageMetadata.toolUsePromptTokensDetails; }, r => { r.usageMetadata.toolUsePromptTokensDetails[0].tokenCount = 11; }, r => { r.usageMetadata.toolUsePromptTokensDetails.push({ modality: 'TEXT', tokenCount: 0 }); }, r => { r.usageMetadata.toolUsePromptTokensDetails[0].modality = 'DOCUMENT'; }, r => { r.usageMetadata.totalTokenCount = 130; }, r => { r.usageMetadata.toolUsePromptTokenCount = null; }, r => { r.usageMetadata.toolUsePromptTokensDetails[0].tokenCount = -1; }, r => { r.usageMetadata.toolUsePromptTokensDetails[0].estimated = true; }]) { const raw = message(); change(raw); expect(() => inspect(raw)).toThrow(); }
    const zero = message(); zero.usageMetadata.toolUsePromptTokenCount = 0; zero.usageMetadata.toolUsePromptTokensDetails = []; zero.usageMetadata.totalTokenCount = 130; expect(inspect(zero).usage.processingToolModalities).toEqual({});
  });
  it('does not infer tool tokens from pair count/opaque bytes or charge nonzero evidence with legacy zero/input-only snapshots', () => {
    const raw = message(); raw.candidates[0].content.parts.splice(3, 0, { toolCall: { toolType: 'MEDIA_PROCESSING' } }, { toolResponse: { toolType: 'MEDIA_PROCESSING' } }); raw.candidates[0].content.parts[1].toolCall.args.private = 'x'.repeat(1000);
    const usage = inspect(raw).usage; expect(usage.processingToolPromptTokens).toBe(50); expect(usage.input).toBe(100);
    const price = { rates: { input: '0', output: '0', cached: '0', input_video: '0', cached_video: '0', input_image: '0', cached_image: '0', input_audio: '0', cached_audio: '0' }, rateUnits: Object.fromEntries(['input', 'cached', 'input_video', 'cached_video', 'input_image', 'cached_image', 'input_audio', 'cached_audio'].map(k => [k, 'USD/1M tokens'])), usageSemantics: { inputModalities: 'observed_gemini_inline_input_modalities', allowedInputModalities: ['TEXT', 'VIDEO', 'IMAGE', 'AUDIO'], videoProcessingToolPrompt: 'observed_gemini_video_processing_tool_prompt_zero' } };
    expect(() => costFromExactUsageSnapshot(usage, price)).toThrow(); delete price.usageSemantics.videoProcessingToolPrompt; expect(() => costFromExactUsageSnapshot(usage, price)).toThrow();
  });
  it('stream associates calls/results across frames and captures immutable original before callbacks; terminal-only usage replaces early counts', () => {
    const body = original(), p = parser(bindings(body), () => { body.contents[0].parts[0].mediaProcessing = 'UNKNOWN'; });
    const early = message(); delete early.candidates[0].finishReason; early.candidates[0].content.parts = [call()]; early.usageMetadata.toolUsePromptTokenCount = 0; early.usageMetadata.toolUsePromptTokensDetails = []; early.usageMetadata.totalTokenCount = 130;
    const terminal = message(); terminal.candidates[0].content.parts = [result(), { text: 'answer' }]; push(p, early); push(p, terminal); expect(p.finish().processingToolPromptTokens).toBe(50);
    const missing = message(); missing.candidates[0].content.parts = [result(), { text: 'answer' }]; delete missing.usageMetadata.toolUsePromptTokensDetails; const fail = parser(); push(fail, early); expect(() => push(fail, missing)).toThrow(); expect(() => fail.finish()).toThrow();
  });
  it('refuses orphan/duplicate/foreign processing traces, output media/resources and unknown early quantities with sticky framing/sink failure', () => {
    expect(inspect(message()).usage.processingToolPromptTokens).toBe(50);
    for (const change of [r => { r.candidates[0].content.parts.splice(2, 1); }, r => { r.candidates[0].content.parts[2].toolResponse.id = 'different'; }, r => { r.candidates[0].content.parts[1].toolCall.toolType = 'GOOGLE_SEARCH_WEB'; }, r => { r.candidates[0].content.parts.push({ inlineData: { mimeType: 'image/png', data: 'YQ==' } }); }, r => { r.candidates[0].content.parts[1].fileData = { fileUri: 'files/private' }; }]) { const raw = message(); change(raw); expect(() => inspect(raw)).toThrow(); }
    const p = parser(), early = message(); delete early.candidates[0].finishReason; early.usageMetadata.toolUsePromptTokensDetails[0].modality = 'UNKNOWN'; expect(() => push(p, early)).toThrow(); expect(() => p.finish()).toThrow();
    const sink = parser(bindings(), () => { throw new Error('fixture sink'); }); expect(() => push(sink, message())).toThrow('fixture sink'); expect(() => sink.finish()).toThrow();
  });
  it('conserves independently bound client calls/history and optional metadata/resolution with processing trace, not a hosted-tool or source permission grant', () => {
    const body = original(); body.tools = [{ functionDeclarations: [{ name: 'lookup', description: 'Private lookup' }] }];
    body.contents[0].parts[0].videoMetadata = { fps: 24, endOffset: '1s' }; body.contents[0].parts[0].mediaResolution = {}; body.generationConfig = { mediaResolution: 'MEDIA_RESOLUTION_LOW' };
    const raw = message(); raw.candidates[0].content.parts.push({ functionCall: { id: 'client_1', name: 'lookup', args: { q: 'private' } }, thoughtSignature: 'ZA==' });
    const a = { ...bindings(body), clientToolsOriginal: body, videoMetadataOriginal: body, videoResolutionOriginal: body }; expect(inspect(raw, a).usage.processingToolPromptTokens).toBe(50);
    for (const key of ['clientToolsOriginal', 'videoMetadataOriginal', 'videoResolutionOriginal']) { const bad = { ...a }; delete bad[key]; expect(() => inspect(raw, bad)).toThrow(); }
    const p = parser(a); push(p, raw); expect(p.finish().processingToolModalities).toEqual({ TEXT: 10, IMAGE: 30, AUDIO: 10 });
  });
  it('bounds stream association state, refuses unresolved EOF/reused history IDs, and preserves default exact normalization refusal', async () => {
    const { normalizeExactUsage } = await import('open-sse/utils/exactUsage.js');
    expect(normalizeExactUsage(message().usageMetadata, 'gemini')).toBeNull(); expect(normalizeExactUsage(message().usageMetadata, 'claude', 'chat', { allowGeminiProcessingUsage: true })).toBeNull();
    const a = bindings(), p = parser(a), early = message(); delete early.candidates[0].finishReason; early.candidates[0].content.parts = [call()]; push(p, early); expect(p.finish()).toBeNull();
    const history = original(); history.contents.push({ role: 'model', parts: [call(), result(), { text: 'old' }] }); expect(() => inspect(message(), bindings(history))).toThrow();
    const large = message(); large.candidates[0].content.parts = Array.from({ length: 5001 }, () => [{ toolCall: { toolType: 'MEDIA_PROCESSING' } }, { toolResponse: { toolType: 'MEDIA_PROCESSING' } }]).flat(); expect(() => inspect(large)).toThrow();
  });
  it('invokes no source/raw getters or proxies and does not turn malformed prepared data into observed tool evidence', () => {
    const raw = message(); expect(inspect(raw).usage.processingToolPromptTokens).toBe(50);
    const getter = vi.fn(); Object.defineProperty(raw.candidates[0].content.parts[1].toolCall, 'args', { enumerable: true, get: getter }); expect(() => inspect(raw)).toThrow(); expect(getter).not.toHaveBeenCalled();
    const trap = vi.fn(), bad = message(); bad.usageMetadata.toolUsePromptTokensDetails = new Proxy([], { ownKeys: trap, get: trap }); expect(() => inspect(bad)).toThrow(); expect(trap).not.toHaveBeenCalled();
  });
});
