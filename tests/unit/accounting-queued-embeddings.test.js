import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Cold compilation of the provider graph is collection work, not per-case DB
// setup. Keep the existing 10s hook limit; never make it a larger deadline.
import { handleEmbeddingsCore as invoke } from 'open-sse/handlers/embeddingsCore.js';
import { handleAccountedEmbedding } from 'open-sse/handlers/embeddingProviders/accountedRequest.js';

const network = vi.hoisted(() => vi.fn());
vi.mock('open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => network(...args) }));
let db, directory, createAccounting;
const old = process.env.DATA_DIR;
const payload = { object: 'list', data: [], model: 'fixture-embedding', usage: { prompt_tokens: 100, total_tokens: 100 } };
const options = accounting => ({ body: { input: 'fixture', model: 'fixture-embedding' }, modelInfo: { provider: 'openai', model: 'fixture-embedding' }, credentials: { apiKey: 'dummy-provider' }, connectionId: 'c', accounting });
beforeEach(async () => {
  vi.resetModules(); network.mockReset(); vi.stubGlobal('fetch', network);
  directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-queued-embedding-')); process.env.DATA_DIR = directory; delete global._dbAdapter;
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }], settings: { requireApiKey: true },
    providerConnections: [{ id: 'c', provider: 'openai', authType: 'apikey', apiKey: 'dummy-provider' }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','openai',?)", [JSON.stringify({ 'fixture-embedding': { input: '0.02', output: '0' } })]);
  });
  createAccounting = () => import('@/lib/apiKeyBudget/requestAccounting.js').then(({ createRequestAccounting }) => createRequestAccounting(
    new Request('http://localhost/v1/embeddings', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true }));
});
afterEach(() => {
  vi.unstubAllGlobals(); vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true });
  if (old === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = old;
});
describe('queued native API-key embeddings prepared authority (mock POST not refresh/general adapters)', { timeout: 20000 }, () => {
  it('strict fixed embeddings POST sees own pending before exact2000 settlement', async () => {
    const context = await createAccounting();
    network.mockImplementation((url, init, _proxy, contract) => {
      expect(url).toBe('https://api.openai.com/v1/embeddings'); expect(init.method).toBe('POST'); expect(init.redirect).toBe('error');
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer dummy-provider');
      expect(JSON.parse(init.body)).toEqual({ model: 'fixture-embedding', input: 'fixture', encoding_format: 'float' });
      expect(contract).toMatchObject({ singlePost: true, embeddingsTransport: { model: 'fixture-embedding' } });
      expect(db.get('SELECT requestId,state FROM apiKeyAccounting')).toEqual({ requestId: context.requestId, state: 'pending' }); return Response.json(payload);
    });
    const result = await invoke(options(context)); expect(result.success).toBe(true); expect(await result.response.json()).toEqual(payload);
    expect(network).toHaveBeenCalledTimes(1); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: 2000 }); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('original embedding wire frozen before exposure drives actual headers/body', async () => {
    const context = await createAccounting(), args = options(context);
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      expect(wire?.protocol).toBe('native-embeddings'); expect(Object.isFrozen(wire)).toBe(true);
      expect(Reflect.set(wire.headers, 'authorization', 'Bearer dummy-foreign')).toBe(false);
      const work = context.beforeAttempt(meta, supported, wire); args.credentials.apiKey = 'dummy-foreign'; args.body.input = 'changed'; return work;
    } };
    network.mockImplementation((_url, init) => { expect(new Headers(init.headers).get('authorization')).toBe('Bearer dummy-provider'); expect(JSON.parse(init.body).input).toBe('fixture'); return Response.json(payload); });
    expect((await invoke({ ...args, accounting })).success).toBe(true); expect(network).toHaveBeenCalledTimes(1);
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: 2000 });
  });
  it('original programmable toJSON cannot erase unsupported metadata before admission', async () => {
    const context = await createAccounting(), args = options(context);
    const serialize = vi.fn(() => ({ model: 'fixture-embedding', input: 'fixture' }));
    Object.defineProperty(args.body, 'toJSON', { value: serialize });
    args.body.metadata = { unsupported: true };
    network.mockResolvedValue(Response.json(payload));
    await expect(invoke(args)).rejects.toThrow();
    expect(serialize).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
    expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('original input accessor is refused without executing before adapter transform', async () => {
    const context = await createAccounting(), args = options(context), read = vi.fn(() => 'fixture');
    Object.defineProperty(args.body, 'input', { get: read, enumerable: true });
    network.mockResolvedValue(Response.json(payload));
    await expect(invoke(args)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
    expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('direct queued owner refuses programmable actual body before serialization', async () => {
    const context = await createAccounting(), serialize = vi.fn(() => ({ model: 'fixture-embedding', input: 'fixture', encoding_format: 'float' }));
    const requestBody = { model: 'fixture-embedding', input: 'fixture', toJSON: serialize };
    await expect(handleAccountedEmbedding({ adapter: { accountingSchema: 'openai', normalize: value => value }, provider: 'openai', model: 'fixture-embedding',
      credentials: { apiKey: 'dummy-provider' }, originalBody: { model: 'fixture-embedding', input: 'fixture' }, requestBody,
      url: 'https://api.openai.com/v1/embeddings', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer dummy-provider' },
      accounting: context, connectionId: 'c' })).rejects.toThrow();
    expect(serialize).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
    expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['metadata', 'token-array', 'coerced-dimensions', 'credential-accessor', 'proxy'])('unsupported original %s refuses before POST/intent without programmable execution', async kind => {
    const context = await createAccounting(), args = options(context), trap = vi.fn(() => { throw new Error('Original trap must not run'); });
    if (kind === 'metadata') args.body.metadata = { unsupported: true };
    if (kind === 'token-array') args.body.input = [1, 2];
    if (kind === 'coerced-dimensions') args.body.dimensions = '10';
    if (kind === 'credential-accessor') Object.defineProperty(args.credentials, 'apiKey', { get: trap, enumerable: true });
    if (kind === 'proxy') args.body = new Proxy(args.body, { ownKeys: trap, get: trap, getPrototypeOf: trap });
    await expect(invoke(args)).rejects.toThrow();
    expect(trap).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
    expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('queue counts original plus actual100k bodies and refuses sixth pair', async () => {
    const context = await createAccounting(); network.mockImplementation(() => Response.json(payload));
    // Owner's queued-only transport import yields before admission. Concurrent
    // execute() calls do not guarantee concurrent queue occupancy: microtask
    // flushes are immediate, not a batch-size wait. Hold at the actual admission
    // boundary, then enqueue the six original wires in one turn, unchanged.
    const ready = [];
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      expect(wire?.protocol).toBe('native-embeddings');
      return new Promise((resolve, reject) => ready.push({ meta, supported, wire, resolve, reject }));
    } };
    const works = [];
    for (let i = 0; i < 6; i++) { const args = options(accounting); args.body.input = 'x'.repeat(100000); works.push(invoke(args)); }
    const rejected = expect(works[5]).rejects.toThrow();
    await vi.waitFor(() => expect(ready).toHaveLength(6));
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
    for (const entry of ready) context.beforeAttempt(entry.meta, entry.supported, entry.wire).then(entry.resolve, entry.reject);
    expect(await Promise.all(works.slice(0, 5))).toHaveLength(5); await rejected;
    expect(network).toHaveBeenCalledTimes(5);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual(Array.from({ length: 5 }, () => ({ state: 'settled', costNanoUsd: 2000 })));
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('original plus actual140k body pair exceeds command bound before intent', async () => {
    const args = options(await createAccounting()); args.body.input = 'x'.repeat(140000);
    await expect(invoke(args)).rejects.toThrow('Accounting Base transport unavailable');
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['credentials', 'headers', 'original-metadata', 'wire-input', 'config', 'settings', 'endpoint'])('original %s drift refuses before POST/intent/gap', async kind => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      expect(wire?.protocol).toBe('native-embeddings'); const changed = structuredClone(wire);
      if (kind === 'credentials') changed.credentials.apiKey = 'dummy-foreign';
      if (kind === 'headers') changed.headers.authorization = 'Bearer dummy-foreign';
      if (kind === 'original-metadata') { const body = JSON.parse(changed.embeddingsTransport.originalSerializedBody); body.metadata = {}; changed.embeddingsTransport.originalSerializedBody = JSON.stringify(body); }
      if (kind === 'wire-input') { const body = JSON.parse(changed.embeddingsTransport.serializedBody); body.input = 'changed'; changed.embeddingsTransport.serializedBody = JSON.stringify(body); }
      if (kind === 'config') changed.embeddingsTransport.mediaConfig.baseUrl = 'https://dummy-upstream.invalid/embeddings';
      if (kind === 'settings') db.durableTransaction(() => db.run('UPDATE settings SET data=? WHERE id=1', [JSON.stringify({ requireApiKey: true, providerOverrides: { openai: { headers: { Accept: 'application/json' } } } })]));
      return context.beforeAttempt(kind === 'endpoint' ? { ...meta, endpoint: 'chat' } : meta, supported, changed);
    } };
    await expect(invoke(options(accounting))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('persisted credential drift at dequeue refuses original embedding wire zeroPOST/intent/gap', async () => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      expect(wire?.protocol).toBe('native-embeddings'); const work = context.beforeAttempt(meta, supported, wire);
      db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']); db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(row.data), apiKey: 'dummy-new' }), 'c']); }); return work;
    } };
    await expect(invoke(options(accounting))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
});
