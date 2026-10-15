import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { createSqlJsAdapter } from '@/lib/db/adapters/sqljsAdapter.js';
import { acquireWriterOwnership } from '@/lib/db/writerOwnership.js';
import { openAccountingCoverage } from '@/lib/db/accountingCoverage.js';
import { runMigrationOnce } from '@/lib/db/migrate.js';
import { seedGeminiAccountingFixture } from './fixtures/accounting-gemini-db.js';
import { createAccountingFixtureLifetime } from './fixtures/accounting-fixture-lifetime.js';
import { openGeminiResourceLifecycleSync } from '@/lib/apiKeyBudget/geminiResourceLifecycle.js';
import { getAccountingWriteCoordinator } from '@/lib/apiKeyBudget/accountingWriteCoordinator.js';
const route = vi.hoisted(() => ({ origin: null, base: null }));
const ack = vi.hoisted(() => ({ after: null, before: null, calls: 0 }));
// Owned loopback only. Both registry and fixed route authority are replaced;
// actual upload/native fetch/coordinator/parser/money remain real.
vi.mock('../../src/lib/apiKeyBudget/geminiUploadProtocol.js', async original => ({ ...await original(), get GEMINI_UPLOAD_ORIGIN() { return route.origin; } }));
vi.mock('../../open-sse/config/providers.js', async original => {
  const value = await original();
  return { ...value, PROVIDERS: { ...value.PROVIDERS, get gemini() { return { ...value.PROVIDERS.gemini, baseUrl: route.base }; } } };
});
vi.mock('../../open-sse/config/accountedGeminiCandidate.js', async original => {
  const value = await original();
  return { ...value, get ACCOUNTED_GEMINI_BASE() { return route.base; },
    supportsGeminiCandidate(executor, options, url, body, headers) {
      const suffix = `/${options.model}${options.stream ? value.ACCOUNTED_GEMINI_STREAM_ACTION + '?alt=sse' : value.ACCOUNTED_GEMINI_ACTION}`;
      return url === route.base + suffix && value.supportsGeminiCandidate(executor, options, value.ACCOUNTED_GEMINI_BASE + suffix, body, headers);
    } };
});
let dir, db, owner, server, requests, original, cap, accounting, responseMessage, resource, mixedResources, uploadSessions;
const binding = () => ({ credential: 'dummy-key-a', apiKeyId: 'a', provider: 'gemini', model: 'fixture-gemini', connectionId: 'c' });
const bytes = Buffer.from('dummy owned video bytes not codec proof');
let lifetime;
const rates = { input: '1', output: '2', cached: '0.1', input_image: '3', cached_image: '0.2', input_audio: '7', cached_audio: '0.4', input_video: '11', cached_video: '0.5' };
beforeEach(async ({ signal }) => {
  lifetime = createAccountingFixtureLifetime(signal);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), '9router-owned-producer-'));
  owner = acquireWriterOwnership(dir); db = await createSqlJsAdapter(path.join(dir, 'data.sqlite'), owner);
  await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner); db.ownerInstanceId = owner.instanceId;
  expect(db.driver).toBe('sql.js'); seedGeminiAccountingFixture(db); openGeminiResourceLifecycleSync(db, owner);
  ack.after = null; ack.before = null; ack.calls = 0;
  requests = []; mixedResources = []; uploadSessions = new Map(); responseMessage = { modelVersion: binding().model, candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'private answer' }] } }], usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 40, candidatesTokenCount: 20, thoughtsTokenCount: 10, totalTokenCount: 130, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 20 }, { modality: 'IMAGE', tokenCount: 50 }, { modality: 'AUDIO', tokenCount: 30 }], cacheTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'IMAGE', tokenCount: 20 }, { modality: 'AUDIO', tokenCount: 10 }] } };
  server = http.createServer(async (req, res) => {
    let body = Buffer.alloc(0); for await (const chunk of req) body = Buffer.concat([body, chunk]);
    requests.push({ url: req.url, method: req.method, headers: req.headers, body });
    if (req.headers['x-goog-upload-command'] === 'start') {
      const file = JSON.parse(body.toString()).file, number = uploadSessions.size + 1;
      const session = number === 1 ? 'dummy-session' : 'dummy-session-' + number;
      uploadSessions.set(session, { file, number });
      res.writeHead(200, { 'X-Goog-Upload-URL': route.origin + '/upload/v1beta/files?upload_id=' + session }); res.end(); return;
    }
    if (req.headers['x-goog-upload-command'] === 'upload, finalize') {
      const { file, number } = uploadSessions.get(new URL(req.url, route.origin).searchParams.get('upload_id'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ file: { name: 'files/upload-' + number, uri: 'https://generativelanguage.googleapis.com/v1beta/files/upload-' + number, mimeType: file.mimeType, sizeBytes: String(body.length), sha256Hash: createHash('sha256').update(body).digest('base64'), createTime: new Date().toISOString(), updateTime: new Date().toISOString(), expirationTime: new Date(Date.now() + 86400000).toISOString(), state: 'ACTIVE', source: 'UPLOADED' } })); return;
    }
    const rows = db.all('SELECT state,priceSnapshotJson AS priceSnapshot FROM apiKeyAccounting');
    requests.at(-1).pending = rows;
    // Current reference drift after dispatch cannot reprice the original attempt.
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='gemini'", [JSON.stringify({ [binding().model]: Object.fromEntries(Object.keys(rates).map(k => [k, '100'])) })]));
    if (req.url.endsWith('?alt=sse')) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end('data: ' + JSON.stringify(responseMessage) + '\n\n'); }
    else { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(responseMessage)); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  route.origin = 'http://127.0.0.1:' + server.address().port; route.base = route.origin + '/v1beta/models';
});
afterEach(async () => {
  lifetime.close();
  if (db) await getAccountingWriteCoordinator(db).stop(); server?.closeAllConnections();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  vi.restoreAllMocks(); db?.close(); owner?.release(); fs.rmSync(dir, { recursive: true, force: true });
});
async function prepare(videoMetadata = false, videoResolution = false, controlled = true, mixed = false, clientTools = false, inlineMedia = false, inlineAudio = false, inlineVideo = false) {
  const own = lifetime, ownedDb = db;
  own.check();
  const upload = await import('@/lib/apiKeyBudget/geminiOwnedUpload.js'); own.check();
  resource = await upload.uploadGeminiOwnedFile({ db, binding: binding(), source: { dataBase64: bytes.toString('base64'), mimeType: 'video/mp4' }, signal: own.signal }); own.check();
  original = { contents: [{ role: 'user', parts: [{ text: 'private original' }, { fileData: { fileUri: resource.file.uri, displayName: 'preserved display' } }] }] };
  const authority = await import('@/lib/apiKeyBudget/geminiOwnedFileAuthority.js'); own.check();
  const schema = await import('open-sse/config/accountedGeminiCandidate.js'); own.check();
  if (videoMetadata && controlled) original.contents[0].parts[1].videoMetadata = { startOffset: '0s', endOffset: '2.000000001s', fps: 1 };
  if (videoResolution && controlled) {
    original.contents[0].parts[1].mediaResolution = { level: 'MEDIA_RESOLUTION_ULTRA_HIGH' };
    original.generationConfig = { mediaResolution: 'MEDIA_RESOLUTION_HIGH', maxOutputTokens: 20 };
  }
  mixedResources = [resource];
  if (mixed) {
    for (const mimeType of ['image/png', 'audio/wav', 'application/pdf']) {
      const next = await upload.uploadGeminiOwnedFile({ db, binding: binding(), source: { dataBase64: Buffer.from('dummy mixed owned bytes not codec authority: ' + mimeType).toString('base64'), mimeType }, signal: own.signal }); own.check();
      mixedResources.push(next); original.contents[0].parts.push({ fileData: { fileUri: next.file.uri, mimeType } });
    }
    original.contents.unshift({ role: 'user', parts: [{ text: 'private history question' }] }, { role: 'model', parts: [{ text: 'private history answer' }] });
  }
  if (clientTools) {
    original.tools = [{ functionDeclarations: [{ name: 'lookup', description: 'original client lookup', parameters: { type: 'OBJECT', properties: { city: { type: 'STRING' } }, required: ['city'] } }] }];
    original.toolConfig = { functionCallingConfig: { mode: 'VALIDATED', allowedFunctionNames: ['lookup'] } };
    original.contents.splice(original.contents.length - 1, 0,
      { role: 'model', parts: [{ functionCall: { id: 'client-1', name: 'lookup', args: { city: 'private city' } }, thoughtSignature: 'cHJpdmF0ZSBzaWduYXR1cmU=' }] },
      { role: 'user', parts: [{ functionResponse: { id: 'client-1', name: 'lookup', response: { text: 'private client result' } } }] });
  }
  if (inlineMedia) {
    original.contents[original.contents.length - 1].parts.push(
      { inlineData: { mimeType: 'image/png', data: Buffer.from('private dummy inline image not codec authority').toString('base64') } },
      { inlineData: { mimeType: 'application/pdf', data: Buffer.from('private dummy inline PDF not page authority').toString('base64') } });
  }
  if (inlineAudio) original.contents[original.contents.length - 1].parts.push({ inlineData: { mimeType: 'audio/wav', data: Buffer.from('private dummy inline audio not codec authority').toString('base64') } });
  if (inlineVideo) original.contents[original.contents.length - 1].parts.push({ inlineData: { mimeType: 'video/mp4', data: Buffer.from('private dummy inline video not frame authority').toString('base64') } });
  cap = authority.prepareGeminiOwnedFileAuthoritySync(db, binding(), original, mixedResources, v => schema.supportsGeminiRequest(v, clientTools, inlineMedia, inlineAudio, inlineVideo), videoMetadata, videoResolution, clientTools, inlineMedia, inlineAudio, inlineVideo);
  db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='gemini'", [JSON.stringify({ [binding().model]: mixed || inlineMedia ? { ...rates, input_document: '4', cached_document: '0.3' } : rates })]));
  const requestOwner = await import('@/lib/apiKeyBudget/requestAccounting.js'); own.check();
  const service = await import('@/lib/apiKeyBudget/service.js'), create = service.createBudgetContext; own.check();
  // Install on the actual loaded export before issuance. The hoisted factory
  // was bypassed by the original-module import graph (ack.calls stayed zero).
  // Only delivery after real durable completion is intercepted; no repo/queue mock.
  vi.spyOn(service, 'createBudgetContext').mockImplementation(async (...args) => {
    own.check(); const context = await create(...args); own.check();
    return { ...context, beginAttemptQueued(...work) {
      own.check(); const intent = context.beginAttemptQueued(...work);
      if (ack.before) ack.before(); return intent;
    }, completeAttemptQueued(...work) {
      return own.complete(() => { ack.calls++; return context.completeAttemptQueued(...work); }, async terminal => {
        if (ack.after) await ack.after(terminal);
      });
    } };
  });
  accounting = await requestOwner.createRequestAccounting(new Request(route.origin + '/v1/chat/completions', { signal: own.signal, headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => ownedDb, queued: true, ownedFileCapability: cap }); own.check();
}
async function execute(stream, override = {}) {
  const own = lifetime; own.check();
  const { DefaultExecutor } = await import('open-sse/executors/default.js'); own.check();
  return new DefaultExecutor('gemini').execute({ signal: own.signal, model: binding().model, body: { model: binding().model, stream, ...original }, stream, credentials: { apiKey: 'dummy-provider' }, connectionId: 'c', accountingMode: stream ? 'native-gemini-owned-files-sse' : 'native-gemini-owned-files-json', accounting, proxyOptions: {}, ...override });
}
describe('owned GenerateContent producer, actual SQL.js/loopback not live provider or codec/public authority', () => {
  it.each([false, true])('owned inline video composition stream=%s preserves full POST and own original-price ACK', async stream => {
    await prepare(true, true, true, false, true, true, true, true);
    const result = await execute(stream, { accountingMode: 'native-gemini-owned-video-client-inline-audio-video-controls-' + (stream ? 'sse' : 'json') });
    expect(stream ? await result.response.text() : await result.response.json()).toEqual(stream ? 'data: ' + JSON.stringify(responseMessage) + '\n\n' : responseMessage);
    expect(requests).toHaveLength(3); expect(JSON.parse(requests[2].body.toString())).toEqual(original);
    expect(requests[2].pending).toHaveLength(1); expect(requests[2].pending[0].state).toBe('pending');
    if (stream) expect(requests[2].headers.accept).toBe('text/event-stream');
    const price = JSON.parse(requests[2].pending[0].priceSnapshot);
    expect(price.rates.input_video).toBe('11'); expect(price.rates.input_document).toBe('4'); expect(price.rates.cached_document).toBe('0.3');
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toMatchObject({ state: 'settled', costNanoUsd: 309000 });
    expect(ack.calls).toBe(1); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(1);
    expect(JSON.stringify(db.all('SELECT * FROM apiKeyAccounting'))).not.toMatch(/private dummy|dummy-provider|dummy-key-a|files\/upload-/);
  });
  it.each([false, true].flatMap(stream => ['deliver', 'lost', 'revoke'].map(mode => ({ stream, mode }))))('owned inline video composition stream=$stream held ACK mode=$mode remains own current authority', async ({ stream, mode }) => {
    await prepare(true, true, true, false, true, true, true, true); let enter, release, ended = false;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    ack.after = async terminal => { expect(terminal.state).toBe('settled'); expect(String(terminal.costNanoUsd)).toBe('309000'); enter(); await held; if (mode === 'lost') throw new Error('dummy lost inline-video ACK'); };
    const work = execute(stream, { accountingMode: 'native-gemini-owned-video-client-inline-audio-video-controls-' + (stream ? 'sse' : 'json') }).then(result => stream ? result.response.text() : result.response.json()).then(value => { ended = true; return { value }; }, error => { ended = true; return { error }; });
    try {
      expect(await Promise.race([entered.then(() => 'held'), work.then(() => 'premature')])).toBe('held'); expect(ended).toBe(false);
      expect(ack.calls).toBe(1); expect(requests).toHaveLength(3); expect(JSON.parse(requests[2].body.toString())).toEqual(original);
      expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toMatchObject({ state: 'settled', costNanoUsd: 309000 });
      if (mode === 'revoke') (await import('@/lib/apiKeyBudget/geminiUploadRegistry.js')).revokeGeminiUploadedResourceSync(db, binding(), resource.id, new Date().toISOString());
      release(); const result = await work;
      if (mode === 'deliver') { expect(result.error).toBeUndefined(); expect(result.value).toEqual(stream ? 'data: ' + JSON.stringify(responseMessage) + '\n\n' : responseMessage); }
      else { expect(result.error).toBeDefined(); expect(result.value).toBeUndefined(); }
      expect(ack.calls).toBe(1); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(1);
    } finally { release(); await work; }
  });
  it('owned inline video composition actual dequeue revoke forbids intent or generation socket', async () => {
    await prepare(true, true, true, false, true, true, true, true); let count = 0;
    const registry = await import('@/lib/apiKeyBudget/geminiUploadRegistry.js');
    ack.before = () => { count++; registry.revokeGeminiUploadedResourceSync(db, binding(), resource.id, new Date().toISOString()); };
    await expect(execute(false, { accountingMode: 'native-gemini-owned-video-client-inline-audio-video-controls-json' })).rejects.toThrow();
    expect(count).toBe(1); expect(requests).toHaveLength(2); expect(ack.calls).toBe(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
  it.each([false, true])('owned inline video composition absent video still requires video=%s', async video => {
    await prepare(true, true, true, false, true, true, true);
    const authority = await import('@/lib/apiKeyBudget/geminiOwnedFileAuthority.js'), schema = await import('open-sse/config/accountedGeminiCandidate.js');
    cap = authority.prepareGeminiOwnedFileAuthoritySync(db, binding(), original, mixedResources, v => schema.supportsGeminiRequest(v, true, true, true), true, true, true, true, true, video);
    accounting = await (await import('@/lib/apiKeyBudget/requestAccounting.js')).createRequestAccounting(new Request(route.origin + '/v1/chat/completions', { signal: lifetime.signal, headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true, ownedFileCapability: cap });
    const work = execute(false, { accountingMode: 'native-gemini-owned-video-client-inline-audio-video-controls-json' });
    if (video) { const result = await work; expect(await result.response.json()).toEqual(responseMessage); expect(ack.calls).toBe(1); expect(requests).toHaveLength(3); }
    else { await expect(work).rejects.toThrow(); expect(ack.calls).toBe(0); expect(requests).toHaveLength(2); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]); }
  });
  it('owned inline video composition copied issuer and old audio mode cannot promote video grant', async () => {
    await prepare(true, true, true, false, true, true, true, true);
    await expect(execute(false, { accountingMode: 'native-gemini-owned-video-client-inline-audio-video-controls-json', accounting: { ...accounting } })).rejects.toThrow();
    await expect(execute(false, { accountingMode: 'native-gemini-owned-video-client-inline-audio-controls-json' })).rejects.toThrow();
    expect(requests).toHaveLength(2); expect(ack.calls).toBe(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
  it.each([false, true])('owned inline audio composition stream=%s preserves whole original and own original-price ACK', async stream => {
    await prepare(true, true, true, true, true, true, true);
    const result = await execute(stream, { accountingMode: 'native-gemini-owned-video-client-inline-audio-controls-' + (stream ? 'sse' : 'json') });
    expect(stream ? await result.response.text() : await result.response.json()).toEqual(stream ? 'data: ' + JSON.stringify(responseMessage) + '\n\n' : responseMessage);
    expect(requests).toHaveLength(9); const post = requests[8]; expect(JSON.parse(post.body.toString())).toEqual(original);
    expect(post.pending).toHaveLength(1); expect(post.pending[0].state).toBe('pending');
    if (stream) expect(post.headers.accept).toBe('text/event-stream');
    const snapshot = JSON.parse(post.pending[0].priceSnapshot);
    expect(snapshot.rates.input_audio).toBe('7'); expect(snapshot.rates.cached_audio).toBe('0.4'); expect(snapshot.rates.input_document).toBe('4');
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toMatchObject({ state: 'settled', costNanoUsd: 309000 });
    expect(ack.calls).toBe(1); expect(result.accountingOwned).toBe(true);
    const rows = db.all('SELECT * FROM apiKeyAccounting'); expect(rows).toHaveLength(1);
    for (const value of ['private dummy', 'private history', 'private client result', original.contents.at(-1).parts.at(-1).inlineData.data, 'cHJpdmF0ZSBzaWduYXR1cmU=', 'files/upload-', 'dummy-key-a', 'dummy-provider']) expect(JSON.stringify(rows)).not.toContain(value);
  });
  it.each([false, true].flatMap(stream => ['deliver', 'lost', 'revoke'].map(mode => ({ stream, mode }))))('owned inline audio composition stream=$stream held ACK mode=$mode cannot bypass current all-resource authority', async ({ stream, mode }) => {
    await prepare(true, true, true, true, true, true, true); let enter, release, ended = false;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    ack.after = async terminal => { expect(terminal.state).toBe('settled'); expect(String(terminal.costNanoUsd)).toBe('309000'); enter(); await held; if (mode === 'lost') throw new Error('dummy lost owned-inline-audio ACK'); };
    const work = execute(stream, { accountingMode: 'native-gemini-owned-video-client-inline-audio-controls-' + (stream ? 'sse' : 'json') }).then(result => stream ? result.response.text() : result.response.json()).then(value => { ended = true; return { value }; }, error => { ended = true; return { error }; });
    try {
      expect(await Promise.race([entered.then(() => 'held'), work.then(() => 'premature')])).toBe('held');
      expect(ended).toBe(false); expect(ack.calls).toBe(1); expect(requests).toHaveLength(9); expect(JSON.parse(requests[8].body.toString())).toEqual(original);
      expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toMatchObject({ state: 'settled', costNanoUsd: 309000 });
      if (mode === 'revoke') (await import('@/lib/apiKeyBudget/geminiUploadRegistry.js')).revokeGeminiUploadedResourceSync(db, binding(), mixedResources[2].id, new Date().toISOString());
      release(); const result = await work;
      if (mode === 'deliver') { expect(result.error).toBeUndefined(); expect(result.value).toEqual(stream ? 'data: ' + JSON.stringify(responseMessage) + '\n\n' : responseMessage); }
      else { expect(result.error).toBeDefined(); expect(result.value).toBeUndefined(); }
      expect(ack.calls).toBe(1); expect(requests).toHaveLength(9); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(1);
    } finally { release(); await work; }
  });
  it('owned inline audio composition actual dequeue revoke prevents own intent/socket after one enqueue', async () => {
    await prepare(true, true, true, true, true, true, true); let enqueueCalls = 0;
    const registry = await import('@/lib/apiKeyBudget/geminiUploadRegistry.js');
    ack.before = () => { enqueueCalls++; registry.revokeGeminiUploadedResourceSync(db, binding(), mixedResources[2].id, new Date().toISOString()); };
    await expect(execute(false, { accountingMode: 'native-gemini-owned-video-client-inline-audio-controls-json' })).rejects.toThrow();
    expect(enqueueCalls).toBe(1); expect(requests).toHaveLength(8); expect(ack.calls).toBe(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
  it.each([false, true])('owned inline audio composition absent audio still requires private audio=%s', async audio => {
    await prepare(true, true, true, true, true, true);
    const authority = await import('@/lib/apiKeyBudget/geminiOwnedFileAuthority.js'), schema = await import('open-sse/config/accountedGeminiCandidate.js');
    cap = authority.prepareGeminiOwnedFileAuthoritySync(db, binding(), original, mixedResources, v => schema.supportsGeminiRequest(v, true, true), true, true, true, true, audio);
    accounting = await (await import('@/lib/apiKeyBudget/requestAccounting.js')).createRequestAccounting(new Request(route.origin + '/v1/chat/completions', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true, ownedFileCapability: cap });
    const work = execute(false, { accountingMode: 'native-gemini-owned-video-client-inline-audio-controls-json' });
    if (audio) { const result = await work; expect(await result.response.json()).toEqual(responseMessage); expect(ack.calls).toBe(1); expect(requests).toHaveLength(9); }
    else { await expect(work).rejects.toThrow(); expect(ack.calls).toBe(0); expect(requests).toHaveLength(8); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]); }
  });
  it('owned inline audio composition rejects copied issuer and cannot launder audio into image/PDF-only mode', async () => {
    await prepare(true, true, true, true, true, true, true);
    await expect(execute(false, { accountingMode: 'native-gemini-owned-video-client-inline-audio-controls-json', accounting: { ...accounting } })).rejects.toThrow();
    await expect(execute(false, { accountingMode: 'native-gemini-owned-video-client-inline-controls-json' })).rejects.toThrow();
    expect(requests).toHaveLength(8); expect(ack.calls).toBe(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
  it('owned inline audio composition requires independent audio rates even when AUDIO counters are absent', async () => {
    await prepare(true, true, true, true, true, true, true);
    responseMessage.usageMetadata.promptTokensDetails = [{ modality: 'TEXT', tokenCount: 50 }, { modality: 'IMAGE', tokenCount: 50 }];
    responseMessage.usageMetadata.cacheTokensDetails = [{ modality: 'TEXT', tokenCount: 20 }, { modality: 'IMAGE', tokenCount: 20 }];
    const missing = { ...rates, input_document: '4', cached_document: '0.3' }; delete missing.cached_audio;
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='gemini'", [JSON.stringify({ [binding().model]: missing })]));
    await expect(execute(false, { accountingMode: 'native-gemini-owned-video-client-inline-audio-controls-json' })).rejects.toThrow();
    expect(requests).toHaveLength(8); expect(ack.calls).toBe(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='gemini'", [JSON.stringify({ [binding().model]: { ...missing, cached_audio: '0.4' } })]));
    const result = await execute(false, { accountingMode: 'native-gemini-owned-video-client-inline-audio-controls-json' }); expect(await result.response.json()).toEqual(responseMessage);
    expect(requests).toHaveLength(9); expect(ack.calls).toBe(1); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toMatchObject({ state: 'settled', costNanoUsd: 186000 });
  });
  it.each([false, true])('owned resolution actual producer stream=%s preserves complete POST and own observed original-price ACK', async stream => {
    await prepare(false, true);
    const result = await execute(stream, { accountingMode: 'native-gemini-owned-video-resolution-' + (stream ? 'sse' : 'json') });
    expect(stream ? await result.response.text() : await result.response.json()).toEqual(stream ? 'data: ' + JSON.stringify(responseMessage) + '\n\n' : responseMessage);
    expect(requests).toHaveLength(3); const post = requests[2];
    expect(post.method).toBe('POST'); expect(JSON.parse(post.body.toString())).toEqual(original);
    expect(post.url).toBe('/v1beta/models/' + binding().model + (stream ? ':streamGenerateContent?alt=sse' : ':generateContent'));
    expect(post.headers['x-goog-api-key']).toBe('dummy-provider'); if (stream) expect(post.headers.accept).toBe('text/event-stream');
    expect(post.pending).toHaveLength(1); expect(post.pending[0].state).toBe('pending');
    expect(JSON.parse(post.pending[0].priceSnapshot).usageSemantics.inputModalities).toBe('observed_gemini_owned_file_input_modalities');
    const rows = db.all('SELECT * FROM apiKeyAccounting'); expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ state: 'settled', costNanoUsd: 309000 });
    for (const value of ['private original', 'private answer', 'files/upload-1', 'dummy-key-a', 'dummy-provider', 'dummy-session']) expect(JSON.stringify(rows)).not.toContain(value);
    expect(result.accountingOwned).toBe(true); expect(ack.calls).toBe(1);
  });
  it.each([false, true].flatMap(stream => ['deliver', 'lost', 'revoke', 'credential'].map(mode => ({ stream, mode }))))('owned resolution actual producer terminal stream=$stream mode=$mode requires own delivered ACK after durable debit', async ({ stream, mode }) => {
    await prepare(false, true); let enter, release, ended = false;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    ack.after = async terminal => { expect(terminal.state).toBe('settled'); expect(String(terminal.costNanoUsd)).toBe('309000'); enter(); await held; if (mode === 'lost') throw new Error('dummy lost delivery ACK'); };
    const work = execute(stream, { accountingMode: 'native-gemini-owned-video-resolution-' + (stream ? 'sse' : 'json') }).then(result => stream ? result.response.text() : result.response.json()).then(value => { ended = true; return { value }; }, error => { ended = true; return { error }; });
    try {
      expect(await Promise.race([entered.then(() => 'held'), work.then(() => 'premature')])).toBe('held');
      expect(ended).toBe(false); expect(ack.calls).toBe(1); expect(requests).toHaveLength(3);
      expect(JSON.parse(requests[2].body.toString())).toEqual(original); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toMatchObject({ state: 'settled', costNanoUsd: 309000 });
      if (mode === 'revoke') (await import('@/lib/apiKeyBudget/geminiUploadRegistry.js')).revokeGeminiUploadedResourceSync(db, binding(), resource.id, new Date().toISOString());
      if (mode === 'credential') db.durableTransaction(() => db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ apiKey: 'changed-dummy-provider' }), 'c']));
      release(); const result = await work;
      if (mode === 'deliver') { expect(result.error).toBeUndefined(); expect(result.value).toEqual(stream ? 'data: ' + JSON.stringify(responseMessage) + '\n\n' : responseMessage); }
      else { expect(result.error).toBeDefined(); expect(result.value).toBeUndefined(); }
      expect(ack.calls).toBe(1); expect(requests).toHaveLength(3); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(1);
    } finally { release(); await work; }
  });
  it.each([false, true])('owned resolution missing terminal modalities stream=%s never become unlimited success', async stream => {
    await prepare(false, true); delete responseMessage.usageMetadata.promptTokensDetails;
    await expect(execute(stream, { accountingMode: 'native-gemini-owned-video-resolution-' + (stream ? 'sse' : 'json') }).then(result => stream ? result.response.text() : result.response.json())).rejects.toThrow();
    expect(requests).toHaveLength(3); expect(ack.calls).toBe(1); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toMatchObject({ state: 'unresolved', costNanoUsd: null });
  });
  it('owned resolution actual dequeue revocation refuses before own intent and socket after one enqueue', async () => {
    await prepare(false, true); const registry = await import('@/lib/apiKeyBudget/geminiUploadRegistry.js'); let enqueueCalls = 0;
    ack.before = () => { enqueueCalls++; registry.revokeGeminiUploadedResourceSync(db, binding(), resource.id, new Date().toISOString()); };
    await expect(execute(false, { accountingMode: 'native-gemini-owned-video-resolution-json' })).rejects.toThrow();
    expect(enqueueCalls).toBe(1); expect(requests).toHaveLength(2); expect(ack.calls).toBe(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
  it('owned resolution copied issuer and old mode cannot adopt private grant even with retained controls', async () => {
    await prepare(false, true);
    await expect(execute(false, { accountingMode: 'native-gemini-owned-video-resolution-json', accounting: { ...accounting } })).rejects.toThrow();
    await expect(execute(false)).rejects.toThrow(); expect(requests).toHaveLength(2); expect(ack.calls).toBe(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
  it.each([false, true])('owned combined controls stream=%s preserve both independent controls and actual own ACK', async stream => {
    await prepare(true, true);
    const result = await execute(stream, { accountingMode: 'native-gemini-owned-video-metadata-resolution-' + (stream ? 'sse' : 'json') });
    expect(stream ? await result.response.text() : await result.response.json()).toEqual(stream ? 'data: ' + JSON.stringify(responseMessage) + '\n\n' : responseMessage);
    expect(requests).toHaveLength(3); const post = requests[2];
    expect(JSON.parse(post.body.toString())).toEqual(original); expect(post.method).toBe('POST');
    expect(post.url).toBe('/v1beta/models/' + binding().model + (stream ? ':streamGenerateContent?alt=sse' : ':generateContent'));
    expect(post.headers['x-goog-api-key']).toBe('dummy-provider'); if (stream) expect(post.headers.accept).toBe('text/event-stream');
    expect(post.pending).toHaveLength(1); expect(post.pending[0].state).toBe('pending');
    const rows = db.all('SELECT * FROM apiKeyAccounting'); expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ state: 'settled', costNanoUsd: 309000 });
    expect(result.accountingOwned).toBe(true); expect(ack.calls).toBe(1);
    for (const value of ['private original', 'private answer', 'files/upload-1', 'dummy-key-a', 'dummy-provider', 'dummy-session']) expect(JSON.stringify(rows)).not.toContain(value);
  });
  it.each([false, true].flatMap(stream => ['deliver', 'lost', 'revoke', 'credential'].map(mode => ({ stream, mode }))))('owned combined controls stream=$stream mode=$mode require exact delivered own ACK', async ({ stream, mode }) => {
    await prepare(true, true); let enter, release, ended = false;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    ack.after = async terminal => { expect(terminal.state).toBe('settled'); expect(String(terminal.costNanoUsd)).toBe('309000'); enter(); await held; if (mode === 'lost') throw new Error('dummy lost combined ACK'); };
    const work = execute(stream, { accountingMode: 'native-gemini-owned-video-metadata-resolution-' + (stream ? 'sse' : 'json') }).then(result => stream ? result.response.text() : result.response.json()).then(value => { ended = true; return { value }; }, error => { ended = true; return { error }; });
    try {
      expect(await Promise.race([entered.then(() => 'held'), work.then(() => 'premature')])).toBe('held');
      expect(ended).toBe(false); expect(ack.calls).toBe(1); expect(requests).toHaveLength(3);
      expect(JSON.parse(requests[2].body.toString())).toEqual(original); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toMatchObject({ state: 'settled', costNanoUsd: 309000 });
      if (mode === 'revoke') (await import('@/lib/apiKeyBudget/geminiUploadRegistry.js')).revokeGeminiUploadedResourceSync(db, binding(), resource.id, new Date().toISOString());
      if (mode === 'credential') db.durableTransaction(() => db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ apiKey: 'changed-dummy-provider' }), 'c']));
      release(); const result = await work;
      if (mode === 'deliver') { expect(result.error).toBeUndefined(); expect(result.value).toEqual(stream ? 'data: ' + JSON.stringify(responseMessage) + '\n\n' : responseMessage); }
      else { expect(result.error).toBeDefined(); expect(result.value).toBeUndefined(); }
      expect(ack.calls).toBe(1); expect(requests).toHaveLength(3); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(1);
    } finally { release(); await work; }
  });
  it('owned combined controls actual dequeue rechecks private lifecycle after one enqueue', async () => {
    await prepare(true, true); let enqueueCalls = 0; const registry = await import('@/lib/apiKeyBudget/geminiUploadRegistry.js');
    ack.before = () => { enqueueCalls++; registry.revokeGeminiUploadedResourceSync(db, binding(), resource.id, new Date().toISOString()); };
    await expect(execute(false, { accountingMode: 'native-gemini-owned-video-metadata-resolution-json' })).rejects.toThrow();
    expect(enqueueCalls).toBe(1); expect(requests).toHaveLength(2); expect(ack.calls).toBe(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
  it('owned combined controls cannot adopt copied issuer or launder both grants into either single mode', async () => {
    await prepare(true, true);
    await expect(execute(false, { accountingMode: 'native-gemini-owned-video-metadata-resolution-json', accounting: { ...accounting } })).rejects.toThrow();
    for (const mode of ['native-gemini-owned-files-json', 'native-gemini-owned-video-metadata-json', 'native-gemini-owned-video-resolution-json']) await expect(execute(false, { accountingMode: mode })).rejects.toThrow();
    expect(requests).toHaveLength(2); expect(ack.calls).toBe(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
  it.each([[false, false], [true, false], [false, true], [true, true]])('owned combined controls absent still require exact metadata=%s resolution=%s private grants', async (metadata, resolution) => {
    await prepare(metadata, resolution, false);
    const work = execute(false, { accountingMode: 'native-gemini-owned-video-metadata-resolution-json' });
    if (metadata && resolution) {
      const result = await work; expect(await result.response.json()).toEqual(responseMessage);
      expect(requests).toHaveLength(3); expect(JSON.parse(requests[2].body.toString())).toEqual(original);
      expect(ack.calls).toBe(1); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toMatchObject({ state: 'settled', costNanoUsd: 309000 });
    } else {
      await expect(work).rejects.toThrow(); expect(requests).toHaveLength(2); expect(ack.calls).toBe(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
    }
  });
  it.each([false, true])('mixed owned resources stream=%s preserve all four uploads/history/controls and exact observed own ACK', async stream => {
    await prepare(true, true, true, true);
    expect(mixedResources).toHaveLength(4); expect(uploadSessions.size).toBe(4);
    const result = await execute(stream, { accountingMode: 'native-gemini-owned-video-metadata-resolution-' + (stream ? 'sse' : 'json') });
    expect(stream ? await result.response.text() : await result.response.json()).toEqual(stream ? 'data: ' + JSON.stringify(responseMessage) + '\n\n' : responseMessage);
    expect(requests).toHaveLength(9); const post = requests[8]; expect(post.method).toBe('POST'); expect(JSON.parse(post.body.toString())).toEqual(original);
    expect(post.url).toBe('/v1beta/models/' + binding().model + (stream ? ':streamGenerateContent?alt=sse' : ':generateContent'));
    expect(post.pending).toHaveLength(1); expect(post.pending[0].state).toBe('pending');
    const snapshot = JSON.parse(post.pending[0].priceSnapshot);
    expect(snapshot.rates.input_document).toBe('4'); expect(snapshot.rates.cached_document).toBe('0.3');
    expect(snapshot.usageSemantics.inputModalities).toBe('observed_gemini_owned_file_input_modalities');
    // Provider-observed maps remain TEXT/IMAGE/AUDIO only: PDF/video ownership
    // requires rates but does not fabricate quantities or charges.
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toMatchObject({ state: 'settled', costNanoUsd: 309000 });
    expect(ack.calls).toBe(1); expect(result.accountingOwned).toBe(true);
    const rows = db.all('SELECT * FROM apiKeyAccounting'); expect(rows).toHaveLength(1);
    for (const value of ['private history', 'private original', 'private answer', 'files/upload-', 'dummy-key-a', 'dummy-provider', 'dummy-session']) expect(JSON.stringify(rows)).not.toContain(value);
  });
  it.each([false, true].flatMap(stream => ['deliver', 'lost', 'image', 'pdf'].map(mode => ({ stream, mode }))))('mixed owned resources stream=$stream held ACK mode=$mode checks each independently owned resource', async ({ stream, mode }) => {
    await prepare(true, true, true, true); let enter, release, ended = false;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    ack.after = async terminal => { expect(terminal.state).toBe('settled'); expect(String(terminal.costNanoUsd)).toBe('309000'); enter(); await held; if (mode === 'lost') throw new Error('dummy lost mixed ACK'); };
    const work = execute(stream, { accountingMode: 'native-gemini-owned-video-metadata-resolution-' + (stream ? 'sse' : 'json') }).then(result => stream ? result.response.text() : result.response.json()).then(value => { ended = true; return { value }; }, error => { ended = true; return { error }; });
    try {
      expect(await Promise.race([entered.then(() => 'held'), work.then(() => 'premature')])).toBe('held');
      expect(ended).toBe(false); expect(ack.calls).toBe(1); expect(requests).toHaveLength(9); expect(JSON.parse(requests[8].body.toString())).toEqual(original);
      expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toMatchObject({ state: 'settled', costNanoUsd: 309000 });
      if (mode === 'image' || mode === 'pdf') {
        const registry = await import('@/lib/apiKeyBudget/geminiUploadRegistry.js');
        registry.revokeGeminiUploadedResourceSync(db, binding(), mixedResources[mode === 'image' ? 1 : 3].id, new Date().toISOString());
      }
      release(); const result = await work;
      if (mode === 'deliver') { expect(result.error).toBeUndefined(); expect(result.value).toEqual(stream ? 'data: ' + JSON.stringify(responseMessage) + '\n\n' : responseMessage); }
      else { expect(result.error).toBeDefined(); expect(result.value).toBeUndefined(); }
      expect(ack.calls).toBe(1); expect(requests).toHaveLength(9); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(1);
    } finally { release(); await work; }
  });
  it('mixed owned resources actual dequeue revocation of third audio resource prevents own intent/socket after one enqueue', async () => {
    await prepare(true, true, true, true); let enqueueCalls = 0; const registry = await import('@/lib/apiKeyBudget/geminiUploadRegistry.js');
    ack.before = () => { enqueueCalls++; registry.revokeGeminiUploadedResourceSync(db, binding(), mixedResources[2].id, new Date().toISOString()); };
    await expect(execute(false, { accountingMode: 'native-gemini-owned-video-metadata-resolution-json' })).rejects.toThrow();
    expect(enqueueCalls).toBe(1); expect(requests).toHaveLength(8); expect(ack.calls).toBe(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
  it('mixed owned resources require even unobserved document rates before GeneratePOST, not fabricated zero usage', async () => {
    await prepare(true, true, true, true);
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='gemini'", [JSON.stringify({ [binding().model]: rates })]));
    await expect(execute(false, { accountingMode: 'native-gemini-owned-video-metadata-resolution-json' })).rejects.toThrow();
    expect(requests).toHaveLength(8); expect(ack.calls).toBe(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
  it.each([false, true])('owned inline image/PDF client composition stream=%s preserves full original POST and observed own ACK', async stream => {
    await prepare(true, true, true, true, true, true);
    const result = await execute(stream, { accountingMode: 'native-gemini-owned-video-client-inline-controls-' + (stream ? 'sse' : 'json') });
    expect(stream ? await result.response.text() : await result.response.json()).toEqual(stream ? 'data: ' + JSON.stringify(responseMessage) + '\n\n' : responseMessage);
    expect(requests).toHaveLength(9); expect(JSON.parse(requests[8].body.toString())).toEqual(original);
    expect(requests[8].url).toBe('/v1beta/models/' + binding().model + (stream ? ':streamGenerateContent?alt=sse' : ':generateContent'));
    expect(requests[8].pending).toHaveLength(1); expect(requests[8].pending[0].state).toBe('pending');
    const snapshot = JSON.parse(requests[8].pending[0].priceSnapshot);
    expect(snapshot.rates.input_document).toBe('4'); expect(snapshot.rates.cached_document).toBe('0.3');
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toMatchObject({ state: 'settled', costNanoUsd: 309000 });
    expect(ack.calls).toBe(1); expect(result.accountingOwned).toBe(true);
    const rows = db.all('SELECT * FROM apiKeyAccounting'); expect(rows).toHaveLength(1);
    for (const value of ['private dummy', 'private history', 'private client result', original.contents[original.contents.length - 1].parts.at(-1).inlineData.data, 'cHJpdmF0ZSBzaWduYXR1cmU=', 'files/upload-', 'dummy-key-a', 'dummy-provider']) expect(JSON.stringify(rows)).not.toContain(value);
  });
  it.each([false, true].flatMap(stream => ['deliver', 'lost', 'revoke'].map(mode => ({ stream, mode }))))('owned inline image/PDF stream=$stream held own ACK mode=$mode prevents premature or stale delivery', async ({ stream, mode }) => {
    await prepare(true, true, true, true, true, true); let enter, release, ended = false;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    ack.after = async terminal => { expect(terminal.state).toBe('settled'); expect(String(terminal.costNanoUsd)).toBe('309000'); enter(); await held; if (mode === 'lost') throw new Error('dummy lost owned-inline ACK'); };
    const work = execute(stream, { accountingMode: 'native-gemini-owned-video-client-inline-controls-' + (stream ? 'sse' : 'json') }).then(result => stream ? result.response.text() : result.response.json()).then(value => { ended = true; return { value }; }, error => { ended = true; return { error }; });
    try {
      expect(await Promise.race([entered.then(() => 'held'), work.then(() => 'premature')])).toBe('held');
      expect(ended).toBe(false); expect(ack.calls).toBe(1); expect(requests).toHaveLength(9); expect(JSON.parse(requests[8].body.toString())).toEqual(original);
      expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toMatchObject({ state: 'settled', costNanoUsd: 309000 });
      if (mode === 'revoke') (await import('@/lib/apiKeyBudget/geminiUploadRegistry.js')).revokeGeminiUploadedResourceSync(db, binding(), mixedResources[1].id, new Date().toISOString());
      release(); const result = await work;
      if (mode === 'deliver') { expect(result.error).toBeUndefined(); expect(result.value).toEqual(stream ? 'data: ' + JSON.stringify(responseMessage) + '\n\n' : responseMessage); }
      else { expect(result.error).toBeDefined(); expect(result.value).toBeUndefined(); }
      expect(ack.calls).toBe(1); expect(requests).toHaveLength(9); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(1);
    } finally { release(); await work; }
  });
  it('owned inline image/PDF actual dequeue revocation prevents intent/POST after one enqueue', async () => {
    await prepare(true, true, true, true, true, true); let enqueueCalls = 0;
    const registry = await import('@/lib/apiKeyBudget/geminiUploadRegistry.js');
    ack.before = () => { enqueueCalls++; registry.revokeGeminiUploadedResourceSync(db, binding(), mixedResources[1].id, new Date().toISOString()); };
    await expect(execute(false, { accountingMode: 'native-gemini-owned-video-client-inline-controls-json' })).rejects.toThrow();
    expect(enqueueCalls).toBe(1); expect(requests).toHaveLength(8); expect(ack.calls).toBe(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
  it.each([false, true])('inline composition without inline parts still requires independent inline grant inline=%s', async inline => {
    await prepare(true, true, true, true, true);
    const authority = await import('@/lib/apiKeyBudget/geminiOwnedFileAuthority.js');
    const schema = await import('open-sse/config/accountedGeminiCandidate.js');
    cap = authority.prepareGeminiOwnedFileAuthoritySync(db, binding(), original, mixedResources, v => schema.supportsGeminiRequest(v, true), true, true, true, inline);
    accounting = await (await import('@/lib/apiKeyBudget/requestAccounting.js')).createRequestAccounting(new Request(route.origin + '/v1/chat/completions', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true, ownedFileCapability: cap });
    const work = execute(false, { accountingMode: 'native-gemini-owned-video-client-inline-controls-json' });
    if (inline) { const result = await work; expect(await result.response.json()).toEqual(responseMessage); expect(ack.calls).toBe(1); expect(requests).toHaveLength(9); }
    else { await expect(work).rejects.toThrow(); expect(ack.calls).toBe(0); expect(requests).toHaveLength(8); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]); }
  });
  it('inline PDF requires independent DOCUMENT rates even when only video was uploaded and DOCUMENT usage is absent', async () => {
    await prepare(true, true, true, false, true, true);
    // This negative owns its missing-rate precondition; the shared positive
    // fixture correctly supplies DOCUMENT prices whenever inline PDF is present.
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='gemini'", [JSON.stringify({ [binding().model]: rates })]));
    const missing = JSON.parse(db.get("SELECT value FROM kv WHERE scope='pricing' AND key='gemini'").value)[binding().model];
    expect(Object.hasOwn(missing, 'input_document')).toBe(false); expect(Object.hasOwn(missing, 'cached_document')).toBe(false);
    expect(responseMessage.usageMetadata.promptTokensDetails.some(detail => detail.modality === 'DOCUMENT')).toBe(false);
    await expect(execute(false, { accountingMode: 'native-gemini-owned-video-client-inline-controls-json' })).rejects.toThrow();
    expect(requests).toHaveLength(2); expect(ack.calls).toBe(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='gemini'", [JSON.stringify({ [binding().model]: { ...rates, input_document: '4', cached_document: '0.3' } })]));
    const result = await execute(false, { accountingMode: 'native-gemini-owned-video-client-inline-controls-json' });
    expect(await result.response.json()).toEqual(responseMessage); expect(requests).toHaveLength(3); expect(JSON.parse(requests[2].body.toString())).toEqual(original);
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toMatchObject({ state: 'settled', costNanoUsd: 309000 }); expect(ack.calls).toBe(1);
    expect(JSON.parse(requests[2].pending[0].priceSnapshot).rates.input_document).toBe('4');
  });
  it('owned inline image/PDF composition refuses copied issuer and client-only mode laundering', async () => {
    await prepare(true, true, true, true, true, true);
    await expect(execute(false, { accountingMode: 'native-gemini-owned-video-client-inline-controls-json', accounting: { ...accounting } })).rejects.toThrow();
    await expect(execute(false, { accountingMode: 'native-gemini-owned-video-client-controls-json' })).rejects.toThrow();
    expect(requests).toHaveLength(8); expect(ack.calls).toBe(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
  it.each([false, true])('mixed owned client history stream=%s preserves signed calls/results/tools and own observed original-price ACK', async stream => {
    await prepare(true, true, true, true, true);
    const result = await execute(stream, { accountingMode: 'native-gemini-owned-video-client-controls-' + (stream ? 'sse' : 'json') });
    expect(stream ? await result.response.text() : await result.response.json()).toEqual(stream ? 'data: ' + JSON.stringify(responseMessage) + '\n\n' : responseMessage);
    expect(requests).toHaveLength(9); expect(JSON.parse(requests[8].body.toString())).toEqual(original);
    expect(requests[8].pending).toHaveLength(1); expect(requests[8].pending[0].state).toBe('pending');
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toMatchObject({ state: 'settled', costNanoUsd: 309000 });
    expect(ack.calls).toBe(1); expect(result.accountingOwned).toBe(true);
    const rows = db.all('SELECT * FROM apiKeyAccounting'); expect(rows).toHaveLength(1);
    for (const value of ['private history', 'private city', 'private client result', 'cHJpdmF0ZSBzaWduYXR1cmU=', 'files/upload-', 'dummy-key-a', 'dummy-provider']) expect(JSON.stringify(rows)).not.toContain(value);
  });
  it.each([false, true].flatMap(stream => ['deliver', 'lost', 'revoke'].map(mode => ({ stream, mode }))))('mixed owned client history stream=$stream mode=$mode withholds completion until own delivered ACK and current resource', async ({ stream, mode }) => {
    await prepare(true, true, true, true, true); let enter, release, ended = false;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    ack.after = async terminal => { expect(terminal.state).toBe('settled'); expect(String(terminal.costNanoUsd)).toBe('309000'); enter(); await held; if (mode === 'lost') throw new Error('dummy lost client ACK'); };
    const work = execute(stream, { accountingMode: 'native-gemini-owned-video-client-controls-' + (stream ? 'sse' : 'json') }).then(result => stream ? result.response.text() : result.response.json()).then(value => { ended = true; return { value }; }, error => { ended = true; return { error }; });
    try {
      expect(await Promise.race([entered.then(() => 'held'), work.then(() => 'premature')])).toBe('held');
      expect(ended).toBe(false); expect(ack.calls).toBe(1); expect(requests).toHaveLength(9); expect(JSON.parse(requests[8].body.toString())).toEqual(original);
      expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toMatchObject({ state: 'settled', costNanoUsd: 309000 });
      if (mode === 'revoke') (await import('@/lib/apiKeyBudget/geminiUploadRegistry.js')).revokeGeminiUploadedResourceSync(db, binding(), mixedResources[3].id, new Date().toISOString());
      release(); const result = await work;
      if (mode === 'deliver') { expect(result.error).toBeUndefined(); expect(result.value).toEqual(stream ? 'data: ' + JSON.stringify(responseMessage) + '\n\n' : responseMessage); }
      else { expect(result.error).toBeDefined(); expect(result.value).toBeUndefined(); }
      expect(ack.calls).toBe(1); expect(requests).toHaveLength(9); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(1);
    } finally { release(); await work; }
  });
  it('mixed owned client history actual dequeue PDF revoke prevents intent/POST after one enqueue', async () => {
    await prepare(true, true, true, true, true); let enqueueCalls = 0;
    // The existing enqueue seam runs after the real queue accepts the work,
    // before its callback acquires the current resource authority.
    const registry = await import('@/lib/apiKeyBudget/geminiUploadRegistry.js');
    ack.before = () => { enqueueCalls++; registry.revokeGeminiUploadedResourceSync(db, binding(), mixedResources[3].id, new Date().toISOString()); };
    await expect(execute(false, { accountingMode: 'native-gemini-owned-video-client-controls-json' })).rejects.toThrow();
    expect(enqueueCalls).toBe(1); expect(requests).toHaveLength(8); expect(ack.calls).toBe(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
  it.each([false, true])('client composition without client controls requires explicit private grant client=%s', async client => {
    await prepare(true, true, true, true);
    const authority = await import('@/lib/apiKeyBudget/geminiOwnedFileAuthority.js');
    const schema = await import('open-sse/config/accountedGeminiCandidate.js');
    cap = authority.prepareGeminiOwnedFileAuthoritySync(db, binding(), original, mixedResources, v => schema.supportsGeminiRequest(v), true, true, client);
    accounting = await (await import('@/lib/apiKeyBudget/requestAccounting.js')).createRequestAccounting(new Request(route.origin + '/v1/chat/completions', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true, ownedFileCapability: cap });
    const work = execute(false, { accountingMode: 'native-gemini-owned-video-client-controls-json' });
    if (client) { const result = await work; expect(await result.response.json()).toEqual(responseMessage); expect(ack.calls).toBe(1); expect(requests).toHaveLength(9); }
    else { await expect(work).rejects.toThrow(); expect(ack.calls).toBe(0); expect(requests).toHaveLength(8); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]); }
  });
  it('mixed owned client history cannot launder client grant into combined-controls or copy actual issuer', async () => {
    await prepare(true, true, true, true, true);
    await expect(execute(false, { accountingMode: 'native-gemini-owned-video-client-controls-json', accounting: { ...accounting } })).rejects.toThrow();
    await expect(execute(false, { accountingMode: 'native-gemini-owned-video-metadata-resolution-json' })).rejects.toThrow();
    expect(requests).toHaveLength(8); expect(ack.calls).toBe(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
  it.each([false, true])('owned videoMetadata actual producer stream=%s preserves full POST and exact observed original-price ACK', async stream => {
    await prepare(true);
    const mode = stream ? 'native-gemini-owned-video-metadata-sse' : 'native-gemini-owned-video-metadata-json';
    const result = await execute(stream, { accountingMode: mode });
    expect(stream ? await result.response.text() : await result.response.json()).toEqual(stream ? 'data: ' + JSON.stringify(responseMessage) + '\n\n' : responseMessage);
    expect(requests).toHaveLength(3); const post = requests[2];
    expect(post.method).toBe('POST'); expect(JSON.parse(post.body.toString())).toEqual(original);
    expect(post.url).toBe('/v1beta/models/' + binding().model + (stream ? ':streamGenerateContent?alt=sse' : ':generateContent'));
    expect(post.headers['x-goog-api-key']).toBe('dummy-provider'); if (stream) expect(post.headers.accept).toBe('text/event-stream');
    expect(post.pending).toHaveLength(1); expect(post.pending[0].state).toBe('pending');
    expect(JSON.parse(post.pending[0].priceSnapshot).usageSemantics.inputModalities).toBe('observed_gemini_owned_file_input_modalities');
    const rows = db.all('SELECT * FROM apiKeyAccounting'); expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ state: 'settled', costNanoUsd: 309000 });
    for (const value of ['private original', 'private answer', 'files/upload-1', 'dummy-key-a', 'dummy-provider', 'dummy-session']) expect(JSON.stringify(rows)).not.toContain(value);
    expect(result.accountingOwned).toBe(true); expect(ack.calls).toBe(1);
  });
  it.each([false, true].flatMap(stream => ['deliver', 'lost', 'revoke', 'credential'].map(mode => ({ stream, mode }))))('owned videoMetadata actual producer terminal stream=$stream mode=$mode requires exact delivery after durable debit', async ({ stream, mode }) => {
    await prepare(true); let enter, release, ended = false;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    ack.after = async terminal => { expect(terminal.state).toBe('settled'); expect(String(terminal.costNanoUsd)).toBe('309000'); enter(); await held; if (mode === 'lost') throw new Error('dummy lost delivery ACK'); };
    const work = execute(stream, { accountingMode: stream ? 'native-gemini-owned-video-metadata-sse' : 'native-gemini-owned-video-metadata-json' }).then(result => stream ? result.response.text() : result.response.json()).then(value => { ended = true; return { value }; }, error => { ended = true; return { error }; });
    try {
      expect(await Promise.race([entered.then(() => 'held'), work.then(() => 'premature')])).toBe('held');
      expect(ended).toBe(false); expect(ack.calls).toBe(1); expect(requests).toHaveLength(3);
      expect(JSON.parse(requests[2].body.toString())).toEqual(original); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toMatchObject({ state: 'settled', costNanoUsd: 309000 });
      if (mode === 'revoke') (await import('@/lib/apiKeyBudget/geminiUploadRegistry.js')).revokeGeminiUploadedResourceSync(db, binding(), resource.id, new Date().toISOString());
      if (mode === 'credential') db.durableTransaction(() => db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ apiKey: 'changed-dummy-provider' }), 'c']));
      release(); const result = await work;
      if (mode === 'deliver') { expect(result.error).toBeUndefined(); expect(result.value).toEqual(stream ? 'data: ' + JSON.stringify(responseMessage) + '\n\n' : responseMessage); }
      else { expect(result.error).toBeDefined(); expect(result.value).toBeUndefined(); }
      expect(ack.calls).toBe(1); expect(requests).toHaveLength(3); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(1);
    } finally { release(); await work; }
  });
  it.each([false, true])('owned videoMetadata actual producer missing observed terminal stream=%s cannot fall into unlimited success', async stream => {
    await prepare(true); delete responseMessage.usageMetadata.promptTokensDetails;
    await expect(execute(stream, { accountingMode: stream ? 'native-gemini-owned-video-metadata-sse' : 'native-gemini-owned-video-metadata-json' }).then(result => stream ? result.response.text() : result.response.json())).rejects.toThrow();
    expect(requests).toHaveLength(3); expect(ack.calls).toBe(1); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toMatchObject({ state: 'unresolved', costNanoUsd: null });
  });
  it('owned videoMetadata actual producer actual dequeue revocation stops before own intent and socket', async () => {
    await prepare(true); const registry = await import('@/lib/apiKeyBudget/geminiUploadRegistry.js'); let enqueueCalls = 0;
    ack.before = () => { enqueueCalls++; registry.revokeGeminiUploadedResourceSync(db, binding(), resource.id, new Date().toISOString()); };
    await expect(execute(false, { accountingMode: 'native-gemini-owned-video-metadata-json' })).rejects.toThrow(); expect(enqueueCalls).toBe(1); expect(requests).toHaveLength(2); expect(ack.calls).toBe(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
  it('owned videoMetadata actual producer copied issuer and plain-mode grant mismatch cannot adopt resource', async () => {
    await prepare(true);
    await expect(execute(false, { accountingMode: 'native-gemini-owned-video-metadata-json', accounting: { ...accounting } })).rejects.toThrow();
    await expect(execute(false)).rejects.toThrow(); expect(requests).toHaveLength(2); expect(ack.calls).toBe(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
  it('exported resource request-owner issuer refuses caller-shaped frozen controls without genuine app-issued origin', async () => {
    const registry = await import('open-sse/config/accountingGeminiOwnedRequestOwner.js');
    const fake = Object.freeze({ requiresPreparedBaseWire: true }), called = vi.fn();
    await expect(registry.bindGeminiOwnedRequestOwner(fake, { capture: called, inspect: called, parser: called, terminal: called })).rejects.toThrow();
    expect(() => registry.getGeminiOwnedRequestOwner(fake)).toThrow(); expect(called).not.toHaveBeenCalled();
    expect(requests).toEqual([]); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
  it.each([false, true])('whole original owned file POST stream=%s sees own pending and settles observed original309000 through own terminal ACK', async stream => {
    await prepare();
    const result = await execute(stream);
    if (stream) expect(await result.response.text()).toBe('data: ' + JSON.stringify(responseMessage) + '\n\n');
    else expect(await result.response.json()).toEqual(responseMessage);
    expect(requests).toHaveLength(3); const post = requests[2]; expect(post.method).toBe('POST'); expect(JSON.parse(post.body.toString())).toEqual(original);
    expect(post.url).toBe('/v1beta/models/' + binding().model + (stream ? ':streamGenerateContent?alt=sse' : ':generateContent'));
    expect(post.headers['x-goog-api-key']).toBe('dummy-provider'); if (stream) expect(post.headers.accept).toBe('text/event-stream');
    expect(post.pending).toHaveLength(1); expect(post.pending[0].state).toBe('pending'); expect(JSON.parse(post.pending[0].priceSnapshot).usageSemantics.inputModalities).toBe('observed_gemini_owned_file_input_modalities');
    const rows = db.all('SELECT * FROM apiKeyAccounting'); expect(rows).toHaveLength(1); expect(rows[0].state).toBe('settled'); expect(String(rows[0].costNanoUsd)).toBe('309000');
    for (const value of ['private original', 'private answer', 'files/upload-1', 'dummy-key-a', 'dummy-provider', 'dummy-session']) expect(JSON.stringify(rows)).not.toContain(value);
    expect(result.accountingOwned).toBe(true); expect(ack.calls).toBe(1);
  });
  it.each([false, true].flatMap(stream => ['deliver', 'lost', 'revoke', 'credential'].map(mode => ({ stream, mode }))))('own terminal delivery stream=$stream mode=$mode cannot be replaced by the already installed debit', async ({ stream, mode }) => {
    await prepare();
    let enter, release, ended = false;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    ack.after = async terminal => { expect(terminal.state).toBe('settled'); expect(String(terminal.costNanoUsd)).toBe('309000'); enter(); await held; if (mode === 'lost') throw new Error('dummy lost delivery ACK'); };
    const observed = execute(stream).then(result => stream ? result.response.text() : result.response.json()).then(value => { ended = true; return { value }; }, error => { ended = true; return { error }; });
    try {
      expect(await Promise.race([entered.then(() => 'held'), observed.then(() => 'premature')])).toBe('held');
      expect(ended).toBe(false); expect(ack.calls).toBe(1); expect(requests).toHaveLength(3);
      expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toMatchObject({ state: 'settled', costNanoUsd: 309000 });
      if (mode === 'revoke') (await import('@/lib/apiKeyBudget/geminiUploadRegistry.js')).revokeGeminiUploadedResourceSync(db, binding(), resource.id, new Date().toISOString());
      if (mode === 'credential') db.durableTransaction(() => db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ apiKey: 'changed-dummy-provider' }), 'c']));
      release(); const result = await observed;
      if (mode === 'deliver') { expect(result.error).toBeUndefined(); expect(result.value).toEqual(stream ? 'data: ' + JSON.stringify(responseMessage) + '\n\n' : responseMessage); }
      else { expect(result.error).toBeDefined(); expect(result.value).toBeUndefined(); }
      expect(ack.calls).toBe(1); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(1); expect(requests).toHaveLength(3);
    } finally { release(); await observed; }
  });
  it.each([false, true])('missing terminal modality evidence stream=%s stays unresolved and never uses unlimited success fallback', async stream => {
    await prepare(); delete responseMessage.usageMetadata.promptTokensDetails;
    await expect(execute(stream).then(result => stream ? result.response.text() : result.response.json())).rejects.toThrow();
    expect(requests).toHaveLength(3); expect(ack.calls).toBe(1);
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toMatchObject({ state: 'unresolved', costNanoUsd: null });
  });
  it('queue-time owned revocation refuses at actual dequeue without intent or GenerateContent socket', async () => {
    await prepare(); const registry = await import('@/lib/apiKeyBudget/geminiUploadRegistry.js');
    ack.before = () => registry.revokeGeminiUploadedResourceSync(db, binding(), resource.id, new Date().toISOString());
    await expect(execute(false)).rejects.toThrow(); expect(requests).toHaveLength(2); expect(ack.calls).toBe(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
  it('copied or synthetic terminal cannot replace exact delivered ACK even with matching attempt, cost and current original', async () => {
    await prepare(); let terminal;
    ack.after = value => { terminal = value; };
    await (await execute(false)).response.json();
    const controls = (await import('open-sse/config/accountingGeminiOwnedRequestOwner.js')).getGeminiOwnedRequestOwner(accounting);
    expect(() => controls.terminal({ provider: 'gemini', model: binding().model, endpoint: 'chat', connectionId: 'c' }, original, { ...terminal })).toThrow();
    expect(() => controls.terminal({ provider: 'gemini', model: binding().model, endpoint: 'chat', connectionId: 'foreign' }, original, terminal)).toThrow();
    expect(ack.calls).toBe(1); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(1); expect(requests).toHaveLength(3);
  });
  it('copied issued owner or revoked original resource refuses before intent or GenerateContent socket without adopting visible metadata', async () => {
    await prepare(); const registry = await import('open-sse/config/accountingGeminiOwnedRequestOwner.js');
    const controls = registry.getGeminiOwnedRequestOwner(accounting);
    await expect(registry.bindGeminiOwnedRequestOwner(Object.freeze({ ...accounting }), controls)).rejects.toThrow();
    await expect(registry.bindGeminiOwnedRequestOwner(accounting, Object.freeze({ ...controls }))).rejects.toThrow();
    await expect(execute(false, { accounting: { ...accounting } })).rejects.toThrow();
    (await import('@/lib/apiKeyBudget/geminiUploadRegistry.js')).revokeGeminiUploadedResourceSync(db, binding(), resource.id, new Date().toISOString());
    await expect(execute(true)).rejects.toThrow(); expect(requests).toHaveLength(2); expect(ack.calls).toBe(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
});
