import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubExecutor } from 'open-sse/executors/github.js';
import { BUDGET_ERROR } from 'open-sse/config/apiKeyBudgetConstants.js';
const network = vi.hoisted(() => vi.fn());
vi.mock('open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => network(...args) }));
let db, directory, createAccounting;
const old = process.env.DATA_DIR;
const model = 'claude-sonnet-4.6';
const body = () => ({ model, messages: [{ role: 'user', content: 'fixture' }], max_tokens: 100, stream: false });
const options = accounting => ({ model, body: body(), stream: true, connectionId: 'c', accountingMode: 'native-github-messages-sse', accounting,
  credentials: { accessToken: 'dummy-github-oauth', copilotToken: 'dummy-copilot-token', connectionId: 'c', providerSpecificData: { copilotToken: 'dummy-copilot-token' } } });
const event = (type, payload = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
const wire = () => event('message_start', { message: { type: 'message', id: 'msg_fixture', role: 'assistant', model, content: [],
  usage: { input_tokens: 50, output_tokens: 0, cache_read_input_tokens: 40, cache_creation_input_tokens: 10,
    cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 0 }, server_tool_use: { web_search_requests: 0 } } } }) +
  event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } }) + event('message_stop');
beforeEach(async () => {
  vi.resetModules(); network.mockReset(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-queued-github-messages-')); process.env.DATA_DIR = directory; delete global._dbAdapter;
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }], settings: { requireApiKey: true },
    providerConnections: [{ id: 'c', provider: 'github', authType: 'oauth', accessToken: 'dummy-github-oauth', providerSpecificData: { copilotToken: 'dummy-copilot-token' } }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','github',?)", [JSON.stringify({ [model]: { input: '1', output: '2', cached: '0.1', cache_creation: '1.25' } })]);
  });
  createAccounting = () => import('@/lib/apiKeyBudget/requestAccounting.js').then(({ createRequestAccounting }) => createRequestAccounting(
    new Request('http://localhost/v1/messages', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true }));
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true }); if (old === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = old; });
const empty = () => { expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0); };
describe('internal native GitHub Messages original OAuth owner (test-first, not Chat conversion/beta/refresh approval)', { timeout: 20000 }, () => {
  it('both original and actual retained body bytes admit five own ACKs and refuse sixth pair', async () => {
    const context = await createAccounting(), works = [];
    network.mockImplementation(() => new Response(wire(), { headers: { 'content-type': 'text/event-stream' } }));
    for (let index = 0; index < 6; index++) {
      const args = options(context); args.body.messages[0].content = 'x'.repeat(100000);
      // Owner reaches real admission synchronously, observe every outcome now.
      works.push(new GithubExecutor().execute(args).then(value => ({ value }), error => ({ error })));
    }
    const outcomes = await Promise.all(works);
    expect(outcomes.slice(0, 5).every(result => result.value)).toBe(true); expect(outcomes[5].error).toBeDefined(); expect(network).toHaveBeenCalledTimes(5);
    for (const { value } of outcomes.slice(0, 5)) expect(await value.response.text()).toBe(wire());
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual(Array.from({ length: 5 }, () => ({ state: 'settled', costNanoUsd: 106500 })));
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('oversize original+actual pair refuses before admission/intent/POST/gap', async () => {
    const args = options(await createAccounting()); args.body.messages[0].content = 'x'.repeat(140000);
    await expect(new GithubExecutor().execute(args)).rejects.toThrow('Accounting Base transport unavailable'); empty();
  });
  it('actual original wire frozen before exposure drives POST after caller mutations', async () => {
    const context = await createAccounting(), args = options(context);
    const accounting = { ...context, beforeAttempt(meta, supported, prepared) {
      expect(prepared.protocol).toBe('native-github-messages'); expect(Object.isFrozen(prepared.headers)).toBe(true);
      expect(Object.isFrozen(prepared.credentials.providerSpecificData)).toBe(true); expect(Object.isFrozen(prepared.githubMessagesTransport.githubConfig)).toBe(true);
      expect(Reflect.set(prepared.headers, 'authorization', 'Bearer changed')).toBe(false);
      const work = context.beforeAttempt(meta, supported, prepared);
      args.credentials.accessToken = 'changed'; args.credentials.copilotToken = 'changed'; args.credentials.providerSpecificData.copilotToken = 'changed'; args.body.messages[0].content = 'changed'; return work;
    } };
    network.mockImplementation((_url, init) => {
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer dummy-copilot-token'); expect(JSON.parse(init.body)).toEqual({ ...body(), stream: true });
      return new Response(wire(), { headers: { 'content-type': 'text/event-stream' } });
    });
    const result = await new GithubExecutor().execute({ ...args, accounting }); expect(await result.response.text()).toBe(wire());
    expect(network).toHaveBeenCalledTimes(1); expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 106500 }]);
  });
  it.each(['copilotToken', 'githubToken', 'connection', 'original', 'actual', 'config', 'request', 'headers', 'endpoint'])('original %s drift refuses before enqueue/POST/intent/gap', async kind => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, prepared) {
      expect(prepared.protocol).toBe('native-github-messages'); const changed = structuredClone(prepared);
      if (kind === 'copilotToken') changed.credentials.copilotToken = 'changed';
      if (kind === 'githubToken') changed.credentials.accessToken = 'changed';
      if (kind === 'connection') changed.credentials.connectionId = 'other';
      if (kind === 'original') { const value = JSON.parse(changed.githubMessagesTransport.originalSerializedBody); value.metadata = {}; changed.githubMessagesTransport.originalSerializedBody = JSON.stringify(value); }
      if (kind === 'actual') { const value = JSON.parse(changed.githubMessagesTransport.serializedBody); value.messages[0].content = 'changed'; changed.githubMessagesTransport.serializedBody = JSON.stringify(value); }
      if (kind === 'config') changed.githubMessagesTransport.githubConfig.messagesUrl = 'https://fixture.invalid/messages';
      if (kind === 'request') changed.githubMessagesTransport.requestId = 'changed';
      if (kind === 'headers') changed.headers.authorization = 'Bearer changed';
      return context.beforeAttempt(kind === 'endpoint' ? { ...meta, endpoint: 'embeddings' } : meta, supported, changed);
    } };
    await expect(new GithubExecutor().execute(options(accounting))).rejects.toMatchObject({ code: BUDGET_ERROR.UNAVAILABLE }); empty();
  });
  it.each(['bodyAccessor', 'bodyToJSON', 'credentialAccessor', 'proxy', 'configAccessor'])('programmable %s refuses without execution/POST/intent/gap', async kind => {
    const args = options(await createAccounting()), executor = new GithubExecutor(), touched = vi.fn(() => { throw new Error('Fixture programmable input executed'); });
    if (kind === 'bodyAccessor') Object.defineProperty(args.body, 'messages', { enumerable: true, get: touched });
    if (kind === 'bodyToJSON') Object.defineProperty(args.body, 'toJSON', { value: touched });
    if (kind === 'credentialAccessor') Object.defineProperty(args.credentials, 'copilotToken', { enumerable: true, get: touched });
    if (kind === 'proxy') args.proxyOptions = new Proxy({}, { ownKeys: touched, get: touched, getPrototypeOf: touched });
    if (kind === 'configAccessor') { executor.config = structuredClone(executor.config); Object.defineProperty(executor.config, 'messagesUrl', { enumerable: true, get: touched }); }
    await expect(executor.execute(args)).rejects.toThrow('Accounting Base transport unavailable'); expect(touched).not.toHaveBeenCalled(); empty();
  });
  it.each(['accessToken', 'copilotToken'])('persisted %s drift at dequeue cannot rebuild/fallback/refresh', async kind => {
    const context = await createAccounting(), executor = new GithubExecutor();
    const refresh = vi.spyOn(executor, 'refreshCredentials').mockImplementation(() => { throw new Error('Fixture disallows refresh'); });
    const accounting = { ...context, beforeAttempt(meta, supported, prepared) {
      expect(prepared.protocol).toBe('native-github-messages'); const work = context.beforeAttempt(meta, supported, prepared);
      db.durableTransaction(() => {
        const data = JSON.parse(db.get('SELECT data FROM providerConnections WHERE id=?', ['c']).data);
        if (kind === 'accessToken') data.accessToken = 'changed'; else data.providerSpecificData.copilotToken = 'changed';
        db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify(data), 'c']);
      }); return work;
    } };
    await expect(executor.execute(options(accounting))).rejects.toMatchObject({ code: BUDGET_ERROR.UNAVAILABLE }); empty(); expect(refresh).not.toHaveBeenCalled();
  });
  it('missing selected Copilot token refuses without GitHub token fallback', async () => {
    const args = options(await createAccounting()); delete args.credentials.copilotToken;
    await expect(new GithubExecutor().execute(args)).rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED }); empty();
  });
  it('request-local UUIDs on one concurrent executor do not mutate route cache', async () => {
    const executor = new GithubExecutor(), first = await createAccounting(), second = await createAccounting(), ids = [];
    network.mockImplementation((_url, init) => { ids.push(new Headers(init.headers).get('x-request-id')); return new Response(wire(), { headers: { 'content-type': 'text/event-stream' } }); });
    const results = await Promise.all([executor.execute(options(first)), executor.execute(options(second))]); await Promise.all(results.map(result => result.response.text()));
    expect(ids).toHaveLength(2); expect(ids[0]).toMatch(/^[a-f0-9-]{36}$/); expect(ids[1]).not.toBe(ids[0]); expect(executor.knownCodexModels.size).toBe(0);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 106500 }, { state: 'settled', costNanoUsd: 106500 }]);
  });
  it('explicit raw native Messages owns pending/strict POST/original Copilot headers and106500 terminal before translation', async () => {
    const context = await createAccounting(), executor = new GithubExecutor();
    const translate = vi.spyOn(executor, 'executeWithMessagesEndpoint').mockImplementation(() => { throw new Error('Fixture denies legacy translated Messages dispatch'); });
    const refresh = vi.spyOn(executor, 'refreshCredentials').mockImplementation(() => { throw new Error('Fixture disallows refresh'); });
    network.mockImplementation((url, init, _proxy, contract) => {
      expect(url).toBe('https://api.githubcopilot.com/v1/messages'); expect(init.method).toBe('POST'); expect(init.redirect).toBe('error');
      const headers = new Headers(init.headers); expect(headers.get('authorization')).toBe('Bearer dummy-copilot-token');
      expect(headers.get('anthropic-version')).toBe('2023-06-01'); expect(headers.get('accept')).toBe('text/event-stream');
      expect(JSON.parse(init.body)).toEqual({ ...body(), stream: true });
      expect(contract).toMatchObject({ singlePost: true, githubMessagesTransport: { model, mode: 'native-github-messages-sse' } });
      expect(db.get('SELECT requestId,state FROM apiKeyAccounting')).toEqual({ requestId: context.requestId, state: 'pending' });
      return new Response(wire(), { headers: { 'content-type': 'text/event-stream' } });
    });
    const result = await executor.execute(options(context)); expect(await result.response.text()).toBe(wire());
    expect(network).toHaveBeenCalledTimes(1); expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 106500 }]);
    expect(translate).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled(); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('missing original GitHub Messages wire refuses even unlimited before intent/POST/gap', async () => {
    const context = await createAccounting();
    await expect(context.beforeAttempt({ provider: 'github', model, endpoint: 'chat', connectionId: 'c' }, true)).rejects.toMatchObject({ code: BUDGET_ERROR.UNAVAILABLE }); empty();
  });
  it('unsupported original metadata cannot be stripped by legacy Claude translation to bypass ownership', async () => {
    const args = options(await createAccounting()); args.body.metadata = { fixture: 'unsupported' };
    network.mockImplementation(() => new Response(wire(), { headers: { 'content-type': 'text/event-stream' } }));
    await expect(new GithubExecutor().execute(args)).rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED }); empty();
  });
});
