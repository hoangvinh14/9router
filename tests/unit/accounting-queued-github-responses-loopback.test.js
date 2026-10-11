import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { GithubExecutor } from 'open-sse/executors/github.js';
const fixture = vi.hoisted(() => ({ url: null }));
// Candidate AND registry grant only the owned route. Real fetch/proxy/DB;
// no production URL exception, TLS change, provider call or token exchange.
vi.mock('../../open-sse/config/accountedGithubResponsesCandidate.js', async importOriginal => {
  const original = await importOriginal(); return { ...original, get ACCOUNTED_GITHUB_RESPONSES_URL() { return fixture.url; } };
});
vi.mock('../../open-sse/config/providers.js', async importOriginal => {
  const original = await importOriginal(); return { ...original, PROVIDERS: { ...original.PROVIDERS, get github() { return { ...original.PROVIDERS.github, responsesUrl: fixture.url }; } } };
});
let directory, db, server, requests, failure, responder, createAccounting;
const old = process.env.DATA_DIR;
const specific = () => ({ copilotToken: 'dummy-copilot-token' });
const message = () => ({ id: 'resp_fixture', object: 'response', model: 'gpt-5.2-codex', status: 'completed', service_tier: 'default', error: null, incomplete_details: null,
  output: [], usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 10 } } });
const wire = () => [{ type: 'response.created', response: { ...message(), status: 'in_progress', usage: null } }, { type: 'response.completed', response: message() }]
  .map((event, sequence_number) => `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join('');
const requestBody = () => ({ model: 'gpt-5.2-codex', input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'fixture' }] }], stream: true, store: false, instructions: 'fixture instruction' });
const options = accounting => ({ model: 'gpt-5.2-codex', body: requestBody(), stream: true, connectionId: 'c', accountingMode: 'native-github-responses-sse', accounting,
  credentials: { accessToken: 'dummy-github-oauth', copilotToken: 'dummy-copilot-token', connectionId: 'c', providerSpecificData: specific() },
  proxyOptions: { persistedGlobalProxy: { url: 'http://127.0.0.1:1', noProxy: '127.0.0.1' } } });
beforeEach(async () => {
  vi.resetModules(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-native-github-responses-')); process.env.DATA_DIR = directory; delete global._dbAdapter;
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }],
    settings: { requireApiKey: true, outboundProxyEnabled: true, outboundProxyUrl: 'http://127.0.0.1:1', outboundNoProxy: '127.0.0.1' },
    providerConnections: [{ id: 'c', provider: 'github', authType: 'oauth', accessToken: 'dummy-github-oauth', providerSpecificData: specific() }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','github',?)", [JSON.stringify({ 'gpt-5.2-codex': { input: '1', output: '2', cached: '0.1', reasoning: '2' } })]);
  });
  requests = []; failure = null;
  responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(wire()); };
  server = http.createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      requests.push({ method: request.method, url: request.url, body: JSON.parse(Buffer.concat(chunks).toString()), headers: request.headers,
        row: db.get('SELECT requestId,state FROM apiKeyAccounting') });
      await responder(request, response);
    } catch (error) { failure = error; response.writeHead(500, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: 'fixture failed' })); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  fixture.url = `http://127.0.0.1:${server.address().port}/github/responses`;
  createAccounting = () => import('@/lib/apiKeyBudget/requestAccounting.js').then(({ createRequestAccounting }) => createRequestAccounting(
    new Request('http://localhost/v1/responses', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true }));
});
afterEach(async () => {
  server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve));
  vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true });
  if (old === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = old;
});
const rows = () => db.all('SELECT state,costNanoUsd FROM apiKeyAccounting');
describe('owned native HTTP queued GitHub Responses (fixture route only, not TLS/refresh/full GitHub)', { timeout: 20000 }, () => {
  it('actual original Copilot fingerprint/body/own pending retains original price after upstream edit', async () => {
    const context = await createAccounting(), args = options(context); let expectedHeaders;
    const accounting = { ...context, beforeAttempt(meta, supported, original) {
      expect(original.protocol).toBe('native-github-responses'); expect(Reflect.set(original.headers, 'authorization', 'Bearer changed')).toBe(false);
      expectedHeaders = original.headers;
      const work = context.beforeAttempt(meta, supported, original);
      args.credentials.accessToken = 'changed'; args.credentials.copilotToken = 'changed'; args.credentials.providerSpecificData.copilotToken = 'changed'; args.body.input[0].content[0].text = 'changed'; return work;
    } };
    responder = (_request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='github'", [JSON.stringify({ 'gpt-5.2-codex': { input: '9', output: '9', cached: '9', reasoning: '9' } })]));
      response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(wire());
    };
    const executor = new GithubExecutor(), refresh = vi.spyOn(executor, 'refreshCredentials').mockImplementation(() => { throw new Error('Fixture disallows refresh'); });
    executor.knownCodexModels.add('gpt-5.2-codex');
    const result = await executor.execute({ ...args, accounting }); expect(await result.response.text()).toBe(wire());
    expect(failure).toBeNull(); expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: 'POST', url: '/github/responses', body: requestBody(), headers: expectedHeaders, row: { requestId: context.requestId, state: 'pending' } });
    expect(requests[0].headers.authorization).toBe('Bearer dummy-copilot-token'); expect(requests[0].headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
    expect(requests[0].headers.accept).toBe('text/event-stream');
    expect(rows()).toEqual([{ state: 'settled', costNanoUsd: 104000 }]); expect(db.coverage.status('a').gaps).toHaveLength(0); expect(refresh).not.toHaveBeenCalled();
  });
  it('native completed bytes wait own queued terminal ACK', async () => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, async completeAttempt(attempt, completion) { enter(); await held; return context.completeAttempt(attempt, completion); } };
    const result = await new GithubExecutor().execute(options(accounting)); let delivered = '', ended = false;
    const consume = (async () => { const reader = result.response.body.getReader(), decoder = new TextDecoder();
      try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; delivered += decoder.decode(chunk.value, { stream: true }); } delivered += decoder.decode(); ended = true; }
      finally { reader.releaseLock(); }
    })();
    try {
      await entered; expect(ended).toBe(false); expect(delivered).toContain('event: response.created'); expect(delivered).not.toContain('event: response.completed');
      expect(requests).toHaveLength(1); expect(rows()).toEqual([{ state: 'pending', costNanoUsd: null }]);
    } finally { release(); await consume; }
    expect(delivered).toBe(wire()); expect(failure).toBeNull(); expect(rows()).toEqual([{ state: 'settled', costNanoUsd: 104000 }]);
  });
  it('EOF missing completed separately awaits sole unresolved ACK after delivery error', async () => {
    const context = await createAccounting(); let acknowledged;
    const ack = new Promise(resolve => { acknowledged = resolve; });
    const accounting = { ...context, async completeAttempt(attempt, completion) { const result = await context.completeAttempt(attempt, completion); acknowledged(); return result; } };
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(wire().split('event: response.completed')[0]); };
    const result = await new GithubExecutor().execute(options(accounting));
    await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable'); await ack;
    expect(failure).toBeNull(); expect(requests).toHaveLength(1); expect(requests[0].row).toMatchObject({ requestId: context.requestId, state: 'pending' });
    expect(rows()).toEqual([{ state: 'unresolved', costNanoUsd: null }]); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('persisted preferred Copilot token drift at dequeue refuses zero socket POST/intent/gap', async () => {
    const context = await createAccounting(), executor = new GithubExecutor();
    const refresh = vi.spyOn(executor, 'refreshCredentials').mockImplementation(() => { throw new Error('Fixture disallows refresh'); });
    const accounting = { ...context, beforeAttempt(meta, supported, original) {
      expect(original.protocol).toBe('native-github-responses'); const work = context.beforeAttempt(meta, supported, original);
      db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']); db.run('UPDATE providerConnections SET data=? WHERE id=?',
        [JSON.stringify({ ...JSON.parse(row.data), providerSpecificData: { copilotToken: 'dummy-new' } }), 'c']); }); return work;
    } };
    await expect(executor.execute(options(accounting))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0); expect(refresh).not.toHaveBeenCalled();
  });
  it('native307 refuses replay with exactly one POST and sole unresolved terminal', async () => {
    responder = (_request, response) => { response.writeHead(307, { location: fixture.url }); response.end(); };
    await expect(new GithubExecutor().execute(options(await createAccounting()))).rejects.toThrow();
    expect(failure).toBeNull(); expect(requests).toHaveLength(1); expect(rows()).toEqual([{ state: 'unresolved', costNanoUsd: null }]); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
});
