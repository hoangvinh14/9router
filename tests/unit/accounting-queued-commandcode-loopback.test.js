import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { CommandCodeExecutor } from 'open-sse/executors/commandcode.js';
const fixture = vi.hoisted(() => ({ url: null }));
// Only candidate AND registry replacements grant this exact owned route. No
// production custom endpoint/TLS exception; actual native fetch/proxy/database.
vi.mock('../../open-sse/config/accountedCommandCodeCandidate.js', async importOriginal => {
  const original = await importOriginal(); return { ...original, get ACCOUNTED_COMMANDCODE_URL() { return fixture.url; } };
});
vi.mock('../../open-sse/config/providers.js', async importOriginal => {
  const original = await importOriginal(); return { ...original, PROVIDERS: { ...original.PROVIDERS, get commandcode() { return { ...original.PROVIDERS.commandcode, baseUrl: fixture.url }; } } };
});
let directory, db, server, requests, failure, responder, createAccounting;
const previous = process.env.DATA_DIR, model = 'deepseek/deepseek-v4-pro';
const body = () => ({ threadId: '11111111-1111-4111-8111-111111111111', memory: '',
  config: { workingDir: '/fixture/workspace', date: '2026-10-10', environment: 'linux', structure: [], isGitRepo: false, currentBranch: '', mainBranch: '', gitStatus: '', recentCommits: [] },
  params: { model, stream: true, max_tokens: 64, temperature: 0.3, messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture prompt' }] }] } });
const usage = () => ({ inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 0, reasoningTokens: 0 });
const wire = () => [{ type: 'start' }, { type: 'start-step' }, { type: 'text-start', id: 'text_fixture' },
  { type: 'text-delta', id: 'text_fixture', text: 'fixture output' }, { type: 'text-end', id: 'text_fixture' },
  { type: 'finish-step', finishReason: 'stop', usage: usage() }, { type: 'finish', finishReason: 'stop', totalUsage: usage() }].map(event => JSON.stringify(event) + '\n').join('');
const options = accounting => ({ model, body: body(), stream: true, connectionId: 'c', accountingMode: 'native-commandcode-ndjson', accounting,
  credentials: { apiKey: 'dummy-api-key', connectionId: 'c', providerSpecificData: {} },
  proxyOptions: { persistedGlobalProxy: { url: 'http://127.0.0.1:1', noProxy: '127.0.0.1' } } });
beforeEach(async () => {
  vi.resetModules(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-native-commandcode-')); process.env.DATA_DIR = directory; delete global._dbAdapter;
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }],
    settings: { requireApiKey: true, outboundProxyEnabled: true, outboundProxyUrl: 'http://127.0.0.1:1', outboundNoProxy: '127.0.0.1' },
    providerConnections: [{ id: 'c', provider: 'commandcode', authType: 'apikey', apiKey: 'dummy-api-key', providerSpecificData: {} }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','commandcode',?)", [JSON.stringify({ [model]: { input: '1', output: '2' } })]);
  });
  requests = []; failure = null;
  responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/x-ndjson' }); response.end(wire()); };
  server = http.createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      requests.push({ method: request.method, url: request.url, body: JSON.parse(Buffer.concat(chunks).toString()), headers: request.headers, row: db.get('SELECT requestId,state FROM apiKeyAccounting') });
      await responder(request, response);
    } catch (error) { failure = error; response.writeHead(500, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: 'fixture failed' })); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  fixture.url = `http://127.0.0.1:${server.address().port}/commandcode/generate`;
  createAccounting = () => import('@/lib/apiKeyBudget/requestAccounting.js').then(({ createRequestAccounting }) => createRequestAccounting(
    new Request('http://localhost/v1/chat/completions', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true }));
});
afterEach(async () => {
  server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve));
  vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous;
});
const rows = () => db.all('SELECT state,costNanoUsd FROM apiKeyAccounting');
describe('owned HTTP native CommandCode no-retry (not TLS/legacy retry/full model approval)', { timeout: 20000 }, () => {
  it('actual original body/full headers and session use frozen authority, own pending, original140000 after price edit', async () => {
    const context = await createAccounting(), args = options(context); let expectedHeaders;
    const accounting = { ...context, beforeAttempt(meta, supported, prepared) {
      expect(prepared.protocol).toBe('native-commandcode'); expect(Reflect.set(prepared.headers, 'authorization', 'changed')).toBe(false); expectedHeaders = prepared.headers;
      const work = context.beforeAttempt(meta, supported, prepared);
      args.credentials.apiKey = 'changed'; args.body.config.workingDir = '/changed'; args.body.params.messages[0].content[0].text = 'changed'; return work;
    } };
    responder = (_request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='commandcode'", [JSON.stringify({ [model]: { input: '9', output: '9' } })]));
      response.writeHead(200, { 'content-type': 'application/x-ndjson' }); response.end(wire());
    };
    const result = await new CommandCodeExecutor().execute({ ...args, accounting }); expect(await result.response.text()).toBe(wire());
    expect(failure).toBeNull(); expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: 'POST', url: '/commandcode/generate', body: body(), headers: expectedHeaders, row: { requestId: context.requestId, state: 'pending' } });
    expect(requests[0].headers.authorization).toBe('Bearer dummy-api-key'); expect(requests[0].headers['x-session-id']).toMatch(/^[a-f0-9-]{36}$/);
    expect(rows()).toEqual([{ state: 'settled', costNanoUsd: 140000 }]); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('raw finish-step/finish and EOF wait own terminal ACK after consumer delta on native HTTP', async () => {
    const context = await createAccounting(); let enter, release, deltaRead;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; }), delta = new Promise(resolve => { deltaRead = resolve; });
    const accounting = { ...context, async completeAttempt(attempt, completion) { enter(); await held; return context.completeAttempt(attempt, completion); } };
    const result = await new CommandCodeExecutor().execute(options(accounting)); let delivered = '', ended = false;
    const work = (async () => { const reader = result.response.body.getReader(), decoder = new TextDecoder();
      try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; delivered += decoder.decode(chunk.value, { stream: true }); if (delivered.includes('fixture output')) deltaRead(); } delivered += decoder.decode(); ended = true; }
      finally { reader.releaseLock(); }
    })();
    try {
      await entered; await delta; expect(ended).toBe(false); expect(delivered).toContain('fixture output'); expect(delivered).not.toContain('finish-step');
      expect(requests).toHaveLength(1); expect(rows()).toEqual([{ state: 'pending', costNanoUsd: null }]);
    } finally { release(); await work; }
    expect(ended).toBe(true); expect(delivered).toBe(wire()); expect(delivered).not.toContain('[DONE]'); expect(failure).toBeNull(); expect(rows()).toEqual([{ state: 'settled', costNanoUsd: 140000 }]);
  });
  it('missing raw finish rejects delivery then separately awaits one unresolved ACK without retry', async () => {
    const context = await createAccounting(); let acknowledged;
    const ack = new Promise(resolve => { acknowledged = resolve; });
    const accounting = { ...context, async completeAttempt(attempt, completion) { const terminal = await context.completeAttempt(attempt, completion); acknowledged(); return terminal; } };
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/x-ndjson' }); response.end(wire().split('\n').slice(0, -2).join('\n') + '\n'); };
    const result = await new CommandCodeExecutor().execute(options(accounting)); await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable'); await ack;
    expect(failure).toBeNull(); expect(requests).toHaveLength(1); expect(rows()).toEqual([{ state: 'unresolved', costNanoUsd: null }]); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('persisted key drift at dequeue refuses zero socket POST/intent/gap', async () => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, prepared) {
      expect(prepared.protocol).toBe('native-commandcode'); const work = context.beforeAttempt(meta, supported, prepared);
      db.durableTransaction(() => { const data = JSON.parse(db.get('SELECT data FROM providerConnections WHERE id=?', ['c']).data); data.apiKey = 'dummy-rotated'; db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify(data), 'c']); }); return work;
    } };
    await expect(new CommandCodeExecutor().execute(options(accounting))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('native caller abort while own intent ACK is held completes not-dispatched with zero socket POST', async () => {
    const context = await createAccounting(), signal = new AbortController(), reason = new Error('fixture native CommandCode held-intent abort'); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const complete = vi.fn((attempt, payload) => context.completeAttempt(attempt, payload));
    const accounting = { ...context, completeAttempt: complete, async beforeAttempt(meta, supported, prepared) {
      const attempt = await context.beforeAttempt(meta, supported, prepared); enter(); await held; return attempt;
    } };
    const work = new CommandCodeExecutor().execute({ ...options(accounting), signal: signal.signal });
    const rejected = expect(work).rejects.toBe(reason);
    try {
      await entered; expect(rows()).toEqual([{ state: 'pending', costNanoUsd: null }]);
      signal.abort(reason); expect(complete).not.toHaveBeenCalled(); expect(requests).toHaveLength(0);
    } finally { release(); await rejected; }
    expect(failure).toBeNull(); expect(requests).toHaveLength(0); expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][1]).toEqual({ notDispatched: true, outcome: 'aborted' });
    expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'not_dispatched', outcome: 'aborted', costNanoUsd: null }]);
  });
  it('native caller abort after server receives POST but before response headers owns unresolved ACK and no retry', async () => {
    const context = await createAccounting(), signal = new AbortController(), reason = new Error('fixture native CommandCode post-received abort'); let received, socketResponse;
    const entered = new Promise(resolve => { received = resolve; });
    const complete = vi.fn((attempt, payload) => context.completeAttempt(attempt, payload)), authorize = vi.fn();
    responder = (_request, response) => { socketResponse = response; received(); }; // actual server barrier, no timing guess
    const work = new CommandCodeExecutor().execute({ ...options({ ...context, completeAttempt: complete, assertSuccessfulTerminal: authorize }), signal: signal.signal });
    const rejected = expect(work).rejects.toBe(reason);
    try {
      await entered; expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(body());
      expect(requests[0].row).toMatchObject({ state: 'pending', requestId: context.requestId }); expect(rows()).toEqual([{ state: 'pending', costNanoUsd: null }]);
      signal.abort(reason); await rejected;
      expect(complete).toHaveBeenCalledTimes(1); expect(complete.mock.calls[0][1]).toEqual({ usage: null, outcome: 'aborted' });
      expect(authorize).not.toHaveBeenCalled(); expect(requests).toHaveLength(1); expect(failure).toBeNull();
      expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', outcome: 'aborted', costNanoUsd: null }]);
    } finally { signal.abort(reason); socketResponse?.destroy(); }
  });
  it('307 cannot replay generation: one POST and one unresolved ACK', async () => {
    responder = (_request, response) => { response.writeHead(307, { location: fixture.url }); response.end(); };
    await expect(new CommandCodeExecutor().execute(options(await createAccounting()))).rejects.toThrow();
    expect(failure).toBeNull(); expect(requests).toHaveLength(1); expect(rows()).toEqual([{ state: 'unresolved', costNanoUsd: null }]); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
});
