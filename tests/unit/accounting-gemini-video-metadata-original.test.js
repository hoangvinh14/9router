import { describe, it, expect, vi } from 'vitest';
import { supportsGeminiRequest, supportsGeminiInternalRequest, supportsGeminiCandidate, ACCOUNTED_GEMINI_BASE, ACCOUNTED_GEMINI_ACTION } from 'open-sse/config/accountedGeminiCandidate.js';
const original = (metadata = { startOffset: '0.000000001s', endOffset: '1.000000001s', fps: 0.5 }) => ({ contents: [{ role: 'user', parts: [{ text: 'private prompt' }, { inlineData: { mimeType: 'video/mp4', data: 'b3BhcXVl', displayName: 'private video' }, videoMetadata: metadata }] }] });
const accepts = (body, client = false, imagePdf = false, audio = false, video = true) => supportsGeminiRequest(body, client, imagePdf, audio, video, true);
describe('legacy Part.videoMetadata isolated original authority, not elapsed usage/frame estimate or processing_options migration', () => {
  it('strict independent metadata/video permissions preserve exact offsets/FPS without default injection or rewrites', () => {
    const body = original(), before = structuredClone(body); expect(accepts(body)).toBe(true); expect(body).toEqual(before);
    expect(supportsGeminiRequest(body, false, false, false, true)).toBe(false); expect(accepts(body, false, false, false, false)).toBe(false);
    for (const metadata of [{}, { fps: 24 }, { fps: 0.00001 }, { startOffset: '0s' }, { endOffset: '315576000000s' }, { startOffset: '1.1s', endOffset: '1.100000001s' }, { startOffset: '1.000000001s', endOffset: '1.000000002s' }]) {
      const value = original(metadata), copy = structuredClone(value); expect(accepts(value)).toBe(true); expect(value).toEqual(copy);
    }
  });
  it('nonnegative protobuf nanosecond offsets compare exactly and reject malformed ranges/FPS or guessed codec dimensions', () => {
    expect(accepts(original())).toBe(true);
    for (const metadata of [null, [], { startOffset: '-1s' }, { startOffset: '1e1s' }, { startOffset: '1.0000000001s' }, { startOffset: '315576000001s' }, { startOffset: '315576000000.000000001s' },
      { startOffset: '01s' }, { startOffset: '1' }, { startOffset: 1 }, { startOffset: '1.000000002s', endOffset: '1.000000001s' }, { startOffset: '1s', endOffset: '1.000000000s' },
      { fps: 0 }, { fps: -1 }, { fps: 24.1 }, { fps: Number.NaN }, { fps: Number.POSITIVE_INFINITY }, { fps: '1' }, { durationSeconds: 1 }, { frameCount: 1 }, { channels: 2 }]) expect(accepts(original(metadata))).toBe(false);
  });
  it('client/image/PDF/audio composition needs every independent grant and preserves complete history/signatures/results', () => {
    const body = original(); body.tools = [{ functionDeclarations: [{ name: 'lookup', description: 'Lookup' }] }];
    body.contents[0].parts.push({ inlineData: { mimeType: 'image/png', data: 'YQ==' } }, { inlineData: { mimeType: 'audio/opus', data: 'Yg==' } }, { inlineData: { mimeType: 'application/pdf', data: 'Yw==' } });
    body.contents.push({ role: 'model', parts: [{ functionCall: { id: 'opaque', name: 'lookup', args: { q: 'private' } }, thoughtSignature: 'b3BhcXVl' }] }, { role: 'user', parts: [{ functionResponse: { id: 'opaque', name: 'lookup', response: { error: 'private result' } } }] });
    const before = structuredClone(body); expect(accepts(body, true, true, true)).toBe(true); expect(body).toEqual(before);
    expect(accepts(body, false, true, true)).toBe(false); expect(accepts(body, true, false, true)).toBe(false); expect(accepts(body, true, true, false)).toBe(false);
  });
  it('metadata belongs only to input inline video; remote resources, processing modes, resolution, nonvideo and output material never get stripped', () => {
    expect(accepts(original())).toBe(true);
    for (const change of [v => { v.contents[0].parts[1].inlineData.mimeType = 'audio/opus'; }, v => { v.contents[0].parts[1].inlineData.mimeType = 'image/png'; },
      v => { v.contents[0].parts[1].text = 'union'; }, v => { v.contents[0].role = 'model'; }, v => { v.contents[0].parts[1].mediaProcessing = 'STATIC'; },
      v => { v.contents[0].parts[1].mediaResolution = { level: 'MEDIA_RESOLUTION_LOW' }; }, v => { v.processing_options = {}; },
      v => { delete v.contents[0].parts[1].inlineData; v.contents[0].parts[1].fileData = { mimeType: 'video/mp4', fileUri: 'https://example.invalid/private' }; },
      v => { v.generationConfig = { responseModalities: ['VIDEO'] }; }]) { const body = original(); change(body); const copy = structuredClone(body); expect(accepts(body, false, true, true)).toBe(false); expect(body).toEqual(copy); }
  });
  it('metadata prerequisite cannot grant current queued video candidate mode or metadata without video source', () => {
    const body = { model: 'fixture-gemini', stream: false, ...original() };
    const options = { body, model: body.model, stream: false, accountingMode: 'native-gemini-video-json', credentials: { apiKey: 'dummy-key' }, accounting: { requiresPreparedBaseWire: true } };
    expect(supportsGeminiCandidate({ provider: 'gemini', config: { format: 'gemini' } }, options, `${ACCOUNTED_GEMINI_BASE}/${body.model}${ACCOUNTED_GEMINI_ACTION}`, original(), { 'Content-Type': 'application/json', 'x-goog-api-key': 'dummy-key' })).toBe(false);
    const noSource = original(); noSource.contents[0].parts[1] = { text: 'not video', videoMetadata: {} }; expect(accepts(noSource)).toBe(false);
    const system = original(); system.systemInstruction = { parts: [{ inlineData: { mimeType: 'video/mp4', data: 'YQ==' }, videoMetadata: {} }] }; expect(accepts(system)).toBe(false);
    const omitted = original(); delete omitted.contents[0].role; expect(accepts(omitted)).toBe(true);
  });
  it('multiple video metadata objects remain source-local and unmodified, with max-range nanosecond comparisons exact', () => {
    const body = original({ startOffset: '315575999999.999999998s', endOffset: '315575999999.999999999s', fps: 24 });
    body.contents[0].parts.push({ inlineData: { mimeType: 'video/webm', data: 'YQ==' }, videoMetadata: { endOffset: '1.2s' } });
    const before = structuredClone(body); expect(accepts(body)).toBe(true); expect(body).toEqual(before);
    body.contents[0].parts[2].videoMetadata.startOffset = '1.200000001s'; expect(accepts(body)).toBe(false);
    const max = original({ startOffset: '315575999999.999999999s', endOffset: '315576000000.000000000s' }); expect(accepts(max)).toBe(true);
    const undefinedFps = original({ fps: undefined }); expect(accepts(undefinedFps)).toBe(false);
  });
  it('bounded internal and raw metadata capture refuses getter/proxy/inherited evidence before reading or coercion', () => {
    const body = { model: 'fixture-gemini', stream: false, ...original() }; expect(supportsGeminiInternalRequest(body, body.model, false, false, false, true, true)).toBe(true);
    expect(supportsGeminiInternalRequest(body, 'foreign', false, false, false, true, true)).toBe(false);
    for (const flag of [null, 1, 'true', {}, []]) expect(supportsGeminiRequest(original(), false, false, false, true, flag)).toBe(false);
    const getter = vi.fn(), trap = vi.fn(), value = original(); Object.defineProperty(value.contents[0].parts[1].videoMetadata, 'fps', { enumerable: true, get: getter }); expect(accepts(value)).toBe(false);
    expect(accepts(new Proxy(original(), { ownKeys: trap }))).toBe(false); expect(getter).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
    const inherited = original(); Object.setPrototypeOf(inherited.contents[0].parts[1].videoMetadata, { fps: 1 }); expect(accepts(inherited)).toBe(false);
    const cyclic = original(); cyclic.contents[0].parts[1].videoMetadata.self = cyclic; expect(accepts(cyclic)).toBe(false);
  });
});
