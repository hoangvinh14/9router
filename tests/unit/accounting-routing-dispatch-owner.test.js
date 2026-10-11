import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../../open-sse/config/providers.js', async original => ({ ...(await original()),
  PROVIDERS: { ...(await original()).PROVIDERS, openai: { baseUrl: 'http://fixture.invalid/chat' } } }));
vi.mock('undici', () => ({ ProxyAgent: class { constructor(options) { fixture.create(options); } },
  Agent: class { constructor(options) { fixture.create(options); } } }));
let db, directory, nativeFetch, BaseExecutor, context, catalog, previousCatalogSource;
const old = process.env.DATA_DIR;
// Cold transformation is setup, not an inference or hook deadline.
await import('../../open-sse/executors/base.js');
await import('@/lib/apiKeyBudget/requestAccounting.js');
beforeEach(async () => {
  previousCatalogSource = globalThis.__9rCatalogSource;
  fixture.create.mockReset(); vi.resetModules();
  directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-routing-dispatch-owner-'));
  process.env.DATA_DIR = directory; delete global._dbAdapter;
  nativeFetch = vi.fn(async () => Response.json({ choices: [{ message: { role: 'assistant', content: 'fixture' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }));
  vi.stubGlobal('fetch', nativeFetch);
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }],
    providerConnections: [{ id: 'c', provider: 'openai', authType: 'apikey', apiKey: 'dummy-provider' }],
    settings: { requireApiKey: true, outboundProxyEnabled: true, outboundProxyUrl: 'http://fixture-proxy.invalid:3210', outboundNoProxy: '' } });
  await (await import('@/lib/db/repos/combosRepo.js')).createCombo({ name: 'root', models: ['openai/fixture-chat'] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','openai',?)", [JSON.stringify({ 'fixture-chat': { input: '1', output: '2' } })]);
  });
  catalog = await import('../../open-sse/providers/catalogOverride.js');
  fs.writeFileSync(catalog.CATALOG_FILE, JSON.stringify({ v: 2, models: {}, providers: {} }));
  await catalog.installCatalogSource();
  context = await (await import('@/lib/apiKeyBudget/requestAccounting.js')).createRequestAccounting(
    new Request('http://localhost/v1/chat/completions', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true });
  await context.captureRoutingGraph('root', async token => token === 'root'
    ? { id: 'root', kind: 'fallback', models: ['openai/fixture-chat'], evidence: {} }
    : { id: token, kind: 'leaf', provider: 'openai', model: 'fixture-chat', evidence: {} });
  ({ BaseExecutor } = await import('../../open-sse/executors/base.js'));
});
afterEach(() => {
  if (previousCatalogSource === undefined) delete globalThis.__9rCatalogSource;
  else globalThis.__9rCatalogSource = previousCatalogSource;
  vi.unstubAllGlobals(); vi.restoreAllMocks(); db?.close(); delete global._dbAdapter;
  fs.rmSync(directory, { recursive: true, force: true });
  if (old === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = old;
});
const args = accounting => ({ model: 'fixture-chat', body: { messages: [{ role: 'user', content: 'fixture' }] }, stream: false,
  credentials: { apiKey: 'dummy-provider' }, connectionId: 'c', accounting,
  proxyOptions: { persistedGlobalProxy: { url: 'http://fixture-proxy.invalid:3210', noProxy: '' } } });

describe('actual queued Base routing owner/ledger after mocked dispatcher acquisition (not socket)', { timeout: 20000 }, () => {
  it.each(['unchanged', 'drift', 'lost-refusal-ack', 'catalog-drift', 'lost-catalog-refusal-ack'])('own terminal path after dispatcher boundary: %s', async mode => {
    let attempt, enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const lost = new Error('Fixture lost routing refusal completion ACK');
    const completions = [];
    const accounting = { ...context,
      async beforeAttempt(...input) { attempt = await context.beforeAttempt(...input); return attempt; },
      async completeAttempt(h, completion) {
        completions.push({ id: h.attemptId, completion });
        const terminal = await context.completeAttempt(h, completion);
        if (mode !== 'unchanged') { enter(); await held; if (mode.startsWith('lost-')) throw lost; }
        return terminal;
      } };
    fixture.create.mockImplementation(() => {
      expect(attempt).toBeTruthy();
      expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [attempt.attemptId]).state).toBe('pending');
      if (mode.includes('catalog')) fs.writeFileSync(catalog.CATALOG_FILE, JSON.stringify({ v: 2,
        models: { 'openai:fixture-chat': { vision: true } }, providers: {} }));
      else if (mode !== 'unchanged') db.durableTransaction(() => db.run('UPDATE combos SET models=? WHERE name=?', ['["openai/changed"]', 'root']));
    });
    const ex = new BaseExecutor('openai', { baseUrl: 'http://fixture.invalid/chat', timeoutMs: 2000,
      retry: { 502: { attempts: 2, delayMs: 0 } } });
    let returned = false;
    const observed = ex.execute(args(accounting)).then(value => ({ value }), error => ({ error })).then(result => { returned = true; return result; });
    try {
      if (mode !== 'unchanged') {
        expect(await Promise.race([entered.then(() => null), observed])).toBeNull();
        expect(returned).toBe(false); expect(nativeFetch).not.toHaveBeenCalled();
        expect(completions).toEqual([{ id: attempt.attemptId, completion: { notDispatched: true, outcome: 'routing_refused' } }]);
        expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [attempt.attemptId]))
          .toEqual({ state: 'not_dispatched', costNanoUsd: null });
      }
      release(); const result = await observed;
      if (mode === 'unchanged') {
        expect(result.error).toBeUndefined(); expect(result.value.response.ok).toBe(true); expect(nativeFetch).toHaveBeenCalledTimes(1);
        expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [attempt.attemptId]))
          .toEqual({ state: 'settled', costNanoUsd: 200000 });
      } else {
        if (mode.startsWith('lost-')) expect(result.error).toBe(lost);
        else expect(result.error).toMatchObject({ code: 'api_key_accounting_unavailable' });
        expect(nativeFetch).not.toHaveBeenCalled();
      }
      expect(fixture.create).toHaveBeenCalledTimes(1); expect(completions).toHaveLength(1);
      expect(db.all('SELECT attemptId,requestId FROM apiKeyAccounting')).toEqual([{ attemptId: attempt.attemptId, requestId: context.requestId }]);
      expect(db.coverage.status('a').gaps).toHaveLength(0);
    } finally { release(); await observed; }
  });
});
