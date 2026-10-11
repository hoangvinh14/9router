import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Compile the fixed core graph during collection, not owned-DB hook execution.
// Keep the existing 10s hook limit and per-case module/DB isolation.
import { handleEmbeddingsCore as invoke } from 'open-sse/handlers/embeddingsCore.js';

const fixture = vi.hoisted(() => ({ url: null }));
// Exact owned route authority comes only from candidate AND registry module
// replacements. Native fetch/proxy transport stay real; no production override.
vi.mock('../../open-sse/config/accountedEmbeddingsCandidate.js', () => ({ get ACCOUNTED_EMBEDDINGS_URL() { return fixture.url; } }));
vi.mock('../../open-sse/providers/index.js', async importOriginal => {
  const original = await importOriginal();
  return { ...original, PROVIDER_MEDIA: { ...original.PROVIDER_MEDIA, get openai() { return { ...original.PROVIDER_MEDIA.openai,
    embeddingConfig: { ...original.PROVIDER_MEDIA.openai.embeddingConfig, baseUrl: fixture.url } }; } } };
});
let db, directory, server, requests, failure, responder, createAccounting;
const old = process.env.DATA_DIR;
const message = { object: 'list', data: [], model: 'fixture-embedding', usage: { prompt_tokens: 100, total_tokens: 100 } };
const options = accounting => ({ body: { model: 'fixture-embedding', input: 'fixture' }, modelInfo: { provider: 'openai', model: 'fixture-embedding' },
  credentials: { apiKey: 'dummy-provider' }, connectionId: 'c', accounting,
  proxyOptions: { persistedGlobalProxy: { url: 'http://127.0.0.1:1', noProxy: '127.0.0.1' } } });
beforeEach(async () => {
  vi.resetModules(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-native-embeddings-')); process.env.DATA_DIR = directory; delete global._dbAdapter;
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }],
    settings: { requireApiKey: true, outboundProxyEnabled: true, outboundProxyUrl: 'http://127.0.0.1:1', outboundNoProxy: '127.0.0.1' },
    providerConnections: [{ id: 'c', provider: 'openai', authType: 'apikey', apiKey: 'dummy-provider' }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','openai',?)", [JSON.stringify({ 'fixture-embedding': { input: '0.02', output: '0' } })]);
  });
  requests = []; failure = null;
  responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(message)); };
  server = http.createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      requests.push({ method: request.method, key: request.headers.authorization, url: request.url, body: JSON.parse(Buffer.concat(chunks).toString()),
        row: db.get('SELECT requestId,state FROM apiKeyAccounting') });
      await responder(request, response);
    } catch (error) { failure = error; response.writeHead(500, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: 'fixture failure' })); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  fixture.url = `http://127.0.0.1:${server.address().port}/v1/embeddings`;
  createAccounting = () => import('@/lib/apiKeyBudget/requestAccounting.js').then(({ createRequestAccounting }) => createRequestAccounting(
    new Request('http://localhost/v1/embeddings', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true }));
});
afterEach(async () => {
  server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve));
  vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true });
  if (old === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = old;
});
describe('native HTTP embeddings queued original authority (test modules only, not TLS/OAuth)', { timeout: 20000 }, () => {
  it('actual original POST owns pending and settles original2000 despite upstream pricing edit', async () => {
    const context = await createAccounting(), args = options(context);
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      expect(wire.protocol).toBe('native-embeddings'); expect(Reflect.set(wire.headers, 'authorization', 'Bearer dummy-changed')).toBe(false);
      const work = context.beforeAttempt(meta, supported, wire); args.credentials.apiKey = 'dummy-changed'; args.body.input = 'changed'; return work;
    } };
    responder = (_request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='openai'", [JSON.stringify({ 'fixture-embedding': { input: '9', output: '0' } })]));
      response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(message));
    };
    const result = await invoke({ ...args, accounting });
    expect(await result.response.json()).toEqual(message); expect(failure).toBeNull(); expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({ method: 'POST', key: 'Bearer dummy-provider', url: '/v1/embeddings', body: { model: 'fixture-embedding', input: 'fixture', encoding_format: 'float' },
      row: { requestId: context.requestId, state: 'pending' } });
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 2000 }]); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('native JSON success cannot return while own queued terminal ACK is held', async () => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, async completeAttempt(attempt, completion) { enter(); await held; return context.completeAttempt(attempt, completion); } };
    let returned = false; const work = invoke(options(accounting)).then(value => { returned = true; return value; });
    try { await entered; expect(returned).toBe(false); expect(requests).toHaveLength(1); expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'pending', costNanoUsd: null }]); }
    finally { release(); }
    expect((await work).response.ok).toBe(true); expect(failure).toBeNull();
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 2000 }]); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('credential drift at dequeue refuses before native POST/intent/gap', async () => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      expect(wire.protocol).toBe('native-embeddings'); const work = context.beforeAttempt(meta, supported, wire);
      db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']); db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(row.data), apiKey: 'dummy-new' }), 'c']); }); return work;
    } };
    await expect(invoke(options(accounting))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['unlimited', 'budgeted'])('307 %s has no native embeddings replay and sole unresolved terminal', async policy => {
    if (policy === 'budgeted') {
      const { putPolicySync } = await import('@/lib/db/repos/apiKeyAccountingRepo.js');
      putPolicySync(db, 'a', { weeklyLimitNanoUsd: '1000000000', monthlyLimitNanoUsd: null }, 0);
    }
    responder = (_request, response) => { response.writeHead(307, { location: fixture.url }); response.end(); };
    const work = invoke(options(await createAccounting()));
    // Embeddings returns a provider error result for unlimited ambiguity AFTER
    // own terminal ACK. Budgeted ambiguity rejects locally; neither may replay.
    if (policy === 'budgeted') await expect(work).rejects.toMatchObject({ code: 'api_key_accounting_unresolved' });
    else expect(await work).toMatchObject({ success: false, status: 502, response: { status: 502 } });
    expect(failure).toBeNull(); expect(requests).toHaveLength(1);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', costNanoUsd: null }]); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
});
