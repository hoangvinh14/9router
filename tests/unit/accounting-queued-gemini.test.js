import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { seedGeminiAccountingFixture } from './fixtures/accounting-gemini-db.js';

const network = vi.hoisted(() => vi.fn());
vi.mock('open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => network(...args) }));
vi.mock('../../src/lib/db/engineAcquisition.js', async importOriginal => {
  const original = await importOriginal();
  return process.env.ACCOUNTING_TEST_SQLJS === '1' ? { ...original, initializeAvailableAdapter: async () => null } : original;
});
let db, directory, createAccounting, DefaultExecutor;
const old = process.env.DATA_DIR;
const message = { modelVersion: 'fixture-gemini', candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'answer' }] } }],
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 130, cachedContentTokenCount: 40, thoughtsTokenCount: 10 } };
const options = accounting => ({ model: 'fixture-gemini', body: { model: 'fixture-gemini', stream: false, contents: [{ role: 'user', parts: [{ text: 'fixture' }] }] }, stream: false,
  credentials: { apiKey: 'dummy-provider' }, connectionId: 'c', accountingMode: 'native-gemini-json', accounting, proxyOptions: null });
beforeEach(async () => {
  const started = performance.now();
  const stage = name => { if (process.env.ACCOUNTING_TEST_SETUP_TRACE === '1') console.info('Gemini mock cold setup', name, Math.round(performance.now() - started)); };
  stage('start');
  network.mockReset(); vi.resetModules(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-queued-gemini-'));
  process.env.DATA_DIR = directory; delete global._dbAdapter;
  stage('disposable-directory');
  db = await (await import('@/lib/db/driver.js')).getAdapter(); stage('adapter-acquired');
  if (process.env.ACCOUNTING_TEST_SQLJS === '1') expect(db.driver).toBe('sql.js');
  seedGeminiAccountingFixture(db);
  stage('fixture-priced');
  ({ DefaultExecutor } = await import('open-sse/executors/default.js')); stage('executor-imported');
  createAccounting = () => import('@/lib/apiKeyBudget/requestAccounting.js').then(({ createRequestAccounting }) => createRequestAccounting(
    new Request('http://localhost/v1beta/models/gemini/fixture-gemini:generateContent', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true }));
});
afterEach(() => {
  vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true });
  if (old === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = old;
});
describe('queued Gemini API-key original prepared authority (mock POST, not OAuth/envelopes/general Gemini)', { timeout: 20000 }, () => {
  it('has its own pending intent at strict native POST then exact124000 settlement', async () => {
    const context = await createAccounting();
    network.mockImplementation((url, init, _proxy, contract) => {
      expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/fixture-gemini:generateContent');
      expect(init.method).toBe('POST'); expect(init.redirect).toBe('error'); expect(new Headers(init.headers).get('x-goog-api-key')).toBe('dummy-provider');
      expect(JSON.parse(init.body)).toEqual({ contents: options(context).body.contents });
      expect(contract).toMatchObject({ singlePost: true, geminiTransport: { model: 'fixture-gemini', mode: 'native-gemini-json' } });
      expect(db.get('SELECT requestId,state FROM apiKeyAccounting')).toEqual({ requestId: context.requestId, state: 'pending' });
      return Response.json(message);
    });
    const result = await new DefaultExecutor('gemini').execute(options(context));
    expect(await result.response.json()).toEqual(message); expect(network).toHaveBeenCalledTimes(1);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 124000 }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('original wire is frozen before exposure and actual POST ignores later input mutation', async () => {
    const context = await createAccounting(), args = options(context);
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      expect(wire?.protocol).toBe('native-gemini'); expect(Object.isFrozen(wire)).toBe(true);
      expect(Reflect.set(wire.headers, 'x-goog-api-key', 'dummy-foreign')).toBe(false);
      const work = context.beforeAttempt(meta, supported, wire); args.credentials.apiKey = 'dummy-foreign'; args.body.contents[0].parts[0].text = 'changed'; return work;
    } };
    network.mockImplementation((_url, init) => {
      expect(new Headers(init.headers).get('x-goog-api-key')).toBe('dummy-provider'); expect(JSON.parse(init.body).contents[0].parts[0].text).toBe('fixture'); return Response.json(message);
    });
    await new DefaultExecutor('gemini').execute({ ...args, accounting }); expect(network).toHaveBeenCalledTimes(1);
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: 124000 });
  });
  it.each(['original', 'missing', 'wrong'])('native SSE complete Accept header %s has exact mode equality', async kind => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      expect(wire.headers.accept).toBe('text/event-stream');
      const changed = structuredClone(wire);
      if (kind === 'missing') delete changed.headers.accept;
      if (kind === 'wrong') changed.headers.accept = 'application/json';
      return context.beforeAttempt(meta, supported, changed);
    } };
    network.mockImplementation((_url, init) => {
      expect(new Headers(init.headers).get('accept')).toBe('text/event-stream');
      return new Response(`data: ${JSON.stringify(message)}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    });
    const args = options(accounting); args.stream = args.body.stream = true; args.accountingMode = 'native-gemini-sse';
    if (kind === 'original') {
      const result = await new DefaultExecutor('gemini').execute(args); await result.response.text();
      expect(network).toHaveBeenCalledTimes(1); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: 124000 });
    } else {
      await expect(new DefaultExecutor('gemini').execute(args)).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
      expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
    }
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('original200k native bodies are charged to the queue ceiling, sixth refused', async () => {
    const context = await createAccounting(); network.mockImplementation(() => Response.json(message));
    const works = [];
    for (let i = 0; i < 6; i++) {
      const args = options(context); args.body.contents[0].parts[0].text = 'x'.repeat(200000);
      works.push(new DefaultExecutor('gemini').execute(args));
    }
    const rejected = expect(works[5]).rejects.toThrow();
    expect(await Promise.all(works.slice(0, 5))).toHaveLength(5); await rejected;
    expect(network).toHaveBeenCalledTimes(5);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual(Array.from({ length: 5 }, () => ({ state: 'settled', costNanoUsd: 124000 })));
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['credentials', 'headers', 'body-tools', 'body-model', 'config', 'settings', 'mode-url'])('original %s drift before capture refuses zeroPOST/intent/gap', async kind => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      const changed = structuredClone(wire);
      if (kind === 'credentials') changed.credentials.apiKey = 'dummy-foreign';
      if (kind === 'headers') changed.headers['x-goog-api-key'] = 'dummy-foreign';
      if (kind === 'body-tools' || kind === 'body-model') {
        const body = JSON.parse(changed.geminiTransport.serializedBody);
        if (kind === 'body-tools') body.tools = [{}]; else body.model = 'foreign-model';
        changed.geminiTransport.serializedBody = JSON.stringify(body);
      }
      if (kind === 'config') changed.geminiTransport.baseTransport.baseUrl = 'https://dummy-upstream.invalid/models';
      if (kind === 'mode-url') changed.geminiTransport.mode = 'native-gemini-sse';
      if (kind === 'settings') db.durableTransaction(() => db.run('UPDATE settings SET data=? WHERE id=1', [JSON.stringify({ requireApiKey: true, providerOverrides: { gemini: { headers: { Accept: 'application/json' } } } })]));
      return context.beforeAttempt(meta, supported, changed);
    } };
    await expect(new DefaultExecutor('gemini').execute(options(accounting))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('missing Gemini prepared wire is refused even for unlimited key, not silently queued', async () => {
    const context = await createAccounting();
    await expect(context.beforeAttempt({ provider: 'gemini', model: 'fixture-gemini', endpoint: 'chat', connectionId: 'c' }, true)).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('oversize original native body is refused before intent and POST', async () => {
    const args = options(await createAccounting()); args.body.contents[0].parts[0].text = 'x'.repeat(300000);
    await expect(new DefaultExecutor('gemini').execute(args)).rejects.toThrow('Accounting Base transport unavailable');
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('dequeue credential drift refuses original stale wire before POST/intent/gap', async () => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      expect(wire?.protocol).toBe('native-gemini');
      const work = context.beforeAttempt(meta, supported, wire);
      db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']);
        db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(row.data), apiKey: 'dummy-new' }), 'c']); }); return work;
    } };
    await expect(new DefaultExecutor('gemini').execute(options(accounting))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
});
