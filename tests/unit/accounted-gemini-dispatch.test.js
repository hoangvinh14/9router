import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ headers: null, create: vi.fn() }));
vi.mock('../../open-sse/config/providers.js', async importOriginal => ({ ...(await importOriginal()),
  PROVIDERS: { ...(await importOriginal()).PROVIDERS, get gemini() { return { format: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models', headers: fixture.headers }; } } }));
vi.mock('undici', () => ({ ProxyAgent: class { constructor(options) { fixture.create(options); } }, Agent: class { constructor(options) { fixture.create(options); } } }));
let nativeFetch, fetchProxy, evidence;
const url = 'https://generativelanguage.googleapis.com/v1beta/models/fixture-gemini:generateContent';
const options = () => ({ method: 'POST', redirect: 'error', body: evidence.serializedBody,
  headers: { 'Content-Type': 'application/json', 'x-goog-api-key': 'dummy-provider' } });
const saved = () => ({ persistedGlobalProxy: { url: 'http://dummy-proxy.invalid:3210', noProxy: '' } });
beforeEach(async () => {
  vi.resetModules(); fixture.headers = null; fixture.create.mockReset();
  nativeFetch = vi.fn(async () => Response.json({ fixture: true })); vi.stubGlobal('fetch', nativeFetch);
  ({ proxyAwareFetch: fetchProxy } = await import('../../open-sse/utils/proxyFetch.js'));
  const { captureAccountingBaseTransport } = await import('../../open-sse/config/accountedBaseTransport.js');
  const { PROVIDERS } = await import('../../open-sse/config/providers.js');
  evidence = { model: 'fixture-gemini', mode: 'native-gemini-json', baseTransport: captureAccountingBaseTransport(PROVIDERS.gemini),
    serializedBody: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'fixture' }] }] }) };
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('native Gemini original dispatch authority (mock dispatcher/fetch, not socket/OAuth/envelopes)', () => {
  it.each(['json', 'sse'])('owned inline video composition wire %s conserves original video and forbids old-mode laundering', async kind => {
    const file = { name: 'files/owned-video', uri: 'https://generativelanguage.googleapis.com/v1beta/files/owned-video', mimeType: 'video/mp4', sizeBytes: '17', sha256Hash: Buffer.alloc(32, 1).toString('base64'), createTime: '2026-10-03T00:00:00Z', updateTime: '2026-10-03T00:00:00Z', expirationTime: '2026-10-05T00:00:00Z', state: 'ACTIVE', source: 'UPLOADED' };
    const original = { contents: [{ parts: [{ fileData: { fileUri: file.uri }, videoMetadata: { fps: 1 }, mediaResolution: { level: 'MEDIA_RESOLUTION_LOW' } }, { inlineData: { mimeType: 'video/mp4', data: 'b3BhcXVl' } }] }] };
    const route = kind === 'sse' ? url.replace(':generateContent', ':streamGenerateContent?alt=sse') : url;
    evidence = { ...evidence, mode: 'native-gemini-owned-video-client-inline-audio-video-controls-' + kind, originalBody: original, resources: [{ id: 'resource-video', file }], serializedBody: JSON.stringify(original) };
    expect((await fetchProxy(route, options(), saved(), { singlePost: true, geminiTransport: evidence })).ok).toBe(true);
    expect(nativeFetch).toHaveBeenCalledOnce(); expect(nativeFetch.mock.calls[0][1].body).toBe(JSON.stringify(original));
    const before = structuredClone(evidence);
    for (const mutate of [v => { v.mode = 'native-gemini-owned-video-client-inline-audio-controls-' + kind; }, v => { v.mode = 'native-gemini-video-' + kind; }, v => { delete v.resources; }, v => { v.resources = []; }, v => { v.originalBody.contents[0].parts[1].inlineData.data = 'YQ=='; }, v => { v.serializedBody = JSON.stringify({ contents: [{ parts: [{ text: 'erased' }] }] }); }, v => { v.originalBody.contents[0].parts[1].mediaProcessing = 'AGENTIC'; v.serializedBody = JSON.stringify(v.originalBody); }, v => { v.originalBody.contents[0].parts[1].videoMetadata = { fps: 1 }; v.serializedBody = JSON.stringify(v.originalBody); }]) {
      const bad = structuredClone(before); mutate(bad); nativeFetch.mockClear(); fixture.create.mockClear();
      await expect(fetchProxy(route, { ...options(), body: bad.serializedBody }, saved(), { singlePost: true, geminiTransport: bad })).rejects.toThrow();
      expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
    }
    expect(evidence).toEqual(before);
  });
  it.each(['json', 'sse'])('owned video resolution wire mode %s preserves exact original and inventory without metadata/client/tenant grants', async kind => {
    const file = { name: 'files/owned-video', uri: 'https://generativelanguage.googleapis.com/v1beta/files/owned-video', mimeType: 'video/mp4', sizeBytes: '17', sha256Hash: Buffer.alloc(32, 1).toString('base64'), createTime: '2026-10-03T00:00:00Z', updateTime: '2026-10-03T00:00:00Z', expirationTime: '2026-10-05T00:00:00Z', state: 'ACTIVE', source: 'UPLOADED' };
    const original = { contents: [{ role: 'user', parts: [{ text: 'private before' }, { fileData: { fileUri: file.uri }, mediaResolution: { level: 'MEDIA_RESOLUTION_ULTRA_HIGH' } }, { text: 'private after' }] }], generationConfig: { mediaResolution: 'MEDIA_RESOLUTION_HIGH', maxOutputTokens: 20 } };
    const route = kind === 'sse' ? url.replace(':generateContent', ':streamGenerateContent?alt=sse') : url;
    evidence = { ...evidence, mode: 'native-gemini-owned-video-resolution-' + kind, originalBody: original, resources: [{ id: 'resource-video', file }], serializedBody: JSON.stringify(original) };
    const before = structuredClone(evidence);
    expect((await fetchProxy(route, options(), saved(), { singlePost: true, geminiTransport: evidence })).ok).toBe(true);
    expect(nativeFetch).toHaveBeenCalledOnce(); expect(nativeFetch.mock.calls[0][0]).toBe(route);
    expect(nativeFetch.mock.calls[0][1].body).toBe(JSON.stringify(original)); expect(nativeFetch.mock.calls[0][1].body).not.toContain('[validated original owned file]');
    for (const mutate of [v => { v.mode = 'native-gemini-owned-files-' + kind; }, v => { v.mode = 'native-gemini-owned-video-metadata-' + kind; }, v => { v.mode = 'native-gemini-video-resolution-' + kind; }, v => { delete v.resources; }, v => { v.resources = []; }, v => { v.extra = true; }, v => { v.originalBody.generationConfig.mediaResolution = 'MEDIA_RESOLUTION_LOW'; }, v => { v.originalBody.contents[0].parts[1].mediaResolution.level = 'MEDIA_RESOLUTION_LOW'; }, v => { v.serializedBody = JSON.stringify({ contents: [{ parts: [{ text: '[validated original owned file]' }] }] }); },
      ...[body => { body.contents[0].parts[1].mediaResolution.level = 'UNKNOWN'; }, body => { body.generationConfig.mediaResolution = 'MEDIA_RESOLUTION_ULTRA_HIGH'; }, body => { body.contents[0].parts[1].videoMetadata = {}; }, body => { body.contents[0].parts[1].mediaProcessing = 'AGENTIC'; }, body => { body.tools = [{ functionDeclarations: [{ name: 'lookup', description: 'private' }] }]; }, body => { body.contents[0].parts.push({ inlineData: { mimeType: 'image/png', data: 'YQ==' } }); }].map(change => v => { change(v.originalBody); v.serializedBody = JSON.stringify(v.originalBody); }),
      v => { v.resources[0].file.mimeType = 'audio/wav'; }]) {
      const bad = structuredClone(before); mutate(bad); nativeFetch.mockClear(); fixture.create.mockClear();
      await expect(fetchProxy(route, { ...options(), body: bad.serializedBody }, saved(), { singlePost: true, geminiTransport: bad })).rejects.toThrow();
      expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
    }
    nativeFetch.mockClear(); fixture.create.mockClear();
    await expect(fetchProxy(kind === 'sse' ? url : url.replace(':generateContent', ':streamGenerateContent?alt=sse'), options(), saved(), { singlePost: true, geminiTransport: evidence })).rejects.toThrow();
    expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled(); expect(evidence).toEqual(before);
  });
  it.each(['json','sse'])('owned video metadata wire mode %s preserves whole controls and resource inventory without tenant/default grants',async kind=>{
    const file={name:'files/upload-1',uri:'https://generativelanguage.googleapis.com/v1beta/files/upload-1',mimeType:'video/mp4',sizeBytes:'17',sha256Hash:Buffer.alloc(32,1).toString('base64'),createTime:'2026-10-03T00:00:00Z',updateTime:'2026-10-03T00:00:00Z',expirationTime:'2026-10-05T00:00:00Z',state:'ACTIVE',source:'UPLOADED'};
    const original={contents:[{role:'user',parts:[{text:'private before'},{fileData:{fileUri:file.uri,displayName:'private display'},videoMetadata:{fps:24,startOffset:'0.000000001s',endOffset:'1s'}},{text:'private after'}]}]};
    const route=kind==='sse'?url.replace(':generateContent',':streamGenerateContent?alt=sse'):url;
    evidence={...evidence,mode:'native-gemini-owned-video-metadata-'+kind,originalBody:original,resources:[{id:'resource-1',file}],serializedBody:JSON.stringify(original)};
    expect((await fetchProxy(route,options(),saved(),{singlePost:true,geminiTransport:evidence})).ok).toBe(true);expect(nativeFetch.mock.calls[0][1].body).toBe(JSON.stringify(original));expect(nativeFetch.mock.calls[0][1].body).not.toContain('[validated original owned file]');
    const before=structuredClone(evidence);
    for(const mutate of [v=>{v.mode='native-gemini-owned-files-'+kind;},v=>{v.mode='native-gemini-video-metadata-'+kind;},v=>{v.originalBody.contents[0].parts[1].videoMetadata.fps=1;},v=>{delete v.resources;},v=>{v.resources[0].file.mimeType='audio/wav';},v=>{v.originalBody.contents[0].parts[1].videoMetadata.fps=25;v.serializedBody=JSON.stringify(v.originalBody);},v=>{v.originalBody.contents[0].parts[1].mediaProcessing='AGENTIC';v.serializedBody=JSON.stringify(v.originalBody);},v=>{v.serializedBody=JSON.stringify({contents:[{parts:[{text:'[validated original owned file]'}]}]});}]){
      const bad=structuredClone(evidence);mutate(bad);nativeFetch.mockClear();fixture.create.mockClear();await expect(fetchProxy(route,{...options(),body:bad.serializedBody},saved(),{singlePost:true,geminiTransport:bad})).rejects.toThrow();expect(nativeFetch).not.toHaveBeenCalled();expect(fixture.create).not.toHaveBeenCalled();
    }
    expect(evidence).toEqual(before);
  });
  it('owned files mode preserves the entire fileData POST and complete structural inventory without creating tenant provenance', async () => {
    const file = { name: 'files/upload-1', uri: 'https://generativelanguage.googleapis.com/v1beta/files/upload-1', mimeType: 'video/mp4', sizeBytes: '17', sha256Hash: Buffer.alloc(32, 1).toString('base64'), createTime: '2026-10-03T00:00:00Z', updateTime: '2026-10-03T00:00:00Z', expirationTime: '2026-10-05T00:00:00Z', state: 'ACTIVE', source: 'UPLOADED' };
    const original = { contents: [{ role: 'user', parts: [{ text: 'private before' }, { fileData: { fileUri: file.uri, displayName: 'original display' } }, { text: 'private after' }] }] };
    for (const mode of ['native-gemini-owned-files-json', 'native-gemini-owned-files-sse']) {
      const route = mode.endsWith('-sse') ? url.replace(':generateContent', ':streamGenerateContent?alt=sse') : url;
      evidence = { ...evidence, mode, originalBody: original, resources: [{ id: 'resource-1', file }], serializedBody: JSON.stringify(original) };
      nativeFetch.mockClear(); expect((await fetchProxy(route, options(), saved(), { singlePost: true, geminiTransport: evidence })).ok).toBe(true);
      expect(nativeFetch.mock.calls[0][1].body).toBe(JSON.stringify(original)); expect(nativeFetch.mock.calls[0][1].body).not.toContain('[validated original owned file]');
      for (const mutate of [v => { delete v.resources; }, v => { v.resources = []; }, v => { v.resources.push({ id: 'unused', file: { ...file, name: 'files/unused', uri: file.uri.replace('upload-1', 'unused') } }); }, v => { v.resources[0].file.mimeType = 'audio/wav'; v.originalBody.contents[0].parts[1].fileData.mimeType = 'video/mp4'; }, v => { v.originalBody.contents[0].parts[0].text = 'changed'; }, v => { v.serializedBody = JSON.stringify({ contents: [{ parts: [{ text: '[validated original owned file]' }] }] }); }, v => { v.originalBody.contents[0].parts[1].mediaProcessing = 'AGENTIC'; v.serializedBody = JSON.stringify(v.originalBody); }, v => { v.mode = 'native-gemini-json'; }]) {
        const bad = structuredClone(evidence); mutate(bad); nativeFetch.mockClear(); fixture.create.mockClear(); await expect(fetchProxy(route, { ...options(), body: bad.serializedBody }, saved(), { singlePost: true, geminiTransport: bad })).rejects.toThrow(); expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
      }
    }
  });
  it('processing tools mode conserves full server traces and optional independent controls; cannot dispatch a projected/erased/foreign/old-mode history', async () => {
    const original = { contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'video/mp4', data: 'b3BhcXVl' }, mediaProcessing: 'AGENTIC', videoMetadata: {}, mediaResolution: {} }, { inlineData: { mimeType: 'application/pdf', data: 'YQ==' } }] }, { role: 'model', parts: [{ text: 'private thought', thought: true, thoughtSignature: 'YQ==' }, { toolCall: { toolType: 'MEDIA_PROCESSING', id: 'old_load', args: { private: 'opaque' } }, thoughtSignature: 'Yg==' }, { toolResponse: { toolType: 'MEDIA_PROCESSING', id: 'old_load', response: { private: 'opaque result' } } }, { text: 'answer' }] }, { role: 'user', parts: [{ text: 'follow up' }] }], tools: [{ functionDeclarations: [{ name: 'lookup', description: 'Lookup' }] }] };
    evidence = { ...evidence, mode: 'native-gemini-processing-tools-json', originalBody: original, serializedBody: JSON.stringify(original) };
    expect((await fetchProxy(url, options(), saved(), { singlePost: true, geminiTransport: evidence })).ok).toBe(true); expect(nativeFetch.mock.calls[0][1].body).toBe(JSON.stringify(original));
    for (const change of [v => { delete v.originalBody; }, v => { v.originalBody.contents[1].parts[1].toolCall.args.private = 'different'; }, v => { v.originalBody.contents[0].parts[0].mediaProcessing = 'STATIC'; }, v => { delete v.originalBody.tools; },
      ...['native-gemini-json', 'native-gemini-video-json', 'native-gemini-video-processing-json', 'native-gemini-video-resolution-json', 'native-gemini-client-json'].map(mode => v => { v.mode = mode; }),
      ...[b => { b.contents[1].parts.splice(2, 1); }, b => { b.contents[1].parts[2].toolResponse.id = 'orphan'; }, b => { b.contents[1].parts[1].toolCall.toolType = 'GOOGLE_SEARCH_WEB'; }, b => { delete b.contents[0].parts[0].mediaProcessing; }, b => { b.contents[0].parts[0].inlineData.mimeType = 'audio/wav'; }, b => { b.contents[0].parts[1].mediaResolution = {}; }, b => { b.processing_options = {}; }].map(mutate => v => { const bad = structuredClone(original); mutate(bad); v.originalBody = bad; v.serializedBody = JSON.stringify(bad); })]) {
      const value = structuredClone(evidence); change(value); nativeFetch.mockClear(); fixture.create.mockClear();
      await expect(fetchProxy(url, { ...options(), body: value.serializedBody }, saved(), { singlePost: true, geminiTransport: value })).rejects.toThrow(); expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
    }
    const bare = structuredClone(evidence); bare.originalBody.contents.splice(1); delete bare.originalBody.contents[0].parts[0].videoMetadata; delete bare.originalBody.contents[0].parts[0].mediaResolution; bare.serializedBody = JSON.stringify(bare.originalBody);
    expect((await fetchProxy(url, { ...options(), body: bare.serializedBody }, saved(), { singlePost: true, geminiTransport: bare })).ok).toBe(true);
  });
  it('processing mode conserves full processing/client/source controls with optional metadata/resolution; cannot erase or launder into old modes', async () => {
    const original = { contents: [{ role: 'user', parts: [{ text: 'fixture' }, { inlineData: { mimeType: 'video/mp4', data: 'b3BhcXVl' }, mediaProcessing: 'AGENTIC', videoMetadata: { fps: 24, endOffset: '1s' }, mediaResolution: { level: 'MEDIA_RESOLUTION_LOW' } }, { inlineData: { mimeType: 'application/pdf', data: 'YQ==' } }] }], generationConfig: { mediaResolution: 'MEDIA_RESOLUTION_HIGH' }, tools: [{ functionDeclarations: [{ name: 'lookup', description: 'Lookup' }] }] };
    evidence = { ...evidence, mode: 'native-gemini-video-processing-json', originalBody: original, serializedBody: JSON.stringify(original) };
    expect((await fetchProxy(url, options(), saved(), { singlePost: true, geminiTransport: evidence })).ok).toBe(true); expect(nativeFetch).toHaveBeenCalledTimes(1);
    for (const change of [v => { delete v.originalBody; }, v => { v.originalBody.contents[0].parts[1].mediaProcessing = 'STATIC'; }, v => { v.originalBody.contents[0].parts[1].inlineData.data = 'Yg=='; }, v => { delete v.originalBody.tools; }, v => { v.originalBody.contents[0].parts[1].videoMetadata.fps = 2; }, v => { v.originalBody.generationConfig.mediaResolution = 'MEDIA_RESOLUTION_LOW'; },
      ...['native-gemini-json', 'native-gemini-client-json', 'native-gemini-video-json', 'native-gemini-video-metadata-json', 'native-gemini-video-resolution-json', 'native-gemini-audio-resolution-json', 'native-gemini-inline-resolution-json'].map(mode => v => { v.mode = mode; }),
      ...[b => { delete b.contents[0].parts[1].mediaProcessing; }, b => { b.contents[0].parts[1].mediaProcessing = { mode: 'AGENTIC' }; }, b => { b.contents[0].parts[2].mediaProcessing = 'STATIC'; }, b => { b.contents[0].parts[2].mediaResolution = {}; }, b => { b.processing_options = {}; }, b => { b.contents[0].parts[1].inlineData.mimeType = 'audio/opus'; }].map(mutate => v => { const bad = structuredClone(original); mutate(bad); v.originalBody = bad; v.serializedBody = JSON.stringify(bad); })]) {
      const value = structuredClone(evidence); change(value); nativeFetch.mockClear(); fixture.create.mockClear();
      await expect(fetchProxy(url, { ...options(), body: value.serializedBody }, saved(), { singlePost: true, geminiTransport: value })).rejects.toThrow(); expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
    }
    const minimal = structuredClone(evidence); delete minimal.originalBody.contents[0].parts[1].videoMetadata; delete minimal.originalBody.contents[0].parts[1].mediaResolution; delete minimal.originalBody.generationConfig; minimal.serializedBody = JSON.stringify(minimal.originalBody);
    expect((await fetchProxy(url, { ...options(), body: minimal.serializedBody }, saved(), { singlePost: true, geminiTransport: minimal })).ok).toBe(true);
  });
  it('client mode binds complete original declarations/history to serialized POST; erasure/divergence and mode laundering refuse before socket', async () => {
    const original = { contents: [{ role: 'user', parts: [{ text: 'fixture' }] }], tools: [{ functionDeclarations: [{ name: 'lookup', description: 'Lookup' }] }] };
    evidence = { ...evidence, mode: 'native-gemini-client-json', originalBody: original, serializedBody: JSON.stringify(original) };
    expect((await fetchProxy(url, options(), saved(), { singlePost: true, geminiTransport: evidence })).ok).toBe(true);
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    for (const mutate of [value => { delete value.originalBody; }, value => { value.originalBody.contents[0].parts[0].text = 'different'; },
      value => { value.serializedBody = JSON.stringify({ contents: original.contents }); }, value => { value.mode = 'native-gemini-json'; }]) {
      const value = structuredClone(evidence); mutate(value); nativeFetch.mockClear(); fixture.create.mockClear();
      await expect(fetchProxy(url, { ...options(), body: value.serializedBody }, saved(), { singlePost: true, geminiTransport: value })).rejects.toThrow('Accounting Gemini transport unavailable');
      expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
    }
  });
  it('inline mode binds original media bytes and client definitions; erasure, divergent payload and mode laundering refuse before dispatch', async () => {
    const original = { contents: [{ role: 'user', parts: [{ text: 'fixture' }, { inlineData: { mimeType: 'image/png', data: 'b3BhcXVl' } }] }], tools: [{ functionDeclarations: [{ name: 'lookup', description: 'Lookup' }] }] };
    evidence = { ...evidence, mode: 'native-gemini-inline-json', originalBody: original, serializedBody: JSON.stringify(original) };
    expect((await fetchProxy(url, options(), saved(), { singlePost: true, geminiTransport: evidence })).ok).toBe(true);
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    for (const change of [value => { delete value.originalBody; }, value => { value.originalBody.contents[0].parts[1].inlineData.data = 'YQ=='; },
      value => { delete value.originalBody.tools; }, value => { value.mode = 'native-gemini-client-json'; },
      value => { value.mode = 'native-gemini-json'; }, value => { const empty = structuredClone(original); empty.contents[0].parts.pop(); value.originalBody = empty; value.serializedBody = JSON.stringify(empty); }]) {
      const value = structuredClone(evidence); change(value); nativeFetch.mockClear(); fixture.create.mockClear();
      await expect(fetchProxy(url, { ...options(), body: value.serializedBody }, saved(), { singlePost: true, geminiTransport: value })).rejects.toThrow();
      expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
    }
  });
  it('audio mode conserves mixed original media/client authority and requires selected AUDIO before dispatch', async () => {
    const original = { contents: [{ role: 'user', parts: [{ text: 'fixture' }, { inlineData: { mimeType: 'audio/wav', data: 'b3BhcXVl' } }, { inlineData: { mimeType: 'image/png', data: 'YQ==' } }] }],
      tools: [{ functionDeclarations: [{ name: 'lookup', description: 'Lookup' }] }] };
    evidence = { ...evidence, mode: 'native-gemini-audio-json', originalBody: original, serializedBody: JSON.stringify(original) };
    expect((await fetchProxy(url, options(), saved(), { singlePost: true, geminiTransport: evidence })).ok).toBe(true); expect(nativeFetch).toHaveBeenCalledTimes(1);
    for (const change of [value => { delete value.originalBody; }, value => { value.originalBody.contents[0].parts[1].inlineData.data = 'YQ=='; },
      value => { delete value.originalBody.tools; }, value => { value.mode = 'native-gemini-inline-json'; }, value => { value.mode = 'native-gemini-client-json'; },
      value => { value.mode = 'native-gemini-json'; }, value => { const absent = structuredClone(original); absent.contents[0].parts.splice(1, 1); value.originalBody = absent; value.serializedBody = JSON.stringify(absent); }]) {
      const value = structuredClone(evidence); change(value); nativeFetch.mockClear(); fixture.create.mockClear();
      await expect(fetchProxy(url, { ...options(), body: value.serializedBody }, saved(), { singlePost: true, geminiTransport: value })).rejects.toThrow();
      expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
    }
  });
  it('video mode binds complete video/audio/image/client original and requires VIDEO before acquiring dispatcher', async () => {
    const original = { contents: [{ role: 'user', parts: [{ text: 'fixture' }, { inlineData: { mimeType: 'video/mp4', data: 'b3BhcXVl' } }, { inlineData: { mimeType: 'audio/opus', data: 'YQ==' } }, { inlineData: { mimeType: 'image/png', data: 'Yg==' } }] }], tools: [{ functionDeclarations: [{ name: 'lookup', description: 'Lookup' }] }] };
    evidence = { ...evidence, mode: 'native-gemini-video-json', originalBody: original, serializedBody: JSON.stringify(original) };
    expect((await fetchProxy(url, options(), saved(), { singlePost: true, geminiTransport: evidence })).ok).toBe(true); expect(nativeFetch).toHaveBeenCalledTimes(1);
    for (const change of [value => { delete value.originalBody; }, value => { value.originalBody.contents[0].parts[1].inlineData.data = 'YQ=='; }, value => { delete value.originalBody.tools; },
      value => { value.mode = 'native-gemini-audio-json'; }, value => { value.mode = 'native-gemini-inline-json'; }, value => { value.mode = 'native-gemini-client-json'; }, value => { value.mode = 'native-gemini-json'; },
      value => { const absent = structuredClone(original); absent.contents[0].parts.splice(1, 1); value.originalBody = absent; value.serializedBody = JSON.stringify(absent); }]) {
      const value = structuredClone(evidence); change(value); nativeFetch.mockClear(); fixture.create.mockClear();
      await expect(fetchProxy(url, { ...options(), body: value.serializedBody }, saved(), { singlePost: true, geminiTransport: value })).rejects.toThrow(); expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
    }
  });
  it('metadata mode owns exact full metadata/video/client source and rejects erasure, divergence, source-only laundering and absent metadata before dispatcher', async () => {
    const original = { contents: [{ role: 'user', parts: [{ text: 'fixture' }, { inlineData: { mimeType: 'video/mp4', data: 'b3BhcXVl' }, videoMetadata: { fps: 0.5, startOffset: '0.000000001s', endOffset: '1.000000001s' } }, { inlineData: { mimeType: 'audio/opus', data: 'YQ==' } }, { inlineData: { mimeType: 'application/pdf', data: 'Yg==' } }] }], tools: [{ functionDeclarations: [{ name: 'lookup', description: 'Lookup' }] }] };
    evidence = { ...evidence, mode: 'native-gemini-video-metadata-json', originalBody: original, serializedBody: JSON.stringify(original) };
    expect((await fetchProxy(url, options(), saved(), { singlePost: true, geminiTransport: evidence })).ok).toBe(true); expect(nativeFetch).toHaveBeenCalledTimes(1);
    for (const change of [value => { delete value.originalBody; }, value => { value.originalBody.contents[0].parts[1].videoMetadata.fps = 2; }, value => { value.originalBody.contents[0].parts[1].videoMetadata.endOffset = '2s'; }, value => { value.originalBody.contents[0].parts[1].inlineData.data = 'YQ=='; }, value => { delete value.originalBody.tools; },
      value => { value.mode = 'native-gemini-video-json'; }, value => { value.mode = 'native-gemini-audio-json'; }, value => { value.mode = 'native-gemini-inline-json'; }, value => { value.mode = 'native-gemini-client-json'; }, value => { value.mode = 'native-gemini-json'; },
      value => { const absent = structuredClone(original); delete absent.contents[0].parts[1].videoMetadata; value.originalBody = absent; value.serializedBody = JSON.stringify(absent); },
      value => { const bad = structuredClone(original); bad.contents[0].parts[1].videoMetadata.startOffset = '2s'; value.originalBody = bad; value.serializedBody = JSON.stringify(bad); }]) {
      const value = structuredClone(evidence); change(value); nativeFetch.mockClear(); fixture.create.mockClear();
      await expect(fetchProxy(url, { ...options(), body: value.serializedBody }, saved(), { singlePost: true, geminiTransport: value })).rejects.toThrow();
      expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
    }
  });
  it('resolution mode binds full Part and generation controls with optional metadata, not old-mode inheritance or projection erasure', async () => {
    const original = { contents: [{ role: 'user', parts: [{ text: 'fixture' }, { inlineData: { mimeType: 'video/mp4', data: 'b3BhcXVl' }, mediaResolution: { level: 'MEDIA_RESOLUTION_ULTRA_HIGH' }, videoMetadata: { fps: 24, endOffset: '1s' } }] }], generationConfig: { mediaResolution: 'MEDIA_RESOLUTION_HIGH' }, tools: [{ functionDeclarations: [{ name: 'lookup', description: 'Lookup' }] }] };
    evidence = { ...evidence, mode: 'native-gemini-video-resolution-json', originalBody: original, serializedBody: JSON.stringify(original) };
    expect((await fetchProxy(url, options(), saved(), { singlePost: true, geminiTransport: evidence })).ok).toBe(true); expect(nativeFetch).toHaveBeenCalledTimes(1);
    for (const change of [value => { delete value.originalBody; }, value => { value.originalBody.contents[0].parts[1].mediaResolution.level = 'MEDIA_RESOLUTION_LOW'; }, value => { value.originalBody.generationConfig.mediaResolution = 'MEDIA_RESOLUTION_LOW'; }, value => { value.originalBody.contents[0].parts[1].videoMetadata.fps = 2; }, value => { delete value.originalBody.tools; },
      value => { value.mode = 'native-gemini-video-metadata-json'; }, value => { value.mode = 'native-gemini-video-json'; }, value => { value.mode = 'native-gemini-json'; },
      value => { const absent = structuredClone(original); delete absent.contents[0].parts[1].mediaResolution; delete absent.generationConfig.mediaResolution; value.originalBody = absent; value.serializedBody = JSON.stringify(absent); },
      value => { const bad = structuredClone(original); bad.generationConfig.mediaResolution = 'MEDIA_RESOLUTION_ULTRA_HIGH'; value.originalBody = bad; value.serializedBody = JSON.stringify(bad); }]) {
      const value = structuredClone(evidence); change(value); nativeFetch.mockClear(); fixture.create.mockClear();
      await expect(fetchProxy(url, { ...options(), body: value.serializedBody }, saved(), { singlePost: true, geminiTransport: value })).rejects.toThrow(); expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
    }
    const noMetadata = structuredClone(evidence); delete noMetadata.originalBody.contents[0].parts[1].videoMetadata; noMetadata.serializedBody = JSON.stringify(noMetadata.originalBody);
    expect((await fetchProxy(url, { ...options(), body: noMetadata.serializedBody }, saved(), { singlePost: true, geminiTransport: noMetadata })).ok).toBe(true);
  });
  it('inline resolution mode conserves full image/PDF controls; old modes, erased resolution and unrelated source grants cannot dispatch', async () => {
    const original = { contents: [{ role: 'user', parts: [{ text: 'fixture' }, { inlineData: { mimeType: 'image/png', data: 'b3BhcXVl', displayName: 'private image' }, mediaResolution: { level: 'MEDIA_RESOLUTION_ULTRA_HIGH' } }, { inlineData: { mimeType: 'application/pdf', data: 'YQ==' }, mediaResolution: {} }] }], generationConfig: { mediaResolution: 'MEDIA_RESOLUTION_HIGH' }, tools: [{ functionDeclarations: [{ name: 'lookup', description: 'Lookup' }] }] };
    evidence = { ...evidence, mode: 'native-gemini-inline-resolution-json', originalBody: original, serializedBody: JSON.stringify(original) };
    expect((await fetchProxy(url, options(), saved(), { singlePost: true, geminiTransport: evidence })).ok).toBe(true); expect(nativeFetch).toHaveBeenCalledTimes(1);
    for (const change of [value => { delete value.originalBody; }, value => { value.originalBody.contents[0].parts[1].mediaResolution.level = 'MEDIA_RESOLUTION_LOW'; }, value => { value.originalBody.generationConfig.mediaResolution = 'MEDIA_RESOLUTION_LOW'; }, value => { value.originalBody.contents[0].parts[1].inlineData.data = 'Yg=='; }, value => { delete value.originalBody.tools; },
      ...['native-gemini-inline-json', 'native-gemini-client-json', 'native-gemini-video-resolution-json', 'native-gemini-json'].map(mode => value => { value.mode = mode; }),
      value => { const absent = structuredClone(original); for (const part of absent.contents[0].parts) delete part.mediaResolution; delete absent.generationConfig.mediaResolution; value.originalBody = absent; value.serializedBody = JSON.stringify(absent); },
      ...['audio/opus', 'video/mp4'].map(mimeType => value => { const bad = structuredClone(original); for (const part of bad.contents[0].parts) if (part.inlineData) part.inlineData.mimeType = mimeType; value.originalBody = bad; value.serializedBody = JSON.stringify(bad); }),
      value => { const bad = structuredClone(original); bad.generationConfig.mediaResolution = 'MEDIA_RESOLUTION_ULTRA_HIGH'; value.originalBody = bad; value.serializedBody = JSON.stringify(bad); }]) {
      const value = structuredClone(evidence); change(value); nativeFetch.mockClear(); fixture.create.mockClear();
      await expect(fetchProxy(url, { ...options(), body: value.serializedBody }, saved(), { singlePost: true, geminiTransport: value })).rejects.toThrow(); expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
    }
  });
  it('audio resolution mode binds full controls/client/PDF source without granting image/video resolution or old-mode inheritance', async () => {
    const original = { contents: [{ role: 'user', parts: [{ text: 'fixture' }, { inlineData: { mimeType: 'audio/opus', data: 'b3BhcXVl', displayName: 'private audio' }, mediaResolution: { level: 'MEDIA_RESOLUTION_ULTRA_HIGH' } }, { inlineData: { mimeType: 'application/pdf', data: 'YQ==' } }] }], generationConfig: { mediaResolution: 'MEDIA_RESOLUTION_HIGH' }, tools: [{ functionDeclarations: [{ name: 'lookup', description: 'Lookup' }] }] };
    evidence = { ...evidence, mode: 'native-gemini-audio-resolution-json', originalBody: original, serializedBody: JSON.stringify(original) };
    expect((await fetchProxy(url, options(), saved(), { singlePost: true, geminiTransport: evidence })).ok).toBe(true); expect(nativeFetch).toHaveBeenCalledTimes(1);
    for (const change of [value => { delete value.originalBody; }, value => { value.originalBody.contents[0].parts[1].mediaResolution.level = 'MEDIA_RESOLUTION_LOW'; }, value => { value.originalBody.generationConfig.mediaResolution = 'MEDIA_RESOLUTION_LOW'; }, value => { value.originalBody.contents[0].parts[1].inlineData.data = 'Yg=='; }, value => { delete value.originalBody.tools; },
      ...['native-gemini-audio-json', 'native-gemini-client-json', 'native-gemini-inline-resolution-json', 'native-gemini-video-resolution-json', 'native-gemini-json'].map(mode => value => { value.mode = mode; }),
      value => { const absent = structuredClone(original); delete absent.contents[0].parts[1].mediaResolution; delete absent.generationConfig.mediaResolution; value.originalBody = absent; value.serializedBody = JSON.stringify(absent); },
      ...['image/png', 'video/mp4'].map(mimeType => value => { const bad = structuredClone(original); bad.contents[0].parts[1].inlineData.mimeType = mimeType; value.originalBody = bad; value.serializedBody = JSON.stringify(bad); }),
      value => { const bad = structuredClone(original); bad.contents[0].parts[2].mediaResolution = {}; value.originalBody = bad; value.serializedBody = JSON.stringify(bad); },
      value => { const bad = structuredClone(original); bad.generationConfig.mediaResolution = 'MEDIA_RESOLUTION_ULTRA_HIGH'; value.originalBody = bad; value.serializedBody = JSON.stringify(bad); }]) {
      const value = structuredClone(evidence); change(value); nativeFetch.mockClear(); fixture.create.mockClear();
      await expect(fetchProxy(url, { ...options(), body: value.serializedBody }, saved(), { singlePost: true, geminiTransport: value })).rejects.toThrow(); expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
    }
  });
  it('unchanged original native request reaches one strict POST', async () => {
    expect((await fetchProxy(url, options(), saved(), { singlePost: true, geminiTransport: evidence })).ok).toBe(true);
    expect(nativeFetch).toHaveBeenCalledTimes(1); expect(fixture.create).toHaveBeenCalledTimes(1);
  });
  it.each(['url', 'body', 'mode', 'tools', 'header', 'registry', 'model', 'action'])('invalid %s refuses before dispatcher and POST', async kind => {
    const input = options(); let target = url;
    if (kind === 'url') target = 'https://dummy-upstream.invalid/generateContent';
    if (kind === 'body') input.body = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'different' }] }] });
    if (kind === 'mode') evidence.mode = 'native-responses-sse';
    if (kind === 'tools') { evidence.serializedBody = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'fixture' }] }], tools: [{}] }); input.body = evidence.serializedBody; }
    if (kind === 'header') input.headers.Authorization = 'Bearer dummy-foreign';
    if (kind === 'registry') fixture.headers = { 'Authorization': 'Bearer dummy-foreign' };
    if (kind === 'model') evidence.model = '../foreign';
    if (kind === 'action') target = url.replace(':generateContent', ':streamGenerateContent?alt=sse');
    await expect(fetchProxy(target, input, saved(), { singlePost: true, geminiTransport: evidence })).rejects.toThrow('Accounting Gemini transport unavailable');
    expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
  });
  it('registry drift while acquiring dispatcher refuses POST without route reselection', async () => {
    fixture.create.mockImplementation(() => { fixture.headers = { 'Accept': 'application/json' }; });
    await expect(fetchProxy(url, options(), saved(), { singlePost: true, geminiTransport: evidence })).rejects.toThrow('Accounting Gemini transport unavailable');
    expect(fixture.create).toHaveBeenCalledTimes(1); expect(nativeFetch).not.toHaveBeenCalled();
  });
  it('postyield actual body drift refuses despite detached original evidence', async () => {
    const input = options();
    fixture.create.mockImplementation(() => { evidence.serializedBody = 'mutated'; input.body = 'mutated'; });
    await expect(fetchProxy(url, input, saved(), { singlePost: true, geminiTransport: evidence })).rejects.toThrow('Accounting Gemini transport unavailable');
    expect(nativeFetch).not.toHaveBeenCalled();
  });
});
