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
import { openGeminiResourceLifecycleSync } from '@/lib/apiKeyBudget/geminiResourceLifecycle.js';
import { revokeGeminiUploadedResourceSync } from '@/lib/apiKeyBudget/geminiUploadRegistry.js';
import { getAccountingWriteCoordinator } from '@/lib/apiKeyBudget/accountingWriteCoordinator.js';
import { supportsGeminiRequest } from 'open-sse/config/accountedGeminiCandidate.js';
import * as authority from '@/lib/apiKeyBudget/geminiOwnedFileAuthority.js';
import { uploadGeminiOwnedFile } from '@/lib/apiKeyBudget/geminiOwnedUpload.js';
import { captureGeminiOwnedFilePriceSync } from '@/lib/apiKeyBudget/geminiOwnedFilePricing.js';
import { inspectGeminiOwnedFileUsageSync, createGeminiOwnedFileSseParserSync } from '@/lib/apiKeyBudget/geminiOwnedFileUsage.js';
import { costFromExactUsageSnapshot } from '@/lib/pricing/money.js';
import * as pricing from '@/lib/apiKeyBudget/geminiOwnedFilePricing.js';
import { createBudgetContext } from '@/lib/apiKeyBudget/service.js';
import { captureQueuedRequestAuthoritySync } from '@/lib/apiKeyBudget/queuedRequestAuthority.js';
import { captureAccountingProxyEnvironment } from 'open-sse/config/accountedProxyEnvironment.js';
import { captureAccountingBaseTransport } from 'open-sse/config/accountedBaseTransport.js';
import { PROVIDERS } from 'open-sse/config/providers.js';
import { createRequestAccounting } from '@/lib/apiKeyBudget/requestAccounting.js';
import { getGeminiOwnedRequestOwner } from 'open-sse/config/accountingGeminiOwnedRequestOwner.js';
const route = vi.hoisted(() => ({ origin: null }));
vi.mock('../../src/lib/apiKeyBudget/geminiUploadProtocol.js', async importOriginal => ({ ...await importOriginal(), get GEMINI_UPLOAD_ORIGIN() { return route.origin; } }));
let dir, db, writer, server, requests;
const binding = () => ({ credential: 'dummy-key-a', apiKeyId: 'a', provider: 'gemini', model: 'fixture-gemini', connectionId: 'c' });
const bytes = Buffer.from('dummy video fixture');
const metadata = () => ({ name: 'files/owned-video', uri: 'https://generativelanguage.googleapis.com/v1beta/files/owned-video', mimeType: 'video/mp4', sizeBytes: String(bytes.length), sha256Hash: createHash('sha256').update(bytes).digest('base64'), createTime: new Date().toISOString(), updateTime: new Date().toISOString(), expirationTime: new Date(Date.now() + 86400000).toISOString(), state: 'ACTIVE', source: 'UPLOADED' });
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), '9router-owned-resolution-')); writer = acquireWriterOwnership(dir);
  db = await createSqlJsAdapter(path.join(dir, 'data.sqlite'), writer); await runMigrationOnce(db);
  db.coverage = openAccountingCoverage(db, writer); db.ownerInstanceId = writer.instanceId; expect(db.driver).toBe('sql.js');
  seedGeminiAccountingFixture(db); openGeminiResourceLifecycleSync(db, writer); requests = [];
  server = http.createServer(async (req, res) => {
    let body = Buffer.alloc(0); for await (const chunk of req) body = Buffer.concat([body, chunk]); requests.push({ method: req.method, body });
    if (requests.length === 1) { res.writeHead(200, { 'X-Goog-Upload-URL': route.origin + '/upload/v1beta/files?upload_id=dummy-session', 'X-Goog-Upload-Status': 'active' }); res.end(); }
    else { res.writeHead(200, { 'Content-Type': 'application/json', 'X-Goog-Upload-Status': 'final' }); res.end(JSON.stringify({ file: metadata() })); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); route.origin = 'http://127.0.0.1:' + server.address().port;
});
afterEach(async () => {
  if (db) await getAccountingWriteCoordinator(db).stop(); server?.closeAllConnections();
  if (server) await new Promise(resolve => server.close(resolve)); vi.restoreAllMocks(); db?.close(); writer?.release(); fs.rmSync(dir, { recursive: true, force: true });
});
const upload = () => uploadGeminiOwnedFile({ db, binding: binding(), source: { dataBase64: bytes.toString('base64'), mimeType: 'video/mp4' } });
const original = resource => ({ contents: [{ parts: [{ text: 'private original' }, { fileData: { fileUri: resource.file.uri }, mediaResolution: { level: 'MEDIA_RESOLUTION_ULTRA_HIGH' } }] }], generationConfig: { mediaResolution: 'MEDIA_RESOLUTION_HIGH', maxOutputTokens: 20 } });
const prepare = (body, resource, metadataGrant = false, resolutionGrant = true, validator = value => supportsGeminiRequest(value)) => authority.prepareGeminiOwnedFileAuthoritySync(db, binding(), body, [resource], validator, metadataGrant, resolutionGrant);
const rates = { input: '1', output: '2', cached: '0.1', input_image: '3', cached_image: '0.2', input_audio: '7', cached_audio: '0.4', input_video: '11', cached_video: '0.5' };
const setRates = value => db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='gemini'", [JSON.stringify({ [binding().model]: value })]));
const message = () => ({ modelVersion: binding().model, candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'private answer' }] } }], usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 40, candidatesTokenCount: 20, thoughtsTokenCount: 10, totalTokenCount: 130, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 20 }, { modality: 'IMAGE', tokenCount: 50 }, { modality: 'AUDIO', tokenCount: 30 }], cacheTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'IMAGE', tokenCount: 20 }, { modality: 'AUDIO', tokenCount: 10 }] } });
async function queuedFixture(resource, stream = false, resolutionGrant = true, controlled = true) {
  const body = controlled ? original(resource) : { contents: [{ parts: [{ fileData: { fileUri: resource.file.uri } }] }] };
  const cap = prepare(body, resource, false, resolutionGrant); setRates(rates);
  const ctx = await createBudgetContext('a', { adapter: async () => db, project: () => {} });
  const requestAuthority = captureQueuedRequestAuthoritySync(db, binding());
  const wire = { protocol: 'native-gemini', url: 'https://generativelanguage.googleapis.com/v1beta/models/' + binding().model + (stream ? ':streamGenerateContent?alt=sse' : ':generateContent'),
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': 'dummy-provider', ...(stream ? { Accept: 'text/event-stream' } : {}) },
    credentials: { apiKey: 'dummy-provider', accessToken: null }, providerOverrides: null, proxyOptions: {}, proxyEnvironment: captureAccountingProxyEnvironment(),
    geminiTransport: { model: binding().model, mode: 'native-gemini-owned-video-resolution-' + (stream ? 'sse' : 'json'), baseTransport: captureAccountingBaseTransport(PROVIDERS.gemini), originalBody: body, resources: [{ id: resource.id, file: resource.file }], serializedBody: JSON.stringify(body) } };
  return { body, cap, ctx, wire, meta: { provider: 'gemini', model: binding().model, endpoint: 'chat', connectionId: 'c' }, options: { requestAuthority, preparedWire: wire, ownedFileCapability: cap } };
}
describe('owned inline video private grant and current usage/reference prerequisite, not GenerateContent producer', () => {
  it('issues independent strict defaultOFF video grant and refuses copied or revoked current authority', async () => {
    expect(typeof authority.assertGeminiOwnedFileInlineVideoSync).toBe('function');
    const resource = await upload(), body = { contents: [{ parts: [{ fileData: { fileUri: resource.file.uri } }] }] };
    const issue = video => authority.prepareGeminiOwnedFileAuthoritySync(db, binding(), body, [resource], value => supportsGeminiRequest(value), false, false, false, false, false, video);
    const cap = issue(true), plain = issue(false);
    expect(authority.assertGeminiOwnedFileInlineVideoSync(db, cap, body, binding().model)).toBe(true);
    expect(authority.assertGeminiOwnedFileInlineVideoSync(db, plain, body, binding().model)).toBe(false);
    for (const flag of [null, 1, 'true', {}, []]) expect(() => issue(flag)).toThrow();
    for (const [candidateDb, candidateCap, candidateBody, model] of [[{}, cap, body, binding().model], [db, { ...cap }, body, binding().model], [db, cap, { ...body, tools: [] }, binding().model], [db, cap, body, 'foreign']]) expect(() => authority.assertGeminiOwnedFileInlineVideoSync(candidateDb, candidateCap, candidateBody, model)).toThrow();
    revokeGeminiUploadedResourceSync(db, binding(), resource.id, new Date().toISOString());
    expect(() => authority.assertGeminiOwnedFileInlineVideoSync(db, cap, body, binding().model)).toThrow();
  });
  it('forwards exact private video grant through JSON/SSE and original price, retaining post-callback current checks', async () => {
    const resource = await upload(), body = { contents: [{ parts: [{ fileData: { fileUri: resource.file.uri } }, { inlineData: { mimeType: 'video/mp4', data: 'b3BhcXVl' } }] }] };
    const issue = video => authority.prepareGeminiOwnedFileAuthoritySync(db, binding(), body, [resource], value => supportsGeminiRequest(value, false, false, false, true), false, false, false, false, false, video);
    const cap = issue(true); setRates(rates);
    const capture = captureGeminiOwnedFilePriceSync(db, cap, body, binding().model);
    const seen = inspectGeminiOwnedFileUsageSync(db, cap, body, message(), binding().model);
    expect(costFromExactUsageSnapshot(seen.usage, capture.snapshot)).toBe('309000');
    expect(capture.snapshot.usageSemantics.allowedInputModalities).toEqual(['TEXT', 'VIDEO', 'IMAGE', 'AUDIO']);
    setRates(Object.fromEntries(Object.keys(rates).map(key => [key, '100'])));
    expect(costFromExactUsageSnapshot(seen.usage, capture.snapshot)).toBe('309000');
    const events = [], bytes = new TextEncoder().encode('data: ' + JSON.stringify(message()) + '\n\n');
    const parser = createGeminiOwnedFileSseParserSync(db, cap, body, event => { events.push(event); }, binding().model);
    parser.push(bytes); expect(parser.evidence()).toBeNull(); expect(parser.finish()).toEqual(seen.usage);
    expect(Buffer.concat(events.map(event => Buffer.from(event.bytes)))).toEqual(Buffer.from(bytes));
    for (const candidate of [{ ...cap }, issue(false)]) {
      expect(() => captureGeminiOwnedFilePriceSync(db, candidate, body, binding().model)).toThrow();
      expect(() => inspectGeminiOwnedFileUsageSync(db, candidate, body, message(), binding().model)).toThrow();
    }
    const revoked = createGeminiOwnedFileSseParserSync(db, cap, body, () => { revokeGeminiUploadedResourceSync(db, binding(), resource.id, new Date().toISOString()); }, binding().model);
    expect(() => revoked.push(bytes)).toThrow(); expect(() => revoked.finish()).toThrow();
    expect(requests).toHaveLength(2); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
  it('does not launder even absent inline video into existing modes via direct queued service or issued request', async () => {
    const resource = await upload(), f = await queuedFixture(resource, false, false, false);
    const cap = authority.prepareGeminiOwnedFileAuthoritySync(db, binding(), f.body, [resource], value => supportsGeminiRequest(value), false, true, false, false, false, true);
    const issued = await createRequestAccounting(new Request('http://localhost/v1/chat/completions', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true, ownedFileCapability: cap });
    await expect(f.ctx.beginAttemptQueued(f.meta, { ...f.options, ownedFileCapability: cap })).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    await expect(issued.beforeAttempt(f.meta, true, f.wire)).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(requests).toHaveLength(2); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
});
describe('owned resolution exact app-issued owner, not actual GenerateContent producer proof', () => {
  it.each([false, true])('retains private resolution grant own intent and only exact returned delivered terminal stream=%s', async stream => {
    const resource = await upload(), f = await queuedFixture(resource, stream);
    const issued = await createRequestAccounting(new Request('http://localhost/v1/chat/completions', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true, ownedFileCapability: f.cap });
    const controls = getGeminiOwnedRequestOwner(issued);
    expect(controls.videoResolution(f.meta, f.body)).toBe(true); expect(controls.videoMetadata(f.meta, f.body)).toBe(false);
    expect(() => getGeminiOwnedRequestOwner({ ...issued })).toThrow();
    const attempt = await issued.beforeAttempt(f.meta, true, f.wire); expect(attempt.unrecorded).not.toBe(true);
    expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [attempt.attemptId]).state).toBe('pending');
    setRates(Object.fromEntries(Object.keys(rates).map(key => [key, '100'])));
    const usage = controls.inspect(f.meta, f.body, message()).usage;
    const terminal = await issued.completeAttempt(attempt, { usage }); expect(String(terminal.costNanoUsd)).toBe('309000');
    expect(() => controls.terminal(f.meta, f.body, { ...terminal })).toThrow();
    expect(() => controls.terminal(f.meta, f.body, terminal)).not.toThrow();
    const changed = structuredClone(f.body); changed.generationConfig.mediaResolution = 'MEDIA_RESOLUTION_LOW';
    expect(() => controls.videoResolution(f.meta, changed)).toThrow();
    revokeGeminiUploadedResourceSync(db, binding(), resource.id, new Date().toISOString());
    expect(() => controls.terminal(f.meta, f.body, terminal)).toThrow(); expect(() => controls.videoResolution(f.meta, f.body)).toThrow();
    expect(requests).toHaveLength(2); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(1);
  });
  it('does not grant resolution from plain app owner even without controls or let resolution capability enter old mode', async () => {
    const resource = await upload(), plain = await queuedFixture(resource, false, false, false);
    const issued = await createRequestAccounting(new Request('http://localhost/v1/chat/completions', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true, ownedFileCapability: plain.cap });
    const controls = getGeminiOwnedRequestOwner(issued); expect(controls.videoResolution(plain.meta, plain.body)).toBe(false);
    await expect(issued.beforeAttempt(plain.meta, true, plain.wire)).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    const granted = await queuedFixture(resource, false, true, false);
    const owner = await createRequestAccounting(new Request('http://localhost/v1/chat/completions', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true, ownedFileCapability: granted.cap });
    expect(getGeminiOwnedRequestOwner(owner).videoResolution(granted.meta, granted.body)).toBe(true);
    const old = structuredClone(granted.wire); old.geminiTransport.mode = 'native-gemini-owned-files-json';
    await expect(owner.beforeAttempt(granted.meta, true, old)).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(requests).toHaveLength(2); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
});
describe('owned resolution actual queued service authority, not GenerateContent socket admission', () => {
  it.each([false, true])('owns durable intent and original price with private grant equal to exact mode stream=%s', async stream => {
    const resource = await upload(), f = await queuedFixture(resource, stream);
    if (stream) { const missing = structuredClone(f.wire); delete missing.headers.Accept; await expect(f.ctx.beginAttemptQueued(f.meta, { ...f.options, preparedWire: missing })).rejects.toThrow(); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]); }
    const attempt = await f.ctx.beginAttemptQueued(f.meta, f.options); expect(attempt.unrecorded).not.toBe(true);
    expect(attempt.priceSnapshot.usageSemantics.inputModalities).toBe('observed_gemini_owned_file_input_modalities');
    expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [attempt.attemptId]).state).toBe('pending');
    setRates(Object.fromEntries(Object.keys(rates).map(key => [key, '100'])));
    const usage = inspectGeminiOwnedFileUsageSync(db, f.cap, f.body, message(), binding().model).usage;
    const terminal = await f.ctx.completeAttemptQueued(attempt, { usage }); expect(terminal.state).toBe('settled'); expect(String(terminal.costNanoUsd)).toBe('309000');
    expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [attempt.attemptId]).state).toBe('settled');
    expect(requests).toHaveLength(2); expect(JSON.stringify(db.all('SELECT * FROM apiKeyAccounting'))).not.toMatch(/private original|private answer|dummy-provider|dummy-key-a|files\/owned-video/);
  });
  it('refuses missing copied and plain capabilities even without controls; grant cannot enter old plain or metadata mode', async () => {
    const resource = await upload(), f = await queuedFixture(resource);
    for (const cap of [null, { ...f.cap }]) await expect(f.ctx.beginAttemptQueued(f.meta, { ...f.options, ownedFileCapability: cap })).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    const plain = await queuedFixture(resource, false, false, false);
    await expect(plain.ctx.beginAttemptQueued(plain.meta, plain.options)).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    const granted = await queuedFixture(resource, false, true, false);
    for (const mode of ['native-gemini-owned-files-json', 'native-gemini-owned-video-metadata-json']) {
      const wire = structuredClone(granted.wire); wire.geminiTransport.mode = mode;
      await expect(granted.ctx.beginAttemptQueued(granted.meta, { ...granted.options, preparedWire: wire })).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    }
    expect(requests).toHaveLength(2); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
  it('rechecks actual dequeue price and revocation after one enqueue capture without repick or intent', async () => {
    const resource = await upload(), f = await queuedFixture(resource), capture = vi.spyOn(pricing, 'captureGeminiOwnedFilePriceSync');
    const changed = f.ctx.beginAttemptQueued(f.meta, f.options); expect(capture).toHaveBeenCalledOnce();
    setRates({ ...rates, input_video: '13' }); await expect(changed).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    setRates(rates); capture.mockClear(); const revoked = f.ctx.beginAttemptQueued(f.meta, f.options); expect(capture).toHaveBeenCalledOnce();
    revokeGeminiUploadedResourceSync(db, binding(), resource.id, new Date().toISOString());
    await expect(revoked).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(requests).toHaveLength(2); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
});
describe('owned resolution usage/reference consumer composition, not wire/dispatch/ACK proof', () => {
  it('captures reference only and observed JSON counters using exact private grants without resolution-derived fees', async () => {
    const resource = await upload(), body = original(resource), before = structuredClone(body), cap = prepare(body, resource); setRates(rates);
    const capture = captureGeminiOwnedFilePriceSync(db, cap, body, binding().model);
    expect(capture.usageCertified).toBe(false);
    expect(capture.snapshot.usageSemantics).toEqual({ inputModalities: 'observed_gemini_owned_file_input_modalities', allowedInputModalities: ['TEXT', 'VIDEO', 'IMAGE', 'AUDIO'] });
    const result = inspectGeminiOwnedFileUsageSync(db, cap, body, message(), binding().model);
    expect(result.message).toEqual(message()); expect(costFromExactUsageSnapshot(result.usage, capture.snapshot)).toBe('309000');
    setRates(Object.fromEntries(Object.keys(rates).map(key => [key, '100'])));
    expect(costFromExactUsageSnapshot(result.usage, capture.snapshot)).toBe('309000');
    expect(body).toEqual(before); expect(requests).toHaveLength(2); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
    expect(JSON.stringify(capture)).not.toMatch(/private original|private answer|dummy-provider|dummy-key-a|files\/owned-video/);
  });
  it('native SSE preserves exact framing with fresh checks around push callback and finish; callback revocation latches failure', async () => {
    const resource = await upload(), body = original(resource); body.contents[0].parts[1].videoMetadata = { fps: 1, endOffset: '1s' };
    const cap = prepare(body, resource, true), raw = message(), text = 'data: ' + JSON.stringify(raw) + '\n\n', bytes = new TextEncoder().encode(text), events = [];
    // Whole-frame consumer test only. The separate unchanged bytewise throughput gate remains OPEN.
    const parser = createGeminiOwnedFileSseParserSync(db, cap, body, event => { events.push(event); }, binding().model);
    parser.push(bytes); expect(parser.evidence()).toBeNull(); expect(parser.finish()).toEqual(inspectGeminiOwnedFileUsageSync(db, cap, body, raw, binding().model).usage);
    expect(Buffer.concat(events.map(event => Buffer.from(event.bytes))).toString()).toBe(text);
    expect(() => parser.finish()).toThrow();
    const callback = vi.fn(() => { revokeGeminiUploadedResourceSync(db, binding(), resource.id, new Date().toISOString()); });
    const revoked = createGeminiOwnedFileSseParserSync(db, cap, body, callback, binding().model);
    expect(() => revoked.push(bytes)).toThrow(); expect(callback).toHaveBeenCalledOnce();
    expect(() => revoked.push(new Uint8Array())).toThrow(); expect(() => revoked.finish()).toThrow();
    expect(requests).toHaveLength(2); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
  it('requires even unobserved video rates and refuses copied original/model/credential drift and non-synchronous callbacks', async () => {
    const resource = await upload(), body = original(resource), cap = prepare(body, resource); setRates(rates);
    expect(captureGeminiOwnedFilePriceSync(db, cap, body, binding().model).usageCertified).toBe(false);
    for (const key of ['input_video', 'cached_video']) { const missing = { ...rates }; delete missing[key]; setRates(missing); expect(() => captureGeminiOwnedFilePriceSync(db, cap, body, binding().model)).toThrow(); } setRates(rates);
    for (const [candidate, originalBody, model] of [[{ ...cap }, body, binding().model], [cap, { ...body, generationConfig: { mediaResolution: 'MEDIA_RESOLUTION_LOW' } }, binding().model], [cap, body, 'foreign']]) {
      expect(() => captureGeminiOwnedFilePriceSync(db, candidate, originalBody, model)).toThrow();
      expect(() => inspectGeminiOwnedFileUsageSync(db, candidate, originalBody, message(), model)).toThrow();
    }
    const text = new TextEncoder().encode('data: ' + JSON.stringify(message()) + '\n\n');
    for (const callback of [() => 1, () => Promise.reject(new Error('dummy callback refusal'))]) {
      const parser = createGeminiOwnedFileSseParserSync(db, cap, body, callback, binding().model);
      expect(() => parser.push(text)).toThrow(); expect(() => parser.finish()).toThrow();
    }
    db.durableTransaction(() => db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ apiKey: 'changed-dummy-provider' }), 'c']));
    expect(() => captureGeminiOwnedFilePriceSync(db, cap, body, binding().model)).toThrow();
    expect(() => inspectGeminiOwnedFileUsageSync(db, cap, body, message(), binding().model)).toThrow();
    expect(requests).toHaveLength(2); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
});
describe('owned resolution current private capability, not pricing/wire/dispatch admission', () => {
  it('owned inline audio private grant is strict independent defaultOFF and cannot be copied or reused after revoke', async () => {
    const resource = await upload(), body = original(resource);
    body.contents[0].parts.push({ inlineData: { mimeType: 'audio/wav', data: bytes.toString('base64') } });
    const validator = value => supportsGeminiRequest(value, false, false, true);
    const issue = audio => authority.prepareGeminiOwnedFileAuthoritySync(db, binding(), body, [resource], validator, false, true, false, false, audio);
    const cap = issue(true);
    expect(typeof authority.assertGeminiOwnedFileInlineAudioSync).toBe('function');
    expect(authority.assertGeminiOwnedFileInlineAudioSync(db, cap, body, binding().model)).toBe(true);
    expect(authority.assertGeminiOwnedFileInlineMediaSync(db, cap, body, binding().model)).toBe(false);
    for (const invalid of [null, 'true', 1, {}, []]) expect(() => issue(invalid)).toThrow();
    const defaultCap = authority.prepareGeminiOwnedFileAuthoritySync(db, binding(), body, [resource], validator, false, true);
    expect(authority.assertGeminiOwnedFileInlineAudioSync(db, defaultCap, body, binding().model)).toBe(false);
    expect(() => inspectGeminiOwnedFileUsageSync(db, defaultCap, body, message(), binding().model)).toThrow();
    expect(() => authority.assertGeminiOwnedFileInlineAudioSync(db, { ...cap }, body, binding().model)).toThrow();
    setRates(rates);
    const capture = captureGeminiOwnedFilePriceSync(db, cap, body, binding().model);
    expect(costFromExactUsageSnapshot(inspectGeminiOwnedFileUsageSync(db, cap, body, message(), binding().model).usage, capture.snapshot)).toBe('309000');
    revokeGeminiUploadedResourceSync(db, binding(), resource.id, new Date().toISOString());
    expect(() => authority.assertGeminiOwnedFileInlineAudioSync(db, cap, body, binding().model)).toThrow();
    expect(requests).toHaveLength(2); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
  it('retains independent default-closed resolution grant and full original through actual owned upload identity', async () => {
    const resource = await upload(), body = original(resource), before = structuredClone(body), cap = prepare(body, resource);
    expect(authority.assertGeminiOwnedFileVideoResolutionSync(db, cap, body, binding().model)).toBe(true);
    expect(authority.assertGeminiOwnedFileVideoMetadataSync(db, cap, body, binding().model)).toBe(false);
    expect(authority.assertGeminiOwnedFileAuthoritySync(db, cap, body)).toEqual({ original: before, resources: [{ id: resource.id, file: resource.file }] });
    expect(body).toEqual(before); expect(Object.isFrozen(cap)).toBe(true); expect(() => prepare(body, resource, false, false)).toThrow();
    const plain = { contents: [{ parts: [{ fileData: { fileUri: resource.file.uri } }] }] };
    const defaultCap = authority.prepareGeminiOwnedFileAuthoritySync(db, binding(), plain, [resource], value => supportsGeminiRequest(value));
    expect(authority.assertGeminiOwnedFileVideoResolutionSync(db, defaultCap, plain, binding().model)).toBe(false);
    const grantedPlain = prepare(plain, resource); expect(authority.assertGeminiOwnedFileVideoResolutionSync(db, grantedPlain, plain, binding().model)).toBe(true);
    const mixed = structuredClone(body); mixed.contents[0].parts[1].videoMetadata = { fps: 1, endOffset: '1s' };
    expect(() => prepare(mixed, resource)).toThrow(); const mixedCap = prepare(mixed, resource, true);
    expect(authority.assertGeminiOwnedFileVideoMetadataSync(db, mixedCap, mixed, binding().model)).toBe(true);
    expect(authority.assertGeminiOwnedFileVideoResolutionSync(db, mixedCap, mixed, binding().model)).toBe(true);
    expect(requests).toHaveLength(2); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
  it('cannot copy or launder grant across original model DB resource credential revocation boundaries', async () => {
    const resource = await upload(), body = original(resource), cap = prepare(body, resource);
    expect(authority.assertGeminiOwnedFileVideoResolutionSync(db, cap, body, binding().model)).toBe(true);
    for (const fake of [{ ...cap }, { ...cap, allowVideoResolution: true }]) expect(() => authority.assertGeminiOwnedFileVideoResolutionSync(db, fake, body, binding().model)).toThrow();
    expect(() => prepare(body, structuredClone(resource))).toThrow();
    expect(() => authority.prepareGeminiOwnedFileAuthoritySync(db, { ...binding(), apiKeyId: 'foreign' }, body, [resource], value => supportsGeminiRequest(value), false, true)).toThrow();
    expect(() => authority.assertGeminiOwnedFileVideoResolutionSync({}, cap, body, binding().model)).toThrow();
    expect(() => authority.assertGeminiOwnedFileVideoResolutionSync(db, cap, body, 'foreign')).toThrow();
    const changed = structuredClone(body); changed.contents[0].parts[1].mediaResolution.level = 'MEDIA_RESOLUTION_LOW';
    expect(() => authority.assertGeminiOwnedFileVideoResolutionSync(db, cap, changed, binding().model)).toThrow();
    db.durableTransaction(() => db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ apiKey: 'changed-dummy-provider' }), 'c']));
    expect(() => authority.assertGeminiOwnedFileVideoResolutionSync(db, cap, body, binding().model)).toThrow();
    db.durableTransaction(() => db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ apiKey: 'dummy-provider' }), 'c']));
    revokeGeminiUploadedResourceSync(db, binding(), resource.id, new Date().toISOString());
    expect(() => authority.assertGeminiOwnedFileVideoResolutionSync(db, cap, body, binding().model)).toThrow();
    expect(requests).toHaveLength(2); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
  });
  it('checks strict Boolean and original traps and rechecks current lifecycle after actual validator callback', async () => {
    const resource = await upload(), body = original(resource), cap = prepare(body, resource);
    expect(authority.assertGeminiOwnedFileVideoResolutionSync(db, cap, body, binding().model)).toBe(true);
    for (const grant of [null, 'true', 1, {}, []]) expect(() => prepare(body, resource, false, grant)).toThrow();
    const getter = vi.fn(), trapped = original(resource); Object.defineProperty(trapped.generationConfig, 'mediaResolution', { enumerable: true, get: getter });
    expect(() => prepare(trapped, resource)).toThrow(); expect(getter).not.toHaveBeenCalled();
    const callback = vi.fn(value => { revokeGeminiUploadedResourceSync(db, binding(), resource.id, new Date().toISOString()); return supportsGeminiRequest(value); });
    expect(() => prepare(body, resource, false, true, callback)).toThrow(); expect(callback).toHaveBeenCalledOnce();
    expect(requests).toHaveLength(2); expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
    const ledger = JSON.stringify(db.all('SELECT * FROM apiKeyAccounting')); expect(ledger).not.toMatch(/private original|dummy-provider|dummy-key-a|files\/owned-video/);
  });
});
