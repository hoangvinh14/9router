import { describe, it, expect, vi } from 'vitest';
import { createGeminiOwnedFileRawAuthority } from 'open-sse/config/accountingGeminiOwnedFileRaw.js';
import { inspectRawGeminiAccounting, readBufferedGeminiAccounting } from 'open-sse/utils/accountingGeminiUsage.js';
import { createAccountingGeminiSseParser } from 'open-sse/utils/accountingGeminiSseParser.js';
import { costFromExactUsageSnapshot } from '@/lib/pricing/money.js';
const file = () => ({ name: 'files/owned-video', uri: 'https://generativelanguage.googleapis.com/v1beta/files/owned-video', mimeType: 'video/mp4', sizeBytes: '17', sha256Hash: Buffer.alloc(32, 1).toString('base64'), createTime: '2026-10-03T00:00:00Z', updateTime: '2026-10-03T00:00:00Z', expirationTime: '2026-10-05T00:00:00Z', state: 'ACTIVE', source: 'UPLOADED' });
const resources = () => [{ id: 'resource-video', file: file() }];
const original = (level = 'MEDIA_RESOLUTION_ULTRA_HIGH') => ({ contents: [{ parts: [{ text: 'private original' }, { fileData: { fileUri: file().uri }, mediaResolution: { level } }] }], generationConfig: { mediaResolution: 'MEDIA_RESOLUTION_HIGH' } });
const message = () => ({ modelVersion: 'fixture-gemini', candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'private answer' }] } }], usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 40, candidatesTokenCount: 20, thoughtsTokenCount: 10, totalTokenCount: 130, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 20 }, { modality: 'IMAGE', tokenCount: 50 }, { modality: 'AUDIO', tokenCount: 30 }], cacheTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'IMAGE', tokenCount: 20 }, { modality: 'AUDIO', tokenCount: 10 }] } });
const inspect = (raw, owner) => inspectRawGeminiAccounting(raw, 'fixture-gemini', { ownedFileRawAuthority: owner });
const parse = (frames, owner) => {
  const events = [], parser = createAccountingGeminiSseParser(event => { events.push(event); }, { expectedModel: 'fixture-gemini', ownedFileRawAuthority: owner });
  const text = frames.map(frame => 'data: ' + JSON.stringify(frame) + '\n\n').join('');
  for (const byte of new TextEncoder().encode(text)) parser.push(Uint8Array.of(byte));
  expect(parser.evidence()).toBeNull(); return { usage: parser.finish(), text, events };
};
const rates = { input: '1', output: '2', cached: '0.1', input_image: '3', cached_image: '0.2', input_audio: '7', cached_audio: '0.4', input_video: '11', cached_video: '0.5' };
const price = { rates, rateUnits: Object.fromEntries(Object.keys(rates).filter(key => key !== 'output').map(key => [key, 'USD/1M tokens'])), usageSemantics: { inputModalities: 'observed_gemini_owned_file_input_modalities', allowedInputModalities: ['TEXT', 'VIDEO', 'IMAGE', 'AUDIO'] } };
describe('owned video resolution pure raw grant, not gateway ownership or resolution-derived quantities', () => {
  it('JSON buffered and native byte-framed SSE preserve observed counters and original bytes with separate fourth grant', async () => {
    const body = original(), before = structuredClone(body), owner = createGeminiOwnedFileRawAuthority(body, resources(), false, true), raw = message();
    const result = inspect(raw, owner); expect(result.message).toEqual(raw);
    expect(result.usage).toMatchObject({ exact: true, input: 100, cacheRead: 40, output: 20, reasoning: 10 });
    expect((await readBufferedGeminiAccounting(Response.json(raw), null, { expectedModel: 'fixture-gemini', ownedFileRawAuthority: owner })).usage).toEqual(result.usage);
    const stream = parse([raw], owner); expect(stream.usage).toEqual(result.usage);
    expect(new TextDecoder().decode(Buffer.concat(stream.events.map(event => Buffer.from(event.bytes))))).toBe(stream.text); expect(body).toEqual(before);
    expect(() => createGeminiOwnedFileRawAuthority(body, resources())).toThrow();
    expect(() => createGeminiOwnedFileRawAuthority(body, resources(), true)).toThrow(); expect(() => inspect(raw, { ...owner })).toThrow();
  });
  it('resolution enums generation control resource size and independently granted offsets do not alter cost or waive any original modality rate', () => {
    for (const level of ['MEDIA_RESOLUTION_LOW', 'MEDIA_RESOLUTION_HIGH', 'MEDIA_RESOLUTION_ULTRA_HIGH']) {
      const body = original(level); body.contents[0].parts[1].videoMetadata = { fps: 24, endOffset: '1.000000001s' };
      const inventory = resources(); inventory[0].file.sizeBytes = '1000';
      const owner = createGeminiOwnedFileRawAuthority(body, inventory, true, true);
      expect(costFromExactUsageSnapshot(inspect(message(), owner).usage, price)).toBe('309000');
      const missing = structuredClone(price); delete missing.rates.cached_video;
      expect(() => costFromExactUsageSnapshot(inspect(message(), owner).usage, missing)).toThrow();
      expect(() => createGeminiOwnedFileRawAuthority(body, inventory, false, true)).toThrow();
    }
  });
  it('early evidence never fills terminal omissions; processing even explicit zero and foreign categories/model remain refused', () => {
    const owner = createGeminiOwnedFileRawAuthority(original(), resources(), false, true), early = message(); delete early.candidates[0].finishReason;
    expect(parse([early], owner).usage).toBeNull(); expect(parse([early, message()], owner).usage).toEqual(inspect(message(), owner).usage);
    for (const change of [value => { delete value.usageMetadata.promptTokensDetails; }, value => { delete value.usageMetadata.cacheTokensDetails; }, value => { value.usageMetadata.toolUsePromptTokenCount = 0; }, value => { value.usageMetadata.toolUsePromptTokensDetails = []; }, value => { value.usageMetadata.promptTokensDetails[1].modality = 'DOCUMENT'; }, value => { value.modelVersion = 'foreign'; }, value => { value.usageMetadata.frameCount = 1; }]) {
      const bad = message(); change(bad); expect(() => inspect(bad, owner)).toThrow(); expect(() => parse([early, bad], owner)).toThrow();
    }
  });
  it('retained original cannot be mutated, and resolution grant cannot mint metadata/client/inline/processing permission or read getters', () => {
    const body = original(), owner = createGeminiOwnedFileRawAuthority(body, resources(), false, true);
    body.contents[0].parts[1].mediaResolution.level = 'UNKNOWN'; expect(inspect(message(), owner).usage.input).toBe(100);
    for (const grant of [null, 'true', 1, {}, []]) expect(() => createGeminiOwnedFileRawAuthority(original(), resources(), false, grant)).toThrow();
    const getter = vi.fn(), value = original(); Object.defineProperty(value.contents[0].parts[1].mediaResolution, 'level', { enumerable: true, get: getter });
    expect(() => createGeminiOwnedFileRawAuthority(value, resources(), false, true)).toThrow(); expect(getter).not.toHaveBeenCalled();
    for (const change of [v => { v.contents[0].parts[1].mediaProcessing = 'AGENTIC'; }, v => { v.contents[0].parts.push({ inlineData: { mimeType: 'image/png', data: 'YQ==' } }); }, v => { v.tools = [{ functionDeclarations: [{ name: 'lookup', description: 'private' }] }]; }]) {
      const bad = original(); change(bad); expect(() => createGeminiOwnedFileRawAuthority(bad, resources(), false, true)).toThrow();
    }
  });
});
