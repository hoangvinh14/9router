import { describe, it, expect, vi } from 'vitest';
import { createGeminiOwnedFileRawAuthority, assertGeminiOwnedFileRawAuthority } from 'open-sse/config/accountingGeminiOwnedFileRaw.js';
import { supportsGeminiOwnedFilesOriginal } from 'open-sse/config/accountingGeminiOwnedFilesOriginal.js';
import { supportsGeminiRequest } from 'open-sse/config/accountedGeminiCandidate.js';
import { inspectRawGeminiAccounting } from 'open-sse/utils/accountingGeminiUsage.js';
import { createAccountingGeminiSseParser } from 'open-sse/utils/accountingGeminiSseParser.js';
import { costFromExactUsageSnapshot } from '@/lib/pricing/money.js';
const resources = () => [{ id: 'resource-image', file: { name: 'files/owned-image', uri: 'https://generativelanguage.googleapis.com/v1beta/files/owned-image', mimeType: 'image/png', sizeBytes: '17', sha256Hash: Buffer.alloc(32, 1).toString('base64'), createTime: '2026-10-03T00:00:00Z', updateTime: '2026-10-03T00:00:00Z', expirationTime: '2026-10-05T00:00:00Z', state: 'ACTIVE', source: 'UPLOADED' } }];
const original = () => ({ contents: [{ role: 'user', parts: [{ text: 'private prompt' }, { fileData: { fileUri: resources()[0].file.uri } }, { inlineData: { mimeType: 'video/mp4', data: 'b3BhcXVl', displayName: 'private video' } }] }] });
const owner = (body = original(), video = true, media = false, audio = false) => createGeminiOwnedFileRawAuthority(body, resources(), false, false, false, media, audio, video);
const message = () => ({ modelVersion: 'fixture-gemini', candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'answer' }] } }], usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 40, candidatesTokenCount: 20, thoughtsTokenCount: 10, totalTokenCount: 130, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 30 }, { modality: 'VIDEO', tokenCount: 70 }], cacheTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'VIDEO', tokenCount: 30 }] } });
const inspect = (raw, authority) => inspectRawGeminiAccounting(raw, 'fixture-gemini', { ownedFileRawAuthority: authority });
const price = () => { const rates = { input: '1', output: '2', cached: '0.1', input_image: '3', cached_image: '0.2', input_audio: '7', cached_audio: '0.4', input_video: '11', cached_video: '0.5' }; return { rates, rateUnits: Object.fromEntries(Object.keys(rates).filter(key => key !== 'output').map(key => [key, 'USD/1M tokens'])), usageSemantics: { inputModalities: 'observed_gemini_owned_file_input_modalities', allowedInputModalities: ['TEXT', 'IMAGE', 'VIDEO', 'AUDIO'] } }; };
describe('owned image plus inline video pure raw prerequisite, not current ownership or POST permission', () => {
  it('retains full original and independently grants inline VIDEO categories, not quantities from bytes', () => {
    const body = original(), before = structuredClone(body);
    expect(supportsGeminiOwnedFilesOriginal(body, resources(), value => supportsGeminiRequest(value, false, false, false, true))).toBe(true);
    const authority = owner(body);
    expect(assertGeminiOwnedFileRawAuthority(authority).allowedInputModalities).toEqual(['TEXT', 'IMAGE', 'VIDEO', 'AUDIO']);
    expect(inspect(message(), authority).message).toEqual(message());
    expect(costFromExactUsageSnapshot(inspect(message(), authority).usage, price())).toBe('536000');
    expect(body).toEqual(before);
    const changed = original(); changed.contents[0].parts[2].inlineData.data = 'eA==';
    expect(costFromExactUsageSnapshot(inspect(message(), owner(changed)).usage, price())).toBe('536000');
  });
  it('preserves one-byte SSE and terminal-only counters with exact owned original provenance', () => {
    const authority = owner(), raw = message(), events = [], parser = createAccountingGeminiSseParser(event => { events.push(event); }, { expectedModel: 'fixture-gemini', ownedFileRawAuthority: authority });
    const text = 'data: ' + JSON.stringify(raw) + '\n\n';
    for (const byte of new TextEncoder().encode(text)) parser.push(Uint8Array.of(byte));
    expect(parser.evidence()).toBeNull(); expect(parser.finish()).toEqual(inspect(raw, authority).usage);
    expect(Buffer.concat(events.map(event => Buffer.from(event.bytes))).toString()).toBe(text);
    expect(() => inspect(raw, { ...authority })).toThrow();
    const missing = message(); delete missing.usageMetadata.cacheTokensDetails; expect(() => inspect(missing, authority)).toThrow();
  });
  it('defaults closed and does not infer client/image/audio/processing grants from inline video', () => {
    expect(inspect(message(), owner()).usage.exact).toBe(true);
    expect(() => owner(original(), false)).toThrow();
    for (const video of [null, 'true', 1, {}, []]) expect(() => owner(original(), video)).toThrow();
    for (const change of [body => { body.tools = [{ functionDeclarations: [{ name: 'lookup' }] }]; }, body => { body.contents[0].parts.push({ inlineData: { mimeType: 'audio/wav', data: 'YQ==' } }); }, body => { body.contents[0].parts.push({ inlineData: { mimeType: 'image/png', data: 'YQ==' } }); }, body => { body.contents[0].parts[2].mediaProcessing = 'AGENTIC'; }, body => { body.contents[0].parts[2].videoMetadata = { fps: 1 }; }]) {
      const body = original(); change(body); expect(() => owner(body)).toThrow();
    }
    const body = original(); body.contents[0].parts.push({ inlineData: { mimeType: 'audio/wav', data: 'YQ==' } }, { inlineData: { mimeType: 'image/png', data: 'YQ==' } });
    expect(inspect(message(), owner(body, true, true, true)).usage.exact).toBe(true);
  });
  it('rejects programmable originals before reads and requires every original category rate even if unobserved', () => {
    const authority = owner(), raw = message();
    const missing = price(); delete missing.rates.cached_audio;
    expect(() => costFromExactUsageSnapshot(inspect(raw, authority).usage, missing)).toThrow();
    const getter = vi.fn(), trap = vi.fn(), body = original();
    Object.defineProperty(body.contents[0].parts[2].inlineData, 'data', { enumerable: true, get: getter });
    expect(() => owner(body)).toThrow(); expect(getter).not.toHaveBeenCalled();
    expect(() => owner(new Proxy(original(), { ownKeys: trap, get: trap }))).toThrow(); expect(trap).not.toHaveBeenCalled();
    body.contents[0].parts[0].text = 'mutated'; expect(inspect(raw, authority).usage.input).toBe(100);
  });
});
