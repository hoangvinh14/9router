import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
let db, directory, server, requests, failure, responder, DefaultExecutor, createAccounting;
const old = process.env.DATA_DIR;
const message = { modelVersion: 'fixture-gemini', candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'answer' }] } }],
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 130, cachedContentTokenCount: 40, thoughtsTokenCount: 10 } };
const options = accounting => ({ model: 'fixture-gemini', stream: false, body: { model: 'fixture-gemini', stream: false, contents: [{ role: 'user', parts: [{ text: 'fixture' }] }] },
  credentials: { apiKey: 'dummy-provider' }, connectionId: 'c', accountingMode: 'native-gemini-json', accounting,
  proxyOptions: { persistedGlobalProxy: { url: 'http://127.0.0.1:1', noProxy: '127.0.0.1' } } });
beforeEach(async () => {
  vi.resetModules(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-native-gemini-')); process.env.DATA_DIR = directory; delete global._dbAdapter;
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }],
    settings: { requireApiKey: true, outboundProxyEnabled: true, outboundProxyUrl: 'http://127.0.0.1:1', outboundNoProxy: '127.0.0.1' },
    providerConnections: [{ id: 'c', provider: 'gemini', authType: 'apikey', apiKey: 'dummy-provider' }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','gemini',?)", [JSON.stringify({ 'fixture-gemini': { input: '1', output: '2', cached: '0.1' } })]);
  });
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
  fixture.base = `http://127.0.0.1:${server.address().port}/v1beta/models`;
  ({ DefaultExecutor } = await import('open-sse/executors/default.js'));
  createAccounting = () => import('@/lib/apiKeyBudget/requestAccounting.js').then(({ createRequestAccounting }) => createRequestAccounting(
    new Request('http://localhost/v1beta/models/gemini/fixture-gemini:generateContent', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true }));
});
afterEach(async () => {
  server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve));
  vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true });
  if (old === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = old;
});
describe('native HTTP Gemini queued original authority (test modules only, not TLS/OAuth/envelopes)', { timeout: 20000 }, () => {
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
