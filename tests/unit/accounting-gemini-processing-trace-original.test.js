import { describe, expect, it, vi } from 'vitest';
import { supportsGeminiRequest, supportsGeminiInternalRequest } from 'open-sse/config/accountedGeminiCandidate.js';
const body = () => ({ contents: [
  { role: 'user', parts: [{ inlineData: { mimeType: 'video/mp4', data: 'b3BhcXVl' }, mediaProcessing: 'AGENTIC' }, { text: 'private prompt' }] },
  { role: 'model', parts: [{ text: 'private navigation thought', thought: true }, { toolCall: { toolType: 'MEDIA_PROCESSING', id: 'opaque_1', args: { segment: 'private opaque', nested: [1, { value: true }] } }, thoughtSignature: 'YQ==' }, { toolResponse: { toolType: 'MEDIA_PROCESSING', id: 'opaque_1', response: { transcript: 'private result' } }, thoughtSignature: 'Yg==' }, { text: 'private answer', thoughtSignature: 'Yw==' }] },
  { role: 'user', parts: [{ text: 'private followup' }] },
] });
const supports = value => supportsGeminiRequest(value, false, false, false, true, false, false, false, false, true, true);
const internal = value => supportsGeminiInternalRequest({ model: 'fixture-gemini', stream: false, ...value }, 'fixture-gemini', false, false, false, true, false, false, false, false, true, true);
describe('original MEDIA_PROCESSING trace prerequisite, not raw usage, monetary settlement or queued dispatch', () => {
  it('retains full ordered processing calls/results, opaque payloads/thoughts/signatures and internal source without mutation', () => {
    const original = body(), copy = structuredClone(original); expect(supports(original)).toBe(true); expect(internal(original)).toBe(true); expect(original).toEqual(copy);
    for (const mode of ['STATIC', 'MEDIA_PROCESSING_UNSPECIFIED', 'AGENTIC']) { const value = body(); value.contents[0].parts[0].mediaProcessing = mode; expect(supports(value)).toBe(true); }
  });
  it('accepts optional absent IDs/args/response and sequential no-ID pairs without inventing identity or execution', () => {
    const value = body(); value.contents[1].parts = [{ toolCall: { toolType: 'MEDIA_PROCESSING' } }, { toolResponse: { toolType: 'MEDIA_PROCESSING' } }, { toolCall: { toolType: 'MEDIA_PROCESSING', args: {} } }, { toolResponse: { toolType: 'MEDIA_PROCESSING', response: {} } }, { text: 'answer' }];
    expect(supports(value)).toBe(true);
    value.contents[1].parts[1].toolResponse.id = 'invented'; expect(supports(value)).toBe(false);
  });
  it('requires independent trace and video-processing/video grants with actual source/control; old modes cannot inherit', () => {
    const value = body(); expect(supportsGeminiRequest(value, false, false, false, true, false, false, false, false, true)).toBe(false);
    expect(supportsGeminiRequest(value, false, false, false, true, false, false, false, false, false, true)).toBe(false);
    expect(supportsGeminiRequest(value, false, true, true, false, false, false, false, false, true, true)).toBe(false);
    for (const change of [v => { delete v.contents[0].parts[0].mediaProcessing; }, v => { v.contents[0].parts[0].inlineData.mimeType = 'audio/opus'; }, v => { delete v.contents[0].parts[0].inlineData; v.contents[0].parts[0].fileData = { fileUri: 'files/private', mimeType: 'video/mp4' }; }]) { const bad = body(); change(bad); expect(supports(bad)).toBe(false); }
    expect(supportsGeminiRequest(value, false, false, false, true, false, false, false, false, true, 'true')).toBe(false);
    expect(supportsGeminiInternalRequest({ model: 'fixture-gemini', stream: false, ...value }, 'different', false, false, false, true, false, false, false, false, true, true)).toBe(false);
  });
  it('requires complete ordered same-content call/result identity/type association and refuses duplicate or orphan traces', () => {
    for (const mutate of [v => { v.contents[1].parts.splice(2, 1); }, v => { v.contents[1].parts.splice(1, 1); }, v => { v.contents[1].parts[2].toolResponse.id = 'different'; }, v => { v.contents[1].parts[2].toolResponse.toolType = 'GOOGLE_SEARCH_WEB'; }, v => { v.contents[1].parts.splice(2, 0, structuredClone(v.contents[1].parts[1])); }, v => { v.contents[1].parts.push(structuredClone(v.contents[1].parts[1]), structuredClone(v.contents[1].parts[2])); }, v => { [v.contents[1].parts[1], v.contents[1].parts[2]] = [v.contents[1].parts[2], v.contents[1].parts[1]]; }, v => { v.contents[2].parts.unshift(v.contents[1].parts.splice(2, 1)[0]); }]) { const bad = body(); mutate(bad); expect(supports(bad)).toBe(false); }
  });
  it('refuses malformed/foreign/union/own-undefined signature payloads and non-model trace positions rather than stripping them', () => {
    for (const mutate of [v => { v.contents[1].role = 'user'; }, v => { v.systemInstruction = { parts: [v.contents[1].parts[1]] }; }, v => { v.contents[1].parts[1].text = 'union'; }, v => { v.contents[1].parts[1].toolCall.toolName = 'unknown'; }, v => { v.contents[1].parts[1].toolCall.toolType = 'FILE_SEARCH'; }, v => { v.contents[1].parts[1].toolCall.id = ''; }, v => { v.contents[1].parts[1].toolCall.args = []; }, v => { v.contents[1].parts[2].toolResponse.response = null; }, v => { v.contents[1].parts[1].toolCall.args = undefined; }, v => { v.contents[1].parts[1].thoughtSignature = undefined; }, v => { v.contents[1].parts[1].thoughtSignature = 'not base64'; }, v => { v.contents[1].parts[1].mediaProcessing = 'AGENTIC'; }, v => { v.contents[1].parts[2].inlineData = { mimeType: 'image/png', data: 'YQ==' }; }]) { const bad = body(); mutate(bad); expect(supports(bad)).toBe(false); }
  });
  it('combines independent client/media/metadata/resolution grammar while preserving full mixed original', () => {
    const value = body(); value.tools = [{ functionDeclarations: [{ name: 'lookup', description: 'Private lookup' }] }];
    value.contents[0].parts[0].videoMetadata = { fps: 24, endOffset: '1s' }; value.contents[0].parts[0].mediaResolution = { level: 'MEDIA_RESOLUTION_LOW' }; value.generationConfig = { mediaResolution: 'MEDIA_RESOLUTION_HIGH' };
    value.contents[0].parts.push({ inlineData: { mimeType: 'application/pdf', data: 'YQ==' } }, { inlineData: { mimeType: 'audio/opus', data: 'Yg==' } });
    value.contents[1].parts.push({ functionCall: { id: 'client_1', name: 'lookup', args: { q: 'private query' } }, thoughtSignature: 'ZA==' });
    value.contents[2].parts.unshift({ functionResponse: { id: 'client_1', name: 'lookup', response: { error: 'private client result' } } }); const copy = structuredClone(value);
    expect(supportsGeminiRequest(value, true, true, true, true, true, true, false, false, true, true)).toBe(true); expect(value).toEqual(copy);
    expect(supportsGeminiRequest(value, false, true, true, true, true, true, false, false, true, true)).toBe(false);
    expect(supportsGeminiRequest(value, true, false, true, true, true, true, false, false, true, true)).toBe(false);
    value.contents[0].parts[1].mediaResolution = {}; expect(supportsGeminiRequest(value, true, true, true, true, true, true, false, false, true, true)).toBe(false);
  });
  it('keeps multiple distinct ID pairs and complete model histories, but a bare grant or legacy candidate cannot inherit trace permission', async () => {
    const value = body(); value.contents[1].parts.splice(2, 0, { toolCall: { toolType: 'MEDIA_PROCESSING', id: 'opaque_2', args: { private: 'opaque' } } });
    value.contents[1].parts.splice(4, 0, { toolResponse: { toolType: 'MEDIA_PROCESSING', id: 'opaque_2', response: {} } }); expect(supports(value)).toBe(true);
    const absent = body(); absent.contents[1].parts = [{ text: 'answer' }]; expect(supports(absent)).toBe(false);
    const { validateAccountingGeminiDispatch } = await import('open-sse/config/accountedGeminiDispatch.js');
    const { captureAccountingBaseTransport } = await import('open-sse/config/accountedBaseTransport.js');
    const { PROVIDERS } = await import('open-sse/config/providers.js');
    for (const mode of ['native-gemini-video-processing-json', 'native-gemini-video-json', 'native-gemini-client-json', 'native-gemini-json']) {
      expect(() => validateAccountingGeminiDispatch({ model: 'fixture-gemini', mode, baseTransport: captureAccountingBaseTransport(PROVIDERS.gemini), originalBody: value, serializedBody: JSON.stringify(value) }, 'https://generativelanguage.googleapis.com/v1beta/models/fixture-gemini:generateContent')).toThrow();
    }
  });
  it('bounds original capture and invokes no getters/proxy traps while refusing programmable trace material', () => {
    const getter = vi.fn(), bad = body(); Object.defineProperty(bad.contents[1].parts[1].toolCall, 'args', { enumerable: true, get: getter }); expect(supports(bad)).toBe(false); expect(getter).not.toHaveBeenCalled();
    const trap = vi.fn(), proxy = body(); proxy.contents[1].parts[2].toolResponse.response = new Proxy({}, { ownKeys: trap, get: trap }); expect(supports(proxy)).toBe(false); expect(trap).not.toHaveBeenCalled();
    const large = body(); large.contents[1].parts[1].toolCall.args = { private: 'x'.repeat(262145) }; expect(supports(large)).toBe(false);
  });
});
