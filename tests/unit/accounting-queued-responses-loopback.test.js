import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ url: null }));
// Only module replacement permits an owned loopback route; real production
// fixed URL validation remains unchanged. Native fetch/proxyFetch are not mocked.
vi.mock('../../open-sse/config/accountedResponsesCandidate.js', async importOriginal => {
  const original = await importOriginal();
  return { ...original, get ACCOUNTED_RESPONSES_URL() { return fixture.url; },
    supportsResponsesCandidate(executor, options, url, body, headers) {
      return url === fixture.url && original.supportsResponsesCandidate(executor, options, original.ACCOUNTED_RESPONSES_URL, body, headers);
    } };
});
let directory, db, server, requests, failure, responder, DefaultExecutor, createAccounting;
const old = process.env.DATA_DIR;
const message = { id: 'resp_fixture', object: 'response', model: 'fixture-responses', status: 'completed', service_tier: 'default', error: null, incomplete_details: null,
  output: [{ id: 'msg_fixture', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'fixture', annotations: [] }] }],
  usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 10 } } };
const streamWire = () => {
  const item = message.output[0], part = item.content[0];
  return [
    { type: 'response.created', response: { ...message, status: 'in_progress', output: [], usage: null } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
    { type: 'response.content_part.added', output_index: 0, item_id: item.id, content_index: 0, part: { ...part, text: '' } },
    { type: 'response.output_text.delta', output_index: 0, item_id: item.id, content_index: 0, delta: part.text },
    { type: 'response.output_text.done', output_index: 0, item_id: item.id, content_index: 0, text: part.text },
    { type: 'response.content_part.done', output_index: 0, item_id: item.id, content_index: 0, part },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: message },
  ].map((event, sequence_number) => `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join('');
};
const options = accounting => ({ model: 'fixture-responses', body: { model: 'fixture-responses', input: 'fixture', stream: false, store: false }, stream: false,
  credentials: { apiKey: 'dummy-provider' }, connectionId: 'c', accountingMode: 'native-responses-json', accounting,
  proxyOptions: { persistedGlobalProxy: { url: 'http://127.0.0.1:1', noProxy: '127.0.0.1' } } });
beforeEach(async () => {
  vi.resetModules(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-native-responses-')); process.env.DATA_DIR = directory; delete global._dbAdapter;
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }],
    settings: { requireApiKey: true, outboundProxyEnabled: true, outboundProxyUrl: 'http://127.0.0.1:1', outboundNoProxy: '127.0.0.1' },
    providerConnections: [{ id: 'c', provider: 'openai', authType: 'apikey', apiKey: 'dummy-provider' }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','openai',?)", [JSON.stringify({ 'fixture-responses': { input: '1', output: '2', cached: '0.1', reasoning: '2' } })]);
  });
  requests = []; failure = null;
  responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(message)); };
  server = http.createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      requests.push({ method: request.method, authorization: request.headers.authorization, url: request.url, body,
        row: db.get('SELECT requestId,state FROM apiKeyAccounting') });
      await responder(request, response);
    } catch (error) { failure = error; response.writeHead(500, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: 'fixture assertion failed' })); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  fixture.url = `http://127.0.0.1:${server.address().port}/responses`;
  ({ DefaultExecutor } = await import('open-sse/executors/default.js'));
  createAccounting = () => import('@/lib/apiKeyBudget/requestAccounting.js').then(({ createRequestAccounting }) => createRequestAccounting(
    new Request('http://localhost/v1/responses', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true }));
});
afterEach(async () => {
  server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve));
  vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true });
  if (old === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = old;
});
describe('native owned HTTP Responses queued boundary (test module URL only, not TLS/OAuth/all Responses)', { timeout: 20000 }, () => {
  it('native POST retains immutable original headers/body and own pending price snapshot', async () => {
    const context = await createAccounting();
    const args = options(context);
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      expect(Reflect.set(wire.headers, 'authorization', 'Bearer dummy-changed')).toBe(false);
      const work = context.beforeAttempt(meta, supported, wire); args.body.input = 'changed'; args.credentials.apiKey = 'dummy-changed'; return work;
    } };
    responder = (_request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='openai'", [JSON.stringify({ 'fixture-responses': { input: '9', output: '9', cached: '9', reasoning: '9' } })]));
      response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(message));
    };
    const result = await new DefaultExecutor('openai').execute({ ...args, accounting });
    expect(failure).toBeNull(); expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: 'POST', authorization: 'Bearer dummy-provider', url: '/responses', body: { input: 'fixture' }, row: { requestId: context.requestId, state: 'pending' } });
    expect(await result.response.json()).toEqual(message);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 104000 }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('native result waits for own queued terminal ACK', async () => {
    const context = await createAccounting(); let entered, release;
    const started = new Promise(resolve => { entered = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, async completeAttempt(attempt, completion) { entered(); await held; return context.completeAttempt(attempt, completion); } };
    let returned = false;
    const work = new DefaultExecutor('openai').execute(options(accounting)).then(value => { returned = true; return value; });
    try { await started; expect(returned).toBe(false); expect(requests).toHaveLength(1);
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'pending', costNanoUsd: null }]); }
    finally { release(); }
    expect((await work).response.ok).toBe(true); expect(failure).toBeNull();
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 104000 }]);
  });
  it('stale persisted credentials at dequeue refuse before native socket POST/intent', async () => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      const work = context.beforeAttempt(meta, supported, wire);
      db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']);
        db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(row.data), apiKey: 'dummy-new' }), 'c']); }); return work;
    } };
    await expect(new DefaultExecutor('openai').execute(options(accounting))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('native Responses SSE withholds completed bytes until its own queued terminal ACK', async () => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, async completeAttempt(attempt, completion) { enter(); await held; return context.completeAttempt(attempt, completion); } };
    const text = streamWire(); responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(text); };
    const args = options(accounting); args.stream = args.body.stream = true; args.accountingMode = 'native-responses-sse';
    const result = await new DefaultExecutor('openai').execute(args);
    let delivered = '', ended = false;
    const consume = (async () => { const reader = result.response.body.getReader(), decoder = new TextDecoder();
      try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; delivered += decoder.decode(chunk.value, { stream: true }); } delivered += decoder.decode(); ended = true; }
      finally { reader.releaseLock(); }
    })();
    try {
      await entered; expect(ended).toBe(false); expect(delivered).toContain('response.output_text.delta'); expect(delivered).not.toContain('event: response.completed');
      expect(requests).toHaveLength(1); expect(requests[0].row).toMatchObject({ requestId: context.requestId, state: 'pending' });
      expect(requests[0].body.stream).toBe(true);
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'pending', costNanoUsd: null }]);
    } finally { release(); }
    await consume; expect(delivered).toBe(text); expect(failure).toBeNull();
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 104000 }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('native Responses SSE EOF without completed is unresolved only after its own terminal ACK', async () => {
    const context = await createAccounting(); let acknowledged;
    const ack = new Promise(resolve => { acknowledged = resolve; });
    const accounting = { ...context, async completeAttempt(attempt, completion) { const terminal = await context.completeAttempt(attempt, completion); acknowledged(); return terminal; } };
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(streamWire().split('event: response.completed')[0]); };
    const args = options(accounting); args.stream = args.body.stream = true; args.accountingMode = 'native-responses-sse';
    const result = await new DefaultExecutor('openai').execute(args);
    await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable'); await ack;
    expect(failure).toBeNull(); expect(requests).toHaveLength(1); expect(requests[0].row).toMatchObject({ requestId: context.requestId, state: 'pending' });
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', costNanoUsd: null }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('native307cannotreplay generation, sole unresolved terminal and one POST', async () => {
    responder = (_request, response) => { response.writeHead(307, { location: fixture.url }); response.end(); };
    await expect(new DefaultExecutor('openai').execute(options(await createAccounting()))).rejects.toThrow();
    expect(failure).toBeNull(); expect(requests).toHaveLength(1);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', costNanoUsd: null }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
});
