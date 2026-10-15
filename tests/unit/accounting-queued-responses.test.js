import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { retainKeyBindings } from '@/lib/db/helpers/apiKeyBindings.js';
import { getAccountingWriteCoordinator } from '@/lib/apiKeyBudget/accountingWriteCoordinator.js';

const network = vi.hoisted(() => vi.fn());
vi.mock('open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => network(...args) }));
let db, directory, createAccounting, DefaultExecutor;
const old = process.env.DATA_DIR;
const message = { id: 'resp_fixture', object: 'response', model: 'fixture-responses', status: 'completed', service_tier: 'default', error: null, incomplete_details: null,
  output: [{ id: 'msg_fixture', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'fixture', annotations: [] }] }],
  usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 10 } } };
const options = accounting => ({ model: 'fixture-responses', body: { model: 'fixture-responses', input: 'fixture', stream: false, store: false }, stream: false,
  credentials: { apiKey: 'dummy-provider' }, connectionId: 'c', accountingMode: 'native-responses-json', accounting, proxyOptions: null });
beforeEach(async () => {
  network.mockReset(); vi.resetModules(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-queued-responses-'));
  process.env.DATA_DIR = directory; delete global._dbAdapter;
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  // Responses wire/settlement fixture, not config import/restore acceptance.
  // Preserve the real driver, durable transactions and protected key binding.
  const timestamp = '2026-10-03T00:00:00.000Z';
  const keys = [{ id: 'a', key: 'dummy-key-a', createdAt: timestamp }];
  db.durableTransaction(() => {
    if (db.get('SELECT id FROM apiKeys') || db.get('SELECT id FROM providerConnections') || db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")) throw new Error('Responses fixture requires fresh disposable DB');
    db.run('INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES(?,?,1,?)', ['a', 'dummy-key-a', timestamp]);
    retainKeyBindings(db, db.coverage, keys);
    db.run('INSERT INTO settings(id,data) VALUES(1,?)', [JSON.stringify({ requireApiKey: true })]);
    db.run('INSERT INTO providerConnections(id,provider,authType,isActive,data,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)', ['c', 'openai', 'apikey', 1, JSON.stringify({ apiKey: 'dummy-provider' }), timestamp, timestamp]);
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt',?)", [timestamp]);
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','openai',?)", [JSON.stringify({ 'fixture-responses': { input: '1', output: '2', cached: '0.1', reasoning: '2' } })]);
  });
  ({ DefaultExecutor } = await import('open-sse/executors/default.js'));
  createAccounting = () => import('@/lib/apiKeyBudget/requestAccounting.js').then(({ createRequestAccounting }) => createRequestAccounting(
    new Request('http://localhost/v1/responses', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true }));
});
afterEach(async () => {
  vi.restoreAllMocks(); if (db) await getAccountingWriteCoordinator(db).stop(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true });
  if (old === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = old;
});
describe('queued API-key Responses prepared owner (mock POST, not OAuth/general Responses acceptance)', { timeout: 20000 }, () => {
  it('owns pending intent before strict POST and exact original native settlement', async () => {
    const context = await createAccounting();
    network.mockImplementation((url, init, _proxy, contract) => {
      expect(url).toBe('https://api.openai.com/v1/responses'); expect(init.method).toBe('POST'); expect(init.redirect).toBe('error');
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer dummy-provider');
      expect(JSON.parse(init.body)).toEqual(options(context).body);
      expect(contract).toMatchObject({ singlePost: true, responsesTransport: { model: 'fixture-responses', mode: 'native-responses-json' } });
      expect(db.get('SELECT requestId,state FROM apiKeyAccounting')).toEqual({ requestId: context.requestId, state: 'pending' });
      return Response.json(message);
    });
    const result = await new DefaultExecutor('openai').execute(options(context));
    expect(await result.response.json()).toEqual(message); expect(network).toHaveBeenCalledTimes(1);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 104000 }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('exposed prepared headers/body are frozen and cannot alter actual POST after admission', async () => {
    const context = await createAccounting(), args = options(context);
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      expect(Object.isFrozen(wire)).toBe(true); expect(Object.isFrozen(wire.headers)).toBe(true);
      expect(Reflect.set(wire.headers, 'authorization', 'Bearer dummy-mutated')).toBe(false);
      const work = context.beforeAttempt(meta, supported, wire); args.body.input = 'mutated'; args.credentials.apiKey = 'dummy-mutated'; return work;
    } };
    network.mockImplementation((_url, init) => {
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer dummy-provider'); expect(JSON.parse(init.body).input).toBe('fixture');
      return Response.json(message);
    });
    await new DefaultExecutor('openai').execute({ ...args, accounting }); expect(network).toHaveBeenCalledTimes(1);
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: 104000 });
  });
  it('fresh persisted credential drift at dequeue refuses stale prepared wire with zero POST/intent/gap', async () => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      expect(wire?.protocol).toBe('native-responses');
      const work = context.beforeAttempt(meta, supported, wire);
      db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']);
        db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(row.data), apiKey: 'dummy-new' }), 'c']); });
      return work;
    } };
    await expect(new DefaultExecutor('openai').execute(options(accounting))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('queue retained-byte ceiling counts original Responses body, not only operation UUID', async () => {
    const context = await createAccounting();
    network.mockImplementation(() => Response.json(message));
    const admitted = [], refused = [];
    for (let i = 0; i < 6; i++) {
      const args = options(context); args.body.input = 'x'.repeat(200000);
      const work = new DefaultExecutor('openai').execute(args);
      // Observe each rejection immediately; do not let fixture false positives
      // or unhandled rejection timing replace exact queue/ledger assertions.
      if (i < 5) admitted.push(work); else refused.push(work);
    }
    const failed = Promise.all(refused.map(work => expect(work).rejects.toThrow()));
    const success = await Promise.all(admitted); await failed;
    expect(success).toHaveLength(5); expect(network).toHaveBeenCalledTimes(5);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual(Array.from({ length: 5 }, () => ({ state: 'settled', costNanoUsd: 104000 })));
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['credentials', 'headers', 'body-model', 'body-tools', 'config', 'settings'])('original %s drift before equality capture refuses with zero POST/intent/gap', async mode => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      const changed = structuredClone(wire);
      if (mode === 'credentials') changed.credentials.apiKey = 'dummy-foreign';
      if (mode === 'headers') changed.headers.authorization = 'Bearer dummy-foreign';
      if (mode === 'body-model' || mode === 'body-tools') {
        const body = JSON.parse(changed.responsesTransport.serializedBody);
        if (mode === 'body-model') body.model = 'foreign-model'; else body.tools = [{ type: 'web_search' }];
        changed.responsesTransport.serializedBody = JSON.stringify(body);
      }
      if (mode === 'config') changed.responsesTransport.baseTransport.headers = { 'OpenAI-Beta': 'fixture' };
      if (mode === 'settings') db.durableTransaction(() => db.run('UPDATE settings SET data=? WHERE id=1', [JSON.stringify({ requireApiKey: true, providerOverrides: { openai: { headers: { 'Accept': 'application/json' } } } })]));
      return context.beforeAttempt(meta, supported, changed);
    } };
    await expect(new DefaultExecutor('openai').execute(options(accounting))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('oversize original serialized body is bounded before queue admission', async () => {
    const args = options(await createAccounting()); args.body.input = 'x'.repeat(300000);
    await expect(new DefaultExecutor('openai').execute(args)).rejects.toThrow('Accounting Base transport unavailable');
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
});
