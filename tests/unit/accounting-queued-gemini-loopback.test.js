import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedGeminiAccountingFixture } from './fixtures/accounting-gemini-db.js';

const fixture = vi.hoisted(() => ({ base: null }));
// Test-only route authority replaces both fixed candidate constant and registry
// module; native fetch/proxy dispatch remain real. Never mutate real registry.
vi.mock('../../open-sse/config/providers.js', async importOriginal => {
  const original = await importOriginal();
  return { ...original, PROVIDERS: { ...original.PROVIDERS, get gemini() { return { ...original.PROVIDERS.gemini, baseUrl: fixture.base }; } } };
});
vi.mock('../../open-sse/config/accountedGeminiCandidate.js', async importOriginal => {
  const original = await importOriginal();
  return { ...original, get ACCOUNTED_GEMINI_BASE() { return fixture.base; },
    supportsGeminiCandidate(executor, options, url, body, headers) {
      const suffix = `/${options.model}${options.stream ? original.ACCOUNTED_GEMINI_STREAM_ACTION + '?alt=sse' : original.ACCOUNTED_GEMINI_ACTION}`;
      return url === fixture.base + suffix && original.supportsGeminiCandidate(executor, options, original.ACCOUNTED_GEMINI_BASE + suffix, body, headers);
    } };
});
vi.mock('../../src/lib/db/engineAcquisition.js', async importOriginal => {
  const original = await importOriginal();
  return process.env.ACCOUNTING_TEST_SQLJS === '1' ? { ...original, initializeAvailableAdapter: async () => null } : original;
});
let db, directory, server, requests, failure, responder, DefaultExecutor, createAccounting;
const old = process.env.DATA_DIR;
const message = { modelVersion: 'fixture-gemini', candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'answer' }] } }],
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 130, cachedContentTokenCount: 40, thoughtsTokenCount: 10 } };
const options = accounting => ({ model: 'fixture-gemini', stream: false, body: { model: 'fixture-gemini', stream: false, contents: [{ role: 'user', parts: [{ text: 'fixture' }] }] },
  credentials: { apiKey: 'dummy-provider' }, connectionId: 'c', accountingMode: 'native-gemini-json', accounting,
  proxyOptions: { persistedGlobalProxy: { url: 'http://127.0.0.1:1', noProxy: '127.0.0.1' } } });
const clientOptions = (accounting, live = true) => {
  const args = options(accounting); args.stream = args.body.stream = live;
  args.accountingMode = live ? 'native-gemini-client-sse' : 'native-gemini-client-json';
  args.body.tools = [{ functionDeclarations: [{ name: 'lookup', description: 'Private client lookup', parameters: { type: 'OBJECT' } }] }];
  return args;
};
const inlineRates = () => ({ input: '1', output: '2', cached: '0.1', input_image: '3', cached_image: '0.2', input_document: '4', cached_document: '0.3' });
const saveInlineRates = (rates = inlineRates()) => db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='gemini'", [JSON.stringify({ 'fixture-gemini': rates })]));
const inlineOptions = (accounting, live = true, mimeType = 'image/png') => {
  const args = options(accounting); args.stream = args.body.stream = live; args.accountingMode = live ? 'native-gemini-inline-sse' : 'native-gemini-inline-json';
  args.body.contents[0].parts.push({ inlineData: { mimeType, data: 'b3BhcXVl', displayName: 'private media' } }); return args;
};
const inlineMessage = (modality = 'IMAGE') => {
  const raw = structuredClone(message); raw.usageMetadata.promptTokensDetails = [{ modality: 'TEXT', tokenCount: 30 }, { modality, tokenCount: 70 }];
  raw.usageMetadata.cacheTokensDetails = [{ modality: 'TEXT', tokenCount: 10 }, { modality, tokenCount: 30 }]; return raw;
};
const audioRates = () => ({ ...inlineRates(), input_audio: '7', cached_audio: '0.4' });
const audioOptions = (accounting, live = true) => {
  const args = inlineOptions(accounting, live, 'audio/wav'); args.accountingMode = live ? 'native-gemini-audio-sse' : 'native-gemini-audio-json'; return args;
};
const audioResolutionOptions = (accounting, live = true, mimeType = 'audio/wav') => {
  const args = audioOptions(accounting, live); args.accountingMode = live ? 'native-gemini-audio-resolution-sse' : 'native-gemini-audio-resolution-json';
  args.body.contents[0].parts[1].inlineData.mimeType = mimeType;
  args.body.contents[0].parts[1].mediaResolution = { level: 'MEDIA_RESOLUTION_ULTRA_HIGH' };
  args.body.generationConfig = { mediaResolution: 'MEDIA_RESOLUTION_HIGH' }; return args;
};
const videoRates = () => ({ ...audioRates(), input_video: '11', cached_video: '0.5' });
const videoOptions = (accounting, live = true) => {
  const args = inlineOptions(accounting, live, 'video/mp4'); args.accountingMode = live ? 'native-gemini-video-sse' : 'native-gemini-video-json'; return args;
};
const processingOptions = (accounting, live = true) => {
  const args = videoOptions(accounting, live); args.accountingMode = live ? 'native-gemini-video-processing-sse' : 'native-gemini-video-processing-json';
  args.body.contents[0].parts[1].mediaProcessing = 'AGENTIC'; return args;
};
const processingMessage = () => { const raw = inlineMessage('VIDEO'); raw.usageMetadata.toolUsePromptTokenCount = 0; return raw; };
const processingToolRates = () => ({ ...videoRates(), processing_tool_text: '13', processing_tool_image: '17', processing_tool_document: '29', processing_tool_audio: '19', processing_tool_video: '23' });
const processingToolMessage = () => {
  const raw = inlineMessage('VIDEO'); Object.assign(raw.usageMetadata, { toolUsePromptTokenCount: 50, totalTokenCount: 180, toolUsePromptTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'IMAGE', tokenCount: 30 }, { modality: 'AUDIO', tokenCount: 10 }] });
  raw.candidates[0].content.parts = [{ text: 'private thought', thought: true }, { toolCall: { toolType: 'MEDIA_PROCESSING', id: 'load_1', args: { private: 'opaque load' } }, thoughtSignature: 'YQ==' }, { toolResponse: { toolType: 'MEDIA_PROCESSING', id: 'load_1', response: { private: 'opaque result' } }, thoughtSignature: 'Yg==' }, { text: 'answer' }]; return raw;
};
const metadataOptions = (accounting, live = true) => {
  const args = videoOptions(accounting, live); args.accountingMode = live ? 'native-gemini-video-metadata-sse' : 'native-gemini-video-metadata-json';
  args.body.contents[0].parts[1].videoMetadata = { fps: 0.5, startOffset: '0.000000001s', endOffset: '1.000000001s' }; return args;
};
const resolutionOptions = (accounting, live = true) => {
  const args = videoOptions(accounting, live); args.accountingMode = live ? 'native-gemini-video-resolution-sse' : 'native-gemini-video-resolution-json';
  args.body.contents[0].parts[1].mediaResolution = { level: 'MEDIA_RESOLUTION_ULTRA_HIGH' };
  args.body.generationConfig = { mediaResolution: 'MEDIA_RESOLUTION_HIGH' }; return args;
};
const inlineResolutionOptions = (accounting, live = true, mimeType = 'image/png') => {
  const args = inlineOptions(accounting, live, mimeType); args.accountingMode = live ? 'native-gemini-inline-resolution-sse' : 'native-gemini-inline-resolution-json';
  args.body.contents[0].parts[1].mediaResolution = { level: 'MEDIA_RESOLUTION_ULTRA_HIGH' };
  args.body.generationConfig = { mediaResolution: 'MEDIA_RESOLUTION_HIGH' }; return args;
};
const clientMessage = () => { const raw = structuredClone(message); raw.candidates[0].content.parts = [{ functionCall: { id: 'current_call', name: 'lookup', args: { q: 'private query' } }, thoughtSignature: 'b3BhcXVl' }]; return raw; };
beforeEach(async () => {
  const started = performance.now();
  const stage = name => { if (process.env.ACCOUNTING_TEST_SETUP_TRACE === '1') console.info('Gemini loopback cold setup', name, Math.round(performance.now() - started)); };
  stage('start');
  vi.resetModules(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-native-gemini-')); process.env.DATA_DIR = directory; delete global._dbAdapter;
  stage('disposable-directory');
  db = await (await import('@/lib/db/driver.js')).getAdapter(); stage('adapter-acquired');
  if (process.env.ACCOUNTING_TEST_SQLJS === '1') expect(db.driver).toBe('sql.js');
  seedGeminiAccountingFixture(db, true);
  stage('fixture-priced');
  requests = []; failure = null;
  responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(message)); };
  server = http.createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      requests.push({ method: request.method, key: request.headers['x-goog-api-key'], url: request.url, body: JSON.parse(Buffer.concat(chunks).toString()), row: db.get('SELECT requestId,state FROM apiKeyAccounting') });
      await responder(request, response);
    } catch (error) { failure = error; response.writeHead(500, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: 'fixture failure' })); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  stage('loopback-listening');
  fixture.base = `http://127.0.0.1:${server.address().port}/v1beta/models`;
  ({ DefaultExecutor } = await import('open-sse/executors/default.js')); stage('executor-imported');
  createAccounting = () => import('@/lib/apiKeyBudget/requestAccounting.js').then(({ createRequestAccounting }) => createRequestAccounting(
    new Request('http://localhost/v1beta/models/gemini/fixture-gemini:generateContent', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true }));
});
afterEach(async () => {
  server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve));
  vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true });
  if (old === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = old;
});
describe('native HTTP Gemini queued original authority (test modules only, not TLS/OAuth/envelopes)', { timeout: 20000 }, () => {
  it.each(['json', 'sse-cross-frame', 'mixed-client-pdf', 'missing-details', 'erased-evidence', 'erased-evidence-json', 'lost-ack'])('processing-tools queued %s preserves whole history/POST, independent original loaded-token prices and own terminal ACK', async mode => {
    const json = mode === 'json' || mode === 'erased-evidence-json', valid = ['json', 'sse-cross-frame', 'mixed-client-pdf'].includes(mode);
    saveInlineRates(processingToolRates()); const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, completeAttempt: vi.fn(async (attempt, completion) => {
      if (mode.startsWith('erased-evidence') && completion.usage) { completion = structuredClone(completion); delete completion.usage.processingToolModalities; }
      const terminal = await context.completeAttempt(attempt, completion); enter(); if (valid) await held; if (mode === 'lost-ack') throw new Error('fixture processing tool ACK lost'); return terminal;
    }) };
    const args = processingOptions(accounting, !json), raw = processingToolMessage(); args.accountingMode = json ? 'native-gemini-processing-tools-json' : 'native-gemini-processing-tools-sse';
    const oldCall = structuredClone(raw.candidates[0].content.parts[1]), oldResult = structuredClone(raw.candidates[0].content.parts[2]); oldCall.toolCall.id = oldResult.toolResponse.id = 'old_load';
    args.body.contents.push({ role: 'model', parts: [oldCall, oldResult, { text: 'private prior answer' }] }, { role: 'user', parts: [{ text: 'private follow up' }] });
    if (mode === 'mixed-client-pdf') {
      args.body.tools = clientOptions(accounting).body.tools; args.body.toolConfig = { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['lookup'] } };
      args.body.contents[0].parts[1].videoMetadata = { fps: 24, endOffset: '1s' }; args.body.contents[0].parts[1].mediaResolution = { level: 'MEDIA_RESOLUTION_LOW' }; args.body.generationConfig = { mediaResolution: 'MEDIA_RESOLUTION_HIGH' };
      args.body.contents[0].parts.push({ inlineData: { mimeType: 'application/pdf', data: 'YQ==', displayName: 'private pdf' } });
      args.body.contents.push({ role: 'model', parts: [{ functionCall: { id: 'old_client', name: 'lookup', args: { q: 'private' } }, thoughtSignature: 'Yw==' }] }, { role: 'user', parts: [{ functionResponse: { id: 'old_client', name: 'lookup', response: { error: 'private result' } } }] });
      raw.candidates[0].content.parts.push(clientMessage().candidates[0].content.parts[0]);
      raw.usageMetadata.promptTokensDetails[1].tokenCount = 60; raw.usageMetadata.promptTokensDetails.push({ modality: 'DOCUMENT', tokenCount: 10 }); raw.usageMetadata.cacheTokensDetails[1].tokenCount = 20; raw.usageMetadata.cacheTokensDetails.push({ modality: 'DOCUMENT', tokenCount: 10 });
      raw.usageMetadata.toolUsePromptTokensDetails = [{ modality: 'DOCUMENT', tokenCount: 50 }];
    }
    if (mode === 'missing-details') delete raw.usageMetadata.toolUsePromptTokensDetails;
    const original = structuredClone(args.body), cost = mode === 'mixed-client-pdf' ? 1984000 : 1366000; let price;
    let text = `data: ${JSON.stringify(raw)}\n\n`;
    if (mode === 'sse-cross-frame') {
      const early = processingToolMessage(); delete early.candidates[0].finishReason; early.candidates[0].content.parts = [early.candidates[0].content.parts[1]]; early.usageMetadata.toolUsePromptTokenCount = 0; early.usageMetadata.toolUsePromptTokensDetails = []; early.usageMetadata.totalTokenCount = 130;
      const terminal = structuredClone(raw); terminal.candidates[0].content.parts.splice(1, 1); text = `data: ${JSON.stringify(early)}\n\ndata: ${JSON.stringify(terminal)}\n\n`;
    }
    responder = (_request, response) => {
      price = JSON.parse(db.get('SELECT priceSnapshotJson FROM apiKeyAccounting').priceSnapshotJson); const drift = processingToolRates(); for (const field of Object.keys(drift)) drift[field] = '100'; saveInlineRates(drift);
      response.writeHead(200, { 'content-type': json ? 'application/json' : 'text/event-stream' }); response.end(json ? JSON.stringify(raw) : text);
    };
    let ended = false; const consume = new DefaultExecutor('gemini').execute(args).then(result => result.response.text()); consume.then(() => { ended = true; }, () => { ended = true; });
    if (valid) {
      try { await Promise.race([entered, consume.then(() => { throw new Error('processing tool success before own ACK'); })]); expect(ended).toBe(false); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: cost }); } finally { release(); }
      if (json) expect(JSON.parse(await consume)).toEqual(raw); else expect(await consume).toBe(text);
    } else { await expect(consume).rejects.toThrow('Gateway accounting stream unavailable'); await entered; }
    const { model: _model, stream: _stream, ...wire } = original; expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(wire); expect(requests[0].row).toEqual({ requestId: context.requestId, state: 'pending' }); expect(requests[0].key).toBe('dummy-provider');
    const allowed = ['TEXT', 'VIDEO', 'IMAGE', 'AUDIO', ...(mode === 'mixed-client-pdf' ? ['DOCUMENT'] : [])];
    expect(price).toMatchObject({ rates: processingToolRates(), usageSemantics: { inputModalities: 'observed_gemini_inline_input_modalities', allowedInputModalities: allowed, videoProcessingToolPrompt: 'observed_gemini_video_processing_tool_prompt_modalities', allowedProcessingToolModalities: allowed } });
    for (const field of Object.keys(processingToolRates()).filter(key => key.startsWith('processing_tool_'))) expect(price.rateUnits[field]).toBe('USD/1M tokens');
    const unresolved = ['missing-details', 'erased-evidence', 'erased-evidence-json'].includes(mode), row = db.get('SELECT state,costNanoUsd,usageJson,priceSnapshotJson FROM apiKeyAccounting'); expect(row).toMatchObject({ state: unresolved ? 'unresolved' : 'settled', costNanoUsd: unresolved ? null : cost });
    if (!unresolved) expect(JSON.parse(row.usageJson)).toMatchObject({ input: 100, cacheRead: 40, processingToolPromptTokens: 50, processingToolModalities: mode === 'mixed-client-pdf' ? { DOCUMENT: 50 } : { TEXT: 10, IMAGE: 30, AUDIO: 10 }, provenance: { videoProcessingToolPrompt: 'observed_gemini_video_processing_tool_prompt_modalities' } });
    expect(JSON.stringify(row)).not.toMatch(/private|opaque|b3BhcXVl|dummy-provider|load_1|old_load|old_client|current_call|MEDIA_PROCESSING|AGENTIC/); expect(args.body).toEqual(original); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(failure).toBeNull();
  });
  it.each([0, 50])('processing-tools bare original retains observed terminal tool-prompt %s with typed evidence; history permission is not required before the first trace', async count => {
    saveInlineRates(processingToolRates()); const context = await createAccounting(), args = processingOptions(context, false), raw = processingToolMessage(); args.accountingMode = 'native-gemini-processing-tools-json';
    if (count === 0) { raw.usageMetadata.toolUsePromptTokenCount = 0; raw.usageMetadata.toolUsePromptTokensDetails = []; raw.usageMetadata.totalTokenCount = 130; raw.candidates[0].content.parts = [{ text: 'answer' }]; }
    const original = structuredClone(args.body); responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(raw)); };
    expect(await (await new DefaultExecutor('gemini').execute(args)).response.json()).toEqual(raw); const { model: _model, stream: _stream, ...wire } = original; expect(requests[0].body).toEqual(wire); expect(requests).toHaveLength(1);
    const row = db.get('SELECT state,costNanoUsd,usageJson,priceSnapshotJson FROM apiKeyAccounting'); expect(row).toMatchObject({ state: 'settled', costNanoUsd: count === 0 ? 536000 : 1366000 });
    expect(JSON.parse(row.usageJson)).toMatchObject({ processingToolPromptTokens: count, processingToolModalities: count === 0 ? {} : { TEXT: 10, IMAGE: 30, AUDIO: 10 }, provenance: { videoProcessingToolPrompt: 'observed_gemini_video_processing_tool_prompt_modalities' } });
    expect(JSON.parse(row.priceSnapshotJson).usageSemantics).toMatchObject({ videoProcessingToolPrompt: 'observed_gemini_video_processing_tool_prompt_modalities', allowedProcessingToolModalities: ['TEXT', 'VIDEO', 'IMAGE', 'AUDIO'] }); expect(failure).toBeNull();
  });
  it.each(['default-mode', 'zero-only-mode', 'video-mode', 'no-processing', 'no-video', 'orphan-history', 'foreign-history', 'remote-resource', 'getter', 'credential-drift', 'missing-tool-text', 'missing-tool-video', 'missing-tool-image', 'missing-tool-audio', 'pdf-missing-tool-document', 'missing-initial-video', 'pdf-resolution', 'generation-ultra', 'processing-options'])('processing-tools pre-intent %s refuses before POST/intent even unlimited', async mode => {
    saveInlineRates(processingToolRates()); const context = await createAccounting(), getter = vi.fn();
    const accounting = { ...context, beforeAttempt(...input) { const work = context.beforeAttempt(...input); if (mode === 'credential-drift') db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']); db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(row.data), apiKey: 'dummy-new' }), 'c']); }); return work; } };
    const args = processingOptions(accounting), part = args.body.contents[0].parts[1], rates = processingToolRates(); args.accountingMode = 'native-gemini-processing-tools-sse';
    const history = processingToolMessage().candidates[0].content; args.body.contents.push(history, { role: 'user', parts: [{ text: 'follow up' }] });
    if (mode === 'default-mode') args.accountingMode = 'native-gemini-sse'; if (mode === 'zero-only-mode') args.accountingMode = 'native-gemini-video-processing-sse'; if (mode === 'video-mode') args.accountingMode = 'native-gemini-video-sse';
    if (mode === 'no-processing') delete part.mediaProcessing; if (mode === 'no-video') part.inlineData.mimeType = 'image/png';
    if (mode === 'orphan-history') history.parts.splice(2, 1); if (mode === 'foreign-history') history.parts[1].toolCall.toolType = 'GOOGLE_SEARCH_WEB';
    if (mode === 'remote-resource') { delete part.inlineData; part.fileData = { mimeType: 'video/mp4', fileUri: 'files/private' }; }
    if (mode === 'getter') Object.defineProperty(history.parts[1].toolCall, 'args', { enumerable: true, get: getter });
    const missing = { 'missing-tool-text': 'processing_tool_text', 'missing-tool-video': 'processing_tool_video', 'missing-tool-image': 'processing_tool_image', 'missing-tool-audio': 'processing_tool_audio', 'pdf-missing-tool-document': 'processing_tool_document', 'missing-initial-video': 'cached_video' };
    if (Object.hasOwn(missing, mode)) { if (mode === 'pdf-missing-tool-document') args.body.contents[0].parts.push({ inlineData: { mimeType: 'application/pdf', data: 'YQ==' } }); delete rates[missing[mode]]; saveInlineRates(rates); }
    if (mode === 'pdf-resolution') args.body.contents[0].parts.push({ inlineData: { mimeType: 'application/pdf', data: 'YQ==' }, mediaResolution: {} });
    if (mode === 'generation-ultra') args.body.generationConfig = { mediaResolution: 'MEDIA_RESOLUTION_ULTRA_HIGH' }; if (mode === 'processing-options') args.body.processing_options = {};
    const work = new DefaultExecutor('gemini').execute(args); if (Object.hasOwn(missing, mode)) await expect(work).rejects.toMatchObject({ code: 'model_pricing_unavailable' }); else await expect(work).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled(); expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(failure).toBeNull();
  });
  it('processing-tools all explicit zero prices preserve observed nonzero initial/tool quantities and full trace bytes without guessing free fees', async () => {
    const rates = processingToolRates(); for (const field of Object.keys(rates)) rates[field] = '0'; saveInlineRates(rates); const context = await createAccounting(), args = processingOptions(context, false), raw = processingToolMessage(); args.accountingMode = 'native-gemini-processing-tools-json';
    raw.candidates[0].content.parts.splice(3, 0, { toolCall: { toolType: 'MEDIA_PROCESSING', args: { opaque: 'x'.repeat(1000) } } }, { toolResponse: { toolType: 'MEDIA_PROCESSING' } });
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(raw)); };
    expect(await (await new DefaultExecutor('gemini').execute(args)).response.json()).toEqual(raw); expect(requests).toHaveLength(1);
    const row = db.get('SELECT state,costNanoUsd,usageJson FROM apiKeyAccounting'); expect(row).toMatchObject({ state: 'settled', costNanoUsd: 0 }); expect(JSON.parse(row.usageJson)).toMatchObject({ inputModalities: { VIDEO: { input: 70, cacheRead: 30 } }, processingToolPromptTokens: 50, processingToolModalities: { TEXT: 10, IMAGE: 30, AUDIO: 10 } }); expect(failure).toBeNull();
  });
  it.each(['unclean-eof', 'orphan-terminal', 'sink-exception', 'early-zero-terminal-missing', 'missing-terminal-count'])('processing-tools terminal %s cannot deliver success or fill absent terminal evidence', async mode => {
    saveInlineRates(processingToolRates()); const context = await createAccounting(), accounting = { ...context, completeAttempt: vi.fn((...input) => { if (mode === 'sink-exception') throw new Error('fixture processing tools sink'); return context.completeAttempt(...input); }) };
    const args = processingOptions(accounting), raw = processingToolMessage(); args.accountingMode = 'native-gemini-processing-tools-sse'; let prefix = '';
    if (mode === 'unclean-eof') delete raw.candidates[0].finishReason; if (mode === 'orphan-terminal') raw.candidates[0].content.parts.splice(2, 1);
    if (mode === 'early-zero-terminal-missing') { const early = processingToolMessage(); delete early.candidates[0].finishReason; early.candidates[0].content.parts = [early.candidates[0].content.parts[1]]; early.usageMetadata.toolUsePromptTokenCount = 0; early.usageMetadata.toolUsePromptTokensDetails = []; early.usageMetadata.totalTokenCount = 130; prefix = `data: ${JSON.stringify(early)}\n\n`; raw.candidates[0].content.parts.splice(1, 1); delete raw.usageMetadata.toolUsePromptTokensDetails; }
    if (mode === 'missing-terminal-count') delete raw.usageMetadata.toolUsePromptTokenCount;
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(prefix + `data: ${JSON.stringify(raw)}\n\n`); };
    const result = await new DefaultExecutor('gemini').execute(args); await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable'); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(requests).toHaveLength(1);
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: mode === 'sink-exception' ? 'pending' : 'unresolved', costNanoUsd: null }); expect(failure).toBeNull();
  });
  it('processing-tools fresh full server-trace/client-result successor binds new independent rates and own intent ACK before POST2', async () => {
    saveInlineRates(processingToolRates()); const context = await createAccounting(), executor = new DefaultExecutor('gemini'), first = processingOptions(context, false), raw = processingToolMessage(); first.accountingMode = 'native-gemini-processing-tools-json'; first.body.tools = clientOptions(context).body.tools; raw.candidates[0].content.parts.push(clientMessage().candidates[0].content.parts[0]);
    const secondRaw = processingToolMessage(); secondRaw.candidates[0].content.parts[1].toolCall.id = secondRaw.candidates[0].content.parts[2].toolResponse.id = 'load_2'; let successorAttemptId = null, successorRowAtPost = null;
    responder = (_request, response) => {
      if (requests.length === 2) successorRowAtPost = db.get('SELECT requestId,state FROM apiKeyAccounting WHERE attemptId=?', [successorAttemptId]);
      response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(requests.length === 1 ? raw : secondRaw));
    };
    expect(await (await executor.execute(first)).response.json()).toEqual(raw); expect(requests).toHaveLength(1); saveInlineRates({ ...processingToolRates(), input_video: '13', processing_tool_image: '18' }); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, async beforeAttempt(...input) { const attempt = await context.beforeAttempt(...input); successorAttemptId = attempt.attemptId; enter(); await held; return attempt; } };
    const next = processingOptions(accounting, false); next.accountingMode = 'native-gemini-processing-tools-json'; next.body.tools = first.body.tools; next.body.contents[0].parts[1].mediaProcessing = 'STATIC'; next.body.contents[0].parts[1].videoMetadata = { fps: 24, endOffset: '1s' }; next.body.contents[0].parts[1].mediaResolution = { level: 'MEDIA_RESOLUTION_LOW' }; next.body.generationConfig = { mediaResolution: 'MEDIA_RESOLUTION_MEDIUM' };
    next.body.contents.push(structuredClone(raw.candidates[0].content), { role: 'user', parts: [{ functionResponse: { id: 'current_call', name: 'lookup', response: { error: 'private client result' } } }] }); const original = structuredClone(next.body);
    const work = executor.execute(next); try { await Promise.race([entered, work.then(() => { throw new Error('POST2 before own intent ACK'); })]); expect(requests).toHaveLength(1); expect(db.all('SELECT state FROM apiKeyAccounting')).toHaveLength(2); } finally { release(); }
    expect(await (await work).response.json()).toEqual(secondRaw); const { model: _model, stream: _stream, ...wire } = original; expect(requests[1].body).toEqual(wire); expect(successorAttemptId).toEqual(expect.any(String)); expect(successorRowAtPost).toEqual({ requestId: context.requestId, state: 'pending' });
    const rows = db.all('SELECT attemptId,requestId,state,costNanoUsd,usageJson,priceSnapshotJson FROM apiKeyAccounting ORDER BY rowid'); expect(rows[1].attemptId).toBe(successorAttemptId); expect(rows.map(row => row.costNanoUsd)).toEqual([1366000, 1476000]); expect(new Set(rows.map(row => row.attemptId)).size).toBe(2); expect(rows.every(row => row.state === 'settled' && row.requestId === context.requestId)).toBe(true);
    expect(JSON.parse(rows[0].priceSnapshotJson).rates.processing_tool_image).toBe('17'); expect(JSON.parse(rows[1].priceSnapshotJson).rates.processing_tool_image).toBe('18'); expect(JSON.stringify(rows)).not.toMatch(/private|load_1|load_2|current_call|dummy-provider|b3BhcXVl|MEDIA_PROCESSING|AGENTIC|STATIC|videoMetadata|mediaResolution/); expect(next.body).toEqual(original); expect(failure).toBeNull();
  });
  it.each(['json-static', 'sse-agentic', 'frame-audio', 'mixed-client-pdf', 'missing-details', 'missing-tool-zero', 'nonzero-tool', 'erased-evidence', 'erased-evidence-json', 'lost-ack'])('video-processing queued %s owns full processing POST, retained explicit zero, original price and own ACK', async mode => {
    const json = mode === 'json-static' || mode === 'erased-evidence-json';
    saveInlineRates(videoRates()); const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const valid = ['json-static', 'sse-agentic', 'frame-audio', 'mixed-client-pdf'].includes(mode);
    const accounting = { ...context, completeAttempt: vi.fn(async (attempt, completion) => {
      if (mode.startsWith('erased-evidence') && completion.usage) { completion = structuredClone(completion); delete completion.usage.processingToolPromptTokens; delete completion.usage.provenance.videoProcessingToolPrompt; }
      const terminal = await context.completeAttempt(attempt, completion); enter(); if (valid) await held; if (mode === 'lost-ack') throw new Error('fixture processing ACK lost'); return terminal;
    }) };
    const args = videoOptions(accounting, !json), raw = inlineMessage('VIDEO'); raw.usageMetadata.toolUsePromptTokenCount = 0;
    args.accountingMode = json ? 'native-gemini-video-processing-json' : 'native-gemini-video-processing-sse';
    args.body.contents[0].parts[1].mediaProcessing = json ? 'STATIC' : 'AGENTIC';
    if (mode === 'frame-audio') {
      raw.usageMetadata.promptTokensDetails = [{ modality: 'TEXT', tokenCount: 30 }, { modality: 'IMAGE', tokenCount: 50 }, { modality: 'AUDIO', tokenCount: 20 }];
      raw.usageMetadata.cacheTokensDetails = [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'IMAGE', tokenCount: 20 }, { modality: 'AUDIO', tokenCount: 10 }];
    }
    if (mode === 'mixed-client-pdf') {
      args.body.tools = clientOptions(accounting).body.tools; args.body.toolConfig = { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['lookup'] } };
      args.body.contents[0].parts[1].videoMetadata = { fps: 24, startOffset: '0s', endOffset: '1s' }; args.body.contents[0].parts[1].mediaResolution = { level: 'MEDIA_RESOLUTION_LOW' }; args.body.generationConfig = { mediaResolution: 'MEDIA_RESOLUTION_HIGH' };
      args.body.contents[0].parts.push({ inlineData: { mimeType: 'application/pdf', data: 'YQ==', displayName: 'private pdf' } });
      args.body.contents.push({ role: 'model', parts: [{ functionCall: { id: 'old_call', name: 'lookup', args: { q: 'private old' } }, thoughtSignature: 'b3BhcXVl' }] }, { role: 'user', parts: [{ functionResponse: { id: 'old_call', name: 'lookup', response: { error: 'private old result' } } }] });
      raw.candidates[0].content = clientMessage().candidates[0].content;
      raw.usageMetadata.promptTokensDetails[1].tokenCount = 60; raw.usageMetadata.promptTokensDetails.push({ modality: 'DOCUMENT', tokenCount: 10 });
      raw.usageMetadata.cacheTokensDetails[1].tokenCount = 20; raw.usageMetadata.cacheTokensDetails.push({ modality: 'DOCUMENT', tokenCount: 10 });
    }
    if (mode === 'missing-details') delete raw.usageMetadata.cacheTokensDetails;
    if (mode === 'missing-tool-zero') delete raw.usageMetadata.toolUsePromptTokenCount;
    if (mode === 'nonzero-tool') { raw.usageMetadata.toolUsePromptTokenCount = 1; raw.usageMetadata.totalTokenCount = 131; }
    const original = structuredClone(args.body), text = `data: ${JSON.stringify(raw)}\n\n`, cost = mode === 'frame-audio' ? 249000 : mode === 'mixed-client-pdf' ? 534000 : 536000; let price;
    responder = (_request, response) => {
      price = JSON.parse(db.get('SELECT priceSnapshotJson FROM apiKeyAccounting').priceSnapshotJson); saveInlineRates({ ...videoRates(), input_video: '110', input_document: '40', input_image: '30', input_audio: '70' });
      response.writeHead(200, { 'content-type': json ? 'application/json' : 'text/event-stream' }); response.end(json ? JSON.stringify(raw) : text);
    };
    let ended = false; const consume = new DefaultExecutor('gemini').execute(args).then(result => result.response.text()); consume.then(() => { ended = true; }, () => { ended = true; });
    if (valid) {
      try { await Promise.race([entered, consume.then(() => { throw new Error('processing success before own ACK'); })]); expect(ended).toBe(false); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: cost }); } finally { release(); }
      if (json) expect(JSON.parse(await consume)).toEqual(raw); else expect(await consume).toBe(text);
    } else { await expect(consume).rejects.toThrow('Gateway accounting stream unavailable'); await entered; }
    const { model: _model, stream: _stream, ...wire } = original; expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(wire); expect(requests[0].row).toEqual({ requestId: context.requestId, state: 'pending' }); expect(requests[0].key).toBe('dummy-provider');
    expect(price).toMatchObject({ rates: { input_video: '11', cached_video: '0.5', input_image: '3', cached_image: '0.2', input_audio: '7', cached_audio: '0.4' }, rateUnits: { input_video: 'USD/1M tokens', cached_video: 'USD/1M tokens', input_image: 'USD/1M tokens', cached_image: 'USD/1M tokens', input_audio: 'USD/1M tokens', cached_audio: 'USD/1M tokens' }, usageSemantics: { inputModalities: 'observed_gemini_inline_input_modalities', allowedInputModalities: ['TEXT', 'VIDEO', 'IMAGE', 'AUDIO', ...(mode === 'mixed-client-pdf' ? ['DOCUMENT'] : [])], videoProcessingToolPrompt: 'observed_gemini_video_processing_tool_prompt_zero' } });
    const unresolved = ['missing-details', 'missing-tool-zero', 'nonzero-tool', 'erased-evidence', 'erased-evidence-json'].includes(mode);
    const row = db.get('SELECT state,costNanoUsd,usageJson,priceSnapshotJson FROM apiKeyAccounting'); expect(row).toMatchObject({ state: unresolved ? 'unresolved' : 'settled', costNanoUsd: unresolved ? null : cost });
    if (!unresolved) expect(JSON.parse(row.usageJson)).toMatchObject({ processingToolPromptTokens: 0, provenance: { videoProcessingToolPrompt: 'observed_gemini_video_processing_tool_prompt_zero' } });
    expect(JSON.stringify(row)).not.toMatch(/private|b3BhcXVl|dummy-provider|current_call|old_call|mediaResolution|MEDIA_RESOLUTION|mediaProcessing|AGENTIC|STATIC|videoMetadata|fps/); expect(args.body).toEqual(original); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(failure).toBeNull();
  });
  it.each(['default-mode', 'source-only-video-mode', 'metadata-mode', 'resolution-mode', 'audio-resolution-mode', 'inline-resolution-mode', 'no-processing', 'nonvideo-source', 'object-mode', 'unknown-mode', 'processing-options', 'missing-video-cache', 'missing-unobserved-image', 'missing-unobserved-audio', 'missing-text-cache', 'pdf-missing-document', 'pdf-resolution', 'audio-processing', 'generation-ultra', 'credential-drift', 'getter', 'remote-resource'])('video-processing pre-intent %s refuses without POST/intent even unlimited', async mode => {
    saveInlineRates(videoRates()); const context = await createAccounting(), getter = vi.fn();
    const accounting = { ...context, beforeAttempt(...input) { const work = context.beforeAttempt(...input);
      if (mode === 'credential-drift') db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']); db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(row.data), apiKey: 'dummy-new' }), 'c']); }); return work;
    } };
    const args = processingOptions(accounting), part = args.body.contents[0].parts[1], rates = videoRates();
    const modes = { 'default-mode': 'native-gemini-sse', 'source-only-video-mode': 'native-gemini-video-sse', 'metadata-mode': 'native-gemini-video-metadata-sse', 'resolution-mode': 'native-gemini-video-resolution-sse', 'audio-resolution-mode': 'native-gemini-audio-resolution-sse', 'inline-resolution-mode': 'native-gemini-inline-resolution-sse' };
    if (Object.hasOwn(modes, mode)) args.accountingMode = modes[mode];
    if (mode === 'metadata-mode') part.videoMetadata = { fps: 1 };
    if (mode === 'resolution-mode') part.mediaResolution = {};
    if (mode === 'no-processing') delete part.mediaProcessing;
    if (mode === 'nonvideo-source') part.inlineData.mimeType = 'image/png';
    if (mode === 'object-mode') part.mediaProcessing = { mode: 'AGENTIC' };
    if (mode === 'unknown-mode') part.mediaProcessing = 'AUTOMATIC';
    if (mode === 'processing-options') args.body.processing_options = {};
    const missing = { 'missing-video-cache': 'cached_video', 'missing-unobserved-image': 'cached_image', 'missing-unobserved-audio': 'cached_audio', 'missing-text-cache': 'cached', 'pdf-missing-document': 'cached_document' };
    if (Object.hasOwn(missing, mode)) { if (mode === 'pdf-missing-document') args.body.contents[0].parts.push({ inlineData: { mimeType: 'application/pdf', data: 'YQ==' } }); delete rates[missing[mode]]; saveInlineRates(rates); }
    if (mode === 'pdf-resolution') args.body.contents[0].parts.push({ inlineData: { mimeType: 'application/pdf', data: 'YQ==' }, mediaResolution: {} });
    if (mode === 'audio-processing') args.body.contents[0].parts.push({ inlineData: { mimeType: 'audio/opus', data: 'YQ==' }, mediaProcessing: 'STATIC' });
    if (mode === 'generation-ultra') args.body.generationConfig = { mediaResolution: 'MEDIA_RESOLUTION_ULTRA_HIGH' };
    if (mode === 'getter') Object.defineProperty(part, 'mediaProcessing', { enumerable: true, get: getter });
    if (mode === 'remote-resource') { delete part.inlineData; part.fileData = { mimeType: 'video/mp4', fileUri: 'files/private' }; }
    const work = new DefaultExecutor('gemini').execute(args); if (Object.hasOwn(missing, mode)) await expect(work).rejects.toMatchObject({ code: 'model_pricing_unavailable' }); else await expect(work).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled(); expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(failure).toBeNull();
  });
  it.each(['video/mpeg', 'video/mov', 'video/avi', 'video/x-flv', 'video/mpg', 'video/webm', 'video/wmv', 'video/3gpp'])('video-processing selected %s preserves opaque bytes with observed usage, not processing/frame-derived quantity', async mimeType => {
    saveInlineRates(videoRates()); const context = await createAccounting(), args = processingOptions(context, false), raw = processingMessage();
    args.body.contents[0].parts[1].inlineData.mimeType = mimeType; args.body.contents[0].parts[1].inlineData.data = Buffer.alloc(1000, 1).toString('base64'); const original = structuredClone(args.body);
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(raw)); };
    expect(await (await new DefaultExecutor('gemini').execute(args)).response.json()).toEqual(raw);
    const { model: _model, stream: _stream, ...wire } = original; expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(wire); expect(requests[0].row).toEqual({ requestId: context.requestId, state: 'pending' });
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: 536000 }); expect(JSON.parse(db.get('SELECT usageJson FROM apiKeyAccounting').usageJson)).toMatchObject({ processingToolPromptTokens: 0, inputModalities: { VIDEO: { input: 70, cacheRead: 30 } } }); expect(args.body).toEqual(original); expect(failure).toBeNull();
  });
  it('video-processing source-local STATIC/AGENTIC/UNSPECIFIED/absence keeps ordered controls without defaults or metadata/resolution inference', async () => {
    saveInlineRates(videoRates()); const context = await createAccounting(), args = processingOptions(context, false), raw = processingMessage();
    args.body.contents[0].parts[1].mediaProcessing = 'MEDIA_PROCESSING_UNSPECIFIED';
    args.body.contents[0].parts.push({ inlineData: { mimeType: 'video/mpeg', data: 'YQ==' }, mediaProcessing: 'STATIC', videoMetadata: {} }, { inlineData: { mimeType: 'video/webm', data: 'Yg==' }, mediaProcessing: 'AGENTIC', mediaResolution: {} }, { inlineData: { mimeType: 'video/3gpp', data: 'Yw==' } });
    const original = structuredClone(args.body); responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(raw)); };
    expect(await (await new DefaultExecutor('gemini').execute(args)).response.json()).toEqual(raw);
    const { model: _model, stream: _stream, ...wire } = original; expect(requests[0].body).toEqual(wire); expect(requests).toHaveLength(1); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: 536000 }); expect(args.body).toEqual(original); expect(failure).toBeNull();
  });
  it('video-processing explicit zero rates retain nonzero VIDEO and observed processing tool-prompt zero, not invented free charges', async () => {
    const rates = videoRates(); for (const key of Object.keys(rates)) rates[key] = '0'; saveInlineRates(rates); const raw = processingMessage();
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(raw)); };
    expect(await (await new DefaultExecutor('gemini').execute(processingOptions(await createAccounting(), false))).response.json()).toEqual(raw);
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: 0 }); expect(JSON.parse(db.get('SELECT usageJson FROM apiKeyAccounting').usageJson)).toMatchObject({ inputModalities: { VIDEO: { input: 70, cacheRead: 30 } }, processingToolPromptTokens: 0, provenance: { videoProcessingToolPrompt: 'observed_gemini_video_processing_tool_prompt_zero' } }); expect(requests).toHaveLength(1); expect(failure).toBeNull();
  });
  it.each(['unclean-eof', 'sink-exception', 'early-zero-terminal-missing'])('video-processing terminal %s cannot invent terminal zero or deliver a successful finish', async mode => {
    saveInlineRates(videoRates()); const context = await createAccounting(), accounting = { ...context, completeAttempt: vi.fn((...input) => { if (mode === 'sink-exception') throw new Error('fixture processing sink exception'); return context.completeAttempt(...input); }) };
    const raw = processingMessage(); if (mode === 'unclean-eof') delete raw.candidates[0].finishReason;
    let prefix = ''; if (mode === 'early-zero-terminal-missing') { const early = processingMessage(); delete early.candidates[0].finishReason; prefix = `data: ${JSON.stringify(early)}\n\n`; delete raw.usageMetadata.toolUsePromptTokenCount; }
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(prefix + `data: ${JSON.stringify(raw)}\n\n`); };
    const result = await new DefaultExecutor('gemini').execute(processingOptions(accounting)); await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable');
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(requests).toHaveLength(1); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: mode === 'sink-exception' ? 'pending' : 'unresolved', costNanoUsd: null }); expect(failure).toBeNull();
  });
  it('video-processing full client-result successor binds fresh processing/original price and own intent ACK before POST2', async () => {
    saveInlineRates(videoRates()); const context = await createAccounting(), executor = new DefaultExecutor('gemini'), first = processingOptions(context, false);
    first.body.tools = clientOptions(context).body.tools; const raw = processingMessage(); raw.candidates[0].content = clientMessage().candidates[0].content;
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(requests.length === 1 ? raw : processingMessage())); };
    expect(await (await executor.execute(first)).response.json()).toEqual(raw); expect(requests).toHaveLength(1); saveInlineRates({ ...videoRates(), input_video: '13' }); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, async beforeAttempt(...input) { const attempt = await context.beforeAttempt(...input); enter(); await held; return attempt; } };
    const next = processingOptions(accounting, false); next.body.tools = first.body.tools; next.body.contents[0].parts[1].mediaProcessing = 'STATIC'; next.body.contents[0].parts[1].videoMetadata = { fps: 24, endOffset: '1s' }; next.body.contents[0].parts[1].mediaResolution = { level: 'MEDIA_RESOLUTION_LOW' }; next.body.generationConfig = { mediaResolution: 'MEDIA_RESOLUTION_MEDIUM' };
    next.body.contents.push(structuredClone(raw.candidates[0].content), { role: 'user', parts: [{ functionResponse: { id: 'current_call', name: 'lookup', response: { error: 'private result' } } }] });
    const original = structuredClone(next.body), work = executor.execute(next);
    try { await Promise.race([entered, work.then(() => { throw new Error('processing successor POST before own intent ACK'); })]); expect(requests).toHaveLength(1); expect(db.all('SELECT state FROM apiKeyAccounting ORDER BY rowid')).toEqual([{ state: 'settled' }, { state: 'pending' }]); } finally { release(); }
    expect(await (await work).response.json()).toEqual(processingMessage()); expect(requests).toHaveLength(2); const { model: _model, stream: _stream, ...wire } = original; expect(requests[1].body).toEqual(wire);
    const rows = db.all('SELECT attemptId,requestId,state,costNanoUsd,priceSnapshotJson,usageJson FROM apiKeyAccounting ORDER BY rowid'); expect(rows.map(row => row.costNanoUsd)).toEqual([536000, 616000]); expect(new Set(rows.map(row => row.attemptId)).size).toBe(2);
    expect(rows.every(row => row.requestId === context.requestId && row.state === 'settled')).toBe(true); expect(rows.map(row => JSON.parse(row.priceSnapshotJson).rates.input_video)).toEqual(['11', '13']);
    for (const row of rows) { expect(JSON.parse(row.priceSnapshotJson).usageSemantics.videoProcessingToolPrompt).toBe('observed_gemini_video_processing_tool_prompt_zero'); expect(JSON.parse(row.usageJson).processingToolPromptTokens).toBe(0); }
    expect(JSON.stringify(rows)).not.toMatch(/private|mediaProcessing|AGENTIC|STATIC|videoMetadata|mediaResolution|current_call|b3BhcXVl/); expect(next.body).toEqual(original); expect(failure).toBeNull();
  });
  it.each(['json', 'sse', 'mixed-client-pdf', 'missing-details', 'lost-ack'])('audio-resolution queued %s owns full audio resolution POST, observed original price and own ACK', async mode => {
    saveInlineRates(audioRates()); const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const valid = ['json', 'sse', 'mixed-client-pdf'].includes(mode);
    const accounting = { ...context, completeAttempt: vi.fn(async (...input) => { const terminal = await context.completeAttempt(...input); enter(); if (valid) await held; if (mode === 'lost-ack') throw new Error('fixture audio resolution ACK lost'); return terminal; }) };
    const args = audioOptions(accounting, mode !== 'json'), raw = inlineMessage('AUDIO');
    args.accountingMode = mode === 'json' ? 'native-gemini-audio-resolution-json' : 'native-gemini-audio-resolution-sse';
    args.body.contents[0].parts[1].mediaResolution = { level: mode === 'json' ? 'MEDIA_RESOLUTION_LOW' : 'MEDIA_RESOLUTION_ULTRA_HIGH' };
    args.body.generationConfig = { mediaResolution: 'MEDIA_RESOLUTION_HIGH', maxOutputTokens: 20 };
    if (mode === 'mixed-client-pdf') {
      args.body.tools = clientOptions(accounting).body.tools; args.body.toolConfig = { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['lookup'] } };
      args.body.contents[0].parts.push({ inlineData: { mimeType: 'application/pdf', data: 'YQ==', displayName: 'private pdf' } });
      args.body.contents.push({ role: 'model', parts: [{ functionCall: { id: 'old_call', name: 'lookup', args: { q: 'private old' } }, thoughtSignature: 'b3BhcXVl' }] }, { role: 'user', parts: [{ functionResponse: { id: 'old_call', name: 'lookup', response: { error: 'private old result' } } }] });
      raw.candidates[0].content = clientMessage().candidates[0].content;
      raw.usageMetadata.promptTokensDetails[1].tokenCount = 60; raw.usageMetadata.promptTokensDetails.push({ modality: 'DOCUMENT', tokenCount: 10 });
      raw.usageMetadata.cacheTokensDetails[1].tokenCount = 20; raw.usageMetadata.cacheTokensDetails.push({ modality: 'DOCUMENT', tokenCount: 10 });
    }
    if (mode === 'missing-details') delete raw.usageMetadata.cacheTokensDetails;
    const original = structuredClone(args.body), text = `data: ${JSON.stringify(raw)}\n\n`, cost = mode === 'mixed-client-pdf' ? 372000 : 373000; let price;
    responder = (_request, response) => {
      price = JSON.parse(db.get('SELECT priceSnapshotJson FROM apiKeyAccounting').priceSnapshotJson); saveInlineRates({ ...audioRates(), input_audio: '70', input_document: '40' });
      response.writeHead(200, { 'content-type': mode === 'json' ? 'application/json' : 'text/event-stream' }); response.end(mode === 'json' ? JSON.stringify(raw) : text);
    };
    let ended = false; const consume = new DefaultExecutor('gemini').execute(args).then(result => result.response.text()); consume.then(() => { ended = true; }, () => { ended = true; });
    if (valid) {
      try { await Promise.race([entered, consume.then(() => { throw new Error('audio resolution success before own ACK'); })]); expect(ended).toBe(false); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: cost }); } finally { release(); }
      if (mode === 'json') expect(JSON.parse(await consume)).toEqual(raw); else expect(await consume).toBe(text);
    } else { await expect(consume).rejects.toThrow('Gateway accounting stream unavailable'); await entered; }
    const { model: _model, stream: _stream, ...wire } = original; expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(wire); expect(requests[0].row).toEqual({ requestId: context.requestId, state: 'pending' }); expect(requests[0].key).toBe('dummy-provider');
    expect(price).toMatchObject({ rates: { input_audio: '7', cached_audio: '0.4' }, rateUnits: { input_audio: 'USD/1M tokens', cached_audio: 'USD/1M tokens' }, usageSemantics: { inputModalities: 'observed_gemini_inline_input_modalities', allowedInputModalities: ['TEXT', 'AUDIO', ...(mode === 'mixed-client-pdf' ? ['IMAGE', 'DOCUMENT'] : [])] } });
    if (mode === 'mixed-client-pdf') expect(price).toMatchObject({ rates: { input_document: '4', cached_document: '0.3', input_image: '3', cached_image: '0.2' }, rateUnits: { input_document: 'USD/1M tokens', cached_document: 'USD/1M tokens', input_image: 'USD/1M tokens', cached_image: 'USD/1M tokens' } });
    const row = db.get('SELECT state,costNanoUsd,usageJson,priceSnapshotJson FROM apiKeyAccounting'); expect(row).toMatchObject({ state: mode === 'missing-details' ? 'unresolved' : 'settled', costNanoUsd: mode === 'missing-details' ? null : cost });
    if (mode !== 'missing-details') expect(JSON.parse(row.usageJson).inputModalities).toEqual(Object.fromEntries(raw.usageMetadata.promptTokensDetails.map(({ modality, tokenCount }) => [modality, { input: tokenCount, cacheRead: raw.usageMetadata.cacheTokensDetails.find(item => item.modality === modality)?.tokenCount ?? 0 }])));
    expect(JSON.stringify(row)).not.toMatch(/private|b3BhcXVl|dummy-provider|current_call|old_call|mediaResolution|MEDIA_RESOLUTION/); expect(args.body).toEqual(original); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(failure).toBeNull();
  });
  it.each(['default-mode', 'source-only-audio-mode', 'inline-resolution-mode', 'video-resolution-mode', 'no-resolution', 'image-source', 'video-source', 'unknown-part-level', 'generation-ultra', 'missing-audio-cache', 'missing-text-cache', 'pdf-missing-unobserved-image', 'pdf-missing-document', 'pdf-resolution', 'credential-drift', 'getter', 'processing-mode', 'remote-resource'])('audio-resolution pre-intent %s refuses without POST or intent even unlimited', async mode => {
    saveInlineRates(audioRates()); const context = await createAccounting(), getter = vi.fn();
    const accounting = { ...context, beforeAttempt(...input) { const work = context.beforeAttempt(...input);
      if (mode === 'credential-drift') db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']); db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(row.data), apiKey: 'dummy-new' }), 'c']); }); return work;
    } };
    const args = audioResolutionOptions(accounting), part = args.body.contents[0].parts[1], rates = audioRates();
    if (mode === 'default-mode') args.accountingMode = 'native-gemini-sse';
    if (mode === 'source-only-audio-mode') args.accountingMode = 'native-gemini-audio-sse';
    if (mode === 'inline-resolution-mode') args.accountingMode = 'native-gemini-inline-resolution-sse';
    if (mode === 'video-resolution-mode') args.accountingMode = 'native-gemini-video-resolution-sse';
    if (mode === 'no-resolution') { delete part.mediaResolution; delete args.body.generationConfig.mediaResolution; }
    if (mode === 'image-source') part.inlineData.mimeType = 'image/png';
    if (mode === 'video-source') part.inlineData.mimeType = 'video/mp4';
    if (mode === 'unknown-part-level') part.mediaResolution.level = 'UNKNOWN';
    if (mode === 'generation-ultra') args.body.generationConfig.mediaResolution = 'MEDIA_RESOLUTION_ULTRA_HIGH';
    const missing = { 'missing-audio-cache': 'cached_audio', 'missing-text-cache': 'cached', 'pdf-missing-unobserved-image': 'cached_image', 'pdf-missing-document': 'cached_document' };
    if (Object.hasOwn(missing, mode)) { if (mode.startsWith('pdf-')) args.body.contents[0].parts.push({ inlineData: { mimeType: 'application/pdf', data: 'YQ==' } }); delete rates[missing[mode]]; saveInlineRates(rates); }
    if (mode === 'pdf-resolution') args.body.contents[0].parts.push({ inlineData: { mimeType: 'application/pdf', data: 'YQ==' }, mediaResolution: {} });
    if (mode === 'getter') Object.defineProperty(part.mediaResolution, 'level', { enumerable: true, get: getter });
    if (mode === 'processing-mode') part.mediaProcessing = 'AGENTIC';
    if (mode === 'remote-resource') { delete part.inlineData; part.fileData = { mimeType: 'audio/opus', fileUri: 'files/private' }; }
    const work = new DefaultExecutor('gemini').execute(args); if (Object.hasOwn(missing, mode)) await expect(work).rejects.toMatchObject({ code: 'model_pricing_unavailable' }); else await expect(work).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled(); expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(failure).toBeNull();
  });
  it.each(['part-only', 'generation-only', 'empty-object'])('audio-resolution %s retains source shape and observed price without default resolution or token estimates', async shape => {
    saveInlineRates(audioRates()); const context = await createAccounting(), args = audioResolutionOptions(context, false);
    if (shape === 'part-only') delete args.body.generationConfig.mediaResolution;
    if (shape === 'generation-only') delete args.body.contents[0].parts[1].mediaResolution;
    if (shape === 'empty-object') args.body.contents[0].parts[1].mediaResolution = {};
    const original = structuredClone(args.body), raw = inlineMessage('AUDIO');
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(raw)); };
    expect(await (await new DefaultExecutor('gemini').execute(args)).response.json()).toEqual(raw);
    const { model: _model, stream: _stream, ...wire } = original; expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(wire); expect(requests[0].row).toEqual({ requestId: context.requestId, state: 'pending' });
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: 373000 }); expect(args.body).toEqual(original); expect(failure).toBeNull();
  });
  it.each(['audio/mp3', 'audio/aiff', 'audio/aac', 'audio/ogg', 'audio/flac', 'audio/mpeg', 'audio/m4a', 'audio/l16', 'audio/opus', 'audio/alaw', 'audio/mulaw', 'audio/webm'])('audio-resolution selected %s retains opaque resolution source, no byte-derived usage', async mimeType => {
    saveInlineRates(audioRates()); const context = await createAccounting(), args = audioResolutionOptions(context, false, mimeType);
    args.body.contents[0].parts[1].inlineData.data = Buffer.alloc(1000, 1).toString('base64'); const original = structuredClone(args.body), raw = inlineMessage('AUDIO');
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(raw)); };
    expect(await (await new DefaultExecutor('gemini').execute(args)).response.json()).toEqual(raw);
    const { model: _model, stream: _stream, ...wire } = original; expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(wire); expect(requests[0].row).toEqual({ requestId: context.requestId, state: 'pending' });
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: 373000 }); expect(args.body).toEqual(original); expect(failure).toBeNull();
  });
  it('audio-resolution explicit zero prices retain nonzero observed AUDIO, not resolution-derived counts', async () => {
    const rates = audioRates(); for (const key of Object.keys(rates)) rates[key] = '0'; saveInlineRates(rates);
    const raw = inlineMessage('AUDIO'); responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(raw)); };
    expect(await (await new DefaultExecutor('gemini').execute(audioResolutionOptions(await createAccounting(), false))).response.json()).toEqual(raw);
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: 0 }); expect(JSON.parse(db.get('SELECT usageJson FROM apiKeyAccounting').usageJson).inputModalities.AUDIO).toEqual({ input: 70, cacheRead: 30 }); expect(requests).toHaveLength(1); expect(failure).toBeNull();
  });
  it.each(['unclean-eof', 'sink-exception'])('audio-resolution terminal %s has one completion and no successful finish', async mode => {
    saveInlineRates(audioRates()); const context = await createAccounting(), accounting = { ...context, completeAttempt: vi.fn((...input) => { if (mode === 'sink-exception') throw new Error('fixture audio resolution sink exception'); return context.completeAttempt(...input); }) };
    const raw = inlineMessage('AUDIO'); if (mode === 'unclean-eof') delete raw.candidates[0].finishReason;
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(`data: ${JSON.stringify(raw)}\n\n`); };
    const result = await new DefaultExecutor('gemini').execute(audioResolutionOptions(accounting)); await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable');
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(requests).toHaveLength(1); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: mode === 'sink-exception' ? 'pending' : 'unresolved', costNanoUsd: null }); expect(failure).toBeNull();
  });
  it('audio-resolution full client-result successor binds fresh resolution source/rate and own intent ACK before POST2', async () => {
    saveInlineRates(audioRates()); const context = await createAccounting(), executor = new DefaultExecutor('gemini'), first = audioResolutionOptions(context, false);
    first.body.tools = clientOptions(context).body.tools; const raw = inlineMessage('AUDIO'); raw.candidates[0].content = clientMessage().candidates[0].content;
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(requests.length === 1 ? raw : inlineMessage('AUDIO'))); };
    expect(await (await executor.execute(first)).response.json()).toEqual(raw); expect(requests).toHaveLength(1); saveInlineRates({ ...audioRates(), input_audio: '9' }); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, async beforeAttempt(...input) { const attempt = await context.beforeAttempt(...input); enter(); await held; return attempt; } };
    const next = audioResolutionOptions(accounting, false); next.body.tools = first.body.tools; next.body.contents[0].parts[1].mediaResolution = { level: 'MEDIA_RESOLUTION_LOW' }; next.body.generationConfig.mediaResolution = 'MEDIA_RESOLUTION_MEDIUM';
    next.body.contents.push(structuredClone(raw.candidates[0].content), { role: 'user', parts: [{ functionResponse: { id: 'current_call', name: 'lookup', response: { error: 'private result' } } }] });
    const original = structuredClone(next.body), work = executor.execute(next);
    try { await Promise.race([entered, work.then(() => { throw new Error('audio resolution successor POST before intent ACK'); })]); expect(requests).toHaveLength(1); expect(db.all('SELECT state FROM apiKeyAccounting ORDER BY rowid')).toEqual([{ state: 'settled' }, { state: 'pending' }]); } finally { release(); }
    expect(await (await work).response.json()).toEqual(inlineMessage('AUDIO')); expect(requests).toHaveLength(2); const { model: _model, stream: _stream, ...wire } = original; expect(requests[1].body).toEqual(wire);
    const rows = db.all('SELECT attemptId,requestId,state,costNanoUsd,priceSnapshotJson FROM apiKeyAccounting ORDER BY rowid'); expect(rows.map(row => row.costNanoUsd)).toEqual([373000, 453000]); expect(new Set(rows.map(row => row.attemptId)).size).toBe(2);
    expect(rows.every(row => row.requestId === context.requestId && row.state === 'settled')).toBe(true); expect(rows.map(row => JSON.parse(row.priceSnapshotJson).rates.input_audio)).toEqual(['7', '9']); expect(JSON.stringify(rows)).not.toMatch(/private|mediaResolution|MEDIA_RESOLUTION|current_call/); expect(next.body).toEqual(original); expect(failure).toBeNull();
  });
  it.each(['json', 'sse', 'pdf', 'mixed-client', 'missing-details', 'lost-ack'])('inline-resolution queued %s owns full image/PDF resolution POST, original observed price and own ACK', async mode => {
    saveInlineRates(); const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const valid = ['json', 'sse', 'pdf', 'mixed-client'].includes(mode);
    const accounting = { ...context, completeAttempt: vi.fn(async (...input) => { const terminal = await context.completeAttempt(...input); enter(); if (valid) await held; if (mode === 'lost-ack') throw new Error('fixture inline resolution ACK lost'); return terminal; }) };
    const args = inlineOptions(accounting, mode !== 'json', mode === 'pdf' ? 'application/pdf' : 'image/png'), raw = inlineMessage(mode === 'pdf' ? 'DOCUMENT' : 'IMAGE');
    args.accountingMode = mode === 'json' ? 'native-gemini-inline-resolution-json' : 'native-gemini-inline-resolution-sse';
    args.body.contents[0].parts[1].mediaResolution = { level: mode === 'json' ? 'MEDIA_RESOLUTION_LOW' : 'MEDIA_RESOLUTION_ULTRA_HIGH' };
    args.body.generationConfig = { mediaResolution: 'MEDIA_RESOLUTION_HIGH', maxOutputTokens: 20 };
    if (mode === 'mixed-client') {
      args.body.tools = clientOptions(accounting).body.tools; args.body.toolConfig = { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['lookup'] } };
      args.body.contents[0].parts.push({ inlineData: { mimeType: 'application/pdf', data: 'YQ==', displayName: 'private pdf' }, mediaResolution: {} });
      args.body.contents.push({ role: 'model', parts: [{ functionCall: { id: 'old_call', name: 'lookup', args: { q: 'private old' } }, thoughtSignature: 'b3BhcXVl' }] }, { role: 'user', parts: [{ functionResponse: { id: 'old_call', name: 'lookup', response: { error: 'private old result' } } }] });
      raw.candidates[0].content = clientMessage().candidates[0].content;
      raw.usageMetadata.promptTokensDetails[1].tokenCount = 60; raw.usageMetadata.promptTokensDetails.push({ modality: 'DOCUMENT', tokenCount: 10 });
      raw.usageMetadata.cacheTokensDetails[1].tokenCount = 20; raw.usageMetadata.cacheTokensDetails.push({ modality: 'DOCUMENT', tokenCount: 10 });
    }
    if (mode === 'missing-details') delete raw.usageMetadata.cacheTokensDetails;
    const original = structuredClone(args.body), text = `data: ${JSON.stringify(raw)}\n\n`, cost = mode === 'pdf' ? 250000 : mode === 'mixed-client' ? 208000 : 207000; let price;
    responder = (_request, response) => {
      price = JSON.parse(db.get('SELECT priceSnapshotJson FROM apiKeyAccounting').priceSnapshotJson); saveInlineRates({ ...inlineRates(), input_image: '30', input_document: '40' });
      response.writeHead(200, { 'content-type': mode === 'json' ? 'application/json' : 'text/event-stream' }); response.end(mode === 'json' ? JSON.stringify(raw) : text);
    };
    let ended = false; const consume = new DefaultExecutor('gemini').execute(args).then(result => result.response.text()); consume.then(() => { ended = true; }, () => { ended = true; });
    if (valid) {
      try { await Promise.race([entered, consume.then(() => { throw new Error('inline resolution success before own ACK'); })]); expect(ended).toBe(false); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: cost }); } finally { release(); }
      if (mode === 'json') expect(JSON.parse(await consume)).toEqual(raw); else expect(await consume).toBe(text);
    } else { await expect(consume).rejects.toThrow('Gateway accounting stream unavailable'); await entered; }
    const { model: _model, stream: _stream, ...wire } = original; expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(wire); expect(requests[0].row).toEqual({ requestId: context.requestId, state: 'pending' }); expect(requests[0].key).toBe('dummy-provider');
    expect(price).toMatchObject({ rates: { input_image: '3', cached_image: '0.2' }, rateUnits: { input_image: 'USD/1M tokens', cached_image: 'USD/1M tokens' }, usageSemantics: { inputModalities: 'observed_gemini_inline_input_modalities', allowedInputModalities: ['TEXT', 'IMAGE', ...(['pdf', 'mixed-client'].includes(mode) ? ['DOCUMENT'] : [])] } });
    if (['pdf', 'mixed-client'].includes(mode)) expect(price).toMatchObject({ rates: { input_document: '4', cached_document: '0.3' }, rateUnits: { input_document: 'USD/1M tokens', cached_document: 'USD/1M tokens' } });
    const row = db.get('SELECT state,costNanoUsd,usageJson,priceSnapshotJson FROM apiKeyAccounting'); expect(row).toMatchObject({ state: mode === 'missing-details' ? 'unresolved' : 'settled', costNanoUsd: mode === 'missing-details' ? null : cost });
    if (mode !== 'missing-details') expect(JSON.parse(row.usageJson).inputModalities).toEqual(Object.fromEntries(raw.usageMetadata.promptTokensDetails.map(({ modality, tokenCount }) => [modality, { input: tokenCount, cacheRead: raw.usageMetadata.cacheTokensDetails.find(item => item.modality === modality)?.tokenCount ?? 0 }])));
    expect(JSON.stringify(row)).not.toMatch(/private|b3BhcXVl|dummy-provider|current_call|old_call|mediaResolution|MEDIA_RESOLUTION/); expect(args.body).toEqual(original); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(failure).toBeNull();
  });
  it.each(['default-mode', 'source-only-inline-mode', 'video-resolution-mode', 'no-resolution', 'audio-source', 'video-source', 'unknown-part-level', 'generation-ultra', 'missing-image-cache', 'pdf-missing-unobserved-image', 'missing-text-cache', 'pdf-missing-document', 'credential-drift', 'getter', 'processing-mode', 'remote-resource'])('inline-resolution pre-intent %s refuses without POST or intent even unlimited', async mode => {
    saveInlineRates(); const context = await createAccounting(), getter = vi.fn();
    const accounting = { ...context, beforeAttempt(...input) { const work = context.beforeAttempt(...input);
      if (mode === 'credential-drift') db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']); db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(row.data), apiKey: 'dummy-new' }), 'c']); }); return work;
    } };
    const args = inlineResolutionOptions(accounting), part = args.body.contents[0].parts[1], rates = inlineRates();
    if (mode === 'default-mode') args.accountingMode = 'native-gemini-sse';
    if (mode === 'source-only-inline-mode') args.accountingMode = 'native-gemini-inline-sse';
    if (mode === 'video-resolution-mode') args.accountingMode = 'native-gemini-video-resolution-sse';
    if (mode === 'no-resolution') { delete part.mediaResolution; delete args.body.generationConfig.mediaResolution; }
    if (mode === 'audio-source') part.inlineData.mimeType = 'audio/opus';
    if (mode === 'video-source') part.inlineData.mimeType = 'video/mp4';
    if (mode === 'unknown-part-level') part.mediaResolution.level = 'UNKNOWN';
    if (mode === 'generation-ultra') args.body.generationConfig.mediaResolution = 'MEDIA_RESOLUTION_ULTRA_HIGH';
    const missing = { 'missing-image-cache': 'cached_image', 'pdf-missing-unobserved-image': 'cached_image', 'missing-text-cache': 'cached', 'pdf-missing-document': 'cached_document' };
    if (Object.hasOwn(missing, mode)) { if (mode.startsWith('pdf-')) part.inlineData.mimeType = 'application/pdf'; delete rates[missing[mode]]; saveInlineRates(rates); }
    if (mode === 'getter') Object.defineProperty(part.mediaResolution, 'level', { enumerable: true, get: getter });
    if (mode === 'processing-mode') part.mediaProcessing = 'STATIC';
    if (mode === 'remote-resource') { delete part.inlineData; part.fileData = { mimeType: 'application/pdf', fileUri: 'files/private' }; }
    const work = new DefaultExecutor('gemini').execute(args); if (Object.hasOwn(missing, mode)) await expect(work).rejects.toMatchObject({ code: 'model_pricing_unavailable' }); else await expect(work).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled(); expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(failure).toBeNull();
  });
  it.each(['part-only', 'generation-only', 'empty-object'])('inline-resolution %s conserves source shape and observed price without defaults or label estimates', async shape => {
    saveInlineRates(); const context = await createAccounting(), args = inlineResolutionOptions(context, false);
    if (shape === 'part-only') delete args.body.generationConfig.mediaResolution;
    if (shape === 'generation-only') delete args.body.contents[0].parts[1].mediaResolution;
    if (shape === 'empty-object') args.body.contents[0].parts[1].mediaResolution = {};
    const original = structuredClone(args.body), raw = inlineMessage();
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(raw)); };
    expect(await (await new DefaultExecutor('gemini').execute(args)).response.json()).toEqual(raw);
    const { model: _model, stream: _stream, ...wire } = original; expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(wire); expect(requests[0].row).toEqual({ requestId: context.requestId, state: 'pending' });
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: 207000 }); expect(args.body).toEqual(original); expect(failure).toBeNull();
  });
  it.each(['image/jpeg', 'image/jpg', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'image/avif', 'application/pdf'])('inline-resolution selected %s preserves opaque source/resolution POST without decoding or byte-derived usage', async mimeType => {
    saveInlineRates(); const context = await createAccounting(), args = inlineResolutionOptions(context, false, mimeType);
    args.body.contents[0].parts[1].inlineData.data = Buffer.alloc(1000, 1).toString('base64'); const original = structuredClone(args.body), raw = inlineMessage(mimeType === 'application/pdf' ? 'DOCUMENT' : 'IMAGE');
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(raw)); };
    expect(await (await new DefaultExecutor('gemini').execute(args)).response.json()).toEqual(raw);
    const { model: _model, stream: _stream, ...wire } = original; expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(wire); expect(requests[0].row).toEqual({ requestId: context.requestId, state: 'pending' });
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: mimeType === 'application/pdf' ? 250000 : 207000 }); expect(args.body).toEqual(original); expect(failure).toBeNull();
  });
  it('inline-resolution explicit zero rates retain nonzero observed IMAGE rather than invent resolution-derived quantity', async () => {
    const rates = inlineRates(); for (const key of Object.keys(rates)) rates[key] = '0'; saveInlineRates(rates);
    const raw = inlineMessage(); responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(raw)); };
    expect(await (await new DefaultExecutor('gemini').execute(inlineResolutionOptions(await createAccounting(), false))).response.json()).toEqual(raw);
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: 0 }); expect(JSON.parse(db.get('SELECT usageJson FROM apiKeyAccounting').usageJson).inputModalities.IMAGE).toEqual({ input: 70, cacheRead: 30 }); expect(requests).toHaveLength(1); expect(failure).toBeNull();
  });
  it.each(['unclean-eof', 'sink-exception'])('inline-resolution terminal %s has one completion and no successful finish', async mode => {
    saveInlineRates(); const context = await createAccounting(), accounting = { ...context, completeAttempt: vi.fn((...input) => { if (mode === 'sink-exception') throw new Error('fixture inline resolution sink exception'); return context.completeAttempt(...input); }) };
    const raw = inlineMessage(); if (mode === 'unclean-eof') delete raw.candidates[0].finishReason;
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(`data: ${JSON.stringify(raw)}\n\n`); };
    const result = await new DefaultExecutor('gemini').execute(inlineResolutionOptions(accounting)); await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable');
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(requests).toHaveLength(1); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: mode === 'sink-exception' ? 'pending' : 'unresolved', costNanoUsd: null }); expect(failure).toBeNull();
  });
  it('inline-resolution full client-result successor binds fresh source resolution/rate and own intent ACK before POST2', async () => {
    saveInlineRates(); const context = await createAccounting(), executor = new DefaultExecutor('gemini'), first = inlineResolutionOptions(context, false);
    first.body.tools = clientOptions(context).body.tools; const raw = inlineMessage(); raw.candidates[0].content = clientMessage().candidates[0].content;
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(requests.length === 1 ? raw : inlineMessage())); };
    expect(await (await executor.execute(first)).response.json()).toEqual(raw); expect(requests).toHaveLength(1); saveInlineRates({ ...inlineRates(), input_image: '5' }); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, async beforeAttempt(...input) { const attempt = await context.beforeAttempt(...input); enter(); await held; return attempt; } };
    const next = inlineResolutionOptions(accounting, false); next.body.tools = first.body.tools; next.body.contents[0].parts[1].mediaResolution = { level: 'MEDIA_RESOLUTION_LOW' }; next.body.generationConfig.mediaResolution = 'MEDIA_RESOLUTION_MEDIUM';
    next.body.contents.push(structuredClone(raw.candidates[0].content), { role: 'user', parts: [{ functionResponse: { id: 'current_call', name: 'lookup', response: { error: 'private result' } } }] });
    const original = structuredClone(next.body), work = executor.execute(next);
    try { await Promise.race([entered, work.then(() => { throw new Error('inline resolution successor POST before intent ACK'); })]); expect(requests).toHaveLength(1); expect(db.all('SELECT state FROM apiKeyAccounting ORDER BY rowid')).toEqual([{ state: 'settled' }, { state: 'pending' }]); } finally { release(); }
    expect(await (await work).response.json()).toEqual(inlineMessage()); expect(requests).toHaveLength(2); const { model: _model, stream: _stream, ...wire } = original; expect(requests[1].body).toEqual(wire);
    const rows = db.all('SELECT attemptId,requestId,state,costNanoUsd,priceSnapshotJson FROM apiKeyAccounting ORDER BY rowid'); expect(rows.map(row => row.costNanoUsd)).toEqual([207000, 287000]); expect(new Set(rows.map(row => row.attemptId)).size).toBe(2);
    expect(rows.every(row => row.requestId === context.requestId && row.state === 'settled')).toBe(true); expect(rows.map(row => JSON.parse(row.priceSnapshotJson).rates.input_image)).toEqual(['3', '5']); expect(JSON.stringify(rows)).not.toMatch(/private|mediaResolution|MEDIA_RESOLUTION|current_call/); expect(next.body).toEqual(original); expect(failure).toBeNull();
  });
  it.each(['json', 'sse', 'frame-audio', 'mixed-client-pdf', 'missing-details', 'lost-ack'])('video-resolution queued %s owns full source resolution POST, observed price and own ACK without label inference', async mode => {
    saveInlineRates(videoRates()); const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const valid = ['json', 'sse', 'frame-audio', 'mixed-client-pdf'].includes(mode);
    const accounting = { ...context, completeAttempt: vi.fn(async (...input) => { const terminal = await context.completeAttempt(...input); enter(); if (valid) await held; if (mode === 'lost-ack') throw new Error('fixture resolution ACK lost'); return terminal; }) };
    const args = videoOptions(accounting, mode !== 'json'), raw = inlineMessage('VIDEO');
    args.accountingMode = mode === 'json' ? 'native-gemini-video-resolution-json' : 'native-gemini-video-resolution-sse';
    args.body.contents[0].parts[1].mediaResolution = { level: mode === 'json' ? 'MEDIA_RESOLUTION_LOW' : 'MEDIA_RESOLUTION_ULTRA_HIGH' };
    args.body.generationConfig = { maxOutputTokens: 20, mediaResolution: 'MEDIA_RESOLUTION_HIGH' };
    if (mode === 'frame-audio') {
      raw.usageMetadata.promptTokensDetails = [{ modality: 'TEXT', tokenCount: 30 }, { modality: 'IMAGE', tokenCount: 50 }, { modality: 'AUDIO', tokenCount: 20 }];
      raw.usageMetadata.cacheTokensDetails = [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'IMAGE', tokenCount: 20 }, { modality: 'AUDIO', tokenCount: 10 }];
    }
    if (mode === 'mixed-client-pdf') {
      args.body.contents[0].parts[1].videoMetadata = { fps: 24, startOffset: '0.000000001s', endOffset: '1.000000001s' };
      args.body.tools = clientOptions(accounting).body.tools; args.body.toolConfig = { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['lookup'] } };
      args.body.contents[0].parts.push({ inlineData: { mimeType: 'application/pdf', data: 'YQ==', displayName: 'private pdf' } }, { inlineData: { mimeType: 'audio/opus', data: 'Yg==' } }, { inlineData: { mimeType: 'image/png', data: 'Yw==' } }, { inlineData: { mimeType: 'video/webm', data: 'YQ==' }, mediaResolution: {} });
      args.body.contents.push({ role: 'model', parts: [{ functionCall: { id: 'old_call', name: 'lookup', args: { q: 'private old' } }, thoughtSignature: 'b3BhcXVl' }] }, { role: 'user', parts: [{ functionResponse: { id: 'old_call', name: 'lookup', response: { error: 'private old result' } } }] });
      raw.candidates[0].content = clientMessage().candidates[0].content;
      raw.usageMetadata.promptTokensDetails[1].tokenCount = 60; raw.usageMetadata.promptTokensDetails.push({ modality: 'DOCUMENT', tokenCount: 10 });
      raw.usageMetadata.cacheTokensDetails[1].tokenCount = 20; raw.usageMetadata.cacheTokensDetails.push({ modality: 'DOCUMENT', tokenCount: 10 });
    }
    if (mode === 'missing-details') delete raw.usageMetadata.cacheTokensDetails;
    const original = structuredClone(args.body), text = `data: ${JSON.stringify(raw)}\n\n`, cost = mode === 'frame-audio' ? 249000 : mode === 'mixed-client-pdf' ? 534000 : 536000; let price;
    responder = (_request, response) => {
      price = JSON.parse(db.get('SELECT priceSnapshotJson FROM apiKeyAccounting').priceSnapshotJson); saveInlineRates({ ...videoRates(), input_video: '110', input_audio: '70', input_image: '30' });
      response.writeHead(200, { 'content-type': mode === 'json' ? 'application/json' : 'text/event-stream' }); response.end(mode === 'json' ? JSON.stringify(raw) : text);
    };
    let ended = false; const consume = new DefaultExecutor('gemini').execute(args).then(result => result.response.text()); consume.then(() => { ended = true; }, () => { ended = true; });
    if (valid) {
      try { await Promise.race([entered, consume.then(() => { throw new Error('resolution success before own ACK'); })]); expect(ended).toBe(false); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: cost }); } finally { release(); }
      if (mode === 'json') expect(JSON.parse(await consume)).toEqual(raw); else expect(await consume).toBe(text);
    } else { await expect(consume).rejects.toThrow('Gateway accounting stream unavailable'); await entered; }
    const { model: _model, stream: _stream, ...wire } = original; expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(wire); expect(requests[0].row).toEqual({ requestId: context.requestId, state: 'pending' }); expect(requests[0].key).toBe('dummy-provider');
    expect(price).toMatchObject({ rates: { input_video: '11', cached_video: '0.5', input_image: '3', cached_image: '0.2', input_audio: '7', cached_audio: '0.4' }, rateUnits: { input_video: 'USD/1M tokens', cached_video: 'USD/1M tokens', input_image: 'USD/1M tokens', cached_image: 'USD/1M tokens', input_audio: 'USD/1M tokens', cached_audio: 'USD/1M tokens' }, usageSemantics: { inputModalities: 'observed_gemini_inline_input_modalities', allowedInputModalities: mode === 'mixed-client-pdf' ? ['TEXT', 'VIDEO', 'IMAGE', 'AUDIO', 'DOCUMENT'] : ['TEXT', 'VIDEO', 'IMAGE', 'AUDIO'] } });
    const row = db.get('SELECT state,costNanoUsd,usageJson,priceSnapshotJson FROM apiKeyAccounting'); expect(row).toMatchObject({ state: mode === 'missing-details' ? 'unresolved' : 'settled', costNanoUsd: mode === 'missing-details' ? null : cost });
    if (mode !== 'missing-details') expect(JSON.parse(row.usageJson).inputModalities).toEqual(Object.fromEntries(raw.usageMetadata.promptTokensDetails.map(({ modality, tokenCount }) => [modality, { input: tokenCount, cacheRead: raw.usageMetadata.cacheTokensDetails.find(item => item.modality === modality)?.tokenCount ?? 0 }])));
    expect(JSON.stringify(row)).not.toMatch(/private|b3BhcXVl|dummy-provider|current_call|old_call|mediaResolution|MEDIA_RESOLUTION|videoMetadata|startOffset|endOffset|fps/);
    expect(args.body).toEqual(original); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(failure).toBeNull();
  });
  it.each(['default-mode', 'source-only-video-mode', 'metadata-mode', 'no-resolution', 'no-video', 'unknown-part-level', 'generation-ultra', 'missing-video-cache', 'missing-image-cache', 'missing-audio-cache', 'missing-text-cache', 'pdf-missing-document', 'credential-drift', 'getter', 'processing-mode', 'remote-resource'])('video-resolution pre-intent %s refuses with no POST or intent even unlimited', async mode => {
    saveInlineRates(videoRates()); const context = await createAccounting(), getter = vi.fn();
    const accounting = { ...context, beforeAttempt(...input) { const work = context.beforeAttempt(...input);
      if (mode === 'credential-drift') db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']); db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(row.data), apiKey: 'dummy-new' }), 'c']); }); return work;
    } };
    const args = resolutionOptions(accounting), part = args.body.contents[0].parts[1], rates = videoRates();
    if (mode === 'default-mode') args.accountingMode = 'native-gemini-sse';
    if (mode === 'source-only-video-mode') args.accountingMode = 'native-gemini-video-sse';
    if (mode === 'metadata-mode') { args.accountingMode = 'native-gemini-video-metadata-sse'; part.videoMetadata = {}; }
    if (mode === 'no-resolution') { delete part.mediaResolution; delete args.body.generationConfig.mediaResolution; }
    if (mode === 'no-video') part.inlineData.mimeType = 'audio/opus';
    if (mode === 'unknown-part-level') part.mediaResolution.level = 'UNKNOWN';
    if (mode === 'generation-ultra') args.body.generationConfig.mediaResolution = 'MEDIA_RESOLUTION_ULTRA_HIGH';
    const missing = { 'missing-video-cache': 'cached_video', 'missing-image-cache': 'cached_image', 'missing-audio-cache': 'cached_audio', 'missing-text-cache': 'cached', 'pdf-missing-document': 'cached_document' };
    if (Object.hasOwn(missing, mode)) { if (mode === 'pdf-missing-document') args.body.contents[0].parts.push({ inlineData: { mimeType: 'application/pdf', data: 'YQ==' } }); delete rates[missing[mode]]; saveInlineRates(rates); }
    if (mode === 'getter') Object.defineProperty(part.mediaResolution, 'level', { enumerable: true, get: getter });
    if (mode === 'processing-mode') part.mediaProcessing = 'STATIC';
    if (mode === 'remote-resource') { delete part.inlineData; part.fileData = { mimeType: 'video/mp4', fileUri: 'files/private' }; }
    const work = new DefaultExecutor('gemini').execute(args); if (Object.hasOwn(missing, mode)) await expect(work).rejects.toMatchObject({ code: 'model_pricing_unavailable' }); else await expect(work).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled(); expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(failure).toBeNull();
  });
  it.each(['part-only', 'generation-only', 'empty-object'])('video-resolution %s retains original shape and observed price, no default levels or label token estimates', async shape => {
    saveInlineRates(videoRates()); const context = await createAccounting(), args = resolutionOptions(context, false);
    if (shape === 'part-only') delete args.body.generationConfig.mediaResolution;
    if (shape === 'generation-only') delete args.body.contents[0].parts[1].mediaResolution;
    if (shape === 'empty-object') args.body.contents[0].parts[1].mediaResolution = {};
    const original = structuredClone(args.body), raw = inlineMessage('VIDEO');
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(raw)); };
    expect(await (await new DefaultExecutor('gemini').execute(args)).response.json()).toEqual(raw);
    const { model: _model, stream: _stream, ...wire } = original; expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(wire); expect(requests[0].row).toEqual({ requestId: context.requestId, state: 'pending' });
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: 536000 }); expect(args.body).toEqual(original); expect(failure).toBeNull();
  });
  it('video-resolution explicit zero rates keep nonzero observed VIDEO and do not fabricate resolution-derived quantity', async () => {
    const rates = videoRates(); for (const key of Object.keys(rates)) rates[key] = '0'; saveInlineRates(rates);
    const raw = inlineMessage('VIDEO'); responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(raw)); };
    expect(await (await new DefaultExecutor('gemini').execute(resolutionOptions(await createAccounting(), false))).response.json()).toEqual(raw);
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: 0 }); expect(JSON.parse(db.get('SELECT usageJson FROM apiKeyAccounting').usageJson).inputModalities.VIDEO).toEqual({ input: 70, cacheRead: 30 }); expect(requests).toHaveLength(1); expect(failure).toBeNull();
  });
  it.each(['unclean-eof', 'sink-exception'])('video-resolution terminal %s has one completion and no successful finish', async mode => {
    saveInlineRates(videoRates()); const context = await createAccounting(), accounting = { ...context, completeAttempt: vi.fn((...input) => { if (mode === 'sink-exception') throw new Error('fixture resolution sink exception'); return context.completeAttempt(...input); }) };
    const raw = inlineMessage('VIDEO'); if (mode === 'unclean-eof') delete raw.candidates[0].finishReason;
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(`data: ${JSON.stringify(raw)}\n\n`); };
    const result = await new DefaultExecutor('gemini').execute(resolutionOptions(accounting)); await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable');
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(requests).toHaveLength(1); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: mode === 'sink-exception' ? 'pending' : 'unresolved', costNanoUsd: null }); expect(failure).toBeNull();
  });
  it('video-resolution full client-result successor binds fresh source resolution/rate and own intent ACK before POST2', async () => {
    saveInlineRates(videoRates()); const context = await createAccounting(), executor = new DefaultExecutor('gemini'), first = resolutionOptions(context, false);
    first.body.tools = clientOptions(context).body.tools; const raw = inlineMessage('VIDEO'); raw.candidates[0].content = clientMessage().candidates[0].content;
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(requests.length === 1 ? raw : inlineMessage('VIDEO'))); };
    expect(await (await executor.execute(first)).response.json()).toEqual(raw); expect(requests).toHaveLength(1); saveInlineRates({ ...videoRates(), input_video: '13' }); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, async beforeAttempt(...input) { const attempt = await context.beforeAttempt(...input); enter(); await held; return attempt; } };
    const next = resolutionOptions(accounting, false); next.body.tools = first.body.tools; next.body.contents[0].parts[1].mediaResolution = { level: 'MEDIA_RESOLUTION_LOW' }; next.body.generationConfig.mediaResolution = 'MEDIA_RESOLUTION_MEDIUM'; next.body.contents[0].parts[1].videoMetadata = { fps: 24, endOffset: '1s' };
    next.body.contents.push(structuredClone(raw.candidates[0].content), { role: 'user', parts: [{ functionResponse: { id: 'current_call', name: 'lookup', response: { error: 'private result' } } }] });
    const original = structuredClone(next.body), work = executor.execute(next);
    try { await Promise.race([entered, work.then(() => { throw new Error('resolution successor POST before intent ACK'); })]); expect(requests).toHaveLength(1); expect(db.all('SELECT state FROM apiKeyAccounting ORDER BY rowid')).toEqual([{ state: 'settled' }, { state: 'pending' }]); } finally { release(); }
    expect(await (await work).response.json()).toEqual(inlineMessage('VIDEO')); expect(requests).toHaveLength(2); const { model: _model, stream: _stream, ...wire } = original; expect(requests[1].body).toEqual(wire);
    const rows = db.all('SELECT attemptId,requestId,state,costNanoUsd,priceSnapshotJson FROM apiKeyAccounting ORDER BY rowid'); expect(rows.map(row => row.costNanoUsd)).toEqual([536000, 616000]); expect(new Set(rows.map(row => row.attemptId)).size).toBe(2);
    expect(rows.every(row => row.requestId === context.requestId && row.state === 'settled')).toBe(true); expect(rows.map(row => JSON.parse(row.priceSnapshotJson).rates.input_video)).toEqual(['11', '13']); expect(JSON.stringify(rows)).not.toMatch(/private|mediaResolution|MEDIA_RESOLUTION|videoMetadata|fps/); expect(next.body).toEqual(original); expect(failure).toBeNull();
  });
  it.each(['json', 'sse', 'frame-audio', 'mixed-client-pdf', 'missing-details', 'lost-ack'])('video-metadata queued %s owns complete offsets/FPS POST, observed price and own ACK without duration inference', async mode => {
    saveInlineRates(videoRates()); const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const valid = ['json', 'sse', 'frame-audio', 'mixed-client-pdf'].includes(mode);
    const accounting = { ...context, completeAttempt: vi.fn(async (...input) => { const terminal = await context.completeAttempt(...input); enter(); if (valid) await held; if (mode === 'lost-ack') throw new Error('fixture metadata ACK lost'); return terminal; }) };
    const args = videoOptions(accounting, mode !== 'json'), raw = inlineMessage('VIDEO');
    args.accountingMode = mode === 'json' ? 'native-gemini-video-metadata-json' : 'native-gemini-video-metadata-sse';
    args.body.contents[0].parts[1].videoMetadata = mode === 'json' ? { fps: 0.5, startOffset: '0.000000001s', endOffset: '1.000000001s' } : { fps: 24, startOffset: '315575999999.999999999s', endOffset: '315576000000s' };
    if (mode === 'frame-audio') {
      raw.usageMetadata.promptTokensDetails = [{ modality: 'TEXT', tokenCount: 30 }, { modality: 'IMAGE', tokenCount: 50 }, { modality: 'AUDIO', tokenCount: 20 }];
      raw.usageMetadata.cacheTokensDetails = [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'IMAGE', tokenCount: 20 }, { modality: 'AUDIO', tokenCount: 10 }];
    }
    if (mode === 'mixed-client-pdf') {
      args.body.tools = clientOptions(accounting).body.tools; args.body.toolConfig = { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['lookup'] } };
      args.body.contents[0].parts.push({ inlineData: { mimeType: 'application/pdf', data: 'YQ==', displayName: 'private pdf' } }, { inlineData: { mimeType: 'audio/opus', data: 'Yg==' } }, { inlineData: { mimeType: 'image/png', data: 'Yw==' } }, { inlineData: { mimeType: 'video/webm', data: 'YQ==' }, videoMetadata: {} });
      args.body.contents.push({ role: 'model', parts: [{ functionCall: { id: 'old_call', name: 'lookup', args: { q: 'private old' } }, thoughtSignature: 'b3BhcXVl' }] }, { role: 'user', parts: [{ functionResponse: { id: 'old_call', name: 'lookup', response: { error: 'private old result' } } }] });
      raw.candidates[0].content = clientMessage().candidates[0].content;
      raw.usageMetadata.promptTokensDetails[1].tokenCount = 60; raw.usageMetadata.promptTokensDetails.push({ modality: 'DOCUMENT', tokenCount: 10 });
      raw.usageMetadata.cacheTokensDetails[1].tokenCount = 20; raw.usageMetadata.cacheTokensDetails.push({ modality: 'DOCUMENT', tokenCount: 10 });
    }
    if (mode === 'missing-details') delete raw.usageMetadata.cacheTokensDetails;
    const original = structuredClone(args.body), text = `data: ${JSON.stringify(raw)}\n\n`, cost = mode === 'frame-audio' ? 249000 : mode === 'mixed-client-pdf' ? 534000 : 536000; let price;
    responder = (_request, response) => {
      price = JSON.parse(db.get('SELECT priceSnapshotJson FROM apiKeyAccounting').priceSnapshotJson);
      saveInlineRates({ ...videoRates(), input_video: '110', input_audio: '70', input_image: '30' });
      response.writeHead(200, { 'content-type': mode === 'json' ? 'application/json' : 'text/event-stream' }); response.end(mode === 'json' ? JSON.stringify(raw) : text);
    };
    let ended = false; const consume = new DefaultExecutor('gemini').execute(args).then(result => result.response.text()); consume.then(() => { ended = true; }, () => { ended = true; });
    if (valid) {
      try { await Promise.race([entered, consume.then(() => { throw new Error('metadata success before own ACK'); })]); expect(ended).toBe(false); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: cost }); } finally { release(); }
      if (mode === 'json') expect(JSON.parse(await consume)).toEqual(raw); else expect(await consume).toBe(text);
    } else { await expect(consume).rejects.toThrow('Gateway accounting stream unavailable'); await entered; }
    const { model: _model, stream: _stream, ...wire } = original; expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(wire);
    expect(requests[0].row).toEqual({ requestId: context.requestId, state: 'pending' }); expect(requests[0].key).toBe('dummy-provider');
    expect(price).toMatchObject({ rates: { input_video: '11', cached_video: '0.5', input_image: '3', cached_image: '0.2', input_audio: '7', cached_audio: '0.4' }, rateUnits: { input_video: 'USD/1M tokens', cached_video: 'USD/1M tokens', input_image: 'USD/1M tokens', cached_image: 'USD/1M tokens', input_audio: 'USD/1M tokens', cached_audio: 'USD/1M tokens' }, usageSemantics: { inputModalities: 'observed_gemini_inline_input_modalities', allowedInputModalities: mode === 'mixed-client-pdf' ? ['TEXT', 'VIDEO', 'IMAGE', 'AUDIO', 'DOCUMENT'] : ['TEXT', 'VIDEO', 'IMAGE', 'AUDIO'] } });
    const row = db.get('SELECT state,costNanoUsd,usageJson,priceSnapshotJson FROM apiKeyAccounting'); expect(row).toMatchObject({ state: mode === 'missing-details' ? 'unresolved' : 'settled', costNanoUsd: mode === 'missing-details' ? null : cost });
    if (mode !== 'missing-details') expect(JSON.parse(row.usageJson).inputModalities).toEqual(Object.fromEntries(raw.usageMetadata.promptTokensDetails.map(({ modality, tokenCount }) => [modality, { input: tokenCount, cacheRead: raw.usageMetadata.cacheTokensDetails.find(item => item.modality === modality)?.tokenCount ?? 0 }])));
    expect(JSON.stringify(row)).not.toMatch(/private|b3BhcXVl|dummy-provider|current_call|old_call|videoMetadata|startOffset|endOffset|fps/);
    expect(args.body).toEqual(original); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(failure).toBeNull();
  });
  it.each(['default-mode', 'source-only-video-mode', 'no-metadata', 'no-video', 'invalid-fps', 'reversed-offsets', 'missing-video-cache', 'missing-image-cache', 'missing-audio-cache', 'missing-text-cache', 'pdf-missing-document', 'credential-drift', 'getter', 'processing-mode', 'resolution', 'remote-resource'])('video-metadata pre-intent %s refuses with no POST or intent even unlimited', async mode => {
    saveInlineRates(videoRates()); const context = await createAccounting(), getter = vi.fn();
    const accounting = { ...context, beforeAttempt(...input) { const work = context.beforeAttempt(...input);
      if (mode === 'credential-drift') db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']); db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(row.data), apiKey: 'dummy-new' }), 'c']); }); return work;
    } };
    const args = metadataOptions(accounting), rates = videoRates(), part = args.body.contents[0].parts[1];
    if (mode === 'default-mode') args.accountingMode = 'native-gemini-sse';
    if (mode === 'source-only-video-mode') args.accountingMode = 'native-gemini-video-sse';
    if (mode === 'no-metadata') delete part.videoMetadata;
    if (mode === 'no-video') part.inlineData.mimeType = 'audio/opus';
    if (mode === 'invalid-fps') part.videoMetadata.fps = 0;
    if (mode === 'reversed-offsets') part.videoMetadata.startOffset = '2s';
    const missing = { 'missing-video-cache': 'cached_video', 'missing-image-cache': 'cached_image', 'missing-audio-cache': 'cached_audio', 'missing-text-cache': 'cached', 'pdf-missing-document': 'cached_document' };
    if (Object.hasOwn(missing, mode)) { if (mode === 'pdf-missing-document') args.body.contents[0].parts.push({ inlineData: { mimeType: 'application/pdf', data: 'YQ==' } }); delete rates[missing[mode]]; saveInlineRates(rates); }
    if (mode === 'getter') Object.defineProperty(part.videoMetadata, 'fps', { enumerable: true, get: getter });
    if (mode === 'processing-mode') part.mediaProcessing = 'AGENTIC';
    if (mode === 'resolution') part.mediaResolution = { level: 'MEDIA_RESOLUTION_LOW' };
    if (mode === 'remote-resource') { delete part.inlineData; part.fileData = { mimeType: 'video/mp4', fileUri: 'files/private' }; }
    const work = new DefaultExecutor('gemini').execute(args);
    if (Object.hasOwn(missing, mode)) await expect(work).rejects.toMatchObject({ code: 'model_pricing_unavailable' }); else await expect(work).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled(); expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(failure).toBeNull();
  });
  it('video-metadata empty optional metadata preserves source and explicit zero prices with nonzero observed VIDEO', async () => {
    const rates = videoRates(); for (const key of Object.keys(rates)) rates[key] = '0'; saveInlineRates(rates);
    const args = metadataOptions(await createAccounting(), false); args.body.contents[0].parts[1].videoMetadata = {}; const original = structuredClone(args.body), raw = inlineMessage('VIDEO');
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(raw)); };
    expect(await (await new DefaultExecutor('gemini').execute(args)).response.json()).toEqual(raw);
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: 0 });
    expect(JSON.parse(db.get('SELECT usageJson FROM apiKeyAccounting').usageJson).inputModalities.VIDEO).toEqual({ input: 70, cacheRead: 30 });
    const { model: _model, stream: _stream, ...wire } = original; expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(wire); expect(args.body).toEqual(original); expect(failure).toBeNull();
  });
  it.each(['unclean-eof', 'sink-exception'])('video-metadata terminal %s has one completion and no successful finish', async mode => {
    saveInlineRates(videoRates()); const context = await createAccounting(), accounting = { ...context, completeAttempt: vi.fn((...input) => { if (mode === 'sink-exception') throw new Error('fixture metadata sink exception'); return context.completeAttempt(...input); }) };
    const raw = inlineMessage('VIDEO'); if (mode === 'unclean-eof') delete raw.candidates[0].finishReason;
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(`data: ${JSON.stringify(raw)}\n\n`); };
    const result = await new DefaultExecutor('gemini').execute(metadataOptions(accounting)); await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable');
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(requests).toHaveLength(1); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: mode === 'sink-exception' ? 'pending' : 'unresolved', costNanoUsd: null }); expect(failure).toBeNull();
  });
  it('video-metadata explicit full client-result successor gets fresh rate and its own intent ACK before POST2', async () => {
    saveInlineRates(videoRates()); const context = await createAccounting(), executor = new DefaultExecutor('gemini'), first = metadataOptions(context, false);
    first.body.tools = clientOptions(context).body.tools; const raw = inlineMessage('VIDEO'); raw.candidates[0].content = clientMessage().candidates[0].content;
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(requests.length === 1 ? raw : inlineMessage('VIDEO'))); };
    expect(await (await executor.execute(first)).response.json()).toEqual(raw); expect(requests).toHaveLength(1);
    saveInlineRates({ ...videoRates(), input_video: '13' }); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, async beforeAttempt(...input) { const attempt = await context.beforeAttempt(...input); enter(); await held; return attempt; } };
    const next = metadataOptions(accounting, false); next.body.tools = first.body.tools; next.body.contents[0].parts[1].videoMetadata = { fps: 24, endOffset: '315576000000s' };
    next.body.contents.push(structuredClone(raw.candidates[0].content), { role: 'user', parts: [{ functionResponse: { id: 'current_call', name: 'lookup', response: { error: 'private result' } } }] });
    const original = structuredClone(next.body), work = executor.execute(next);
    try { await Promise.race([entered, work.then(() => { throw new Error('metadata successor POST before intent ACK'); })]); expect(requests).toHaveLength(1); expect(db.all('SELECT state FROM apiKeyAccounting ORDER BY rowid')).toEqual([{ state: 'settled' }, { state: 'pending' }]); } finally { release(); }
    expect(await (await work).response.json()).toEqual(inlineMessage('VIDEO')); expect(requests).toHaveLength(2);
    const { model: _model, stream: _stream, ...wire } = original; expect(requests[1].body).toEqual(wire);
    const rows = db.all('SELECT attemptId,requestId,state,costNanoUsd,priceSnapshotJson FROM apiKeyAccounting ORDER BY rowid'); expect(rows.map(row => row.costNanoUsd)).toEqual([536000, 616000]);
    expect(new Set(rows.map(row => row.attemptId)).size).toBe(2); expect(rows.every(row => row.requestId === context.requestId && row.state === 'settled')).toBe(true); expect(rows.map(row => JSON.parse(row.priceSnapshotJson).rates.input_video)).toEqual(['11', '13']);
    expect(JSON.stringify(rows)).not.toMatch(/private|videoMetadata|startOffset|endOffset|fps/); expect(next.body).toEqual(original); expect(failure).toBeNull();
  });
  it.each(['json', 'sse', 'frame-audio', 'mixed-client-pdf', 'missing-details', 'lost-ack'])('video-input queued %s binds original video POST, observed modalities, original rates and own ACK', async mode => {
    saveInlineRates(videoRates()); const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const valid = ['json', 'sse', 'frame-audio', 'mixed-client-pdf'].includes(mode);
    const accounting = { ...context, completeAttempt: vi.fn(async (...input) => { const terminal = await context.completeAttempt(...input); enter(); if (valid) await held; if (mode === 'lost-ack') throw new Error('fixture video ACK lost'); return terminal; }) };
    const args = videoOptions(accounting, mode !== 'json'), raw = inlineMessage('VIDEO');
    if (mode === 'frame-audio') {
      raw.usageMetadata.promptTokensDetails = [{ modality: 'TEXT', tokenCount: 30 }, { modality: 'IMAGE', tokenCount: 50 }, { modality: 'AUDIO', tokenCount: 20 }];
      raw.usageMetadata.cacheTokensDetails = [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'IMAGE', tokenCount: 20 }, { modality: 'AUDIO', tokenCount: 10 }];
    }
    if (mode === 'mixed-client-pdf') {
      args.body.tools = clientOptions(accounting).body.tools; args.body.toolConfig = { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['lookup'] } };
      args.body.contents[0].parts.push({ inlineData: { mimeType: 'application/pdf', data: 'YQ==', displayName: 'private pdf' } }, { inlineData: { mimeType: 'audio/opus', data: 'Yg==' } }, { inlineData: { mimeType: 'image/png', data: 'Yw==' } });
      args.body.contents.push({ role: 'model', parts: [{ functionCall: { id: 'old_call', name: 'lookup', args: { q: 'private old' } }, thoughtSignature: 'b3BhcXVl' }] }, { role: 'user', parts: [{ functionResponse: { id: 'old_call', name: 'lookup', response: { error: 'private old result' } } }] });
      raw.candidates[0].content = clientMessage().candidates[0].content;
      raw.usageMetadata.promptTokensDetails[1].tokenCount = 60; raw.usageMetadata.promptTokensDetails.push({ modality: 'DOCUMENT', tokenCount: 10 });
      raw.usageMetadata.cacheTokensDetails[1].tokenCount = 20; raw.usageMetadata.cacheTokensDetails.push({ modality: 'DOCUMENT', tokenCount: 10 });
    }
    if (mode === 'missing-details') delete raw.usageMetadata.cacheTokensDetails;
    const original = structuredClone(args.body), text = `data: ${JSON.stringify(raw)}\n\n`, cost = mode === 'frame-audio' ? 249000 : mode === 'mixed-client-pdf' ? 534000 : 536000; let price;
    responder = (_request, response) => { price = JSON.parse(db.get('SELECT priceSnapshotJson FROM apiKeyAccounting').priceSnapshotJson); saveInlineRates({ ...videoRates(), input_video: '110', input_audio: '70', input_image: '30' }); response.writeHead(200, { 'content-type': mode === 'json' ? 'application/json' : 'text/event-stream' }); response.end(mode === 'json' ? JSON.stringify(raw) : text); };
    let ended = false; const consume = new DefaultExecutor('gemini').execute(args).then(result => result.response.text()); consume.then(() => { ended = true; }, () => { ended = true; });
    if (valid) {
      try { await Promise.race([entered, consume.then(() => { throw new Error('video terminal before own ACK'); })]); expect(ended).toBe(false); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: cost }); } finally { release(); }
      if (mode === 'json') expect(JSON.parse(await consume)).toEqual(raw); else expect(await consume).toBe(text);
    } else { await expect(consume).rejects.toThrow('Gateway accounting stream unavailable'); await entered; }
    const { model: _model, stream: _stream, ...wire } = original; expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(wire); expect(requests[0].row).toEqual({ requestId: context.requestId, state: 'pending' }); expect(requests[0].key).toBe('dummy-provider');
    expect(price).toMatchObject({ rates: { input_video: '11', cached_video: '0.5', input_image: '3', cached_image: '0.2', input_audio: '7', cached_audio: '0.4' }, rateUnits: { input_video: 'USD/1M tokens', cached_video: 'USD/1M tokens', input_image: 'USD/1M tokens', cached_image: 'USD/1M tokens', input_audio: 'USD/1M tokens', cached_audio: 'USD/1M tokens' }, usageSemantics: { inputModalities: 'observed_gemini_inline_input_modalities', allowedInputModalities: mode === 'mixed-client-pdf' ? ['TEXT', 'VIDEO', 'IMAGE', 'AUDIO', 'DOCUMENT'] : ['TEXT', 'VIDEO', 'IMAGE', 'AUDIO'] } });
    const row = db.get('SELECT state,costNanoUsd,usageJson,priceSnapshotJson FROM apiKeyAccounting'); expect(row).toMatchObject({ state: mode === 'missing-details' ? 'unresolved' : 'settled', costNanoUsd: mode === 'missing-details' ? null : cost });
    if (mode !== 'missing-details') expect(JSON.parse(row.usageJson).inputModalities).toEqual(Object.fromEntries(raw.usageMetadata.promptTokensDetails.map(({ modality, tokenCount }) => [modality, { input: tokenCount, cacheRead: raw.usageMetadata.cacheTokensDetails.find(item => item.modality === modality)?.tokenCount ?? 0 }])));
    expect(JSON.stringify(row)).not.toMatch(/private|b3BhcXVl|dummy-provider|current_call|old_call/); expect(args.body).toEqual(original); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(failure).toBeNull();
  });
  it.each(['default-mode', 'audio-mode', 'no-video', 'flat-rates', 'missing-video-cache', 'missing-image-cache', 'missing-audio-cache', 'missing-text-cache', 'pdf-missing-document', 'credential-drift', 'getter', 'processing-metadata'])('video-input pre-intent %s refuses without POST or intent even unlimited', async mode => {
    saveInlineRates(videoRates()); const context = await createAccounting(), getter = vi.fn();
    const accounting = { ...context, beforeAttempt(...input) {
      const work = context.beforeAttempt(...input);
      if (mode === 'credential-drift') db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']); db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(row.data), apiKey: 'dummy-new' }), 'c']); }); return work;
    } };
    const args = videoOptions(accounting), rates = videoRates();
    if (mode === 'default-mode') args.accountingMode = 'native-gemini-sse';
    if (mode === 'audio-mode') args.accountingMode = 'native-gemini-audio-sse';
    if (mode === 'no-video') args.body.contents[0].parts[1].inlineData.mimeType = 'audio/opus';
    if (mode === 'flat-rates') saveInlineRates({ input: '1', output: '2', cached: '0.1' });
    const missing = { 'missing-video-cache': 'cached_video', 'missing-image-cache': 'cached_image', 'missing-audio-cache': 'cached_audio', 'missing-text-cache': 'cached', 'pdf-missing-document': 'cached_document' };
    if (Object.hasOwn(missing, mode)) {
      if (mode === 'pdf-missing-document') args.body.contents[0].parts.push({ inlineData: { mimeType: 'application/pdf', data: 'YQ==' } });
      delete rates[missing[mode]]; saveInlineRates(rates);
    }
    if (mode === 'getter') Object.defineProperty(args.body.contents[0].parts[1].inlineData, 'data', { enumerable: true, get: getter });
    if (mode === 'processing-metadata') args.body.contents[0].parts[1].mediaProcessing = 'AGENTIC';
    const work = new DefaultExecutor('gemini').execute(args);
    if (mode === 'flat-rates' || Object.hasOwn(missing, mode)) await expect(work).rejects.toMatchObject({ code: 'model_pricing_unavailable' }); else await expect(work).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled(); expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(failure).toBeNull();
  });
  it.each(['video/mpeg', 'video/mov', 'video/avi', 'video/x-flv', 'video/mpg', 'video/webm', 'video/wmv', 'video/3gpp'])('remaining video MIME %s conserves full original POST and observed price without codec inference', async mime => {
    saveInlineRates(videoRates()); const context = await createAccounting(), args = videoOptions(context, false); args.body.contents[0].parts[1].inlineData.mimeType = mime;
    const original = structuredClone(args.body), raw = inlineMessage('VIDEO');
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(raw)); };
    expect(await (await new DefaultExecutor('gemini').execute(args)).response.json()).toEqual(raw);
    const { model: _model, stream: _stream, ...wire } = original; expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(wire); expect(requests[0].row).toEqual({ requestId: context.requestId, state: 'pending' });
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: 536000 });
    expect(JSON.parse(db.get('SELECT priceSnapshotJson FROM apiKeyAccounting').priceSnapshotJson).usageSemantics.allowedInputModalities).toEqual(['TEXT', 'VIDEO', 'IMAGE', 'AUDIO']); expect(args.body).toEqual(original); expect(failure).toBeNull();
  });
  it('video-input explicit zero rates retain nonzero observed VIDEO, not fabricated free quantities', async () => {
    const rates = videoRates(); for (const key of Object.keys(rates)) rates[key] = '0'; saveInlineRates(rates);
    const raw = inlineMessage('VIDEO'); responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(raw)); };
    expect(await (await new DefaultExecutor('gemini').execute(videoOptions(await createAccounting(), false))).response.json()).toEqual(raw);
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: 0 });
    expect(JSON.parse(db.get('SELECT usageJson FROM apiKeyAccounting').usageJson).inputModalities.VIDEO).toEqual({ input: 70, cacheRead: 30 }); expect(requests).toHaveLength(1); expect(failure).toBeNull();
  });
  it.each(['unclean-eof', 'sink-exception'])('video-input terminal %s has one completion and no successful delivery', async mode => {
    saveInlineRates(videoRates()); const context = await createAccounting(), accounting = { ...context, completeAttempt: vi.fn((...input) => {
      if (mode === 'sink-exception') throw new Error('fixture video sink exception'); return context.completeAttempt(...input);
    }) };
    const raw = inlineMessage('VIDEO'); if (mode === 'unclean-eof') delete raw.candidates[0].finishReason;
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(`data: ${JSON.stringify(raw)}\n\n`); };
    const result = await new DefaultExecutor('gemini').execute(videoOptions(accounting)); await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable');
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(requests).toHaveLength(1); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: mode === 'sink-exception' ? 'pending' : 'unresolved', costNanoUsd: null }); expect(failure).toBeNull();
  });
  it('video-input explicit client-result successor binds fresh full original/video rate and own intent ACK before POST2', async () => {
    saveInlineRates(videoRates()); const context = await createAccounting(), executor = new DefaultExecutor('gemini'), first = videoOptions(context, false);
    first.body.tools = clientOptions(context).body.tools; const raw = inlineMessage('VIDEO'); raw.candidates[0].content = clientMessage().candidates[0].content;
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(requests.length === 1 ? raw : inlineMessage('VIDEO'))); };
    expect(await (await executor.execute(first)).response.json()).toEqual(raw); expect(requests).toHaveLength(1);
    saveInlineRates({ ...videoRates(), input_video: '13' }); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, async beforeAttempt(...input) { const attempt = await context.beforeAttempt(...input); enter(); await held; return attempt; } };
    const next = videoOptions(accounting, false); next.body.tools = first.body.tools;
    next.body.contents.push(structuredClone(raw.candidates[0].content), { role: 'user', parts: [{ functionResponse: { id: 'current_call', name: 'lookup', response: { error: 'private result' } } }] });
    const original = structuredClone(next.body), work = executor.execute(next);
    try { await Promise.race([entered, work.then(() => { throw new Error('video successor POST before intent ACK'); })]); expect(requests).toHaveLength(1); expect(db.all('SELECT state FROM apiKeyAccounting ORDER BY rowid')).toEqual([{ state: 'settled' }, { state: 'pending' }]); } finally { release(); }
    expect(await (await work).response.json()).toEqual(inlineMessage('VIDEO')); expect(requests).toHaveLength(2);
    const { model: _model, stream: _stream, ...wire } = original; expect(requests[1].body).toEqual(wire);
    const rows = db.all('SELECT attemptId,requestId,state,costNanoUsd,priceSnapshotJson FROM apiKeyAccounting ORDER BY rowid'); expect(rows.map(row => row.costNanoUsd)).toEqual([536000, 616000]);
    expect(new Set(rows.map(row => row.attemptId)).size).toBe(2); expect(rows.every(row => row.requestId === context.requestId && row.state === 'settled')).toBe(true);
    expect(rows.map(row => JSON.parse(row.priceSnapshotJson).rates.input_video)).toEqual(['11', '13']); expect(next.body).toEqual(original); expect(failure).toBeNull();
  });
  it.each(['audio/m4a', 'audio/l16', 'audio/opus', 'audio/alaw', 'audio/mulaw', 'audio/webm'].flatMap(mime => [[mime, false], [mime, true]]))('remaining audio MIME %s live=%s whole POST owns observed AUDIO, original price and terminal ACK', async (mime, live) => {
    saveInlineRates(audioRates()); const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, completeAttempt: vi.fn(async (...input) => { const terminal = await context.completeAttempt(...input); enter(); await held; return terminal; }) };
    const args = audioOptions(accounting, live); args.body.contents[0].parts[1].inlineData = { mimeType: mime, data: live ? 'YWI=' : 'YQ==', displayName: 'private remaining codec' };
    const original = structuredClone(args.body), raw = inlineMessage('AUDIO'), text = `data: ${JSON.stringify(raw)}\n\n`; let price;
    responder = (_request, response) => {
      price = JSON.parse(db.get('SELECT priceSnapshotJson FROM apiKeyAccounting').priceSnapshotJson); saveInlineRates({ ...audioRates(), input_audio: '70' });
      response.writeHead(200, { 'content-type': live ? 'text/event-stream' : 'application/json' }); response.end(live ? text : JSON.stringify(raw));
    };
    let ended = false; const consume = new DefaultExecutor('gemini').execute(args).then(result => result.response.text()); consume.then(() => { ended = true; }, () => { ended = true; });
    try { await Promise.race([entered, consume.then(() => { throw new Error('remaining codec success before own ACK'); })]); expect(ended).toBe(false); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: 373000 }); } finally { release(); }
    if (live) expect(await consume).toBe(text); else expect(JSON.parse(await consume)).toEqual(raw);
    const { model: _model, stream: _stream, ...wire } = original; expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(wire); expect(requests[0].row).toEqual({ requestId: context.requestId, state: 'pending' });
    expect(price).toMatchObject({ rates: { input_audio: '7', cached_audio: '0.4' }, rateUnits: { input_audio: 'USD/1M tokens', cached_audio: 'USD/1M tokens' }, usageSemantics: { allowedInputModalities: ['TEXT', 'AUDIO'], inputModalities: 'observed_gemini_inline_input_modalities' } });
    const row = db.get('SELECT usageJson,priceSnapshotJson FROM apiKeyAccounting'); expect(JSON.parse(row.usageJson).inputModalities.AUDIO).toEqual({ input: 70, cacheRead: 30 });
    expect(JSON.stringify(row)).not.toMatch(/private|YWI=|YQ==|dummy-provider/); expect(args.body).toEqual(original); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(failure).toBeNull();
  });
  it.each(['required-rate-at-zero', 'observed-zero', 'missing-details'])('remaining audio MIME attribution %s never estimates quantity from codec or bytes', async mode => {
    saveInlineRates(audioRates()); const context = await createAccounting(), args = audioOptions(context, false); args.body.contents[0].parts[1].inlineData.mimeType = 'audio/l16';
    const raw = inlineMessage('AUDIO'); raw.usageMetadata.promptTokensDetails = [{ modality: 'TEXT', tokenCount: 100 }, { modality: 'AUDIO', tokenCount: 0 }];
    raw.usageMetadata.cacheTokensDetails = [{ modality: 'TEXT', tokenCount: 40 }, { modality: 'AUDIO', tokenCount: 0 }];
    if (mode === 'required-rate-at-zero') { const rates = audioRates(); delete rates.input_audio; saveInlineRates(rates); }
    if (mode === 'missing-details') delete raw.usageMetadata.promptTokensDetails;
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(raw)); };
    const work = new DefaultExecutor('gemini').execute(args);
    if (mode === 'required-rate-at-zero') { await expect(work).rejects.toMatchObject({ code: 'model_pricing_unavailable' }); expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); }
    else if (mode === 'missing-details') { await expect(work).rejects.toThrow(); expect(requests).toHaveLength(1); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'unresolved', costNanoUsd: null }); }
    else { expect(await (await work).response.json()).toEqual(raw); expect(requests).toHaveLength(1); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: 124000 }); expect(JSON.parse(db.get('SELECT usageJson FROM apiKeyAccounting').usageJson).inputModalities.AUDIO).toEqual({ input: 0, cacheRead: 0 }); }
    expect(failure).toBeNull();
  });
  it.each(['json', 'sse', 'mixed-client-image', 'missing-details', 'lost-ack'])('audio-input queued %s binds original audio/declared-client POST, observed AUDIO rates and own ACK', async mode => {
    saveInlineRates(audioRates()); const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const valid = ['json', 'sse', 'mixed-client-image'].includes(mode);
    const accounting = { ...context, completeAttempt: vi.fn(async (...input) => {
      const terminal = await context.completeAttempt(...input); enter(); if (valid) await held;
      if (mode === 'lost-ack') throw new Error('fixture audio ACK lost'); return terminal;
    }) };
    const args = audioOptions(accounting, mode !== 'json'), raw = inlineMessage('AUDIO');
    if (mode === 'mixed-client-image') {
      args.body.tools = clientOptions(accounting).body.tools; args.body.toolConfig = { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['lookup'] } };
      args.body.contents[0].parts.push({ inlineData: { mimeType: 'image/png', data: 'YQ==' } });
      args.body.contents.push({ role: 'model', parts: [{ functionCall: { id: 'old_call', name: 'lookup', args: { q: 'private old' } }, thoughtSignature: 'b3BhcXVl' }] },
        { role: 'user', parts: [{ functionResponse: { id: 'old_call', name: 'lookup', response: { error: 'private old result' } } }] });
      raw.candidates[0].content = clientMessage().candidates[0].content;
      raw.usageMetadata.promptTokensDetails[1].tokenCount = 60; raw.usageMetadata.promptTokensDetails.push({ modality: 'IMAGE', tokenCount: 10 });
      raw.usageMetadata.cacheTokensDetails[1].tokenCount = 20; raw.usageMetadata.cacheTokensDetails.push({ modality: 'IMAGE', tokenCount: 10 });
    }
    if (mode === 'missing-details') delete raw.usageMetadata.cacheTokensDetails;
    const original = structuredClone(args.body), text = `data: ${JSON.stringify(raw)}\n\n`, cost = mode === 'mixed-client-image' ? 371000 : 373000; let pendingPrice;
    responder = (_request, response) => {
      pendingPrice = JSON.parse(db.get('SELECT priceSnapshotJson FROM apiKeyAccounting').priceSnapshotJson);
      saveInlineRates({ ...audioRates(), input_audio: '70' });
      response.writeHead(200, { 'content-type': mode === 'json' ? 'application/json' : 'text/event-stream' }); response.end(mode === 'json' ? JSON.stringify(raw) : text);
    };
    let ended = false; const consume = new DefaultExecutor('gemini').execute(args).then(result => result.response.text()); consume.then(() => { ended = true; }, () => { ended = true; });
    if (valid) {
      try { await Promise.race([entered, consume.then(() => { throw new Error('audio terminal before own ACK'); })]); expect(ended).toBe(false); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: cost }); }
      finally { release(); }
      if (mode === 'json') expect(JSON.parse(await consume)).toEqual(raw); else expect(await consume).toBe(text);
    } else { await expect(consume).rejects.toThrow('Gateway accounting stream unavailable'); await entered; }
    const { model: _model, stream: _stream, ...wire } = original; expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(wire);
    expect(requests[0].row).toEqual({ requestId: context.requestId, state: 'pending' }); expect(requests[0].key).toBe('dummy-provider');
    expect(pendingPrice).toMatchObject({ rates: { input_audio: '7', cached_audio: '0.4' }, rateUnits: { input_audio: 'USD/1M tokens', cached_audio: 'USD/1M tokens' },
      usageSemantics: { inputModalities: 'observed_gemini_inline_input_modalities', allowedInputModalities: mode === 'mixed-client-image' ? ['TEXT', 'AUDIO', 'IMAGE'] : ['TEXT', 'AUDIO'] } });
    const row = db.get('SELECT state,costNanoUsd,usageJson,priceSnapshotJson FROM apiKeyAccounting'); expect(row).toMatchObject({ state: mode === 'missing-details' ? 'unresolved' : 'settled', costNanoUsd: mode === 'missing-details' ? null : cost });
    if (mode !== 'missing-details') expect(JSON.parse(row.usageJson).inputModalities.AUDIO).toEqual({ input: mode === 'mixed-client-image' ? 60 : 70, cacheRead: mode === 'mixed-client-image' ? 20 : 30 });
    expect(JSON.stringify(row)).not.toMatch(/private|b3BhcXVl|dummy-provider|current_call|old_call/); expect(args.body).toEqual(original); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(failure).toBeNull();
  });
  it.each(['default-mode', 'image-mode', 'flat-rates', 'missing-audio-cache', 'missing-text-cache', 'mixed-missing-image', 'no-audio', 'credential-drift', 'getter'])('audio-input pre-intent %s refuses without POST or intent even unlimited', async mode => {
    saveInlineRates(audioRates()); const context = await createAccounting(), getter = vi.fn();
    const accounting = { ...context, beforeAttempt(...input) {
      const work = context.beforeAttempt(...input);
      if (mode === 'credential-drift') db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']); db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(row.data), apiKey: 'dummy-new' }), 'c']); });
      return work;
    } };
    const args = audioOptions(accounting), rates = audioRates();
    if (mode === 'default-mode') args.accountingMode = 'native-gemini-sse';
    if (mode === 'image-mode') args.accountingMode = 'native-gemini-inline-sse';
    if (mode === 'flat-rates') saveInlineRates({ input: '1', output: '2', cached: '0.1' });
    if (mode === 'missing-audio-cache') { delete rates.cached_audio; saveInlineRates(rates); }
    if (mode === 'missing-text-cache') { delete rates.cached; saveInlineRates(rates); }
    if (mode === 'mixed-missing-image') { args.body.contents[0].parts.push({ inlineData: { mimeType: 'image/png', data: 'YQ==' } }); delete rates.cached_image; saveInlineRates(rates); }
    if (mode === 'no-audio') args.body.contents[0].parts[1].inlineData.mimeType = 'image/png';
    if (mode === 'getter') Object.defineProperty(args.body.contents[0].parts[1].inlineData, 'data', { enumerable: true, get: getter });
    const work = new DefaultExecutor('gemini').execute(args);
    if (['flat-rates', 'missing-audio-cache', 'missing-text-cache', 'mixed-missing-image'].includes(mode)) await expect(work).rejects.toMatchObject({ code: 'model_pricing_unavailable' }); else await expect(work).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled(); expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(failure).toBeNull();
  });
  it('audio-input explicit zero prices retain nonzero observed AUDIO and original required rates', async () => {
    const rates = audioRates(); for (const key of Object.keys(rates)) rates[key] = '0'; saveInlineRates(rates);
    const raw = inlineMessage('AUDIO'); responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(raw)); };
    expect(await (await new DefaultExecutor('gemini').execute(audioOptions(await createAccounting(), false))).response.json()).toEqual(raw);
    const row = db.get('SELECT state,costNanoUsd,usageJson,priceSnapshotJson FROM apiKeyAccounting'); expect(row).toMatchObject({ state: 'settled', costNanoUsd: 0 });
    expect(JSON.parse(row.usageJson).inputModalities.AUDIO.input).toBe(70); expect(JSON.parse(row.priceSnapshotJson).rates.cached_audio).toBe('0'); expect(requests).toHaveLength(1); expect(failure).toBeNull();
  });
  it.each(['unclean-eof', 'sink-exception'])('audio-input terminal %s has one completion and no successful terminal', async mode => {
    saveInlineRates(audioRates()); const context = await createAccounting(), accounting = { ...context, completeAttempt: vi.fn((...input) => {
      if (mode === 'sink-exception') throw new Error('fixture audio sink exception'); return context.completeAttempt(...input);
    }) };
    const raw = inlineMessage('AUDIO'); if (mode === 'unclean-eof') delete raw.candidates[0].finishReason;
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(`data: ${JSON.stringify(raw)}\n\n`); };
    const result = await new DefaultExecutor('gemini').execute(audioOptions(accounting)); await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable');
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(requests).toHaveLength(1); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: mode === 'sink-exception' ? 'pending' : 'unresolved', costNanoUsd: null }); expect(failure).toBeNull();
  });
  it('audio-input client-result successor retains original audio/signature/result with fresh rate and own intent ACK before POST2', async () => {
    saveInlineRates(audioRates()); const context = await createAccounting(), executor = new DefaultExecutor('gemini'), first = audioOptions(context, false);
    first.body.tools = clientOptions(context).body.tools; const raw = inlineMessage('AUDIO'); raw.candidates[0].content = clientMessage().candidates[0].content;
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(requests.length === 1 ? raw : inlineMessage('AUDIO'))); };
    expect(await (await executor.execute(first)).response.json()).toEqual(raw); expect(requests).toHaveLength(1);
    saveInlineRates({ ...audioRates(), input_audio: '9' }); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, async beforeAttempt(...input) { const attempt = await context.beforeAttempt(...input); enter(); await held; return attempt; } };
    const next = audioOptions(accounting, false); next.body.tools = first.body.tools;
    next.body.contents.push(structuredClone(raw.candidates[0].content), { role: 'user', parts: [{ functionResponse: { id: 'current_call', name: 'lookup', response: { error: 'private result' } } }] });
    const original = structuredClone(next.body), work = executor.execute(next);
    try { await Promise.race([entered, work.then(() => { throw new Error('audio successor POST before intent ACK'); })]); expect(requests).toHaveLength(1); expect(db.all('SELECT state FROM apiKeyAccounting ORDER BY rowid')).toEqual([{ state: 'settled' }, { state: 'pending' }]); } finally { release(); }
    expect(await (await work).response.json()).toEqual(inlineMessage('AUDIO')); expect(requests).toHaveLength(2);
    const { model: _model, stream: _stream, ...wire } = original; expect(requests[1].body).toEqual(wire);
    const rows = db.all('SELECT attemptId,requestId,state,costNanoUsd,priceSnapshotJson FROM apiKeyAccounting ORDER BY rowid'); expect(rows.map(row => row.costNanoUsd)).toEqual([373000, 453000]);
    expect(new Set(rows.map(row => row.attemptId)).size).toBe(2); expect(rows.every(row => row.requestId === context.requestId && row.state === 'settled')).toBe(true);
    expect(rows.map(row => JSON.parse(row.priceSnapshotJson).rates.input_audio)).toEqual(['7', '9']); expect(next.body).toEqual(original); expect(failure).toBeNull();
  });
  it.each(['json', 'sse', 'client-media', 'missing-details', 'lost-ack'])('inline-media queued %s binds full original bytes, raw modalities, explicit original price and own ACK', async mode => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, completeAttempt: vi.fn(async (...input) => {
      const terminal = await context.completeAttempt(...input); enter();
      if (['json', 'sse', 'client-media'].includes(mode)) await held;
      if (mode === 'lost-ack') throw new Error('fixture inline ACK lost'); return terminal;
    }) };
    const args = mode === 'client-media' ? clientOptions(accounting) : options(accounting);
    args.stream = args.body.stream = mode !== 'json'; args.accountingMode = mode === 'json' ? 'native-gemini-inline-json' : 'native-gemini-inline-sse';
    args.body.contents[0].parts.push({ inlineData: { mimeType: 'image/png', data: 'b3BhcXVl', displayName: 'private inline' } });
    const original = structuredClone(args.body), raw = mode === 'client-media' ? clientMessage() : structuredClone(message);
    raw.usageMetadata.promptTokensDetails = [{ modality: 'TEXT', tokenCount: 30 }, { modality: 'IMAGE', tokenCount: 70 }];
    raw.usageMetadata.cacheTokensDetails = [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'IMAGE', tokenCount: 30 }];
    if (mode === 'missing-details') delete raw.usageMetadata.promptTokensDetails;
    const rates = { input: '1', output: '2', cached: '0.1', input_image: '3', cached_image: '0.2' };
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='gemini'", [JSON.stringify({ 'fixture-gemini': rates })]));
    const text = `data: ${JSON.stringify(raw)}\n\n`; let pendingPrice;
    responder = (_request, response) => {
      pendingPrice = JSON.parse(db.get('SELECT priceSnapshotJson FROM apiKeyAccounting').priceSnapshotJson);
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='gemini'", [JSON.stringify({ 'fixture-gemini': { input: '9', output: '9', cached: '9', input_image: '9', cached_image: '9' } })]));
      response.writeHead(200, { 'content-type': mode === 'json' ? 'application/json' : 'text/event-stream' }); response.end(mode === 'json' ? JSON.stringify(raw) : text);
    };
    let ended = false; const consume = new DefaultExecutor('gemini').execute(args).then(result => result.response.text()); consume.then(() => { ended = true; }, () => { ended = true; });
    if (['json', 'sse', 'client-media'].includes(mode)) {
      try { await Promise.race([entered, consume.then(() => { throw new Error('inline terminal before own ACK'); })]); expect(ended).toBe(false); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: 207000 }); }
      finally { release(); }
      if (mode === 'json') expect(JSON.parse(await consume)).toEqual(raw); else expect(await consume).toBe(text);
    } else { await expect(consume).rejects.toThrow('Gateway accounting stream unavailable'); await entered; }
    const { model: _model, stream: _stream, ...wire } = original;
    expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(wire); expect(requests[0].row).toEqual({ requestId: context.requestId, state: 'pending' }); expect(requests[0].key).toBe('dummy-provider');
    expect(pendingPrice).toMatchObject({ rates, usageSemantics: { inputModalities: 'observed_gemini_inline_input_modalities', allowedInputModalities: ['TEXT', 'IMAGE'] }, rateUnits: { input_image: 'USD/1M tokens', cached_image: 'USD/1M tokens' } });
    const row = db.get('SELECT state,costNanoUsd,usageJson,priceSnapshotJson FROM apiKeyAccounting'); expect(row).toMatchObject({ state: mode === 'missing-details' ? 'unresolved' : 'settled', costNanoUsd: mode === 'missing-details' ? null : 207000 });
    if (mode !== 'missing-details') expect(JSON.parse(row.usageJson)).toMatchObject({ inputModalities: { TEXT: { input: 30, cacheRead: 10 }, IMAGE: { input: 70, cacheRead: 30 } } });
    expect(JSON.stringify(row)).not.toMatch(/private|b3BhcXVl|dummy-provider|current_call/); expect(args.body).toEqual(original); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(failure).toBeNull();
  });
  it.each(['default-mode', 'flat-rates', 'missing-image-cache', 'missing-text-cache', 'pdf-missing-document', 'credential-drift', 'getter'])('inline-media pre-intent %s refuses without POST or monetary intent, even unlimited', async mode => {
    saveInlineRates(); const context = await createAccounting(), getter = vi.fn();
    const accounting = { ...context, beforeAttempt(...input) {
      const work = context.beforeAttempt(...input);
      if (mode === 'credential-drift') db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']); db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(row.data), apiKey: 'dummy-new' }), 'c']); });
      return work;
    } };
    const args = inlineOptions(accounting, true, mode === 'pdf-missing-document' ? 'application/pdf' : 'image/png');
    if (mode === 'default-mode') args.accountingMode = 'native-gemini-sse';
    const rates = inlineRates();
    if (mode === 'flat-rates') saveInlineRates({ input: '1', output: '2', cached: '0.1' });
    if (mode === 'missing-image-cache') { delete rates.cached_image; saveInlineRates(rates); }
    if (mode === 'missing-text-cache') { delete rates.cached; saveInlineRates(rates); }
    if (mode === 'pdf-missing-document') { delete rates.input_document; saveInlineRates(rates); }
    if (mode === 'getter') Object.defineProperty(args.body.contents[0].parts[1].inlineData, 'data', { enumerable: true, get: getter });
    const work = new DefaultExecutor('gemini').execute(args);
    if (['flat-rates', 'missing-image-cache', 'missing-text-cache', 'pdf-missing-document'].includes(mode)) await expect(work).rejects.toMatchObject({ code: 'model_pricing_unavailable' }); else await expect(work).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled(); expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(failure).toBeNull();
  });
  it('inline-media explicit zero per-modality rates are priced with observed attribution, not fabricated free usage', async () => {
    const rates = inlineRates(); for (const key of Object.keys(rates)) rates[key] = '0'; saveInlineRates(rates);
    const raw = inlineMessage(); responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(raw)); };
    expect(await (await new DefaultExecutor('gemini').execute(inlineOptions(await createAccounting(), false))).response.json()).toEqual(raw);
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: 0 });
    const row = db.get('SELECT usageJson,priceSnapshotJson FROM apiKeyAccounting'); expect(JSON.parse(row.usageJson).inputModalities.IMAGE.input).toBe(70);
    expect(JSON.parse(row.priceSnapshotJson).rates.cached_image).toBe('0'); expect(requests).toHaveLength(1); expect(failure).toBeNull();
  });
  it('inline PDF schema attribution has original explicit IMAGE and DOCUMENT prices; observed DOCUMENT tokens alone cost money', async () => {
    saveInlineRates(); const raw = inlineMessage('DOCUMENT'), args = inlineOptions(await createAccounting(), false, 'application/pdf');
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(raw)); };
    expect(await (await new DefaultExecutor('gemini').execute(args)).response.json()).toEqual(raw);
    expect(requests[0].body.contents[0].parts[1].inlineData).toEqual(args.body.contents[0].parts[1].inlineData);
    const row = db.get('SELECT state,costNanoUsd,priceSnapshotJson,usageJson FROM apiKeyAccounting'); expect(row).toMatchObject({ state: 'settled', costNanoUsd: 250000 });
    expect(JSON.parse(row.priceSnapshotJson).usageSemantics.allowedInputModalities).toEqual(['TEXT', 'IMAGE', 'DOCUMENT']);
    expect(JSON.parse(row.usageJson).inputModalities).toEqual({ TEXT: { input: 30, cacheRead: 10 }, DOCUMENT: { input: 70, cacheRead: 30 } });
    expect(failure).toBeNull(); // Dummy bytes prove protocol conservation, not PDF decoding/pages or live reporting.
  });
  it.each(['unclean-eof', 'sink-exception'])('inline-media terminal %s has one completion and no successful terminal delivery', async mode => {
    saveInlineRates(); const context = await createAccounting(), accounting = { ...context, completeAttempt: vi.fn((...input) => {
      if (mode === 'sink-exception') throw new Error('fixture inline sink exception'); return context.completeAttempt(...input);
    }) };
    const raw = inlineMessage(); if (mode === 'unclean-eof') delete raw.candidates[0].finishReason;
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(`data: ${JSON.stringify(raw)}\n\n`); };
    const result = await new DefaultExecutor('gemini').execute(inlineOptions(accounting)); await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable');
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(requests).toHaveLength(1);
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: mode === 'sink-exception' ? 'pending' : 'unresolved', costNanoUsd: null }); expect(failure).toBeNull();
  });
  it('inline client-result successor has fresh original media/rates and own intent ACK; no automatic generation or free inherited use', async () => {
    saveInlineRates(); const context = await createAccounting(), executor = new DefaultExecutor('gemini'), first = inlineOptions(context, false);
    first.body.tools = clientOptions(context).body.tools; const raw = inlineMessage(); raw.candidates[0].content = clientMessage().candidates[0].content;
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(requests.length === 1 ? raw : inlineMessage())); };
    expect(await (await executor.execute(first)).response.json()).toEqual(raw); expect(requests).toHaveLength(1);
    saveInlineRates({ ...inlineRates(), input_image: '5' });
    let enter, release; const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, async beforeAttempt(...input) { const attempt = await context.beforeAttempt(...input); enter(); await held; return attempt; } };
    const next = inlineOptions(accounting, false); next.body.tools = first.body.tools;
    next.body.contents.push(structuredClone(raw.candidates[0].content), { role: 'user', parts: [{ functionResponse: { id: 'current_call', name: 'lookup', response: { error: 'private result' } } }] });
    const original = structuredClone(next.body), work = executor.execute(next);
    try { await Promise.race([entered, work.then(() => { throw new Error('inline successor POST before intent ACK'); })]); expect(requests).toHaveLength(1); expect(db.all('SELECT state FROM apiKeyAccounting ORDER BY rowid')).toEqual([{ state: 'settled' }, { state: 'pending' }]); } finally { release(); }
    expect(await (await work).response.json()).toEqual(inlineMessage()); expect(requests).toHaveLength(2);
    const { model: _model, stream: _stream, ...wire } = original; expect(requests[1].body).toEqual(wire);
    const rows = db.all('SELECT attemptId,requestId,state,costNanoUsd,priceSnapshotJson FROM apiKeyAccounting ORDER BY rowid'); expect(rows.map(row => row.costNanoUsd)).toEqual([207000, 287000]);
    expect(new Set(rows.map(row => row.attemptId)).size).toBe(2); expect(rows.every(row => row.requestId === context.requestId && row.state === 'settled')).toBe(true);
    expect(rows.map(row => JSON.parse(row.priceSnapshotJson).rates.input_image)).toEqual(['3', '5']); expect(next.body).toEqual(original); expect(failure).toBeNull();
  });
  it.each(['json', 'sse', 'undeclared', 'missing-usage', 'lost-ack'])('client-function queued %s binds original POST/raw signature/token price and own ACK', async mode => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, completeAttempt: vi.fn(async (...input) => {
      const terminal = await context.completeAttempt(...input); enter();
      if (mode === 'json' || mode === 'sse') await held;
      if (mode === 'lost-ack') throw new Error('fixture Gemini client ACK lost'); return terminal;
    }) };
    const args = options(accounting); args.stream = args.body.stream = mode !== 'json';
    args.accountingMode = mode === 'json' ? 'native-gemini-client-json' : 'native-gemini-client-sse';
    args.body.tools = [{ functionDeclarations: [{ name: 'lookup', description: 'Private client lookup', parameters: { type: 'OBJECT' } }] }];
    args.body.toolConfig = { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['lookup'] } };
    args.body.contents.push({ role: 'model', parts: [{ functionCall: { id: 'original_call', name: 'lookup', args: { q: 'private original query' } }, thoughtSignature: 'b3BhcXVl' }] },
      { role: 'user', parts: [{ functionResponse: { id: 'original_call', name: 'lookup', response: { error: 'private original error' } } }] });
    const original = structuredClone(args.body), raw = structuredClone(message);
    raw.candidates[0].content.parts = [{ functionCall: { id: 'current_call', name: mode === 'undeclared' ? 'Task' : 'lookup', args: { q: 'private raw query' } }, thoughtSignature: 'b3BhcXVl' }];
    if (mode === 'missing-usage') delete raw.usageMetadata;
    const delta = { modelVersion: 'fixture-gemini', responseId: 'client_raw', candidates: [{ index: 0, content: raw.candidates[0].content }] };
    const last = { ...raw, responseId: 'client_raw', candidates: [{ ...raw.candidates[0], content: { role: 'model', parts: [] } }] };
    const text = `data: ${JSON.stringify(delta)}\n\ndata: ${JSON.stringify(last)}\n\n`; let pendingPrice;
    responder = (_request, response) => {
      pendingPrice = JSON.parse(db.get('SELECT priceSnapshotJson FROM apiKeyAccounting').priceSnapshotJson);
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='gemini'", [JSON.stringify({ 'fixture-gemini': { input: '9', output: '9', cached: '9' } })]));
      response.writeHead(200, { 'content-type': mode === 'json' ? 'application/json' : 'text/event-stream' }); response.end(mode === 'json' ? JSON.stringify(raw) : text);
    };
    let ended = false; const consume = new DefaultExecutor('gemini').execute(args).then(result => result.response.text()); consume.then(() => { ended = true; }, () => { ended = true; });
    if (mode === 'json' || mode === 'sse') {
      try { await Promise.race([entered, consume.then(() => { throw new Error('terminal before own ACK'); })]); expect(ended).toBe(false); expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 124000 }]); }
      finally { release(); }
      if (mode === 'json') expect(JSON.parse(await consume)).toEqual(raw); else expect(await consume).toBe(text);
    } else { await expect(consume).rejects.toThrow('Gateway accounting stream unavailable'); await entered; }
    const { model: _model, stream: _stream, ...originalWire } = original;
    expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(originalWire); expect(requests[0].key).toBe('dummy-provider');
    expect(requests[0].row).toEqual({ requestId: context.requestId, state: 'pending' }); expect(pendingPrice.rates).toMatchObject({ input: '1', output: '2', cached: '0.1' });
    const unknown = mode === 'undeclared' || mode === 'missing-usage';
    const row = db.get('SELECT state,costNanoUsd,usageJson,priceSnapshotJson FROM apiKeyAccounting');
    expect(row).toMatchObject({ state: unknown ? 'unresolved' : 'settled', costNanoUsd: unknown ? null : 124000 });
    if (!unknown) expect(JSON.parse(row.usageJson)).toMatchObject({ exact: true, input: 100, output: 20, reasoning: 10, cacheRead: 40 });
    expect(JSON.stringify(row)).not.toMatch(/private|b3BhcXVl|dummy-provider|current_call/); expect(args.body).toEqual(original); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(failure).toBeNull();
  });
  it.each(['default-mode', 'missing-price', 'credential-drift', 'getter'])('client-function pre-intent %s refuses without unauthorized POST or intent', async mode => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      const work = context.beforeAttempt(meta, supported, wire);
      if (mode === 'credential-drift') db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']); db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(row.data), apiKey: 'dummy-new' }), 'c']); });
      return work;
    } };
    const args = clientOptions(accounting), getter = vi.fn();
    if (mode === 'default-mode') args.accountingMode = 'native-gemini-sse';
    if (mode === 'missing-price') db.durableTransaction(() => db.run("DELETE FROM kv WHERE scope='pricing' AND key='gemini'"));
    if (mode === 'getter') Object.defineProperty(args.body, 'tools', { enumerable: true, get: getter });
    const work = new DefaultExecutor('gemini').execute(args);
    if (mode === 'missing-price') await expect(work).rejects.toMatchObject({ code: 'model_pricing_unavailable' }); else await expect(work).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled(); expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(failure).toBeNull();
  });
  it('client-function explicit zero token rates are priced, not unavailable or inferred free work', async () => {
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='gemini'", [JSON.stringify({ 'fixture-gemini': { input: '0', output: '0', cached: '0' } })]));
    const raw = clientMessage(); responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(raw)); };
    expect(await (await new DefaultExecutor('gemini').execute(clientOptions(await createAccounting(), false))).response.json()).toEqual(raw);
    const row = db.get('SELECT state,costNanoUsd,priceSnapshotJson,usageJson FROM apiKeyAccounting');
    expect(row).toMatchObject({ state: 'settled', costNanoUsd: 0 }); expect(JSON.parse(row.priceSnapshotJson).rates).toMatchObject({ input: '0', output: '0', cached: '0' });
    expect(JSON.parse(row.usageJson)).toMatchObject({ exact: true, input: 100, output: 20, reasoning: 10 }); expect(requests).toHaveLength(1); expect(failure).toBeNull();
  });
  it.each(['unclean-eof', 'sink-exception'])('client-function terminal %s cannot fabricate exact usage or own durable ACK', async mode => {
    const context = await createAccounting(), accounting = { ...context, completeAttempt: vi.fn((...input) => {
      if (mode === 'sink-exception') throw new Error('fixture Gemini client sink exception'); return context.completeAttempt(...input);
    }) };
    const raw = clientMessage(); if (mode === 'unclean-eof') delete raw.candidates[0].finishReason;
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(`data: ${JSON.stringify(raw)}\n\n`); };
    const result = await new DefaultExecutor('gemini').execute(clientOptions(accounting)); await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable');
    expect(requests).toHaveLength(1); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1);
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: mode === 'sink-exception' ? 'pending' : 'unresolved', costNanoUsd: null }); expect(failure).toBeNull();
  });
  it('client-function continuation has no automatic generation; explicit successor binds original raw signature/result and fresh price/intent ACK', async () => {
    const context = await createAccounting(), executor = new DefaultExecutor('gemini'), first = clientOptions(context, false), raw = clientMessage();
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(requests.length === 1 ? raw : message)); };
    expect(await (await executor.execute(first)).response.json()).toEqual(raw); expect(requests).toHaveLength(1);
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='gemini'", [JSON.stringify({ 'fixture-gemini': { input: '2', output: '2', cached: '0.1' } })]));
    let enter, release; const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, async beforeAttempt(...input) { const attempt = await context.beforeAttempt(...input); enter(); await held; return attempt; } };
    const next = clientOptions(accounting, false); next.body.contents.push(structuredClone(raw.candidates[0].content), { role: 'user', parts: [{ functionResponse: { id: 'current_call', name: 'lookup', response: { error: 'private continuation result' } } }] });
    const original = structuredClone(next.body), work = executor.execute(next);
    try { await Promise.race([entered, work.then(() => { throw new Error('POST before own successor intent ACK'); })]); expect(requests).toHaveLength(1); expect(db.all('SELECT state FROM apiKeyAccounting ORDER BY rowid')).toEqual([{ state: 'settled' }, { state: 'pending' }]); } finally { release(); }
    expect(await (await work).response.json()).toEqual(message); expect(requests).toHaveLength(2);
    const { model: _model, stream: _stream, ...originalWire } = original; expect(requests[1].body).toEqual(originalWire);
    const rows = db.all('SELECT requestId,attemptId,state,costNanoUsd,priceSnapshotJson FROM apiKeyAccounting ORDER BY rowid');
    expect(rows.map(row => row.costNanoUsd)).toEqual([124000, 184000]); expect(new Set(rows.map(row => row.attemptId)).size).toBe(2);
    expect(rows.every(row => row.requestId === context.requestId && row.state === 'settled')).toBe(true);
    expect(rows.map(row => JSON.parse(row.priceSnapshotJson).rates.input)).toEqual(['1', '2']); expect(next.body).toEqual(original); expect(failure).toBeNull();
  });
  it('client-function pre-admission cancellation performs no intent or POST', async () => {
    const args = clientOptions(await createAccounting()), controller = new AbortController(); controller.abort(new Error('fixture cancellation')); args.signal = controller.signal;
    await expect(new DefaultExecutor('gemini').execute(args)).rejects.toThrow('fixture cancellation'); expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
  });
  it('actual original POST owns pending and settles original124000 despite upstream pricing mutation', async () => {
    const context = await createAccounting(), args = options(context);
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      expect(Reflect.set(wire.headers, 'x-goog-api-key', 'dummy-changed')).toBe(false);
      const work = context.beforeAttempt(meta, supported, wire); args.credentials.apiKey = 'dummy-changed'; args.body.contents[0].parts[0].text = 'changed'; return work;
    } };
    responder = (_request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='gemini'", [JSON.stringify({ 'fixture-gemini': { input: '9', output: '9', cached: '9' } })]));
      response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(message));
    };
    const result = await new DefaultExecutor('gemini').execute({ ...args, accounting });
    expect(await result.response.json()).toEqual(message); expect(failure).toBeNull(); expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({ method: 'POST', key: 'dummy-provider', url: '/v1beta/models/fixture-gemini:generateContent', body: { contents: [{ role: 'user', parts: [{ text: 'fixture' }] }] }, row: { requestId: context.requestId, state: 'pending' } });
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 124000 }]); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('native JSON success cannot return while own queued terminal ACK is held', async () => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, async completeAttempt(attempt, completion) { enter(); await held; return context.completeAttempt(attempt, completion); } };
    let returned = false; const work = new DefaultExecutor('gemini').execute(options(accounting)).then(value => { returned = true; return value; });
    try { await entered; expect(returned).toBe(false); expect(requests).toHaveLength(1); expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'pending', costNanoUsd: null }]); }
    finally { release(); }
    expect((await work).response.ok).toBe(true); expect(failure).toBeNull();
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 124000 }]);
  });
  it('credential drift at dequeue refuses before any native POST or intent', async () => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      const work = context.beforeAttempt(meta, supported, wire);
      db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']); db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(row.data), apiKey: 'dummy-new' }), 'c']); }); return work;
    } };
    await expect(new DefaultExecutor('gemini').execute(options(accounting))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('native SSE delta passes but terminal frame waits for own queued ACK', async () => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, async completeAttempt(attempt, completion) { enter(); await held; return context.completeAttempt(attempt, completion); } };
    const delta = { modelVersion: 'fixture-gemini', candidates: [{ index: 0, content: { role: 'model', parts: [{ text: 'live answer' }] } }] };
    const text = `data: ${JSON.stringify(delta)}\n\ndata: ${JSON.stringify(message)}\n\n`;
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(text); };
    const args = options(accounting); args.stream = args.body.stream = true; args.accountingMode = 'native-gemini-sse';
    const result = await new DefaultExecutor('gemini').execute(args);
    let delivered = '', ended = false;
    const consume = (async () => { const reader = result.response.body.getReader(), decoder = new TextDecoder();
      try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; delivered += decoder.decode(chunk.value, { stream: true }); } delivered += decoder.decode(); ended = true; }
      finally { reader.releaseLock(); }
    })();
    try {
      await entered; expect(ended).toBe(false); expect(delivered).toContain('live answer'); expect(delivered).not.toContain('finishReason'); expect(delivered).not.toContain('usageMetadata');
      expect(requests).toHaveLength(1); expect(requests[0].url).toBe('/v1beta/models/fixture-gemini:streamGenerateContent?alt=sse');
      expect(requests[0].row).toMatchObject({ requestId: context.requestId, state: 'pending' }); expect(requests[0].body).not.toHaveProperty('stream');
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'pending', costNanoUsd: null }]);
    } finally { release(); }
    await consume; expect(delivered).toBe(text); expect(failure).toBeNull();
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 124000 }]); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('native SSE EOF without finish errors delivery then observes own unresolved ACK', async () => {
    const context = await createAccounting(); let acknowledged;
    const ack = new Promise(resolve => { acknowledged = resolve; });
    const accounting = { ...context, async completeAttempt(attempt, completion) { const terminal = await context.completeAttempt(attempt, completion); acknowledged(); return terminal; } };
    const delta = { modelVersion: 'fixture-gemini', candidates: [{ index: 0, content: { role: 'model', parts: [{ text: 'live answer' }] } }] };
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(`data: ${JSON.stringify(delta)}\n\n`); };
    const args = options(accounting); args.stream = args.body.stream = true; args.accountingMode = 'native-gemini-sse';
    const result = await new DefaultExecutor('gemini').execute(args);
    await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable'); await ack;
    expect(failure).toBeNull(); expect(requests).toHaveLength(1); expect(requests[0].row).toMatchObject({ requestId: context.requestId, state: 'pending' });
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', costNanoUsd: null }]); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('307 has no native generation replay and one unresolved terminal', async () => {
    responder = (_request, response) => { response.writeHead(307, { location: fixture.base + '/fixture-gemini:generateContent' }); response.end(); };
    await expect(new DefaultExecutor('gemini').execute(options(await createAccounting()))).rejects.toThrow();
    expect(failure).toBeNull(); expect(requests).toHaveLength(1); expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', costNanoUsd: null }]); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
});
