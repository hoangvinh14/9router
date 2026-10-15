import { describe, it, expect, vi } from 'vitest';
import { supportsGeminiRequest, supportsGeminiInternalRequest, supportsGeminiCandidate, ACCOUNTED_GEMINI_BASE, ACCOUNTED_GEMINI_ACTION } from 'open-sse/config/accountedGeminiCandidate.js';
const original = (mimeType = 'audio/wav') => ({ contents: [{ role: 'user', parts: [{ text: 'private prompt' }, { inlineData: { mimeType, data: 'b3BhcXVl', displayName: 'private audio' } }] }] });
const accepts = (body, client = false, imagePdf = false) => supportsGeminiRequest(body, client, imagePdf, true);
describe('isolated input inline audio original prerequisite, not duration/rates/raw/POST grant', () => {
  it('independent audio flag retains canonical inline bytes and order without broadening default image/PDF or declaring duration', () => {
    const body = original(), before = structuredClone(body);
    expect(accepts(body)).toBe(true); expect(body).toEqual(before);
    expect(supportsGeminiRequest(body)).toBe(false); expect(supportsGeminiRequest(body, false, true)).toBe(false);
    for (const mime of ['audio/wav', 'audio/mp3', 'audio/aiff', 'audio/aac', 'audio/ogg', 'audio/flac', 'audio/mpeg']) expect(accepts(original(mime))).toBe(true);
    const multi = original(); multi.contents[0].parts.push({ text: 'between' }, { inlineData: { mimeType: 'audio/flac', data: 'YQ==' } }, { text: 'after' });
    const copy = structuredClone(multi); expect(accepts(multi)).toBe(true); expect(multi).toEqual(copy);
  });
  it('client calls/results compose only under both independent flags and preserve opaque original signatures and arguments', () => {
    const body = original(); body.tools = [{ functionDeclarations: [{ name: 'lookup', description: 'Lookup' }] }];
    body.contents.push({ role: 'model', parts: [{ functionCall: { id: 'opaque', name: 'lookup', args: { private: 'input' } }, thoughtSignature: 'b3BhcXVl' }] },
      { role: 'user', parts: [{ functionResponse: { id: 'opaque', name: 'lookup', response: { error: 'private result' } } }] });
    const before = structuredClone(body); expect(accepts(body, true)).toBe(true); expect(body).toEqual(before);
    expect(accepts(body)).toBe(false); expect(supportsGeminiRequest(body, true, true)).toBe(false);
    body.contents[2].parts[0].functionResponse.id = 'foreign'; expect(accepts(body, true)).toBe(false);
  });
  it('input audio never authorizes output media, remote file/URI, unspecified codec, extra union members or generated configuration', () => {
    expect(accepts(original())).toBe(true);
    for (const change of [v => { v.contents[0].role = 'model'; }, v => { v.contents[0].parts[1].text = 'mixed'; },
      v => { v.contents[0].parts[1].inlineData.data = ''; }, v => { v.contents[0].parts[1].inlineData.data = 'YQ='; },
      v => { v.contents[0].parts[1].inlineData.durationSeconds = 1; }, v => { v.contents[0].parts[1].audioTranscription = { text: 'transcript' }; },
      v => { v.contents[0].parts[1] = { fileData: { mimeType: 'audio/wav', fileUri: 'https://example.invalid/audio' } }; },
      v => { v.generationConfig = { responseModalities: ['AUDIO'] }; }, v => { v.contents[0].parts[1].inlineData.mimeType = 'video/mp4'; }]) {
      const body = original(); change(body); expect(accepts(body)).toBe(false);
    }
    expect(accepts(original('audio/unknown'))).toBe(false);
  });
  it('audio plus image/PDF requires independent grants; local projection never strips unsupported original work to pass', () => {
    const body = original(); body.contents[0].parts.push({ inlineData: { mimeType: 'image/png', data: 'YQ==' } });
    const before = structuredClone(body); expect(accepts(body, false, true)).toBe(true); expect(body).toEqual(before);
    expect(accepts(body)).toBe(false); expect(supportsGeminiRequest(body, false, true)).toBe(false);
    body.contents[0].parts.push({ inlineData: { mimeType: 'application/pdf', data: 'Yg==' } }); expect(accepts(body, false, true)).toBe(true);
  });
  it('bounded original-only authority does not opt in candidate modes or erase system/output/cache/resource fields', () => {
    expect(accepts(original())).toBe(true);
    const body = { model: 'fixture-gemini', stream: false, ...original() };
    const options = { body, model: body.model, stream: false, accountingMode: 'native-gemini-inline-json', credentials: { apiKey: 'dummy-key' }, accounting: { requiresPreparedBaseWire: true } };
    expect(supportsGeminiCandidate({ provider: 'gemini', config: { format: 'gemini' } }, options, `${ACCOUNTED_GEMINI_BASE}/${body.model}${ACCOUNTED_GEMINI_ACTION}`, original(), { 'Content-Type': 'application/json', 'x-goog-api-key': 'dummy-key' })).toBe(false);
    for (const change of [v => { v.systemInstruction = { parts: [{ inlineData: { mimeType: 'audio/wav', data: 'YQ==' } }] }; },
      v => { v.cachedContent = 'cachedResources/private'; }, v => { v.contents[0].parts[1].inlineData.displayName = null; },
      v => { v.contents[0].parts[1].inlineData.data = 'YQ=='.repeat(70000); }]) {
      const value = original(); change(value); expect(accepts(value)).toBe(false);
    }
    const omitted = original(); delete omitted.contents[0].role; expect(accepts(omitted)).toBe(true);
  });
  it('nested/internal inherited, cyclic and revoked proxy evidence refuse before executing accessors or coercion', () => {
    expect(accepts(original())).toBe(true); const getter = vi.fn();
    const body = { model: 'fixture-gemini', stream: false, ...original() };
    Object.defineProperty(body, 'model', { enumerable: true, get: getter });
    expect(supportsGeminiInternalRequest(body, 'fixture-gemini', false, false, true)).toBe(false); expect(getter).not.toHaveBeenCalled();
    const cyclic = original(); cyclic.contents[0].parts[1].inlineData.self = cyclic; expect(accepts(cyclic)).toBe(false);
    const inherited = original(); Object.setPrototypeOf(inherited.contents[0].parts[1].inlineData, { durationSeconds: 1 }); expect(accepts(inherited)).toBe(false);
    const proxy = Proxy.revocable(original(), {}); proxy.revoke(); expect(accepts(proxy.proxy)).toBe(false);
    for (const flag of [null, 1, {}, []]) expect(supportsGeminiInternalRequest({ model: 'fixture-gemini', stream: false, ...original() }, 'fixture-gemini', false, false, flag)).toBe(false);
  });
  it('strict audio opt-in/internal model validation captures bounded plain evidence before getters/proxies and cannot infer support from MIME alone', () => {
    const body = { model: 'fixture-gemini', stream: false, ...original() };
    expect(supportsGeminiInternalRequest(body, 'fixture-gemini', false, false, true)).toBe(true);
    expect(supportsGeminiInternalRequest(body, 'foreign', false, false, true)).toBe(false);
    expect(supportsGeminiRequest(original(), false, false, 'true')).toBe(false);
    const getter = vi.fn(), trap = vi.fn(); const programmable = original();
    Object.defineProperty(programmable.contents[0].parts[1].inlineData, 'data', { enumerable: true, get: getter });
    expect(accepts(programmable)).toBe(false); expect(accepts(new Proxy(original(), { ownKeys: trap }))).toBe(false);
    expect(getter).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
  });
});
