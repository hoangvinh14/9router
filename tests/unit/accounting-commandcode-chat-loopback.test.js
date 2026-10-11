import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeAccountedCommandCodeChatGeneration as execute } from 'open-sse/executors/accountedCommandCodeChatGeneration.js';
import { PROVIDERS } from 'open-sse/config/providers.js';
import { CommandCodeExecutor } from 'open-sse/executors/commandcode.js';
const fixture = vi.hoisted(() => ({ url: null }));
// Both candidate and registry are replaced for this exact owned fixture route.
// No production custom endpoint permission or TLS bypass.
vi.mock('../../open-sse/config/accountedCommandCodeCandidate.js', async importOriginal => {
  const original = await importOriginal(); return { ...original, get ACCOUNTED_COMMANDCODE_URL() { return fixture.url; } };
});
vi.mock('../../open-sse/config/providers.js', async importOriginal => {
  const original = await importOriginal(); return { ...original, PROVIDERS: { ...original.PROVIDERS, get commandcode() { return { ...original.PROVIDERS.commandcode, baseUrl: fixture.url }; } } };
});
let directory, db, server, requests, responder, failure, accounting;
const previous = process.env.DATA_DIR, model = 'deepseek/deepseek-v4-pro';
const raw = () => {
  const usage = { inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 0, reasoningTokens: 0 };
  return [{ type: 'start' }, { type: 'start-step' }, { type: 'text-start', id: 'fixture' }, { type: 'text-delta', id: 'fixture', text: 'fixture output' },
    { type: 'text-end', id: 'fixture' }, { type: 'finish-step', finishReason: 'stop', usage }, { type: 'finish', finishReason: 'stop', totalUsage: usage }].map(event => JSON.stringify(event) + '\n').join('');
};
const options = context => ({ model, stream: true, connectionId: 'c', accounting: context,
  body: { model, stream: true, max_tokens: 64, temperature: 0.3, messages: [{ role: 'user', content: 'fixture prompt' }] },
  credentials: { apiKey: 'dummy-api-key', connectionId: 'c', providerSpecificData: {} }, providerOverrides: null,
  proxyOptions: { persistedGlobalProxy: { url: 'http://127.0.0.1:1', noProxy: '127.0.0.1' } } });
const executor = () => ({ provider: 'commandcode', config: structuredClone(PROVIDERS.commandcode) });
beforeEach(async () => {
  vi.resetModules(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-commandcode-chat-http-')); process.env.DATA_DIR = directory; delete global._dbAdapter;
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }],
    settings: { requireApiKey: true, outboundProxyEnabled: true, outboundProxyUrl: 'http://127.0.0.1:1', outboundNoProxy: '127.0.0.1' },
    providerConnections: [{ id: 'c', provider: 'commandcode', authType: 'apikey', apiKey: 'dummy-api-key', providerSpecificData: {} }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','commandcode',?)", [JSON.stringify({ [model]: { input: '1', output: '2' } })]);
  });
  requests = []; failure = null;
  responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/x-ndjson' }); response.end(raw()); };
  server = http.createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      requests.push({ body: JSON.parse(Buffer.concat(chunks).toString()), headers: request.headers, method: request.method,
        row: db.get('SELECT requestId,state FROM apiKeyAccounting') }); await responder(request, response);
    } catch (error) { failure = error; response.writeHead(500); response.end('fixture failure'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  fixture.url = `http://127.0.0.1:${server.address().port}/commandcode/generate`;
  accounting = await (await import('@/lib/apiKeyBudget/requestAccounting.js')).createRequestAccounting(
    new Request('http://localhost/v1/chat/completions', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true });
});
afterEach(async () => {
  server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve));
  vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous;
});
describe('owned HTTP Chat CommandCode standalone and internal retry (not TLS/full family)', { timeout: 20000 }, () => {
  it('actual socket body and headers equal frozen real conversion; original price survives edit', async () => {
    let prepared; const args = options({ ...accounting, beforeAttempt(meta, supported, wire) {
      prepared = wire; expect(Object.isFrozen(wire.commandCodeChatCapture.actual.config)).toBe(true);
      const admission = accounting.beforeAttempt(meta, supported, wire);
      args.body.messages[0].content = 'changed'; args.credentials.apiKey = 'changed'; return admission;
    } });
    responder = (_request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='commandcode'", [JSON.stringify({ [model]: { input: '9', output: '9' } })]));
      response.writeHead(200, { 'content-type': 'application/x-ndjson' }); response.end(raw());
    };
    const result = await execute(executor(), args); expect(await result.response.text()).toBe(raw());
    expect(failure).toBeNull(); expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: 'POST', body: prepared.commandCodeChatCapture.actual, headers: prepared.headers,
      row: { requestId: accounting.requestId, state: 'pending' } });
    expect(requests[0].body.params.messages[0].content[0].text).toBe('fixture prompt');
    expect(requests[0].body.config.workingDir).toBe(process.cwd());
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 140000 }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('native initial error status waits own completion ACK after genuine EOF', async () => {
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/x-ndjson' });
      response.end(JSON.stringify({ type: 'error', error: { statusCode: 503, message: 'fixture failure' } }) + '\n'); };
    let enter, release; const installed = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const complete = vi.fn(async (...args) => { const terminal = await accounting.completeAttempt(...args); enter(); await held; return terminal; });
    let returned = false; const work = execute(executor(), options({ ...accounting, completeAttempt: complete })).then(result => { returned = true; return result; });
    try {
      await installed; expect(returned).toBe(false); expect(requests).toHaveLength(1);
      expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', outcome: 'failed', costNanoUsd: null }]);
    } finally { release(); }
    expect((await work).response.status).toBe(503); expect(complete).toHaveBeenCalledTimes(1); expect(failure).toBeNull();
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('abort false after server received POST before headers owns one unresolved completion', async () => {
    let enter, socketResponse; const received = new Promise(resolve => { enter = resolve; }), controller = new AbortController();
    responder = (_request, response) => { socketResponse = response; enter(); };
    const complete = vi.fn((...args) => accounting.completeAttempt(...args)), args = options({ ...accounting, completeAttempt: complete }); args.signal = controller.signal;
    const work = execute(executor(), args).then(value => ({ value }), error => ({ error }));
    try {
      await received; expect(requests).toHaveLength(1); expect(requests[0].row.state).toBe('pending');
      controller.abort(false); expect(await work).toEqual({ error: false });
      expect(complete).toHaveBeenCalledTimes(1); expect(failure).toBeNull();
      expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', outcome: 'aborted', costNanoUsd: null }]);
      expect(db.coverage.status('a').gaps).toHaveLength(0);
    } finally { controller.abort(false); socketResponse?.destroy(); }
  });
  it('actual executor socket POST2 waits successor own intent ACK and retains complete original wire', async () => {
    let enter, release; const installed = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const attempts = [], wires = [];
    const before = vi.fn(async (...args) => {
      wires.push(args[2]); const attempt = await accounting.beforeAttempt(...args); attempts.push(attempt);
      if (attempts.length === 2) { enter(); await held; } return attempt;
    });
    const complete = vi.fn((...args) => accounting.completeAttempt(...args));
    responder = (_request, response) => {
      const index = requests.length - 1;
      expect(requests[index].body).toEqual(wires[index].commandCodeChatCapture.actual);
      expect(requests[index].headers).toMatchObject(wires[index].headers);
      expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [attempts[index].attemptId])).toEqual({ state: 'pending' });
      response.writeHead(200, { 'content-type': 'application/x-ndjson' });
      response.end(index === 0 ? JSON.stringify({ type: 'error', error: { statusCode: 503, message: 'fixture initial error' } }) + '\n' : raw());
    };
    const args = { ...options({ ...accounting, beforeAttempt: before, completeAttempt: complete }), accountingMode: 'chat-commandcode-ndjson-retry' };
    let returned = false;
    const work = new CommandCodeExecutor().execute(args).then(value => ({ value }), error => ({ error })).then(result => { returned = true; return result; });
    try {
      await installed; expect(returned).toBe(false); expect(requests).toHaveLength(1); expect(complete).toHaveBeenCalledTimes(1); expect(before).toHaveBeenCalledTimes(2);
      expect(db.get('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [attempts[0].attemptId])).toEqual({ state: 'unresolved', outcome: 'failed', costNanoUsd: null });
      expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [attempts[1].attemptId])).toEqual({ state: 'pending' });
      args.body.messages[0].content = 'changed'; args.credentials.apiKey = 'changed';
    } finally { release(); }
    const result = await work; expect(result.error).toBeUndefined(); expect(await result.value.response.text()).toBe(raw());
    expect(requests).toHaveLength(2); expect(requests[1].body).toEqual(requests[0].body);
    expect(requests[1].headers.authorization).toBe('Bearer dummy-api-key'); expect(requests[1].headers['x-session-id']).not.toBe(requests[0].headers['x-session-id']);
    expect(complete).toHaveBeenCalledTimes(2); expect(failure).toBeNull();
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [attempts[1].attemptId])).toEqual({ state: 'settled', costNanoUsd: 140000 });
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('lost predecessor completion delivery after native EOF cannot open successor socket POST', async () => {
    const lost = new Error('fixture HTTP lost Chat predecessor handle');
    const complete = vi.fn(async (...args) => { await accounting.completeAttempt(...args); throw lost; });
    const before = vi.fn((...args) => accounting.beforeAttempt(...args));
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/x-ndjson' });
      response.end(JSON.stringify({ type: 'error', error: { statusCode: 503, message: 'fixture initial error' } }) + '\n'); };
    await expect(new CommandCodeExecutor().execute({ ...options({ ...accounting, beforeAttempt: before, completeAttempt: complete }), accountingMode: 'chat-commandcode-ndjson-retry' })).rejects.toBe(lost);
    expect(before).toHaveBeenCalledTimes(1); expect(complete).toHaveBeenCalledTimes(1); expect(requests).toHaveLength(1); expect(failure).toBeNull();
    expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', outcome: 'failed', costNanoUsd: null }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('budgeted native raw503 owns unresolved completion then refuses successor socket POST', async () => {
    const policy = await (await import('@/lib/apiKeyBudget/service.js')).createBudgetContext('a', { adapter: async () => db });
    policy.updatePolicy({ weeklyLimitUsd: '100', monthlyLimitUsd: '100', expectedVersion: 0 });
    const complete = vi.fn((...args) => accounting.completeAttempt(...args)), before = vi.fn((...args) => accounting.beforeAttempt(...args));
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/x-ndjson' });
      response.end(JSON.stringify({ type: 'error', error: { statusCode: 503, message: 'fixture initial error' } }) + '\n'); };
    await expect(new CommandCodeExecutor().execute({ ...options({ ...accounting, beforeAttempt: before, completeAttempt: complete }), accountingMode: 'chat-commandcode-ndjson-retry' })).rejects.toMatchObject({ code: 'api_key_accounting_unresolved' });
    expect(before).toHaveBeenCalledTimes(1); expect(complete).toHaveBeenCalledTimes(1); expect(requests).toHaveLength(1); expect(failure).toBeNull();
    expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', outcome: 'failed', costNanoUsd: null }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('fresh key drift at actual dequeue refuses socket POST and pending intent', async () => {
    const before = (...args) => { const pending = accounting.beforeAttempt(...args);
      db.durableTransaction(() => { const data = JSON.parse(db.get('SELECT data FROM providerConnections WHERE id=?', ['c']).data);
        data.apiKey = 'dummy-rotated'; db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify(data), 'c']); }); return pending; };
    await expect(execute(executor(), options({ ...accounting, beforeAttempt: before }))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
});
