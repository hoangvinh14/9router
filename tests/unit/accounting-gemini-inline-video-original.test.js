import { describe, it, expect, vi } from 'vitest';
import { supportsGeminiRequest, supportsGeminiInternalRequest, supportsGeminiCandidate, ACCOUNTED_GEMINI_BASE, ACCOUNTED_GEMINI_ACTION } from 'open-sse/config/accountedGeminiCandidate.js';
const original = (mimeType = 'video/mp4') => ({ contents: [{ role: 'user', parts: [{ text: 'private prompt' }, { inlineData: { mimeType, data: 'b3BhcXVl', displayName: 'private video' } }] }] });
const accepts = (body, client = false, imagePdf = false, audio = false) => supportsGeminiRequest(body, client, imagePdf, audio, true);
describe('isolated inline video input original prerequisite, not frames/duration/usage/price/POST permission', () => {
  it('independent video flag preserves exact opaque source order and selected MIME strings without borrowing audio/image permission', () => {
    const body = original(), before = structuredClone(body);
    expect(accepts(body)).toBe(true); expect(body).toEqual(before);
    for (const mime of ['video/mp4', 'video/mpeg', 'video/mov', 'video/avi', 'video/x-flv', 'video/mpg', 'video/webm', 'video/wmv', 'video/3gpp']) expect(accepts(original(mime))).toBe(true);
    expect(supportsGeminiRequest(body)).toBe(false); expect(supportsGeminiRequest(body, true, true, true)).toBe(false);
    const multi = original(); multi.contents[0].parts.push({ text: 'between' }, { inlineData: { mimeType: 'video/webm', data: 'YQ==' } });
    const copy = structuredClone(multi); expect(accepts(multi)).toBe(true); expect(multi).toEqual(copy);
  });
  it('video plus client declarations/history preserves IDs/results/signatures only under independent grants', () => {
    const body = original(); body.tools = [{ functionDeclarations: [{ name: 'lookup', description: 'Lookup' }] }];
    body.contents.push({ role: 'model', parts: [{ functionCall: { id: 'opaque', name: 'lookup', args: { q: 'private' } }, thoughtSignature: 'b3BhcXVl' }] },
      { role: 'user', parts: [{ functionResponse: { id: 'opaque', name: 'lookup', response: { error: 'private result' } } }] });
    const before = structuredClone(body); expect(accepts(body, true)).toBe(true); expect(body).toEqual(before); expect(accepts(body)).toBe(false);
    body.contents[2].parts[0].functionResponse.id = 'foreign'; expect(accepts(body, true)).toBe(false);
  });
  it('video mixed image/PDF/audio requires every independent original grant without erasing any input', () => {
    const body = original(); body.contents[0].parts.push({ inlineData: { mimeType: 'audio/opus', data: 'YQ==' } }, { inlineData: { mimeType: 'image/png', data: 'Yg==' } }, { inlineData: { mimeType: 'application/pdf', data: 'Yw==' } });
    const before = structuredClone(body); expect(accepts(body, false, true, true)).toBe(true); expect(body).toEqual(before);
    expect(accepts(body, false, true)).toBe(false); expect(accepts(body, false, false, true)).toBe(false); expect(supportsGeminiRequest(body, false, true, true)).toBe(false);
  });
  it('source-only video never grants remote tenancy, output video, processing metadata or unknown codec support', () => {
    expect(accepts(original())).toBe(true);
    for (const change of [v => { v.contents[0].role = 'model'; }, v => { v.contents[0].parts[1].text = 'union'; },
      v => { v.contents[0].parts[1].inlineData.data = 'YQ='; }, v => { v.contents[0].parts[1].inlineData.frameCount = 1; },
      v => { v.contents[0].parts[1].videoMetadata = { fps: 1, startOffset: '0s' }; }, v => { v.contents[0].parts[1].mediaProcessing = 'AGENTIC'; },
      v => { v.contents[0].parts[1] = { fileData: { mimeType: 'video/mp4', fileUri: 'https://example.invalid/video' } }; },
      v => { v.generationConfig = { responseModalities: ['VIDEO'] }; }, v => { v.cachedContent = 'private-resource'; },
      v => { v.contents[0].parts[1].inlineData.mimeType = 'video/unknown'; }]) { const body = original(); change(body); expect(accepts(body)).toBe(false); }
    // Processing metadata remains a distinct accepted obligation, not erased.
  });
  it('original video grammar cannot accidentally grant any existing candidate mode, system video or resource lookup', () => {
    const body = { model: 'fixture-gemini', stream: false, ...original() };
    for (const mode of ['native-gemini-json', 'native-gemini-client-json', 'native-gemini-inline-json', 'native-gemini-audio-json']) {
      const options = { body, model: body.model, stream: false, accountingMode: mode, credentials: { apiKey: 'dummy-key' }, accounting: { requiresPreparedBaseWire: true } };
      expect(supportsGeminiCandidate({ provider: 'gemini', config: { format: 'gemini' } }, options, `${ACCOUNTED_GEMINI_BASE}/${body.model}${ACCOUNTED_GEMINI_ACTION}`, original(), { 'Content-Type': 'application/json', 'x-goog-api-key': 'dummy-key' })).toBe(false);
    }
    const system = original(); system.systemInstruction = { parts: [{ inlineData: { mimeType: 'video/mp4', data: 'YQ==' } }] }; expect(accepts(system)).toBe(false);
    const omitted = original(); delete omitted.contents[0].role; expect(accepts(omitted)).toBe(true);
  });
  it('video source nested accessors, inherited blobs, revoked proxies and extra codec parameters refuse without reads', () => {
    expect(accepts(original())).toBe(true); const getter = vi.fn(), body = original();
    Object.defineProperty(body.contents[0].parts[1].inlineData, 'data', { enumerable: true, get: getter }); expect(accepts(body)).toBe(false); expect(getter).not.toHaveBeenCalled();
    const inherited = original(); Object.setPrototypeOf(inherited.contents[0].parts[1].inlineData, { durationSeconds: 1 }); expect(accepts(inherited)).toBe(false);
    const proxy = Proxy.revocable(original(), {}); proxy.revoke(); expect(accepts(proxy.proxy)).toBe(false);
    const parameters = original('video/mp4; codecs=avc1'); expect(accepts(parameters)).toBe(false);
  });
  it('internal video flag is strict, bounded and captures before any accessor/proxy/model read', () => {
    const body = { model: 'fixture-gemini', stream: false, ...original() };
    expect(supportsGeminiInternalRequest(body, body.model, false, false, false, true)).toBe(true);
    expect(supportsGeminiInternalRequest(body, 'foreign', false, false, false, true)).toBe(false);
    for (const flag of [null, 1, 'true', {}, []]) expect(supportsGeminiRequest(original(), false, false, false, flag)).toBe(false);
    const getter = vi.fn(), trap = vi.fn(); Object.defineProperty(body, 'model', { enumerable: true, get: getter });
    expect(supportsGeminiInternalRequest(body, 'fixture-gemini', false, false, false, true)).toBe(false); expect(getter).not.toHaveBeenCalled();
    expect(accepts(new Proxy(original(), { ownKeys: trap }))).toBe(false); expect(trap).not.toHaveBeenCalled();
    const cyclic = original(); cyclic.contents[0].parts[1].inlineData.self = cyclic; expect(accepts(cyclic)).toBe(false);
    const oversized = original(); oversized.contents[0].parts[1].inlineData.data = 'YQ=='.repeat(70000); expect(accepts(oversized)).toBe(false);
  });
});
