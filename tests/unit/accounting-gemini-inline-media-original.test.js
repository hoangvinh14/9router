import { describe, it, expect, vi } from 'vitest';
import { supportsGeminiRequest, supportsGeminiInternalRequest } from 'open-sse/config/accountedGeminiCandidate.js';
const original = (mimeType = 'image/png') => ({ contents: [{ role: 'user', parts: [{ text: 'private prompt' }, { inlineData: { mimeType, data: 'b3BhcXVl', displayName: 'private media' } }] }], generationConfig: { maxOutputTokens: 100 } });
describe('isolated Gemini inline image/PDF original authority prerequisite, no retrieval or media metering endpoint grant', () => {
  it('strict independent inline opt-in conserves full original bytes/MIME/display name/ordering; defaults remain text-only', () => {
    const body = original(), before = structuredClone(body);
    expect(supportsGeminiRequest(body, false, true)).toBe(true); expect(body).toEqual(before);
    expect(supportsGeminiInternalRequest({ ...body, model: 'fixture-gemini', stream: true }, 'fixture-gemini', false, true)).toBe(true);
    expect(supportsGeminiRequest(body)).toBe(false); expect(supportsGeminiRequest(body, true)).toBe(false);
    for (const flag of [1, 'true', null, {}]) expect(supportsGeminiRequest(body, false, flag)).toBe(false);
  });
  it('documented image MIME/PDF inline data are opaque provider input, not decoded/page-counted/reencoded or remotely classified', () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'image/avif', 'application/pdf']) {
      const body = original(mime), before = structuredClone(body); expect(supportsGeminiRequest(body, false, true)).toBe(true); expect(body).toEqual(before);
    }
    const value = original('application/pdf'); delete value.contents[0].parts[1].inlineData.displayName; expect(supportsGeminiRequest(value, false, true)).toBe(true);
  });
  it('inline media and client-function history compose only when both original authorities are explicitly enabled', () => {
    const body = original(); body.tools = [{ functionDeclarations: [{ name: 'lookup', description: 'Client lookup' }] }];
    body.contents.push({ role: 'model', parts: [{ functionCall: { id: 'call1', name: 'lookup', args: {} }, thoughtSignature: 'b3BhcXVl' }] },
      { role: 'user', parts: [{ functionResponse: { id: 'call1', name: 'lookup', response: { error: 'private result' } } }] });
    expect(supportsGeminiRequest(body, true, true)).toBe(true); expect(supportsGeminiRequest(body, false, true)).toBe(false); expect(supportsGeminiRequest(body, true, false)).toBe(false);
    body.contents[2].parts[0].functionResponse.parts = [{ inlineData: { mimeType: 'image/png', data: 'b3BhcXVl' } }]; expect(supportsGeminiRequest(body, true, true)).toBe(false);
  });
  it('input-only media authority cannot authorize output images, remote/file IDs, audio/video prices, metadata or data union erasure', () => {
    expect(supportsGeminiRequest(original(), false, true)).toBe(true);
    for (const mutate of [b => { b.contents[0].role = 'model'; }, b => { b.contents[0].parts[1].text = 'union'; },
      b => { b.contents[0].parts[1] = { fileData: { mimeType: 'image/png', fileUri: 'https://example.com/unowned' } }; },
      b => { b.contents[0].parts[1].inlineData.mimeType = 'audio/wav'; }, b => { b.contents[0].parts[1].inlineData.mimeType = 'video/mp4'; },
      b => { b.contents[0].parts[1].videoMetadata = {}; }, b => { b.contents[0].parts[1].mediaResolution = {}; },
      b => { b.generationConfig.responseModalities = ['IMAGE']; }, b => { b.systemInstruction = { parts: b.contents[0].parts }; }]) {
      const body = original(); mutate(body); expect(supportsGeminiRequest(body, false, true)).toBe(false);
    }
  });
  it('base64/MIME/schema invalidity is unavailable, never repaired into valid media or used to infer usage', () => {
    expect(supportsGeminiRequest(original(), false, true)).toBe(true);
    for (const mutate of [v => { v.data = ''; }, v => { v.data = '%%'; }, v => { v.data = 'YQ='; }, v => { v.data = 'YR=='; },
      v => { v.mimeType = 'IMAGE/PNG'; }, v => { v.mimeType = 'text/plain'; }, v => { v.displayName = 42; }, v => { v.unknown = true; }]) {
      const body = original(); mutate(body.contents[0].parts[1].inlineData); expect(supportsGeminiRequest(body, false, true)).toBe(false);
    }
  });
  it('multiple inline images/PDFs retain exact order across text and omit no unknown content or top-level fields', () => {
    const body = original(), pdf = original('application/pdf').contents[0].parts[1];
    body.contents[0].parts.push({ text: 'between' }, pdf, { text: 'after' }); const before = structuredClone(body);
    expect(supportsGeminiRequest(body, false, true)).toBe(true); expect(body).toEqual(before);
    body.contents[0].parts.push({ inlineData: { mimeType: 'image/png', data: 'b3BhcXVl' }, thoughtSignature: 'b3BhcXVl' });
    expect(supportsGeminiRequest(body, false, true)).toBe(false);
    for (const mutate of [v => { v.contents[0].unknown = true; }, v => { v.store = true; }, v => { v.contents[0].parts.push({}); }, v => { v.tools = [{ googleSearch: {} }]; }]) {
      const value = original(); mutate(value); expect(supportsGeminiRequest(value, false, true)).toBe(false);
    }
  });
  it('internal inline opt-in validates flag/model getters before introspection and does not imply API route eligibility', () => {
    const getter = vi.fn(), body = { ...original(), stream: true };
    Object.defineProperty(body, 'model', { enumerable: true, get: getter });
    expect(supportsGeminiInternalRequest(body, 'fixture-gemini', false, true)).toBe(false); expect(getter).not.toHaveBeenCalled();
    const value = { ...original(), model: 'fixture-gemini', stream: true };
    for (const flag of [1, 'true', null, {}]) expect(supportsGeminiInternalRequest(value, 'fixture-gemini', false, flag)).toBe(false);
    expect(supportsGeminiInternalRequest(value, 'different', false, true)).toBe(false);
  });
  it('bounded plain original capture rejects getters/proxies/oversize before clone or MIME inspection', () => {
    expect(supportsGeminiRequest(original(), false, true)).toBe(true); const getter = vi.fn(), trap = vi.fn();
    const body = original(); Object.defineProperty(body.contents[0].parts[1], 'inlineData', { enumerable: true, get: getter });
    expect(supportsGeminiRequest(body, false, true)).toBe(false); expect(getter).not.toHaveBeenCalled();
    expect(supportsGeminiRequest(new Proxy(original(), { ownKeys: trap }), false, true)).toBe(false); expect(trap).not.toHaveBeenCalled();
    const huge = original(); huge.contents[0].parts[1].inlineData.data = 'AAAA'.repeat(65537); expect(supportsGeminiRequest(huge, false, true)).toBe(false);
  });
});
