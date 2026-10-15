import { describe, it, expect, vi } from 'vitest';
import { supportsGeminiRequest, supportsGeminiInternalRequest, supportsGeminiCandidate, ACCOUNTED_GEMINI_BASE, ACCOUNTED_GEMINI_ACTION } from 'open-sse/config/accountedGeminiCandidate.js';
const original = (mimeType = 'image/png') => ({ contents: [{ role: 'user', parts: [{ text: 'private prompt' }, { inlineData: { mimeType, data: 'b3BhcXVl', displayName: 'private media' }, mediaResolution: { level: 'MEDIA_RESOLUTION_ULTRA_HIGH' } }] }], generationConfig: { mediaResolution: 'MEDIA_RESOLUTION_HIGH' } });
const accepts = (body, client = false, media = true, audio = false, video = false, metadata = false, videoResolution = false) => supportsGeminiRequest(body, client, media, audio, video, metadata, videoResolution, true);
describe('inline image/PDF resolution original authority independent of video resolution and media permission', () => {
  it('selected inline image/PDF source and exact Part/generation controls are preserved with two independent grants', () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'image/avif', 'application/pdf']) {
      const body = original(mime), copy = structuredClone(body); expect(accepts(body)).toBe(true); expect(body).toEqual(copy);
      expect(supportsGeminiRequest(body, false, true)).toBe(false); expect(accepts(body, false, false)).toBe(false);
    }
    for (const shape of ['part-only', 'generation-only', 'empty']) {
      const body = original(); if (shape === 'part-only') delete body.generationConfig.mediaResolution; if (shape === 'generation-only') delete body.contents[0].parts[1].mediaResolution; if (shape === 'empty') body.contents[0].parts[1].mediaResolution = {};
      const copy = structuredClone(body); expect(accepts(body)).toBe(true); expect(body).toEqual(copy);
    }
  });
  it('Part object five enums versus generation string four enums remain exact, not coercion or label token hints', () => {
    expect(accepts(original())).toBe(true);
    const levels = ['MEDIA_RESOLUTION_UNSPECIFIED', 'MEDIA_RESOLUTION_LOW', 'MEDIA_RESOLUTION_MEDIUM', 'MEDIA_RESOLUTION_HIGH'];
    for (const level of [...levels, 'MEDIA_RESOLUTION_ULTRA_HIGH']) { const body = original(); body.contents[0].parts[1].mediaResolution = { level }; expect(accepts(body)).toBe(true); }
    for (const level of levels) { const body = original(); body.generationConfig.mediaResolution = level; expect(accepts(body)).toBe(true); }
    for (const resolution of [null, [], 'MEDIA_RESOLUTION_LOW', { level: 1 }, { level: undefined }, { level: 'UNKNOWN' }, { level: 'MEDIA_RESOLUTION_LOW', tokenCount: 64 }]) { const body = original(); body.contents[0].parts[1].mediaResolution = resolution; expect(accepts(body)).toBe(false); }
    for (const resolution of [null, {}, undefined, 64, true, 'MEDIA_RESOLUTION_ULTRA_HIGH', 'LOW']) { const body = original(); body.generationConfig.mediaResolution = resolution; expect(accepts(body)).toBe(false); }
  });
  it('mixed sources/client/signatures/results need every independent source/metadata/video-resolution grant, not implicit grants from resolution', () => {
    const body = original(); body.contents[0].parts.push({ inlineData: { mimeType: 'application/pdf', data: 'YQ==' }, mediaResolution: { level: 'MEDIA_RESOLUTION_LOW' } }, { inlineData: { mimeType: 'audio/opus', data: 'Yg==' } }, { inlineData: { mimeType: 'video/mp4', data: 'Yw==' }, mediaResolution: { level: 'MEDIA_RESOLUTION_ULTRA_HIGH' }, videoMetadata: { fps: 24, endOffset: '1s' } });
    body.tools = [{ functionDeclarations: [{ name: 'lookup', description: 'Lookup' }] }]; body.contents.push({ role: 'model', parts: [{ functionCall: { id: 'opaque', name: 'lookup', args: { q: 'private' } }, thoughtSignature: 'b3BhcXVl' }] }, { role: 'user', parts: [{ functionResponse: { id: 'opaque', name: 'lookup', response: { error: 'private' } } }] });
    const copy = structuredClone(body); expect(accepts(body, true, true, true, true, true, true)).toBe(true); expect(body).toEqual(copy);
    for (const grants of [[false, true, true, true, true, true], [true, false, true, true, true, true], [true, true, false, true, true, true], [true, true, true, false, true, true], [true, true, true, true, false, true], [true, true, true, true, true, false]]) expect(accepts(body, ...grants)).toBe(false);
  });
  it('video resolution alone cannot grant image/PDF resolution; audio/output/system/resource/processing/text-only remain separate', () => {
    expect(accepts(original())).toBe(true);
    expect(supportsGeminiRequest(original(), false, true, false, true, false, true)).toBe(false);
    for (const change of [v => { v.contents[0].parts[1].inlineData.mimeType = 'audio/opus'; }, v => { v.contents[0].parts[1].inlineData.mimeType = 'video/mp4'; }, v => { v.contents[0].parts[1].videoMetadata = {}; }, v => { v.contents[0].parts[1].mediaProcessing = 'STATIC'; }, v => { v.contents[0].parts[1].text = 'union'; }, v => { v.contents[0].role = 'model'; }, v => { v.contents[0].parts.pop(); }, v => { v.contents[0].parts[0].mediaResolution = {}; }, v => { v.generationConfig.responseModalities = ['IMAGE']; }, v => { v.systemInstruction = { parts: [structuredClone(v.contents[0].parts[1])] }; }, v => { delete v.contents[0].parts[1].inlineData; v.contents[0].parts[1].fileData = { mimeType: 'image/png', fileUri: 'files/private' }; }]) { const body = original(); change(body); const copy = structuredClone(body); expect(accepts(body, false, true, true, true)).toBe(false); expect(body).toEqual(copy); }
  });
  it('current inline/video resolution candidate modes cannot inherit this nonvideo original prerequisite', () => {
    const body = { model: 'fixture-gemini', stream: false, ...original() }, { model: _model, stream: _stream, ...wire } = body;
    for (const mode of ['native-gemini-inline-json', 'native-gemini-video-resolution-json']) {
      const options = { body, model: body.model, stream: false, accountingMode: mode, credentials: { apiKey: 'dummy-key' }, accounting: { requiresPreparedBaseWire: true } };
      expect(supportsGeminiCandidate({ provider: 'gemini', config: { format: 'gemini' } }, options, `${ACCOUNTED_GEMINI_BASE}/${body.model}${ACCOUNTED_GEMINI_ACTION}`, wire, { 'Content-Type': 'application/json', 'x-goog-api-key': 'dummy-key' })).toBe(false);
    }
    const originalBefore = structuredClone(wire); expect(accepts(wire)).toBe(true); expect(wire).toEqual(originalBefore);
  });
  it('source-local image and PDF levels remain distinct with omitted role and optional generation controls; oversize capture refuses', () => {
    const body = original(); delete body.contents[0].role;
    body.contents[0].parts.push({ inlineData: { mimeType: 'application/pdf', data: 'YQ==' }, mediaResolution: { level: 'MEDIA_RESOLUTION_LOW' } }, { inlineData: { mimeType: 'image/webp', data: 'Yg==' }, mediaResolution: {} });
    const copy = structuredClone(body); expect(accepts(body)).toBe(true); expect(body).toEqual(copy);
    body.contents[0].parts[2].mediaResolution.level = 'UNKNOWN'; expect(accepts(body)).toBe(false);
    const oversize = original(); oversize.contents[0].parts[0].text = 'a'.repeat(262145); expect(accepts(oversize)).toBe(false);
  });
  it('bounded guarded capture and strict internal model/flag authority refuse programmable evidence before reads', () => {
    const body = { model: 'fixture-gemini', stream: false, ...original() }; expect(supportsGeminiInternalRequest(body, body.model, false, true, false, false, false, false, true)).toBe(true);
    expect(supportsGeminiInternalRequest(body, 'foreign', false, true, false, false, false, false, true)).toBe(false);
    for (const flag of [null, 1, 'true', {}, []]) expect(supportsGeminiRequest(original(), false, true, false, false, false, false, flag)).toBe(false);
    const getter = vi.fn(), trap = vi.fn(), programmable = original(); Object.defineProperty(programmable.contents[0].parts[1].mediaResolution, 'level', { enumerable: true, get: getter }); expect(accepts(programmable)).toBe(false); expect(accepts(new Proxy(original(), { ownKeys: trap }))).toBe(false); expect(getter).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
    const cyclic = original(); cyclic.contents[0].parts[1].mediaResolution.self = cyclic; expect(accepts(cyclic)).toBe(false);
    const inherited = original(); Object.setPrototypeOf(inherited.contents[0].parts[1].mediaResolution, { level: 'MEDIA_RESOLUTION_LOW' }); expect(accepts(inherited)).toBe(false);
  });
});
