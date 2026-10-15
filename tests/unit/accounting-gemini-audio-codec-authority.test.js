import { describe, it, expect } from 'vitest';
import { supportsGeminiRequest } from 'open-sse/config/accountedGeminiCandidate.js';
import { inspectRawGeminiAccounting } from 'open-sse/utils/accountingGeminiUsage.js';
import { createGeminiInputModalityAuthority } from 'open-sse/config/accountingGeminiInputModalities.js';

// Public audio guide names these MIME strings; its Interactions examples are
// not GenerateContent runtime/model/codec eligibility or observed token proof.
const codecs = ['audio/m4a', 'audio/l16', 'audio/opus', 'audio/alaw', 'audio/mulaw', 'audio/webm'];
describe('remaining input audio MIME original/raw authority, not genuine codec decoding', () => {
  it.each(codecs)('%s retains opaque original bytes and requires observed AUDIO rather than MIME/length/duration inference', mimeType => {
    const original = { contents: [{ role: 'user', parts: [{ text: 'private prompt' }, { inlineData: { mimeType, data: 'YQ==', displayName: 'private input' } }] }] };
    const before = structuredClone(original);
    expect(supportsGeminiRequest(original, false, false, true)).toBe(true); expect(original).toEqual(before);
    expect(supportsGeminiRequest(original)).toBe(false); expect(supportsGeminiRequest(original, false, true)).toBe(false);
    expect(createGeminiInputModalityAuthority(original, null, false, true).allowedInputModalities).toEqual(['TEXT', 'AUDIO']);
    const raw = { modelVersion: 'fixture-gemini', candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'answer' }] } }],
      usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 40, candidatesTokenCount: 20, thoughtsTokenCount: 10, totalTokenCount: 130,
        promptTokensDetails: [{ modality: 'TEXT', tokenCount: 30 }, { modality: 'AUDIO', tokenCount: 70 }],
        cacheTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'AUDIO', tokenCount: 30 }] } };
    const inspected = inspectRawGeminiAccounting(raw, 'fixture-gemini', { inlineAudioOriginal: original });
    expect(inspected.usage.inputModalities.AUDIO).toEqual({ input: 70, cacheRead: 30 }); expect(raw.candidates[0].content.parts[0].text).toBe('answer');
    const absent = structuredClone(raw); delete absent.usageMetadata.promptTokensDetails;
    expect(() => inspectRawGeminiAccounting(absent, 'fixture-gemini', { inlineAudioOriginal: original })).toThrow();
    const changed = structuredClone(original); changed.contents[0].parts[1].inlineData.data = 'YWI=';
    expect(inspectRawGeminiAccounting(raw, 'fixture-gemini', { inlineAudioOriginal: changed }).usage.inputModalities).toEqual(inspected.usage.inputModalities);
    changed.contents[0].parts[1].inlineData.durationSeconds = 1; expect(supportsGeminiRequest(changed, false, false, true)).toBe(false);
    const foreign = structuredClone(raw); foreign.usageMetadata.promptTokensDetails[1].modality = 'VIDEO';
    expect(() => inspectRawGeminiAccounting(foreign, 'fixture-gemini', { inlineAudioOriginal: original })).toThrow();
  });
});
