import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { GrokCliExecutor, _resetGrokCliTurnStore } from 'open-sse/executors/grok-cli.js';
const fixture = vi.hoisted(() => ({ url: null, machine: vi.fn(), refresh: vi.fn() }));
// Both module replacements authorize ONLY this exact owned route. Actual fetch,
// proxy dispatch and SQLite are real; production fixed URL/TLS are untouched.
vi.mock('../../open-sse/config/accountedGrokCliCandidate.js', async importOriginal => {
  const original = await importOriginal();
  return { ...original, get ACCOUNTED_GROK_CLI_URL() { return fixture.url; } };
});
vi.mock('../../open-sse/config/providers.js', async importOriginal => {
  const original = await importOriginal();
  return { ...original, PROVIDERS: { ...original.PROVIDERS, get ['grok-cli']() { return { ...original.PROVIDERS['grok-cli'], baseUrl: fixture.url }; } } };
});
vi.mock('open-sse/shared/machineId.js', () => ({ getConsistentMachineId: (...args) => fixture.machine(...args) }));
vi.mock('open-sse/services/oauthCredentialManager.js', () => ({ refreshProviderCredentials: (...args) => fixture.refresh(...args), shouldRefreshCredentials: () => false }));
let directory, db, server, requests, failure, responder, createAccounting;
const old = process.env.DATA_DIR;
const specific = () => ({ deviceId: 'dummy-grok-device', email: 'dummy@example.invalid', userId: 'dummy-grok-user' });
const reasoning = () => ({ id: 'rs_fixture', type: 'reasoning', status: 'completed', summary: [{ type: 'summary_text', text: 'fixture reasoning' }], encrypted_content: 'fixture-encrypted' });
const message = () => ({ id: 'resp_fixture', object: 'response', model: 'grok-build', status: 'completed', service_tier: 'default', error: null, incomplete_details: null,
  output: [reasoning()], usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 10 } } });
const wire = () => [
  { type: 'response.created', response: { ...message(), status: 'in_progress', output: [], usage: null } },
  { type: 'response.output_item.added', output_index: 0, item: { id: 'rs_fixture', type: 'reasoning', status: 'in_progress', summary: [] } },
  { type: 'response.reasoning_summary_part.added', output_index: 0, item_id: 'rs_fixture', summary_index: 0, part: { type: 'summary_text', text: '' } },
  { type: 'response.reasoning_summary_text.delta', output_index: 0, item_id: 'rs_fixture', summary_index: 0, delta: 'fixture reasoning' },
  { type: 'response.reasoning_summary_text.done', output_index: 0, item_id: 'rs_fixture', summary_index: 0, text: 'fixture reasoning' },
  { type: 'response.reasoning_summary_part.done', output_index: 0, item_id: 'rs_fixture', summary_index: 0, part: reasoning().summary[0] },
  { type: 'response.output_item.done', output_index: 0, item: reasoning() },
  { type: 'response.completed', response: message() },
].map((event, sequence_number) => `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join('');
const requestBody = () => ({ model: 'grok-build', stream: true, store: false, instructions: 'fixture instruction', input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'fixture' }] }] });
const actualBody = () => ({ ...requestBody(), reasoning: { summary: 'concise' }, include: ['reasoning.encrypted_content'] });
const options = accounting => ({ model: 'grok-build', body: requestBody(), stream: true, connectionId: 'c', accountingMode: 'native-grok-cli-responses-sse', accounting,
  credentials: { accessToken: 'dummy-grok-oauth', connectionId: 'c', providerSpecificData: specific() },
  proxyOptions: { persistedGlobalProxy: { url: 'http://127.0.0.1:1', noProxy: '127.0.0.1' } } });
beforeEach(async () => {
  vi.resetModules(); _resetGrokCliTurnStore(); fixture.machine.mockReset(); fixture.refresh.mockReset();
  fixture.machine.mockImplementation(() => { throw new Error('Fixture disallows machine acquisition'); }); fixture.refresh.mockImplementation(() => { throw new Error('Fixture disallows refresh'); });
  directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-native-grok-cli-')); process.env.DATA_DIR = directory; delete global._dbAdapter;
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }],
    settings: { requireApiKey: true, outboundProxyEnabled: true, outboundProxyUrl: 'http://127.0.0.1:1', outboundNoProxy: '127.0.0.1' },
    providerConnections: [{ id: 'c', provider: 'grok-cli', authType: 'oauth', accessToken: 'dummy-grok-oauth', providerSpecificData: specific() }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','grok-cli',?)", [JSON.stringify({ 'grok-build': { input: '1', output: '2', cached: '0.1', reasoning: '2' } })]);
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
  fixture.url = `http://127.0.0.1:${server.address().port}/grok-cli/responses`;
  createAccounting = () => import('@/lib/apiKeyBudget/requestAccounting.js').then(({ createRequestAccounting }) => createRequestAccounting(
    new Request('http://localhost/v1/responses', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true }));
});
afterEach(async () => {
  server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve));
  vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true });
  if (old === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = old;
});
const rows = () => db.all('SELECT state,costNanoUsd FROM apiKeyAccounting');
describe('owned native HTTP queued Grok Build (test route only, not TLS/refresh/full Grok)', { timeout: 20000 }, () => {
  it('actual original OAuth/device/client/body pending retains original price after upstream price edit', async () => {
    const context = await createAccounting(), args = options(context); let originalIdentity, originalConfig;
    const accounting = { ...context, beforeAttempt(meta, supported, original) {
      expect(original.protocol).toBe('native-grok-cli'); expect(Reflect.set(original.headers, 'authorization', 'Bearer changed')).toBe(false);
      originalIdentity = original.grokCliTransport.identity; originalConfig = original.grokCliTransport.grokConfig;
      const work = context.beforeAttempt(meta, supported, original); args.credentials.accessToken = 'dummy-changed'; args.credentials.providerSpecificData.deviceId = 'dummy-other'; args.body.input[0].content[0].text = 'changed'; return work;
    } };
    responder = (_request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='grok-cli'", [JSON.stringify({ 'grok-build': { input: '9', output: '9', cached: '9', reasoning: '9' } })]));
      response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(wire());
    };
    const executor = new GrokCliExecutor(), result = await executor.execute({ ...args, accounting }); expect(await result.response.text()).toBe(wire());
    expect(failure).toBeNull(); expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: 'POST', url: '/grok-cli/responses', body: actualBody(), headers: {
      authorization: 'Bearer dummy-grok-oauth', 'x-grok-agent-id': 'dummy-grok-device', 'x-email': 'dummy@example.invalid', 'x-userid': 'dummy-grok-user',
      'x-grok-client-version': originalConfig.clientVersion, 'x-grok-client-identifier': originalConfig.clientIdentifier,
      'user-agent': new Headers(originalConfig.baseTransport.headers).get('user-agent'), 'x-grok-model-override': 'grok-build',
      'x-grok-session-id': originalIdentity.sessionId, 'x-grok-conv-id': originalIdentity.sessionId, 'x-grok-req-id': originalIdentity.requestId, 'x-grok-turn-idx': '1',
      accept: 'text/event-stream' }, row: { requestId: context.requestId, state: 'pending' } });
    expect(rows()).toEqual([{ state: 'settled', costNanoUsd: 104000 }]); expect(db.coverage.status('a').gaps).toHaveLength(0);
    expect(executor._currentSessionId).toBeNull(); expect(executor._currentReqId).toBeNull(); expect(executor._agentId).toBeNull();
    expect(fixture.machine).not.toHaveBeenCalled(); expect(fixture.refresh).not.toHaveBeenCalled();
  });
  it('native reasoning summary/encrypted/completed bytes wait own queued terminal ACK', async () => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, async completeAttempt(attempt, completion) { enter(); await held; return context.completeAttempt(attempt, completion); } };
    const result = await new GrokCliExecutor().execute(options(accounting)); let delivered = '', ended = false;
    const consume = (async () => { const reader = result.response.body.getReader(), decoder = new TextDecoder();
      try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; delivered += decoder.decode(chunk.value, { stream: true }); } delivered += decoder.decode(); ended = true; }
      finally { reader.releaseLock(); }
    })();
    try {
      await entered; expect(ended).toBe(false); expect(delivered).toContain('event: response.reasoning_summary_text.delta');
      expect(delivered).not.toContain('event: response.reasoning_summary_text.done'); expect(delivered).not.toContain('fixture-encrypted'); expect(delivered).not.toContain('event: response.completed');
      expect(requests).toHaveLength(1); expect(rows()).toEqual([{ state: 'pending', costNanoUsd: null }]);
    } finally { release(); await consume; }
    expect(delivered).toBe(wire()); expect(failure).toBeNull(); expect(rows()).toEqual([{ state: 'settled', costNanoUsd: 104000 }]);
  });
  it('EOF missing completed delivery error is not ACK, separately awaits sole unresolved ACK', async () => {
    const context = await createAccounting(); let acknowledged;
    const ack = new Promise(resolve => { acknowledged = resolve; });
    const accounting = { ...context, async completeAttempt(attempt, completion) { const result = await context.completeAttempt(attempt, completion); acknowledged(); return result; } };
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(wire().split('event: response.completed')[0]); };
    const result = await new GrokCliExecutor().execute(options(accounting));
    await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable'); await ack;
    expect(failure).toBeNull(); expect(requests).toHaveLength(1); expect(requests[0].row).toMatchObject({ requestId: context.requestId, state: 'pending' });
    expect(rows()).toEqual([{ state: 'unresolved', costNanoUsd: null }]); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('persisted OAuth/device drift at dequeue refuses zero socket POST/intent/gap without rebuilding', async () => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, original) {
      expect(original.protocol).toBe('native-grok-cli'); const work = context.beforeAttempt(meta, supported, original);
      db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']); db.run('UPDATE providerConnections SET data=? WHERE id=?',
        [JSON.stringify({ ...JSON.parse(row.data), accessToken: 'dummy-new', providerSpecificData: { ...specific(), deviceId: 'dummy-other' } }), 'c']); }); return work;
    } };
    await expect(new GrokCliExecutor().execute(options(accounting))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
    expect(fixture.machine).not.toHaveBeenCalled(); expect(fixture.refresh).not.toHaveBeenCalled();
  });
  it('native307 refuses replay with one POST and sole unresolved terminal', async () => {
    responder = (_request, response) => { response.writeHead(307, { location: fixture.url }); response.end(); };
    await expect(new GrokCliExecutor().execute(options(await createAccounting()))).rejects.toThrow();
    expect(failure).toBeNull(); expect(requests).toHaveLength(1); expect(rows()).toEqual([{ state: 'unresolved', costNanoUsd: null }]); expect(db.coverage.status('a').gaps).toHaveLength(0);
    expect(fixture.refresh).not.toHaveBeenCalled();
  });
});
