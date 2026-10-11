import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { CodexExecutor } from 'open-sse/executors/codex.js';
const fixture = vi.hoisted(() => ({ url: null }));
// Both candidate AND registry replacement grant only the exact owned route.
// Native fetch/proxy remain real; production fixed route and TLS untouched.
vi.mock('../../open-sse/config/accountedCodexCandidate.js', async importOriginal => {
  const original = await importOriginal();
  return { ...original, get ACCOUNTED_CODEX_URL() { return fixture.url; },
    supportsCodexCandidate(executor, options, url, body, headers) {
      return url === fixture.url && original.supportsCodexCandidate({ ...executor, config: { ...executor.config, baseUrl: original.ACCOUNTED_CODEX_URL } }, options, original.ACCOUNTED_CODEX_URL, body, headers);
    } };
});
vi.mock('../../open-sse/config/providers.js', async importOriginal => {
  const original = await importOriginal();
  return { ...original, PROVIDERS: { ...original.PROVIDERS, get codex() { return { ...original.PROVIDERS.codex, baseUrl: fixture.url }; } } };
});
let directory, db, server, requests, failure, responder, createAccounting;
const old = process.env.DATA_DIR;
const message = { id: 'resp_fixture', object: 'response', model: 'gpt-5.5', status: 'completed', service_tier: 'default', error: null, incomplete_details: null,
  output: [], usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 10 } } };
const wire = () => [{ type: 'response.created', response: { ...message, status: 'in_progress', usage: null } }, { type: 'response.completed', response: message }]
  .map((event, sequence_number) => `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join('');
const requestBody = () => ({ model: 'gpt-5.5', stream: true, store: false, instructions: 'fixture instruction', input: 'fixture' });
const options = accounting => ({ model: 'gpt-5.5', body: requestBody(), stream: true, connectionId: 'c', accountingMode: 'native-codex-responses-sse', accounting,
  credentials: { accessToken: 'dummy-codex-oauth', connectionId: 'c', providerSpecificData: { chatgptAccountId: 'dummy-account' } },
  proxyOptions: { persistedGlobalProxy: { url: 'http://127.0.0.1:1', noProxy: '127.0.0.1' } } });
beforeEach(async () => {
  vi.resetModules(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-native-codex-')); process.env.DATA_DIR = directory; delete global._dbAdapter;
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }],
    settings: { requireApiKey: true, outboundProxyEnabled: true, outboundProxyUrl: 'http://127.0.0.1:1', outboundNoProxy: '127.0.0.1' },
    providerConnections: [{ id: 'c', provider: 'codex', authType: 'oauth', accessToken: 'dummy-codex-oauth', providerSpecificData: { chatgptAccountId: 'dummy-account' } }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','codex',?)", [JSON.stringify({ 'gpt-5.5': { input: '1', output: '2', cached: '0.1', reasoning: '2' } })]);
  });
  requests = []; failure = null;
  responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(wire()); };
  server = http.createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      requests.push({ method: request.method, url: request.url, body: JSON.parse(Buffer.concat(chunks).toString()),
        headers: request.headers, row: db.get('SELECT requestId,state FROM apiKeyAccounting') });
      await responder(request, response);
    } catch (error) { failure = error; response.writeHead(500, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: 'fixture failed' })); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  fixture.url = `http://127.0.0.1:${server.address().port}/codex/responses`;
  createAccounting = () => import('@/lib/apiKeyBudget/requestAccounting.js').then(({ createRequestAccounting }) => createRequestAccounting(
    new Request('http://localhost/v1/responses', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true }));
});
afterEach(async () => {
  server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve));
  vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true });
  if (old === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = old;
});
const rows = () => db.all('SELECT state,costNanoUsd FROM apiKeyAccounting');
describe('owned native HTTP queued Codex OAuth (test route only, not TLS/refresh/general Codex)', { timeout: 20000 }, () => {
  it('actual original OAuth headers/body and pending retain original price despite upstream edit', async () => {
    const context = await createAccounting(), args = options(context);
    const accounting = { ...context, beforeAttempt(meta, supported, original) {
      expect(original.protocol).toBe('native-codex'); expect(Reflect.set(original.headers, 'authorization', 'Bearer changed')).toBe(false);
      const work = context.beforeAttempt(meta, supported, original); args.credentials.accessToken = 'dummy-changed'; args.credentials.providerSpecificData.chatgptAccountId = 'dummy-other'; args.body.input = 'changed'; return work;
    } };
    responder = (_request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='codex'", [JSON.stringify({ 'gpt-5.5': { input: '9', output: '9', cached: '9', reasoning: '9' } })]));
      response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(wire());
    };
    const result = await new CodexExecutor().execute({ ...args, accounting }); expect(await result.response.text()).toBe(wire());
    expect(failure).toBeNull(); expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: 'POST', url: '/codex/responses', body: requestBody(), headers: { authorization: 'Bearer dummy-codex-oauth', 'chatgpt-account-id': 'dummy-account', session_id: 'c', accept: 'text/event-stream' }, row: { requestId: context.requestId, state: 'pending' } });
    expect(rows()).toEqual([{ state: 'settled', costNanoUsd: 104000 }]); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('native completed bytes wait own queued terminal ACK', async () => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, async completeAttempt(attempt, completion) { enter(); await held; return context.completeAttempt(attempt, completion); } };
    const result = await new CodexExecutor().execute(options(accounting)); let delivered = '', ended = false;
    const consume = (async () => { const reader = result.response.body.getReader(), decoder = new TextDecoder();
      try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; delivered += decoder.decode(chunk.value, { stream: true }); } delivered += decoder.decode(); ended = true; }
      finally { reader.releaseLock(); }
    })();
    try { await entered; expect(ended).toBe(false); expect(delivered).toContain('event: response.created'); expect(delivered).not.toContain('event: response.completed');
      expect(requests).toHaveLength(1); expect(rows()).toEqual([{ state: 'pending', costNanoUsd: null }]); }
    finally { release(); }
    await consume; expect(delivered).toBe(wire()); expect(failure).toBeNull(); expect(rows()).toEqual([{ state: 'settled', costNanoUsd: 104000 }]);
  });
  it('EOF missing completed requires explicit own unresolved ACK, not delivery error as ACK', async () => {
    const context = await createAccounting(); let acknowledged;
    const ack = new Promise(resolve => { acknowledged = resolve; });
    const accounting = { ...context, async completeAttempt(attempt, completion) {
      const result = await context.completeAttempt(attempt, completion); acknowledged(); return result;
    } };
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(wire().split('event: response.completed')[0]); };
    const result = await new CodexExecutor().execute(options(accounting));
    await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable'); await ack;
    expect(failure).toBeNull(); expect(requests).toHaveLength(1); expect(requests[0].row).toMatchObject({ requestId: context.requestId, state: 'pending' });
    expect(rows()).toEqual([{ state: 'unresolved', costNanoUsd: null }]); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('persisted OAuth token drift at dequeue refuses zero socket POST/intent/gap', async () => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, original) {
      expect(original.protocol).toBe('native-codex'); const work = context.beforeAttempt(meta, supported, original);
      db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']); db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(row.data), accessToken: 'dummy-new' }), 'c']); }); return work;
    } };
    await expect(new CodexExecutor().execute(options(accounting))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('native307refuses replay, one POST and sole unresolved terminal', async () => {
    responder = (_request, response) => { response.writeHead(307, { location: fixture.url }); response.end(); };
    await expect(new CodexExecutor().execute(options(await createAccounting()))).rejects.toThrow();
    expect(failure).toBeNull(); expect(requests).toHaveLength(1); expect(rows()).toEqual([{ state: 'unresolved', costNanoUsd: null }]); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
});
