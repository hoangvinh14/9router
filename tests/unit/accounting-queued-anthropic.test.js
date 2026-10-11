import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

const network = vi.hoisted(() => vi.fn());
vi.mock('open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => network(...args) }));
// Existing standard-only contract: replace registry module in this fixture, never
// remove production beta semantics to manufacture supported admission.
vi.mock('../../open-sse/config/providers.js', async importOriginal => {
  const original = await importOriginal();
  return { ...original, PROVIDERS: { ...original.PROVIDERS, anthropic: { ...original.PROVIDERS.anthropic, headers: { 'anthropic-version': '2023-06-01' } } } };
});
let db, directory, createAccounting, DefaultExecutor;
const old = process.env.DATA_DIR;
const event = (type, payload = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
const responseWire = () => event('message_start', { message: { type: 'message', id: 'msg_fixture', role: 'assistant', model: 'fixture-native', content: [],
  usage: { input_tokens: 50, output_tokens: 0, cache_read_input_tokens: 40, cache_creation_input_tokens: 10,
    cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 0 }, server_tool_use: { web_search_requests: 0 } } } }) +
  event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } }) + event('message_stop');
const options = accounting => ({ model: 'fixture-native', stream: true, body: { model: 'fixture-native', stream: false, messages: [{ role: 'user', content: 'fixture' }], max_tokens: 100 },
  credentials: { apiKey: 'dummy-provider' }, connectionId: 'c', accountingMode: 'buffered-claude-sse', accounting, proxyOptions: null });
beforeEach(async () => {
  network.mockReset(); vi.resetModules(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-queued-messages-')); process.env.DATA_DIR = directory; delete global._dbAdapter;
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }], settings: { requireApiKey: true },
    providerConnections: [{ id: 'c', provider: 'anthropic', authType: 'apikey', apiKey: 'dummy-provider' }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','anthropic',?)", [JSON.stringify({ 'fixture-native': { input: '1', output: '2', cached: '0.1', cache_creation: '1.25' } })]);
  });
  ({ DefaultExecutor } = await import('open-sse/executors/default.js'));
  createAccounting = () => import('@/lib/apiKeyBudget/requestAccounting.js').then(({ createRequestAccounting }) => createRequestAccounting(
    new Request('http://localhost/v1/messages', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true }));
});
afterEach(() => {
  vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true });
  if (old === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = old;
});
describe('queued standard API-key Messages original wire (mock/modulefixture, not production beta/OAuth approval)', { timeout: 20000 }, () => {
  it('strict actual mocked POST sees own pending and native106500 settlement', async () => {
    const context = await createAccounting();
    network.mockImplementation((url, init, _proxy, contract) => {
      expect(url).toBe('https://api.anthropic.com/v1/messages'); expect(init.method).toBe('POST'); expect(init.redirect).toBe('error');
      expect(new Headers(init.headers).get('x-api-key')).toBe('dummy-provider'); expect(new Headers(init.headers).get('accept')).toBe('text/event-stream');
      expect(JSON.parse(init.body)).toMatchObject({ model: 'fixture-native', stream: true });
      expect(contract).toMatchObject({ singlePost: true, anthropicTransport: { model: 'fixture-native', mode: 'buffered-claude-sse' } });
      expect(db.get('SELECT requestId,state FROM apiKeyAccounting')).toEqual({ requestId: context.requestId, state: 'pending' });
      return new Response(responseWire(), { headers: { 'content-type': 'text/event-stream' } });
    });
    const result = await new DefaultExecutor('anthropic').execute(options(context)); expect(await result.response.text()).toBe(responseWire());
    expect(network).toHaveBeenCalledTimes(1); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: 106500 }); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('whole original wire frozen before exposure drives actual headers/body despite mutable inputs', async () => {
    const context = await createAccounting(), args = options(context);
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      expect(wire?.protocol).toBe('native-anthropic'); expect(Object.isFrozen(wire)).toBe(true);
      expect(Reflect.set(wire.headers, 'x-api-key', 'dummy-foreign')).toBe(false);
      const work = context.beforeAttempt(meta, supported, wire); args.credentials.apiKey = 'dummy-foreign'; args.body.messages[0].content = 'changed'; return work;
    } };
    network.mockImplementation((_url, init) => {
      expect(new Headers(init.headers).get('x-api-key')).toBe('dummy-provider'); expect(JSON.parse(init.body).messages[0].content).toBe('fixture');
      return new Response(responseWire(), { headers: { 'content-type': 'text/event-stream' } });
    });
    await new DefaultExecutor('anthropic').execute({ ...args, accounting }); expect(network).toHaveBeenCalledTimes(1);
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: 106500 });
  });
  it('queue charges both original and actual serialized bodies, sixth100k pair refused', async () => {
    const context = await createAccounting(); network.mockImplementation(() => new Response(responseWire(), { headers: { 'content-type': 'text/event-stream' } }));
    const works = [];
    for (let i = 0; i < 6; i++) {
      const args = options(context); args.body.messages[0].content = 'x'.repeat(100000); works.push(new DefaultExecutor('anthropic').execute(args));
    }
    const rejected = expect(works[5]).rejects.toThrow();
    expect(await Promise.all(works.slice(0, 5))).toHaveLength(5); await rejected;
    expect(network).toHaveBeenCalledTimes(5);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual(Array.from({ length: 5 }, () => ({ state: 'settled', costNanoUsd: 106500 })));
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['credentials', 'headers', 'missing-accept', 'version', 'original-tools', 'wire-content', 'config', 'settings'])('original %s drift refuses before POST/intent/gap', async kind => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      const changed = structuredClone(wire);
      if (kind === 'credentials') changed.credentials.apiKey = 'dummy-foreign';
      if (kind === 'headers') changed.headers['x-api-key'] = 'dummy-foreign';
      if (kind === 'missing-accept') delete changed.headers.accept;
      if (kind === 'version') changed.headers['anthropic-version'] = 'foreign';
      if (kind === 'original-tools') { const body = JSON.parse(changed.anthropicTransport.originalSerializedBody); body.tools = [{ name: 'fixture', input_schema: {} }]; changed.anthropicTransport.originalSerializedBody = JSON.stringify(body); }
      if (kind === 'wire-content') { const body = JSON.parse(changed.anthropicTransport.serializedBody); body.messages[0].content = 'changed'; changed.anthropicTransport.serializedBody = JSON.stringify(body); }
      if (kind === 'config') changed.anthropicTransport.baseTransport.headers['anthropic-beta'] = 'fixture-beta';
      if (kind === 'settings') db.durableTransaction(() => db.run('UPDATE settings SET data=? WHERE id=1', [JSON.stringify({ requireApiKey: true, providerOverrides: { anthropic: { headers: { Accept: 'application/json' } } } })]));
      return context.beforeAttempt(meta, supported, changed);
    } };
    await expect(new DefaultExecutor('anthropic').execute(options(accounting))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('original plus actual serialized body exceeds per-command bound before admission', async () => {
    const args = options(await createAccounting()); args.body.messages[0].content = 'x'.repeat(140000);
    await expect(new DefaultExecutor('anthropic').execute(args)).rejects.toThrow('Accounting Base transport unavailable');
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('missing Messages wire refuses even unlimited before intent/POST', async () => {
    const context = await createAccounting();
    await expect(context.beforeAttempt({ provider: 'anthropic', model: 'fixture-native', endpoint: 'chat', connectionId: 'c' }, true)).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('transforms cannot erase original unsupported work to manufacture queued admission', async () => {
    const args = options(await createAccounting()); args.body.metadata = { user_id: 'fixture' };
    const executor = new DefaultExecutor('anthropic');
    executor.transformRequest = (_model, body) => { delete body.metadata; return body; };
    await expect(executor.execute(args)).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('persisted credential drift at dequeue refuses original wire before POST/intent/gap', async () => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      expect(wire?.protocol).toBe('native-anthropic'); const work = context.beforeAttempt(meta, supported, wire);
      db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']); db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(row.data), apiKey: 'dummy-new' }), 'c']); }); return work;
    } };
    await expect(new DefaultExecutor('anthropic').execute(options(accounting))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
});
