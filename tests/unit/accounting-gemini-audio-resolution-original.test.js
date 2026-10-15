import { describe, it, expect, vi } from 'vitest';
import { supportsGeminiRequest, supportsGeminiInternalRequest, supportsGeminiCandidate, ACCOUNTED_GEMINI_BASE, ACCOUNTED_GEMINI_ACTION } from 'open-sse/config/accountedGeminiCandidate.js';
const original = (mimeType = 'audio/opus') => ({ contents: [{ role: 'user', parts: [{ text: 'private prompt' }, { inlineData: { mimeType, data: 'b3BhcXVl', displayName: 'private audio' }, mediaResolution: { level: 'MEDIA_RESOLUTION_ULTRA_HIGH' } }] }], generationConfig: { mediaResolution: 'MEDIA_RESOLUTION_HIGH' } });
// Proposed ninth original flag: independent audio resolution, not media grant.
const accepts = (body, client = false, media = false, audio = true, video = false, metadata = false, videoResolution = false, inlineResolution = false) => supportsGeminiRequest(body, client, media, audio, video, metadata, videoResolution, inlineResolution, true);
describe('audio resolution original structural authority without usage/model inference', () => {
  it('all thirteen selected audio MIME originals retain Part/generation controls with separate audio and audio-resolution grants', () => {
    for (const mime of ['audio/wav', 'audio/mp3', 'audio/aiff', 'audio/aac', 'audio/ogg', 'audio/flac', 'audio/mpeg', 'audio/m4a', 'audio/l16', 'audio/opus', 'audio/alaw', 'audio/mulaw', 'audio/webm']) {
      const body = original(mime), copy = structuredClone(body); expect(accepts(body)).toBe(true); expect(body).toEqual(copy);
      expect(supportsGeminiRequest(body, false, false, true)).toBe(false); expect(accepts(body, false, false, false)).toBe(false);
    }
    for (const shape of ['part-only', 'generation-only', 'empty']) { const body = original(); if (shape === 'part-only') delete body.generationConfig.mediaResolution; if (shape === 'generation-only') delete body.contents[0].parts[1].mediaResolution; if (shape === 'empty') body.contents[0].parts[1].mediaResolution = {}; const copy = structuredClone(body); expect(accepts(body)).toBe(true); expect(body).toEqual(copy); }
  });
  it('exact five Part enums and four generation strings preserve their forms without coercion, defaults or token hints', () => {
    expect(accepts(original())).toBe(true);
    const levels = ['MEDIA_RESOLUTION_UNSPECIFIED', 'MEDIA_RESOLUTION_LOW', 'MEDIA_RESOLUTION_MEDIUM', 'MEDIA_RESOLUTION_HIGH'];
    for (const level of [...levels, 'MEDIA_RESOLUTION_ULTRA_HIGH']) { const body = original(); body.contents[0].parts[1].mediaResolution = { level }; expect(accepts(body)).toBe(true); }
    for (const level of levels) { const body = original(); body.generationConfig.mediaResolution = level; expect(accepts(body)).toBe(true); }
    for (const value of [null, [], 'MEDIA_RESOLUTION_LOW', { level: undefined }, { level: 'UNKNOWN' }, { level: 'MEDIA_RESOLUTION_LOW', tokenCount: 64 }]) { const body = original(); body.contents[0].parts[1].mediaResolution = value; expect(accepts(body)).toBe(false); }
    for (const value of [null, {}, undefined, 256, true, 'MEDIA_RESOLUTION_ULTRA_HIGH']) { const body = original(); body.generationConfig.mediaResolution = value; expect(accepts(body)).toBe(false); }
  });
  it('mixed image/PDF/video controls and client history require every independent permission and conserve source-local levels', () => {
    const body = original(); body.contents[0].parts.push({ inlineData: { mimeType: 'application/pdf', data: 'YQ==' }, mediaResolution: {} }, { inlineData: { mimeType: 'video/mp4', data: 'Yg==' }, mediaResolution: { level: 'MEDIA_RESOLUTION_LOW' }, videoMetadata: { fps: 24, endOffset: '1s' } });
    body.tools = [{ functionDeclarations: [{ name: 'lookup', description: 'Lookup' }] }]; body.contents.push({ role: 'model', parts: [{ functionCall: { id: 'opaque', name: 'lookup', args: { q: 'private' } }, thoughtSignature: 'b3BhcXVl' }] }, { role: 'user', parts: [{ functionResponse: { id: 'opaque', name: 'lookup', response: { error: 'private' } } }] });
    const copy = structuredClone(body); expect(accepts(body, true, true, true, true, true, true, true)).toBe(true); expect(body).toEqual(copy);
    for (let i = 0; i < 7; i++) { const flags = Array(7).fill(true); flags[i] = false; expect(accepts(body, ...flags)).toBe(false); }
    expect(supportsGeminiRequest(body, true, true, true, true, true, true, true)).toBe(false);
  });
  it('audio resolution grants no image/video resolution, output, resources, processing, text-only or system source work', () => {
    expect(accepts(original())).toBe(true);
    for (const change of [v => { v.contents[0].parts[1].inlineData.mimeType = 'image/png'; }, v => { v.contents[0].parts[1].inlineData.mimeType = 'video/mp4'; }, v => { v.contents[0].parts[1].mediaProcessing = 'AGENTIC'; }, v => { v.contents[0].parts[1].text = 'union'; }, v => { v.contents[0].role = 'model'; }, v => { v.contents[0].parts.pop(); }, v => { v.contents[0].parts[0].mediaResolution = {}; }, v => { v.generationConfig.responseModalities = ['AUDIO']; }, v => { v.systemInstruction = { parts: [structuredClone(v.contents[0].parts[1])] }; }, v => { delete v.contents[0].parts[1].inlineData; v.contents[0].parts[1].fileData = { mimeType: 'audio/opus', fileUri: 'files/private' }; }]) { const body = original(); change(body); const copy = structuredClone(body); expect(accepts(body, false, true, true, true)).toBe(false); expect(body).toEqual(copy); }
  });
  it('ordered source-local audio levels and omitted role survive without merging controls or normalizing undefined properties', () => {
    const body = original(); delete body.contents[0].role; delete body.generationConfig;
    body.contents[0].parts.push({ inlineData: { mimeType: 'audio/webm', data: 'YQ==' }, mediaResolution: { level: 'MEDIA_RESOLUTION_LOW' } }, { inlineData: { mimeType: 'audio/mulaw', data: 'Yg==' }, mediaResolution: {} });
    const copy = structuredClone(body); expect(accepts(body)).toBe(true); expect(body).toEqual(copy);
    body.contents[0].parts[2].mediaResolution.level = undefined; expect(accepts(body)).toBe(false);
    const absent = original(); absent.contents[0].parts[1].mediaResolution = undefined; expect(accepts(absent)).toBe(false);
    const nested = original(); nested.contents[0].parts[1].inlineData.data = 'YQ='; expect(accepts(nested)).toBe(false);
  });
  it('video/image resolution permissions never enable audio resolution; defaults and foreign internal flags stay closed', () => {
    const body = original(); expect(accepts(body)).toBe(true);
    expect(supportsGeminiRequest(body, false, true, true, true, true, true, true)).toBe(false);
    expect(supportsGeminiRequest(body)).toBe(false);
    expect(supportsGeminiInternalRequest({ model: 'fixture-gemini', stream: false, ...body }, 'fixture-gemini', false, true, true, true, true, true, true)).toBe(false);
    const text = { contents: [{ parts: [{ text: 'only text' }] }], generationConfig: { mediaResolution: 'MEDIA_RESOLUTION_HIGH' } }; expect(accepts(text)).toBe(false);
    const output = original(); output.contents.push({ role: 'model', parts: [structuredClone(output.contents[0].parts[1])] }); expect(accepts(output)).toBe(false);
  });
  it('old candidate modes cannot inherit grant; internal model, bounded capture and booleans remain guarded before programmable reads', () => {
    const body = { model: 'fixture-gemini', stream: false, ...original() }, { model: _model, stream: _stream, ...wire } = body;
    expect(supportsGeminiInternalRequest(body, body.model, false, false, true, false, false, false, false, true)).toBe(true);
    expect(supportsGeminiInternalRequest(body, 'foreign', false, false, true, false, false, false, false, true)).toBe(false);
    for (const mode of ['native-gemini-audio-json', 'native-gemini-inline-resolution-json', 'native-gemini-video-resolution-json']) {
      const options = { body, model: body.model, stream: false, accountingMode: mode, credentials: { apiKey: 'dummy-key' }, accounting: { requiresPreparedBaseWire: true } };
      expect(supportsGeminiCandidate({ provider: 'gemini', config: { format: 'gemini' } }, options, `${ACCOUNTED_GEMINI_BASE}/${body.model}${ACCOUNTED_GEMINI_ACTION}`, wire, { 'Content-Type': 'application/json', 'x-goog-api-key': 'dummy-key' })).toBe(false);
    }
    for (const flag of [null, 1, 'true', {}, []]) expect(supportsGeminiRequest(original(), false, false, true, false, false, false, false, flag)).toBe(false);
    const getter = vi.fn(), trap = vi.fn(), programmable = original(); Object.defineProperty(programmable.contents[0].parts[1].mediaResolution, 'level', { enumerable: true, get: getter }); expect(accepts(programmable)).toBe(false); expect(accepts(new Proxy(original(), { ownKeys: trap }))).toBe(false); expect(getter).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
    const cyclic = original(); cyclic.contents[0].parts[1].mediaResolution.self = cyclic; expect(accepts(cyclic)).toBe(false);
    const inherited = original(); Object.setPrototypeOf(inherited.contents[0].parts[1].mediaResolution, { level: 'MEDIA_RESOLUTION_LOW' }); expect(accepts(inherited)).toBe(false);
    const oversize = original(); oversize.contents[0].parts[0].text = 'a'.repeat(262145); expect(accepts(oversize)).toBe(false);
  });
});
