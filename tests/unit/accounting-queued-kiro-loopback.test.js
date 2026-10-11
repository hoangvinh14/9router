import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { KiroExecutor } from 'open-sse/executors/kiro.js';
import { concatFixtureBytes, fixtureKiroEvent } from '../helpers/accountingKiroFrames.js';
const fixture = vi.hoisted(() => ({ url: null }));
// Exact owned route granted ONLY by candidate AND registry replacements.
// Native fetch/proxy/database are real; no production URL/TLS exceptions.
vi.mock('../../open-sse/config/accountedKiroCandidate.js', async importOriginal => {
  const original = await importOriginal(); return { ...original, get ACCOUNTED_KIRO_URL() { return fixture.url; } };
});
vi.mock('../../open-sse/config/providers.js', async importOriginal => {
  const original = await importOriginal(); return { ...original, PROVIDERS: { ...original.PROVIDERS, get kiro() {
    return { ...original.PROVIDERS.kiro, baseUrls: [...original.PROVIDERS.kiro.baseUrls.slice(0, 2), fixture.url] };
  } } };
});
let directory, db, server, requests, failure, responder, createAccounting;
const previous = process.env.DATA_DIR, model = 'claude-sonnet-4.5';
const body = () => ({ conversationState: { chatTriggerType: 'MANUAL', conversationId: '12345678-1234-4123-8123-123456789abc',
  currentMessage: { userInputMessage: { content: 'fixture prompt', modelId: model, origin: 'AI_EDITOR' } }, history: [] },
  inferenceConfig: { maxTokens: 100, temperature: 0.5, topP: 1 } });
const prefix = () => fixtureKiroEvent('assistantResponseEvent', { content: 'fixture output' });
const metrics = () => fixtureKiroEvent('metricsEvent', { inputTokens: 100, outputTokens: 20, totalTokens: 120,
  cacheReadInputTokens: 0, cacheCreationInputTokens: 0, reasoningTokens: 0 });
const wire = () => concatFixtureBytes([prefix(), metrics(), fixtureKiroEvent('messageStopEvent', { stopReason: 'end_turn' })]);
const options = accounting => ({ model, body: body(), stream: true, connectionId: 'c', accountingMode: 'native-kiro-eventstream', accounting,
  credentials: { apiKey: null, accessToken: 'dummy-api-key', connectionId: 'c', providerSpecificData: { authMethod: 'api_key', region: 'us-east-1' } },
  proxyOptions: { persistedGlobalProxy: { url: 'http://127.0.0.1:1', noProxy: '127.0.0.1' } } });
beforeEach(async () => {
  vi.resetModules(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-native-kiro-')); process.env.DATA_DIR = directory; delete global._dbAdapter;
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }],
    settings: { requireApiKey: true, outboundProxyEnabled: true, outboundProxyUrl: 'http://127.0.0.1:1', outboundNoProxy: '127.0.0.1' },
    providerConnections: [{ id: 'c', provider: 'kiro', authType: 'apikey', apiKey: null, accessToken: 'dummy-api-key', providerSpecificData: { authMethod: 'api_key', region: 'us-east-1' } }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','kiro',?)", [JSON.stringify({ [model]: { input: '1', output: '2' } })]);
  });
  requests = []; failure = null;
  responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/vnd.amazon.eventstream' }); response.end(wire()); };
  server = http.createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      requests.push({ method: request.method, url: request.url, body: JSON.parse(Buffer.concat(chunks).toString()), headers: request.headers,
        row: db.get('SELECT requestId,state FROM apiKeyAccounting') });
      await responder(request, response);
    } catch (error) { failure = error; response.writeHead(500, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: 'fixture failed' })); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  fixture.url = `http://127.0.0.1:${server.address().port}/kiro/generate`;
  createAccounting = () => import('@/lib/apiKeyBudget/requestAccounting.js').then(({ createRequestAccounting }) => createRequestAccounting(
    new Request('http://localhost/v1/chat/completions', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true }));
});
afterEach(async () => {
  server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve));
  vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous;
});
const rows = () => db.all('SELECT state,costNanoUsd FROM apiKeyAccounting');
describe('owned HTTP native Kiro (one-generation and narrow explicit ellipsis repair, not full legacy/TLS approval)', { timeout: 20000 }, () => {
  it('actual repair POST2 waits successor own intent delivery, retains original work and fresh price over native HTTP', async () => {
    const context = await createAccounting(), handles = [], wires = [];
    let enter, release; const installed = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const args = { ...options(context), accountingMode: 'native-kiro-ellipsis-repair' };
    const complete = vi.fn((...input) => context.completeAttempt(...input));
    const accounting = { ...context, completeAttempt: complete, async beforeAttempt(...input) {
      wires.push(input[2]); const attempt = await context.beforeAttempt(...input); handles.push(attempt);
      expect(attempt.unrecorded).toBeFalsy();
      args.body.conversationState.currentMessage.userInputMessage.content = 'caller mutation'; args.credentials.accessToken = 'caller mutation';
      if (handles.length === 2) { enter(); await held; }
      return attempt;
    } };
    const output = text => concatFixtureBytes([fixtureKiroEvent('assistantResponseEvent', { content: text }), metrics(), fixtureKiroEvent('messageStopEvent', { stopReason: 'end_turn' })]);
    responder = (_request, response) => {
      const index = requests.length - 1;
      expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [handles[index].attemptId])).toEqual({ state: 'pending' });
      if (!index) db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='kiro'", [JSON.stringify({ [model]: { input: '9', output: '9' } })]));
      response.writeHead(200, { 'content-type': 'application/vnd.amazon.eventstream' }); response.end(output(index ? 'Fixture recovered answer.' : '...'));
    };
    let returned = false;
    const work = new KiroExecutor().execute({ ...args, accounting }).then(value => ({ value }), error => ({ error })).then(result => { returned = true; return result; });
    try {
      await installed; expect(returned).toBe(false); expect(requests).toHaveLength(1); expect(complete).toHaveBeenCalledTimes(1);
      expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [handles[0].attemptId])).toEqual({ state: 'settled', costNanoUsd: 140000 });
      expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [handles[1].attemptId])).toEqual({ state: 'pending', costNanoUsd: null });
    } finally { release(); }
    const result = await work; if (result.error) throw result.error;
    expect(new Uint8Array(await result.value.response.arrayBuffer())).toEqual(output('Fixture recovered answer.'));
    expect(failure).toBeNull(); expect(requests).toHaveLength(2); expect(complete).toHaveBeenCalledTimes(2);
    expect(requests[0].body).toEqual(body());
    const expected = body(); expected.conversationState.currentMessage.userInputMessage.content += '\n\nRetry the previous response because it ended with only an ellipsis. Return the complete final answer, not only ... or ….';
    expect(requests[1].body).toEqual(expected); expect(wires[1].kiroRepairCapture.actual).toEqual(expected);
    for (let index = 0; index < 2; index++) {
      expect(requests[index].headers).toMatchObject(wires[index].headers);
      expect(requests[index].headers.authorization).toBe('Bearer dummy-api-key'); expect(requests[index].headers['x-amz-sso-bearer']).toBe('dummy-api-key');
      expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [handles[index].attemptId])).toEqual({ state: 'settled', costNanoUsd: index ? 1080000 : 140000 });
    }
    expect(requests[0].headers['amz-sdk-invocation-id']).not.toBe(requests[1].headers['amz-sdk-invocation-id']);
    expect(handles[0].attemptId).not.toBe(handles[1].attemptId); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('actual HTTP predecessor settlement without own delivered handle forbids repair POST2', async () => {
    const context = await createAccounting(), before = vi.fn((...input) => context.beforeAttempt(...input)); let enter, release;
    const installed = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; }), lost = new Error('fixture HTTP lost Kiro repair predecessor handle');
    const complete = vi.fn(async (...input) => { await context.completeAttempt(...input); enter(); await held; throw lost; });
    responder = (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/vnd.amazon.eventstream' });
      response.end(concatFixtureBytes([fixtureKiroEvent('assistantResponseEvent', { content: '...' }), metrics(), fixtureKiroEvent('messageStopEvent', { stopReason: 'end_turn' })]));
    };
    let returned = false; const work = new KiroExecutor().execute({ ...options({ ...context, beforeAttempt: before, completeAttempt: complete }), accountingMode: 'native-kiro-ellipsis-repair' })
      .then(value => ({ value }), error => ({ error })).then(result => { returned = true; return result; });
    try {
      await installed; expect(returned).toBe(false); expect(requests).toHaveLength(1); expect(before).toHaveBeenCalledTimes(1);
      expect(rows()).toEqual([{ state: 'settled', costNanoUsd: 140000 }]);
    } finally { release(); }
    expect((await work).error).toBe(lost); expect(requests).toHaveLength(1); expect(before).toHaveBeenCalledTimes(1); expect(complete).toHaveBeenCalledTimes(1);
    expect(failure).toBeNull(); expect(rows()).toEqual([{ state: 'settled', costNanoUsd: 140000 }]); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('actual original body/full headers/invocation are frozen, own pending, original140000 despite price edit', async () => {
    const context = await createAccounting(), args = options(context); let expectedHeaders;
    const accounting = { ...context, beforeAttempt(meta, supported, prepared) {
      expect(prepared.protocol).toBe('native-kiro'); expect(Reflect.set(prepared.headers, 'authorization', 'changed')).toBe(false); expectedHeaders = prepared.headers;
      const work = context.beforeAttempt(meta, supported, prepared);
      args.credentials.accessToken = 'changed'; args.body.conversationState.currentMessage.userInputMessage.content = 'changed'; return work;
    } };
    responder = (_request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='kiro'", [JSON.stringify({ [model]: { input: '9', output: '9' } })]));
      response.writeHead(200, { 'content-type': 'application/vnd.amazon.eventstream' }); response.end(wire());
    };
    const result = await new KiroExecutor().execute({ ...args, accounting }); expect(new Uint8Array(await result.response.arrayBuffer())).toEqual(wire());
    expect(failure).toBeNull(); expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: 'POST', url: '/kiro/generate', body: body(), headers: expectedHeaders, row: { requestId: context.requestId, state: 'pending' } });
    expect(requests[0].headers.authorization).toBe('Bearer dummy-api-key'); expect(requests[0].headers['x-amz-sso-bearer']).toBe('dummy-api-key');
    expect(requests[0].headers.tokentype).toBe('API_KEY'); expect(requests[0].headers['amz-sdk-invocation-id']).toMatch(/^[a-f0-9-]{36}$/);
    expect(rows()).toEqual([{ state: 'settled', costNanoUsd: 140000 }]); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('raw metrics/stop and EOF wait own ACK after consumer text on native HTTP', async () => {
    const context = await createAccounting(); let enter, release, deltaRead;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; }), delta = new Promise(resolve => { deltaRead = resolve; });
    const accounting = { ...context, async completeAttempt(attempt, completion) { enter(); await held; return context.completeAttempt(attempt, completion); } };
    const result = await new KiroExecutor().execute(options(accounting)), chunks = []; let ended = false;
    const work = (async () => { const reader = result.response.body.getReader();
      try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; chunks.push(chunk.value); deltaRead(); } ended = true; }
      finally { reader.releaseLock(); }
    })();
    try {
      await entered; await delta; expect(ended).toBe(false); expect(concatFixtureBytes(chunks)).toEqual(prefix());
      expect(requests).toHaveLength(1); expect(rows()).toEqual([{ state: 'pending', costNanoUsd: null }]);
    } finally { release(); await work; }
    expect(ended).toBe(true); expect(concatFixtureBytes(chunks)).toEqual(wire()); expect(failure).toBeNull(); expect(rows()).toEqual([{ state: 'settled', costNanoUsd: 140000 }]);
  });
  it('missing raw stop rejects delivery then separately awaits unresolved ACK without regeneration', async () => {
    const context = await createAccounting(); let acknowledged;
    const ack = new Promise(resolve => { acknowledged = resolve; });
    const accounting = { ...context, async completeAttempt(attempt, completion) { const terminal = await context.completeAttempt(attempt, completion); acknowledged(); return terminal; } };
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/vnd.amazon.eventstream' }); response.end(concatFixtureBytes([prefix(), metrics()])); };
    const result = await new KiroExecutor().execute(options(accounting)); await expect(result.response.arrayBuffer()).rejects.toThrow('Gateway accounting stream unavailable'); await ack;
    expect(failure).toBeNull(); expect(requests).toHaveLength(1); expect(rows()).toEqual([{ state: 'unresolved', costNanoUsd: null }]); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('persisted token drift at dequeue refuses zero socket POST/intent/gap', async () => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, prepared) {
      expect(prepared.protocol).toBe('native-kiro'); const work = context.beforeAttempt(meta, supported, prepared);
      db.durableTransaction(() => { const data = JSON.parse(db.get('SELECT data FROM providerConnections WHERE id=?', ['c']).data); data.accessToken = 'dummy-rotated'; db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify(data), 'c']); }); return work;
    } };
    await expect(new KiroExecutor().execute(options(accounting))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('native caller abort while own intent ACK is held completes not-dispatched with zero socket POST', async () => {
    const context = await createAccounting(), signal = new AbortController(), reason = new Error('fixture native held-intent abort'); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const complete = vi.fn((attempt, payload) => context.completeAttempt(attempt, payload));
    const accounting = { ...context, completeAttempt: complete, async beforeAttempt(meta, supported, prepared) {
      const attempt = await context.beforeAttempt(meta, supported, prepared); enter(); await held; return attempt;
    } };
    const work = new KiroExecutor().execute({ ...options(accounting), signal: signal.signal });
    const rejected = expect(work).rejects.toBe(reason);
    try {
      await entered; expect(rows()).toEqual([{ state: 'pending', costNanoUsd: null }]);
      signal.abort(reason); expect(complete).not.toHaveBeenCalled(); expect(requests).toHaveLength(0);
    } finally { release(); await rejected; }
    expect(failure).toBeNull(); expect(requests).toHaveLength(0); expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][1]).toEqual({ notDispatched: true, outcome: 'aborted' });
    expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'not_dispatched', outcome: 'aborted', costNanoUsd: null }]);
  });
  it('native caller abort after server receives POST but before response headers owns unresolved ACK and no replay', async () => {
    const context = await createAccounting(), signal = new AbortController(), reason = new Error('fixture native post-received abort'); let received, socketResponse;
    const entered = new Promise(resolve => { received = resolve; });
    const complete = vi.fn((attempt, payload) => context.completeAttempt(attempt, payload)), authorize = vi.fn();
    responder = (_request, response) => { socketResponse = response; received(); }; // deliberately hold headers, no timing race
    const work = new KiroExecutor().execute({ ...options({ ...context, completeAttempt: complete, assertSuccessfulTerminal: authorize }), signal: signal.signal });
    const rejected = expect(work).rejects.toBe(reason);
    try {
      await entered; expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(body());
      expect(requests[0].row).toMatchObject({ state: 'pending', requestId: context.requestId });
      expect(rows()).toEqual([{ state: 'pending', costNanoUsd: null }]);
      signal.abort(reason); await rejected;
      expect(complete).toHaveBeenCalledTimes(1); expect(complete.mock.calls[0][1]).toEqual({ usage: null, outcome: 'aborted' });
      expect(authorize).not.toHaveBeenCalled(); expect(requests).toHaveLength(1); expect(failure).toBeNull();
      expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', outcome: 'aborted', costNanoUsd: null }]);
    } finally { signal.abort(reason); socketResponse?.destroy(); }
  });
  it('307 cannot replay generation: one POST and one unresolved ACK', async () => {
    responder = (_request, response) => { response.writeHead(307, { location: fixture.url }); response.end(); };
    await expect(new KiroExecutor().execute(options(await createAccounting()))).rejects.toThrow();
    expect(failure).toBeNull(); expect(requests).toHaveLength(1); expect(rows()).toEqual([{ state: 'unresolved', costNanoUsd: null }]); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
});
