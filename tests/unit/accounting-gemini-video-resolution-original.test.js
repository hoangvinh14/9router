import { describe, it, expect, vi } from 'vitest';
import { supportsGeminiRequest, supportsGeminiInternalRequest, supportsGeminiCandidate, ACCOUNTED_GEMINI_BASE, ACCOUNTED_GEMINI_ACTION } from 'open-sse/config/accountedGeminiCandidate.js';
const original = () => ({ contents: [{ role: 'user', parts: [{ text: 'private prompt' }, { inlineData: { mimeType: 'video/mp4', data: 'b3BhcXVl', displayName: 'private video' }, mediaResolution: { level: 'MEDIA_RESOLUTION_ULTRA_HIGH' } }] }], generationConfig: { mediaResolution: 'MEDIA_RESOLUTION_HIGH', maxOutputTokens: 20 } });
const accepts = (body, client = false, media = false, audio = false, video = true, metadata = false) => supportsGeminiRequest(body, client, media, audio, video, metadata, true);
const levels = ['MEDIA_RESOLUTION_UNSPECIFIED', 'MEDIA_RESOLUTION_LOW', 'MEDIA_RESOLUTION_MEDIUM', 'MEDIA_RESOLUTION_HIGH'];
describe('video media resolution isolated original authority, not fixed token counts or model eligibility', () => {
  it('independent resolution and video grants preserve Part object versus generation string without precedence/default injection', () => {
    const body = original(), before = structuredClone(body); expect(accepts(body)).toBe(true); expect(body).toEqual(before);
    expect(supportsGeminiRequest(body, false, false, false, true)).toBe(false); expect(accepts(body, false, false, false, false)).toBe(false);
    for (const level of [...levels, 'MEDIA_RESOLUTION_ULTRA_HIGH']) { const value = original(); value.contents[0].parts[1].mediaResolution = { level }; expect(accepts(value)).toBe(true); }
    for (const level of levels) { const value = original(); value.generationConfig.mediaResolution = level; expect(accepts(value)).toBe(true); }
    for (const location of ['part-only', 'generation-only', 'empty-object']) {
      const value = original(); if (location === 'part-only') delete value.generationConfig.mediaResolution;
      if (location === 'generation-only') delete value.contents[0].parts[1].mediaResolution;
      if (location === 'empty-object') value.contents[0].parts[1].mediaResolution = {};
      const copy = structuredClone(value); expect(accepts(value)).toBe(true); expect(value).toEqual(copy);
    }
  });
  it('Part and generation enums are distinct; unknown fields, numeric token hints and coercible values cannot be normalized into admission', () => {
    expect(accepts(original())).toBe(true);
    for (const resolution of [null, [], 'MEDIA_RESOLUTION_LOW', { level: 1 }, { level: 'LOW' }, { level: 'MEDIA_RESOLUTION_UNKNOWN' }, { level: 'MEDIA_RESOLUTION_LOW', tokenCount: 64 }, { tokenCount: 64 }]) { const value = original(); value.contents[0].parts[1].mediaResolution = resolution; expect(accepts(value)).toBe(false); }
    for (const resolution of [null, {}, 64, true, 'MEDIA_RESOLUTION_ULTRA_HIGH', 'LOW', 'media_resolution_low']) { const value = original(); value.generationConfig.mediaResolution = resolution; expect(accepts(value)).toBe(false); }
  });
  it('video resolution flag cannot grant metadata/client/image/PDF/audio independently; mixed full original stays unmodified', () => {
    const body = original(); body.contents[0].parts[1].videoMetadata = { fps: 24, endOffset: '1.000000001s' };
    body.tools = [{ functionDeclarations: [{ name: 'lookup', description: 'Lookup' }] }];
    body.contents[0].parts.push({ inlineData: { mimeType: 'image/png', data: 'YQ==' } }, { inlineData: { mimeType: 'application/pdf', data: 'Yg==' } }, { inlineData: { mimeType: 'audio/opus', data: 'Yw==' } });
    body.contents.push({ role: 'model', parts: [{ functionCall: { id: 'opaque', name: 'lookup', args: { q: 'private' } }, thoughtSignature: 'b3BhcXVl' }] }, { role: 'user', parts: [{ functionResponse: { id: 'opaque', name: 'lookup', response: { error: 'private result' } } }] });
    const copy = structuredClone(body); expect(accepts(body, true, true, true, true, true)).toBe(true); expect(body).toEqual(copy);
    for (const grants of [[false, true, true, true, true], [true, false, true, true, true], [true, true, false, true, true], [true, true, true, false, true], [true, true, true, true, false]]) expect(accepts(body, ...grants)).toBe(false);
  });
  it('only selected inline video receives this Part resolution slice; system/output/remote/processing modes and no-video generation resolution remain separate', () => {
    expect(accepts(original())).toBe(true);
    for (const change of [v => { v.contents[0].parts[1].inlineData.mimeType = 'audio/opus'; }, v => { v.contents[0].parts[1].inlineData.mimeType = 'image/png'; }, v => { v.contents[0].parts[1].text = 'union'; },
      v => { v.contents[0].role = 'model'; }, v => { v.contents[0].parts[1].mediaProcessing = 'STATIC'; }, v => { v.contents[0].parts[1].mediaProcessing = 'AGENTIC'; },
      v => { delete v.contents[0].parts[1].inlineData; v.contents[0].parts[1].fileData = { mimeType: 'video/mp4', fileUri: 'files/private' }; },
      v => { v.contents[0].parts.pop(); }, v => { v.generationConfig.responseModalities = ['VIDEO']; },
      v => { v.systemInstruction = { parts: [structuredClone(v.contents[0].parts[1])] }; }]) { const value = original(); change(value); const copy = structuredClone(value); expect(accepts(value, false, true, true)).toBe(false); expect(value).toEqual(copy); }
  });
  it('existing queued video and metadata modes cannot inherit resolution permission from original prerequisite', () => {
    const body = { model: 'fixture-gemini', stream: false, ...original() }, { model: _model, stream: _stream, ...wire } = body;
    for (const mode of ['native-gemini-video-json', 'native-gemini-video-metadata-json']) {
      const options = { body, model: body.model, stream: false, accountingMode: mode, credentials: { apiKey: 'dummy-key' }, accounting: { requiresPreparedBaseWire: true } };
      expect(supportsGeminiCandidate({ provider: 'gemini', config: { format: 'gemini' } }, options, `${ACCOUNTED_GEMINI_BASE}/${body.model}${ACCOUNTED_GEMINI_ACTION}`, wire, { 'Content-Type': 'application/json', 'x-goog-api-key': 'dummy-key' })).toBe(false);
    }
    const textResolution = original(); textResolution.contents[0].parts[0].mediaResolution = { level: 'MEDIA_RESOLUTION_LOW' }; expect(accepts(textResolution)).toBe(false);
    const undefinedLevel = original(); undefinedLevel.contents[0].parts[1].mediaResolution = { level: undefined }; expect(accepts(undefinedLevel)).toBe(false);
    const undefinedGeneration = original(); undefinedGeneration.generationConfig.mediaResolution = undefined; expect(accepts(undefinedGeneration)).toBe(false);
  });
  it('multiple video parts retain different source-local levels and unchanged generation-level control, including omitted role', () => {
    const body = original(); delete body.contents[0].role;
    body.contents[0].parts.push({ inlineData: { mimeType: 'video/webm', data: 'YQ==' }, mediaResolution: { level: 'MEDIA_RESOLUTION_LOW' } });
    const copy = structuredClone(body); expect(accepts(body)).toBe(true); expect(body).toEqual(copy);
    body.contents[0].parts[2].mediaResolution.level = 'MEDIA_RESOLUTION_UNKNOWN'; expect(accepts(body)).toBe(false);
    const oversize = original(); oversize.contents[0].parts[0].text = 'a'.repeat(262145); expect(accepts(oversize)).toBe(false);
  });
  it('bounded internal and original capture guards getters/proxies/unknown flags before reads; strict model authority is independent', () => {
    const body = { model: 'fixture-gemini', stream: false, ...original() }; expect(supportsGeminiInternalRequest(body, body.model, false, false, false, true, false, true)).toBe(true);
    expect(supportsGeminiInternalRequest(body, 'foreign', false, false, false, true, false, true)).toBe(false);
    for (const flag of [null, 1, 'true', {}, []]) expect(supportsGeminiRequest(original(), false, false, false, true, false, flag)).toBe(false);
    const getter = vi.fn(), trap = vi.fn(), value = original(); Object.defineProperty(value.contents[0].parts[1].mediaResolution, 'level', { enumerable: true, get: getter }); expect(accepts(value)).toBe(false);
    expect(accepts(new Proxy(original(), { ownKeys: trap }))).toBe(false); expect(getter).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
    const cyclic = original(); cyclic.contents[0].parts[1].mediaResolution.self = cyclic; expect(accepts(cyclic)).toBe(false);
    const inherited = original(); Object.setPrototypeOf(inherited.contents[0].parts[1].mediaResolution, { tokenCount: 64 }); expect(accepts(inherited)).toBe(false);
  });
});
