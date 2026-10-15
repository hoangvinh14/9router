import { describe, it, expect, vi } from 'vitest';
import { supportsGeminiOwnedFilesOriginal as supports } from 'open-sse/config/accountingGeminiOwnedFilesOriginal.js';
import { supportsGeminiRequest } from 'open-sse/config/accountedGeminiCandidate.js';

const file = (name = 'owned-video', mimeType = 'video/mp4') => ({ name: 'files/' + name,
  uri: 'https://generativelanguage.googleapis.com/v1beta/files/' + name, mimeType,
  sizeBytes: '17', sha256Hash: Buffer.alloc(32, 1).toString('base64'),
  createTime: '2026-10-03T00:00:00Z', updateTime: '2026-10-03T00:00:00Z',
  expirationTime: '2026-10-05T00:00:00Z', state: 'ACTIVE', source: 'UPLOADED' });
const inventory = () => [{ id: 'resource-video', file: file() }];
const body = () => ({ contents: [{ parts: [{ text: 'private original' }, {
  fileData: { fileUri: file().uri }, mediaResolution: { level: 'MEDIA_RESOLUTION_ULTRA_HIGH' }
}] }], generationConfig: { mediaResolution: 'MEDIA_RESOLUTION_HIGH', maxOutputTokens: 20 } });
const validate = value => supportsGeminiRequest(value);
const accepts = (value, resources = inventory(), callback = validate, metadata = false, resolution = true) =>
  supports(value, resources, callback, metadata, resolution);
const levels = ['MEDIA_RESOLUTION_UNSPECIFIED', 'MEDIA_RESOLUTION_LOW', 'MEDIA_RESOLUTION_MEDIUM', 'MEDIA_RESOLUTION_HIGH'];

describe('owned-file video resolution original prerequisite, not runtime/usage/dispatch authority', () => {
  it('preserves Part-object and generation-string controls with independent default-closed grant and no fabricated inline data', () => {
    for (const level of [...levels, 'MEDIA_RESOLUTION_ULTRA_HIGH']) {
      const original = body(); original.contents[0].parts[1].mediaResolution = { level };
      const before = structuredClone(original), resources = inventory();
      const callback = vi.fn(view => {
        expect(view.contents[0].parts[1]).toEqual({ text: '[validated original owned file]' });
        expect(view.generationConfig).toEqual({ maxOutputTokens: 20 });
        expect(JSON.stringify(view)).not.toContain('inlineData'); return validate(view);
      });
      expect(supports(original, resources, validate)).toBe(false);
      expect(accepts(original, resources, callback)).toBe(true);
      expect(callback).toHaveBeenCalledOnce(); expect(original).toEqual(before); expect(resources).toEqual(inventory());
      expect(supportsGeminiRequest(original, false, true, true, true, true, true, true, true, true, true)).toBe(false);
    }
    for (const level of levels) { const original = body(); original.generationConfig.mediaResolution = level; expect(accepts(original)).toBe(true); }
    for (const shape of ['part-only', 'generation-only', 'empty-part']) {
      const original = body();
      if (shape === 'part-only') delete original.generationConfig.mediaResolution;
      if (shape === 'generation-only') delete original.contents[0].parts[1].mediaResolution;
      if (shape === 'empty-part') original.contents[0].parts[1].mediaResolution = {};
      const before = structuredClone(original); expect(accepts(original)).toBe(true); expect(original).toEqual(before);
    }
  });
  it('keeps separate source-local controls across complete unique resource inventory and text history', () => {
    const original = body(), second = file('owned-second', 'video/webm');
    original.contents[0].parts.push({ fileData: { fileUri: second.uri, mimeType: second.mimeType }, mediaResolution: { level: 'MEDIA_RESOLUTION_LOW' } });
    original.contents.push({ role: 'model', parts: [{ text: 'private prior' }] }, { role: 'user', parts: [{ text: 'followup' }] });
    const resources = [...inventory(), { id: 'resource-second', file: second }], before = structuredClone(original);
    expect(accepts(original, resources)).toBe(true); expect(original).toEqual(before);
    expect(accepts(original)).toBe(false);
    original.contents[0].parts[2].mediaResolution.level = 'UNKNOWN'; expect(accepts(original, resources)).toBe(false);
  });
  it('composes signature and client history only through an independently granted original validator', () => {
    const original = body();
    original.tools = [{ functionDeclarations: [{ name: 'lookup', description: 'original declaration' }] }];
    original.contents.push({ role: 'model', parts: [{ text: 'private prior', thoughtSignature: 'b3BhcXVl' },
      { functionCall: { id: 'opaque', name: 'lookup', args: { q: 'private' } }, thoughtSignature: 'b3BhcXVl' }] },
    { role: 'user', parts: [{ functionResponse: { id: 'opaque', name: 'lookup', response: { value: 'private result' } } }] });
    const before = structuredClone(original);
    expect(accepts(original)).toBe(false);
    const callback = vi.fn(view => {
      expect(view.contents.slice(1)).toEqual(original.contents.slice(1));
      expect(view.tools).toEqual(original.tools);
      return supportsGeminiRequest(view, true);
    });
    expect(accepts(original, inventory(), callback)).toBe(true);
    expect(callback).toHaveBeenCalledOnce(); expect(original).toEqual(before);
    expect(accepts(original, inventory(), callback, false, false)).toBe(false);
  });
  it('checks observed video type and strict controls before callback, never deriving authority from client MIME or enum labels', () => {
    expect(accepts(body())).toBe(true);
    for (const mimeType of ['image/png', 'application/pdf', 'audio/wav']) {
      const actual = file('owned-video', mimeType), original = body(), callback = vi.fn(() => true);
      expect(accepts(original, [{ id: 'resource-video', file: actual }], callback)).toBe(false); expect(callback).not.toHaveBeenCalled();
    }
    for (const control of [null, [], 'MEDIA_RESOLUTION_LOW', { level: 1 }, { level: 'LOW' }, { tokenCount: 64 }, { level: 'MEDIA_RESOLUTION_LOW', extra: 1 }]) {
      const original = body(), callback = vi.fn(() => true); original.contents[0].parts[1].mediaResolution = control;
      expect(accepts(original, inventory(), callback)).toBe(false); expect(callback).not.toHaveBeenCalled();
    }
    for (const control of [null, {}, 1, true, 'LOW', 'MEDIA_RESOLUTION_ULTRA_HIGH']) {
      const original = body(), callback = vi.fn(() => true); original.generationConfig.mediaResolution = control;
      expect(accepts(original, inventory(), callback)).toBe(false); expect(callback).not.toHaveBeenCalled();
    }
  });
  it('does not grant videoMetadata, inline/client work, processing, unregistered resources or resolution on text', () => {
    const original = body(); original.contents[0].parts[1].videoMetadata = { fps: 1, startOffset: '0s', endOffset: '1s' };
    const before = structuredClone(original); expect(accepts(original)).toBe(false); expect(accepts(original, inventory(), validate, true)).toBe(true); expect(original).toEqual(before);
    expect(accepts(original, inventory(), validate, true, false)).toBe(false);
    for (const mutate of [value => { value.contents[0].parts[1].mediaProcessing = 'AGENTIC'; }, value => { value.contents[0].parts[0].mediaResolution = {}; },
      value => { value.contents[0].parts[1].text = 'wrong union'; }, value => { value.cachedContent = 'cachedContents/foreign'; },
      value => { value.contents[0].parts.push({ inlineData: { mimeType: 'image/png', data: 'YQ==' } }); },
      value => { value.tools = [{ functionDeclarations: [{ name: 'lookup', description: 'original' }] }]; },
      value => { value.contents[0].parts[1].fileData.fileUri = 'https://foreign.invalid/file'; }]) {
      const value = body(); mutate(value); expect(accepts(value)).toBe(false);
    }
    const noVideo = { contents: [{ parts: [{ text: 'plain' }] }], generationConfig: { mediaResolution: 'MEDIA_RESOLUTION_HIGH' } };
    expect(accepts(noVideo)).toBe(false);
  });
  it('rejects non-Boolean grants and programmable or oversized controls without getter/callback execution', () => {
    expect(accepts(body())).toBe(true);
    for (const grant of [null, 1, 'true', {}, []]) expect(accepts(body(), inventory(), validate, false, grant)).toBe(false);
    const getter = vi.fn(), callback = vi.fn(() => true), original = body();
    Object.defineProperty(original.contents[0].parts[1].mediaResolution, 'level', { enumerable: true, get: getter });
    expect(accepts(original, inventory(), callback)).toBe(false); expect(getter).not.toHaveBeenCalled(); expect(callback).not.toHaveBeenCalled();
    const trap = vi.fn(); expect(accepts(new Proxy(body(), { ownKeys: trap }), inventory(), callback)).toBe(false); expect(trap).not.toHaveBeenCalled();
    const undefinedControl = body(); undefinedControl.contents[0].parts[1].mediaResolution.level = undefined; expect(accepts(undefinedControl)).toBe(false);
    const oversized = body(); oversized.contents[0].parts[0].text = 'x'.repeat(262145); expect(accepts(oversized)).toBe(false);
  });
});
