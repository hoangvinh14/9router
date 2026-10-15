import { describe, it, expect, vi } from 'vitest';
import { supportsGeminiRequest, supportsGeminiInternalRequest, supportsGeminiCandidate, ACCOUNTED_GEMINI_BASE, ACCOUNTED_GEMINI_ACTION } from 'open-sse/config/accountedGeminiCandidate.js';
const original = (mediaProcessing = 'STATIC', mimeType = 'video/mp4') => ({ contents: [{ role: 'user', parts: [{ text: 'private prompt' }, { inlineData: { mimeType, data: 'b3BhcXVl', displayName: 'private video' }, mediaProcessing }] }] });
// Proposed tenth original flag: independent video processing, not source grant.
const accepts = (body, client = false, media = false, audio = false, video = true, metadata = false, videoResolution = false, inlineResolution = false, audioResolution = false) => supportsGeminiRequest(body, client, media, audio, video, metadata, videoResolution, inlineResolution, audioResolution, true);
describe('video Part.mediaProcessing original structural authority, no frame/duration/work estimates', () => {
  it('three explicit processing enum strings on all nine selected video MIME sources retain full source under separate grants', () => {
    for (const mode of ['MEDIA_PROCESSING_UNSPECIFIED', 'STATIC', 'AGENTIC']) for (const mime of ['video/mp4', 'video/mpeg', 'video/mov', 'video/avi', 'video/x-flv', 'video/mpg', 'video/webm', 'video/wmv', 'video/3gpp']) {
      const body = original(mode, mime), copy = structuredClone(body); expect(accepts(body)).toBe(true); expect(body).toEqual(copy);
      expect(supportsGeminiRequest(body, false, false, false, true)).toBe(false); expect(accepts(body, false, false, false, false)).toBe(false);
    }
    const absent = original(); delete absent.contents[0].parts[1].mediaProcessing; const copy = structuredClone(absent); expect(accepts(absent)).toBe(true); expect(absent).toEqual(copy);
  });
  it('processing enum is an exact scalar, not nested processing_options remap, coercion, FPS/frames/tokens or defaults', () => {
    expect(accepts(original())).toBe(true);
    for (const mode of [null, 0, 1, true, [], {}, 'static', 'UNKNOWN', { mode: 'STATIC' }]) expect(accepts(original(mode))).toBe(false);
    const undefinedOwn = original(); undefinedOwn.contents[0].parts[1].mediaProcessing = undefined; expect(accepts(undefinedOwn)).toBe(false);
    for (const change of [v => { v.processing_options = { mediaProcessing: 'STATIC' }; }, v => { v.processingOptions = { mediaProcessing: 'STATIC' }; }, v => { v.contents[0].parts[1].frameCount = 1; }, v => { v.contents[0].parts[1].durationSeconds = 1; }, v => { v.contents[0].parts[1].resolutionTokenCount = 64; }, v => { v.generationConfig = { mediaProcessing: 'STATIC' }; }]) { const body = original(); change(body); const copy = structuredClone(body); expect(accepts(body)).toBe(false); expect(body).toEqual(copy); }
  });
  it('mixed client/source-local metadata and resolution need every independent grant and conserve complete history', () => {
    const body = original('AGENTIC'); body.contents[0].parts[1].videoMetadata = { fps: 24, startOffset: '0s', endOffset: '1s' }; body.contents[0].parts[1].mediaResolution = { level: 'MEDIA_RESOLUTION_ULTRA_HIGH' };
    body.contents[0].parts.push({ inlineData: { mimeType: 'application/pdf', data: 'YQ==' }, mediaResolution: {} }, { inlineData: { mimeType: 'audio/opus', data: 'Yg==' }, mediaResolution: { level: 'MEDIA_RESOLUTION_LOW' } }, { inlineData: { mimeType: 'video/webm', data: 'Yw==' }, mediaProcessing: 'STATIC' });
    body.generationConfig = { mediaResolution: 'MEDIA_RESOLUTION_HIGH' }; body.tools = [{ functionDeclarations: [{ name: 'lookup', description: 'Lookup' }] }]; body.contents.push({ role: 'model', parts: [{ functionCall: { id: 'opaque', name: 'lookup', args: { q: 'private' } }, thoughtSignature: 'b3BhcXVl' }] }, { role: 'user', parts: [{ functionResponse: { id: 'opaque', name: 'lookup', response: { error: 'private' } } }] });
    const copy = structuredClone(body); expect(accepts(body, true, true, true, true, true, true, true, true)).toBe(true); expect(body).toEqual(copy);
    for (let i = 0; i < 8; i++) { const flags = Array(8).fill(true); flags[i] = false; expect(accepts(body, ...flags)).toBe(false); }
    expect(supportsGeminiRequest(body, true, true, true, true, true, true, true, true)).toBe(false);
  });
  it('finite video processing prerequisite does not grant nonvideo processing, output/system/resource work or old candidate modes', () => {
    expect(accepts(original())).toBe(true);
    for (const change of [v => { v.contents[0].parts[1].inlineData.mimeType = 'audio/opus'; }, v => { v.contents[0].parts[1].inlineData.mimeType = 'image/png'; }, v => { v.contents[0].parts[1].text = 'union'; }, v => { v.contents[0].role = 'model'; }, v => { v.contents[0].parts.pop(); v.contents[0].parts[0].mediaProcessing = 'STATIC'; }, v => { v.generationConfig = { responseModalities: ['VIDEO'] }; }, v => { v.systemInstruction = { parts: [structuredClone(v.contents[0].parts[1])] }; }, v => { delete v.contents[0].parts[1].inlineData; v.contents[0].parts[1].fileData = { mimeType: 'video/mp4', fileUri: 'files/private' }; }]) { const body = original(); change(body); const copy = structuredClone(body); expect(accepts(body, false, true, true)).toBe(false); expect(body).toEqual(copy); }
    const body = { model: 'fixture-gemini', stream: false, ...original() }, { model: _model, stream: _stream, ...wire } = body;
    for (const mode of ['native-gemini-video-json', 'native-gemini-video-metadata-json', 'native-gemini-video-resolution-json']) {
      const options = { body, model: body.model, stream: false, accountingMode: mode, credentials: { apiKey: 'dummy-key' }, accounting: { requiresPreparedBaseWire: true } };
      expect(supportsGeminiCandidate({ provider: 'gemini', config: { format: 'gemini' } }, options, `${ACCOUNTED_GEMINI_BASE}/${body.model}${ACCOUNTED_GEMINI_ACTION}`, wire, { 'Content-Type': 'application/json', 'x-goog-api-key': 'dummy-key' })).toBe(false);
    }
  });
  it('ordered source-local processing modes survive omitted role with independent optional metadata/resolution and no field injection', () => {
    const body = original('AGENTIC'); delete body.contents[0].role;
    body.contents[0].parts.push({ inlineData: { mimeType: 'video/webm', data: 'YQ==' }, mediaProcessing: 'STATIC' }, { inlineData: { mimeType: 'video/avi', data: 'Yg==' } });
    const copy = structuredClone(body); expect(accepts(body)).toBe(true); expect(body).toEqual(copy);
    body.contents[0].parts[2].mediaProcessing = undefined; expect(accepts(body)).toBe(false);
    const metadata = original(); metadata.contents[0].parts[1].videoMetadata = {}; expect(accepts(metadata)).toBe(false); expect(accepts(metadata, false, false, false, true, true)).toBe(true);
    const resolution = original(); resolution.contents[0].parts[1].mediaResolution = {}; expect(accepts(resolution)).toBe(false); expect(accepts(resolution, false, false, false, true, false, true)).toBe(true);
  });
  it('existing video metadata/resolution/audio/image grants do not silently authorize processing, even explicit UNSPECIFIED', () => {
    const body = original('MEDIA_PROCESSING_UNSPECIFIED'); expect(accepts(body)).toBe(true);
    expect(supportsGeminiRequest(body, false, true, true, true, true, true, true, true)).toBe(false);
    expect(supportsGeminiRequest(body)).toBe(false);
    const malformed = original(); malformed.contents[0].parts[1].inlineData.data = 'YQ='; expect(accepts(malformed)).toBe(false);
    const only = original(); only.contents[0].parts[1] = { mediaProcessing: 'STATIC' }; expect(accepts(only)).toBe(false);
  });
  it('strict internal model/boolean and bounded plain captures refuse programmable evidence before reads', () => {
    const body = { model: 'fixture-gemini', stream: false, ...original() }; expect(supportsGeminiInternalRequest(body, body.model, false, false, false, true, false, false, false, false, true)).toBe(true);
    expect(supportsGeminiInternalRequest(body, 'foreign', false, false, false, true, false, false, false, false, true)).toBe(false);
    for (const flag of [null, 1, 'true', {}, []]) expect(supportsGeminiRequest(original(), false, false, false, true, false, false, false, false, flag)).toBe(false);
    const getter = vi.fn(), trap = vi.fn(), programmable = original(); Object.defineProperty(programmable.contents[0].parts[1], 'mediaProcessing', { enumerable: true, get: getter }); expect(accepts(programmable)).toBe(false); expect(accepts(new Proxy(original(), { ownKeys: trap }))).toBe(false); expect(getter).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
    const inherited = original(); Object.setPrototypeOf(inherited.contents[0].parts[1], { mediaProcessing: 'STATIC' }); expect(accepts(inherited)).toBe(false);
    const cyclic = original(); cyclic.contents[0].parts[1].self = cyclic; expect(accepts(cyclic)).toBe(false);
    const oversize = original(); oversize.contents[0].parts[0].text = 'a'.repeat(262145); expect(accepts(oversize)).toBe(false);
  });
});
