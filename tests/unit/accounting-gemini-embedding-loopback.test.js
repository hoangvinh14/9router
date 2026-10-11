import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ base: null, dispatcherHook: null, dispatchers: [], ordinary: vi.fn(), legacyOff: false, legacyCredentials: null, contextHook: null }));
// Fixture delivery faults occur after real service writes, before delivery to
// the issued request context. Request-origin issuance remains production code.
vi.mock('@/lib/apiKeyBudget/service.js', async original => {
  const actual = await original();
  return { ...actual, async createBudgetContext(...args) {
    const context = await actual.createBudgetContext(...args);
    return fixture.contextHook ? fixture.contextHook(context) : context;
  } };
});
// Public canonical-accounted path must bypass legacy control-plane callbacks.
vi.mock('@/lib/localDb', () => ({ getSettings: (...args) => fixture.legacyOff ? { requireApiKey: true } : fixture.ordinary(...args) }));
vi.mock('../../src/sse/services/auth.js', () => ({ extractApiKey: request => request.headers.get('authorization')?.slice(7),
  isValidApiKey: (...args) => fixture.legacyOff ? true : fixture.ordinary(...args), getProviderCredentials: (...args) => fixture.legacyOff ? fixture.legacyCredentials : fixture.ordinary(...args),
  markAccountUnavailable: (...args) => fixture.ordinary(...args), clearAccountError: (...args) => fixture.legacyOff ? undefined : fixture.ordinary(...args) }));
vi.mock('../../src/sse/services/model.js', () => ({ getModelInfo: (...args) => fixture.legacyOff ? { provider: 'gemini', model: 'gemini-embedding-001' } : fixture.ordinary(...args) }));
vi.mock('../../src/sse/services/tokenRefresh.js', () => ({ updateProviderCredentials: (...args) => fixture.ordinary(...args), checkAndRefreshToken: (...args) => fixture.legacyOff ? args[1] : fixture.ordinary(...args) }));
vi.mock('../../src/sse/utils/logger.js', () => ({ request: (...args) => fixture.ordinary(...args), debug: (...args) => fixture.ordinary(...args),
  info: (...args) => fixture.ordinary(...args), warn: (...args) => fixture.ordinary(...args), error: (...args) => fixture.ordinary(...args), maskKey: () => 'fixture-mask' }));
// Keep real undici dispatcher acquisition; only inject a fixture SQL mutation
// inside construction, after pre-acquisition guards and before await resumes.
vi.mock('undici', async original => {
  const actual = await original();
  return { ...actual, ProxyAgent: class extends actual.ProxyAgent {
    constructor(options) {
      super(options); fixture.dispatchers.push(this);
      fixture.dispatcherHook?.();
    }
  } };
});
const fixtureEngine = process.env.GEMINI_EMBED_FIXTURE_ENGINE;
if (fixtureEngine !== undefined && !['node:sqlite', 'sql.js'].includes(fixtureEngine)) throw new Error('Unsupported Gemini embedding fixture engine');
// Select before DB open only; actual SQL.js ownership, migration and durability
// remain production code. This is not runtime fallback authorization.
vi.mock('@/lib/db/engineAcquisition.js', async original => {
  const actual = await original(); return { ...actual, initializeAvailableAdapter(...args) {
    if (process.env.GEMINI_EMBED_FIXTURE_ENGINE === 'sql.js') return null;
    return actual.initializeAvailableAdapter(...args);
  } };
});
// Test-only fixed-candidate AND registry replacement. Native fetch and service
// remain real; never production URL override or persisted credential proof.
vi.mock('../../open-sse/config/accountedGeminiCandidate.js', async original => {
  const actual = await original(); return { ...actual, get ACCOUNTED_GEMINI_BASE() { return fixture.base; } };
});
vi.mock('../../open-sse/providers/index.js', async original => {
  const actual = await original(); return { ...actual, PROVIDER_MEDIA: { ...actual.PROVIDER_MEDIA,
    get gemini() { return { ...actual.PROVIDER_MEDIA.gemini, embeddingConfig: { ...actual.PROVIDER_MEDIA.gemini.embeddingConfig, baseUrl: fixture.base } }; } } };
});
// Legacy adapter has a literal base, so also replace ONLY its URL builder in
// this owned fixture. Never permit an accidental live provider request.
vi.mock('../../open-sse/handlers/embeddingProviders/gemini.js', async original => {
  const actual = await original(); return { ...actual, default: { ...actual.default,
    buildUrl(model, credentials, ctx) {
      const source = new URL(actual.default.buildUrl(model, credentials, ctx));
      return `${fixture.base}/${model}${source.pathname.slice(source.pathname.indexOf(':'))}${source.search}`;
    } } };
});
// Module-only transformation outside hook timing. No DB acquisition, health,
// network, ledger or inference warm-up; fresh current modules are used below.
await Promise.all([import('../../open-sse/handlers/embeddingsCore.js'), import('@/lib/db/adapters/sqljsAdapter.js')]);
function latch() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
let directory, db, server, serverWork, owners, requests, serverFailure, respond, core, createContext, setupWork;
const oldData = process.env.DATA_DIR;
async function setupFixture() {
  const started = performance.now();
  const phase = label => { if (process.env.GEMINI_EMBED_SETUP_TIMING === '1') console.info('[GeminiEmbedSetup]', label, Math.round(performance.now() - started)); };
  phase('start');
  vi.resetModules();
  fixture.dispatcherHook = null; fixture.dispatchers = []; fixture.legacyOff = false; fixture.legacyCredentials = null; fixture.contextHook = null;
  fixture.ordinary.mockReset().mockImplementation(() => { throw new Error('Fixture legacy entry seam forbidden'); });
  owners = []; serverWork = []; db = null; server = null;
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']) vi.stubEnv(key, '');
  directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-native-gemini-embedding-'));
  process.env.DATA_DIR = directory; delete global._dbAdapter;
  const { getAdapter } = await import('@/lib/db/driver.js'); phase('driver-module');
  db = await getAdapter(); phase('db-acquired');
  if (fixtureEngine !== undefined) expect(db.driver).toBe(fixtureEngine);
  const { importDb } = await import('@/lib/db/index.js'); phase('db-barrel-module');
  await importDb({ apiKeys: [{ id: 'key-a', key: 'fixture-gateway' }, { id: 'key-b', key: 'fixture-gateway-b' }],
    settings: { requireApiKey: true }, providerConnections: [{ id: 'connection-a', provider: 'gemini', authType: 'apikey', apiKey: 'fixture-upstream' }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','gemini',?)", [JSON.stringify({ 'gemini-embedding-001': { input: '1' } })]);
  });
  phase('seeded');
  requests = []; serverWork = []; owners = []; serverFailure = null;
  respond = async (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ embedding: { values: [0.1, 0.2, 0.3] }, usageMetadata: { promptTokenCount: 10 } })); };
  server = http.createServer((request, response) => {
    const work = (async () => {
      try {
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        // Never retain query-key URLs/headers in logs or artifact inventories.
        const parsed = new URL(request.url, 'http://fixture.invalid');
        requests.push({ method: request.method, path: parsed.pathname, correctKey: parsed.searchParams.get('key') === 'fixture-upstream',
          body: JSON.parse(Buffer.concat(chunks).toString()), rows: db.all('SELECT requestId,attemptId,state FROM apiKeyAccounting') });
        await respond(request, response);
      } catch (error) { serverFailure = error; response.writeHead(500); response.end(); }
    })(); serverWork.push(work);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  fixture.base = `http://127.0.0.1:${server.address().port}/v1beta/models`; phase('server-listening');
  ({ handleEmbeddingsCore: core } = await import('../../open-sse/handlers/embeddingsCore.js'));
  phase('core-module');
  const { createRequestAccounting } = await import('@/lib/apiKeyBudget/requestAccounting.js'); phase('context-module');
  createContext = (signal, credential = 'fixture-gateway') => createRequestAccounting(new Request('http://localhost/v1/embeddings', { headers: { Authorization: `Bearer ${credential}` }, signal }), { adapter: async () => db });
}
beforeEach(async () => {
  setupWork = setupFixture();
  // Observe setup immediately. Hook timeout must not let teardown close resources
  // while a still-running module import subsequently creates a native owner.
  setupWork.catch(() => {});
  await setupWork;
});
afterEach(async () => {
  await setupWork?.catch(() => {});
  for (let index = 0; index < owners.length; index++) await owners[index];
  for (let index = 0; index < serverWork.length; index++) await serverWork[index];
  server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve));
  fixture.dispatcherHook = null;
  for (const dispatcher of fixture.dispatchers) await dispatcher.close();
  vi.restoreAllMocks(); vi.unstubAllEnvs(); db?.close(); delete global._dbAdapter;
  fs.rmSync(directory, { recursive: true, force: true });
  if (oldData === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = oldData;
});
function start(accounting, signal, proxyOptions = { persistedGlobalProxy: { url: 'http://127.0.0.1:1', noProxy: '127.0.0.1' } }) {
  const work = core({ body: { model: 'gemini/gemini-embedding-001', input: 'fixture native original', dimensions: 3 },
    modelInfo: { provider: 'gemini', model: 'gemini-embedding-001' }, credentials: { apiKey: 'fixture-upstream' },
    proxyOptions,
    connectionId: 'connection-a', signal, accounting: { ...accounting, requiresGeminiEmbeddingsWire: true } }).then(value => ({ value }), error => ({ error }));
  owners.push(work); return work;
}
describe('Gemini embedding owned HTTP real service, not TLS/power loss', { timeout: 20000 }, () => {
  it.each(['delivered', 'held-terminal', 'lost-terminal', 'lost-intent', 'post-admission-drift', 'cancel-held-terminal', 'budget-crossing'])('internal queued native owner retains own delivery/authority: %s', async mode => {
    const positiveContext = await createContext(); expect((await start(positiveContext)).value.success).toBe(true); expect(requests).toHaveLength(1);
    db.durableTransaction(() => db.run('UPDATE settings SET data=? WHERE id=1', [JSON.stringify({ requireApiKey: true,
      outboundProxyEnabled: true, outboundProxyUrl: 'http://127.0.0.1:1', outboundNoProxy: '127.0.0.1' })]));
    if (mode === 'budget-crossing') db.durableTransaction(() => db.run('INSERT INTO apiKeyBudgetPolicies(apiKeyId,weeklyLimitNanoUsd,monthlyLimitNanoUsd,version,updatedAt) VALUES(?,?,?,?,?)', ['key-a', 15000, null, 1, '2026-10-03T00:00:00.000Z']));
    const controller = new AbortController();
    const entered = latch(), held = latch(), lost = new Error('fixture-private-queued-delivery');
    let attempt, completions = 0, returned = false;
    fixture.contextHook = context => ({ ...context, async beginAttemptQueued(...args) {
      attempt = await context.beginAttemptQueued(...args);
      if (mode === 'lost-intent') { entered.resolve(); throw lost; }
      if (mode === 'post-admission-drift') db.durableTransaction(() => db.run('UPDATE settings SET data=? WHERE id=1',
        [JSON.stringify({ requireApiKey: true, outboundProxyEnabled: true, outboundProxyUrl: 'http://changed.invalid:3210' })]));
      return attempt;
    }, async completeAttemptQueued(...args) {
      const terminal = await context.completeAttemptQueued(...args); completions++; entered.resolve();
      if (['held-terminal', 'lost-terminal', 'cancel-held-terminal'].includes(mode)) await held.promise;
      if (mode === 'lost-terminal') throw lost;
      return terminal;
    } });
    const { createRequestAccounting } = await import('@/lib/apiKeyBudget/requestAccounting.js');
    const { bindQueuedGeminiEmbeddingAccounting } = await import('@/lib/apiKeyBudget/queuedGeminiEmbeddingAccounting.js');
    const { captureAccountingProxyEnvironment } = await import('../../open-sse/config/accountedProxyEnvironment.js');
    const { PROVIDER_MEDIA } = await import('../../open-sse/providers/index.js');
    const adapter = (await import('../../open-sse/handlers/embeddingProviders/gemini.js')).default;
    const context = await createRequestAccounting(new Request('http://localhost/v1/embeddings', { headers: { Authorization: 'Bearer fixture-gateway' }, signal: controller.signal }), { adapter: async () => db, queued: true });
    const original = { model: 'gemini-embedding-001', input: 'fixture native original', dimensions: 3 }, credentials = { apiKey: 'fixture-upstream' };
    const actual = adapter.buildBody(original.model, original), proxyOptions = { persistedGlobalProxy: { url: 'http://127.0.0.1:1', noProxy: '127.0.0.1' } };
    const image = { model: original.model, original, actual, credentials, mediaConfig: PROVIDER_MEDIA.gemini.embeddingConfig,
      headers: adapter.buildHeaders(credentials), url: adapter.buildUrl(original.model, credentials, { input: original.input }), serialized: JSON.stringify(actual), proxyOptions };
    const preparedWire = { protocol: 'native-gemini-embeddings', geminiEmbeddingTransport: image, proxyEnvironment: captureAccountingProxyEnvironment() };
    const bound = bindQueuedGeminiEmbeddingAccounting({ db, credential: 'fixture-gateway', accounting: context, connectionId: 'connection-a', wire: preparedWire });
    const ordinaryRespond = respond;
    if (mode === 'delivered') respond = async (request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='gemini'", [JSON.stringify({ 'gemini-embedding-001': { input: '9' } })]));
      await ordinaryRespond(request, response);
    };
    const work = start(bound, controller.signal); const observed = work.then(result => { returned = true; return result; }); owners.push(observed);
    try {
      if (['held-terminal', 'lost-terminal', 'cancel-held-terminal'].includes(mode)) {
        expect(await Promise.race([entered.promise.then(() => null), observed])).toBeNull(); expect(returned).toBe(false);
        expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [attempt.attemptId])).toEqual({ state: 'settled', costNanoUsd: 10000 });
        if (mode === 'cancel-held-terminal') controller.abort(false);
      }
      held.resolve(); const result = await observed;
      const row = db.get('SELECT requestId,state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [attempt.attemptId]);
      expect(row.requestId).toBe(context.requestId);
      if (mode === 'lost-intent') { expect(result.error).toBe(lost); expect(row.state).toBe('pending'); expect(completions).toBe(0); }
      else if (mode === 'post-admission-drift') {
        expect(result.error).toMatchObject({ code: 'api_key_accounting_unavailable' }); expect(row.state).toBe('not_dispatched');
        expect(db.get('SELECT outcome FROM apiKeyAccounting WHERE attemptId=?', [attempt.attemptId])).toEqual({ outcome: 'routing_refused' }); expect(completions).toBe(1);
      } else {
        if (mode === 'lost-terminal') expect(result.error).toBe(lost);
        else if (mode === 'cancel-held-terminal') expect(result.error).toBe(false);
        else { expect(result.error).toBeUndefined(); expect(result.value.success).toBe(true); }
        expect(row.state).toBe('settled'); expect(row.costNanoUsd).toBe(10000); expect(completions).toBe(1);
        expect(requests[1].rows).toContainEqual({ requestId: context.requestId, attemptId: attempt.attemptId, state: 'pending' });
      }
      expect(requests).toHaveLength(['lost-intent', 'post-admission-drift'].includes(mode) ? 1 : 2);
      if (mode === 'cancel-held-terminal') expect(db.get('SELECT outcome FROM apiKeyAccounting WHERE attemptId=?', [attempt.attemptId])).toEqual({ outcome: 'success' });
      if (mode === 'budget-crossing') {
        expect(db.get('SELECT SUM(costNanoUsd) AS spend FROM apiKeyAccounting WHERE apiKeyId=?', ['key-a'])).toEqual({ spend: 20000 });
        const nextContext = await createRequestAccounting(new Request('http://localhost/v1/embeddings', { headers: { Authorization: 'Bearer fixture-gateway' } }), { adapter: async () => db, queued: true });
        let nextError;
        try { const next = bindQueuedGeminiEmbeddingAccounting({ db, credential: 'fixture-gateway', accounting: nextContext, connectionId: 'connection-a', wire: preparedWire }); nextError = (await start(next)).error; } catch (error) { nextError = error; }
        expect(nextError).toMatchObject({ code: 'api_key_budget_exceeded' });
        expect(requests).toHaveLength(2); expect(completions).toBe(1);
        expect(db.all('SELECT * FROM apiKeyAccounting WHERE requestId=?', [nextContext.requestId])).toHaveLength(0);
      }
      expect(fixture.ordinary).not.toHaveBeenCalled(); expect(serverFailure).toBeNull();
    } finally { held.resolve(); await observed; }
  });
  it.each(['server-receipt', 'held-terminal'])('public cancellation false preserves original owner terminal: %s', async mode => {
    const positiveContext = await createContext(); expect((await start(positiveContext)).value.success).toBe(true); expect(requests).toHaveLength(1);
    db.durableTransaction(() => db.run('UPDATE settings SET data=? WHERE id=1', [JSON.stringify({ requireApiKey: true,
      outboundProxyEnabled: true, outboundProxyUrl: 'http://127.0.0.1:1', outboundNoProxy: '127.0.0.1' })]));
    const controller = new AbortController(), entered = latch(), held = latch();
    let attempt, requestId, completions = 0, returned = false;
    fixture.contextHook = context => {
      requestId = context.requestId;
      return { ...context, beginAttempt(...args) { attempt = context.beginAttempt(...args); return attempt; }, async completeAttempt(...args) {
        const terminal = context.completeAttempt(...args); completions++;
        if (mode === 'held-terminal') { entered.resolve(); await held.promise; }
        return terminal;
      } };
    };
    if (mode === 'server-receipt') respond = async (_request, response) => {
      entered.resolve(); await held.promise; response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ embedding: { values: [0.1, 0.2, 0.3] }, usageMetadata: { promptTokenCount: 10 } }));
    };
    const { handleEmbeddings } = await import('../../src/sse/handlers/embeddings.js');
    const work = handleEmbeddings(new Request('http://localhost/v1/embeddings', { method: 'POST', signal: controller.signal,
      headers: { Authorization: 'Bearer fixture-gateway' }, body: JSON.stringify({ model: 'gemini/gemini-embedding-001', input: 'fixture native original', dimensions: 3 }) }))
      .then(response => ({ response }), error => ({ error }));
    const observed = work.then(result => { returned = true; return result; }); owners.push(observed);
    try {
      expect(await Promise.race([entered.promise.then(() => null), observed])).toBeNull(); expect(returned).toBe(false);
      expect(requests).toHaveLength(2);
      expect(requests[1].rows).toContainEqual({ requestId, attemptId: attempt.attemptId, state: 'pending' });
      const before = db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE requestId=? AND attemptId=?', [requestId, attempt.attemptId]);
      expect(before).toEqual(mode === 'held-terminal' ? { state: 'settled', costNanoUsd: 10000 } : { state: 'pending', costNanoUsd: null });
      controller.abort(false); held.resolve(); const result = await observed; expect(result.error).toBe(false);
      while (serverWork.length) await Promise.all(serverWork.splice(0));
      const terminal = db.get('SELECT state,costNanoUsd,outcome FROM apiKeyAccounting WHERE requestId=? AND attemptId=?', [requestId, attempt.attemptId]);
      expect(terminal).toEqual(mode === 'held-terminal' ? { state: 'settled', costNanoUsd: 10000, outcome: 'success' } :
        { state: 'unresolved', costNanoUsd: null, outcome: 'aborted' });
      expect(completions).toBe(1); expect(requests).toHaveLength(2); expect(fixture.ordinary).not.toHaveBeenCalled(); expect(serverFailure).toBeNull();
    } finally { held.resolve(); await observed; }
  });
  it.each(['held-terminal', 'lost-terminal', 'lost-intent'])('public own ACK delivery is not durable row observation: %s', async mode => {
    const positiveContext = await createContext(); expect((await start(positiveContext)).value.success).toBe(true); expect(requests).toHaveLength(1);
    db.durableTransaction(() => db.run('UPDATE settings SET data=? WHERE id=1', [JSON.stringify({ requireApiKey: true,
      outboundProxyEnabled: true, outboundProxyUrl: 'http://127.0.0.1:1', outboundNoProxy: '127.0.0.1' })]));
    const entered = latch(), held = latch(), lost = new Error('fixture-private-own-delivery-error');
    let attempt, completions = 0, returned = false, requestId;
    fixture.contextHook = context => {
      requestId = context.requestId;
      return { ...context, beginAttempt(...args) {
        attempt = context.beginAttempt(...args);
        if (mode === 'lost-intent') { entered.resolve(); throw lost; }
        return attempt;
      }, async completeAttempt(...args) {
        const terminal = context.completeAttempt(...args); completions++;
        entered.resolve(); await held.promise;
        if (mode === 'lost-terminal') throw lost;
        return terminal;
      } };
    };
    const { handleEmbeddings } = await import('../../src/sse/handlers/embeddings.js');
    const work = handleEmbeddings(new Request('http://localhost/v1/embeddings', { method: 'POST', headers: { Authorization: 'Bearer fixture-gateway' },
      body: JSON.stringify({ model: 'gemini/gemini-embedding-001', input: 'fixture native original', dimensions: 3 }) })).then(response => ({ response }), error => ({ error }));
    const observed = work.then(result => { returned = true; return result; }); owners.push(observed);
    try {
      expect(await Promise.race([entered.promise.then(() => null), observed])).toBeNull();
      const row = db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE requestId=? AND attemptId=?', [requestId, attempt.attemptId]);
      expect(row).toEqual(mode === 'lost-intent' ? { state: 'pending', costNanoUsd: null } : { state: 'settled', costNanoUsd: 10000 });
      if (mode !== 'lost-intent') expect(returned).toBe(false);
      expect(requests).toHaveLength(mode === 'lost-intent' ? 1 : 2); expect(completions).toBe(mode === 'lost-intent' ? 0 : 1);
      held.resolve(); const result = await observed;
      if (mode === 'held-terminal') { expect(result.error).toBeUndefined(); expect(result.response.status).toBe(200); }
      else expect(result.error).toBe(lost);
      expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE requestId=? AND attemptId=?', [requestId, attempt.attemptId])).toEqual(row);
      expect(requests).toHaveLength(mode === 'lost-intent' ? 1 : 2); expect(completions).toBe(mode === 'lost-intent' ? 0 : 1);
      expect(fixture.ordinary).not.toHaveBeenCalled(); expect(serverFailure).toBeNull();
    } finally { held.resolve(); await observed; }
  });
  it.each(['/v1/embeddings', '/api/v1/embeddings'])('public OFF compatibility at %s keeps legacy handoff without activation or accounting intent', async route => {
    const positiveContext = await createContext(); expect((await start(positiveContext)).value.success).toBe(true); expect(requests).toHaveLength(1);
    const before = db.all('SELECT requestId,attemptId,state,costNanoUsd FROM apiKeyAccounting');
    db.durableTransaction(() => db.run("DELETE FROM _meta WHERE key='ledgerStartedAt'"));
    fixture.legacyOff = true; fixture.legacyCredentials = { apiKey: 'fixture-upstream', connectionId: 'connection-a', connectionName: 'Fixture' };
    fixture.ordinary.mockImplementation(() => undefined);
    const { handleEmbeddings } = await import('../../src/sse/handlers/embeddings.js');
    const work = handleEmbeddings(new Request('http://localhost' + route, { method: 'POST', headers: { Authorization: 'Bearer fixture-gateway' },
      body: JSON.stringify({ model: 'gemini/gemini-embedding-001', input: 'fixture native original', dimensions: 3 }) }));
    owners.push(work.then(() => {}, () => {}));
    const response = await work; expect(response.status).toBe(200); expect(requests).toHaveLength(2);
    expect(fixture.ordinary).toHaveBeenCalled();
    expect(db.all('SELECT requestId,attemptId,state,costNanoUsd FROM apiKeyAccounting')).toEqual(before);
    expect(db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined(); expect(serverFailure).toBeNull();
  });
  it.each(['/v1/embeddings', '/api/v1/embeddings'])('public canonical accounted entry at %s owns native POST and bypasses legacy fallback', async route => {
    const { handleHealthyGeminiEmbeddingEntry } = await import('@/lib/apiKeyBudget/geminiEmbeddingEntry.js');
    db.durableTransaction(() => db.run('UPDATE settings SET data=? WHERE id=1', [JSON.stringify({ requireApiKey: true,
      outboundProxyEnabled: true, outboundProxyUrl: 'http://127.0.0.1:1', outboundNoProxy: '127.0.0.1' })]));
    const original = { model: 'gemini/gemini-embedding-001', input: 'fixture native original', dimensions: 3 };
    const caller = body => new Request('http://localhost' + route, { method: 'POST', headers: { Authorization: 'Bearer fixture-gateway' }, body: JSON.stringify(body) });
    const positive = handleHealthyGeminiEmbeddingEntry(caller(original), original, core, { adapter: async () => db });
    owners.push(positive.then(() => {}, () => {})); expect((await positive).status).toBe(200); expect(requests).toHaveLength(1);
    const before = db.all('SELECT requestId,attemptId FROM apiKeyAccounting');
    const { handleEmbeddings } = await import('../../src/sse/handlers/embeddings.js');
    const work = handleEmbeddings(caller(original)); owners.push(work.then(() => {}, () => {}));
    const response = await work; expect(response.status).toBe(200); expect(requests).toHaveLength(2);
    const ids = new Set(before.map(row => row.requestId));
    const rows = db.all('SELECT requestId,attemptId,state,costNanoUsd FROM apiKeyAccounting').filter(row => !ids.has(row.requestId));
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ state: 'settled', costNanoUsd: 10000 });
    expect(requests[1].rows.find(row => row.requestId === rows[0].requestId && row.attemptId === rows[0].attemptId)?.state).toBe('pending');
    const refusalWork = handleEmbeddings(caller({ ...original, privateUnsupported: 'fixture-private' })); owners.push(refusalWork.then(() => {}, () => {}));
    const refused = await refusalWork; expect(refused.status).toBe(503); expect(await refused.text()).not.toContain('fixture-private');
    expect(requests).toHaveLength(2); expect(fixture.ordinary).not.toHaveBeenCalled(); expect(serverFailure).toBeNull();
  });
  it.each(['delivered', 'off', 'original-extra', 'saved-disabled', 'round-robin', 'selection-before-core', 'mutate-after-capture'])('standalone healthy canonical entry owns selected original context: %s', async mode => {
    const positiveContext = await createContext(); expect((await start(positiveContext)).value.success).toBe(true);
    expect(requests).toHaveLength(1);
    const { handleHealthyGeminiEmbeddingEntry } = await import('@/lib/apiKeyBudget/geminiEmbeddingEntry.js');
    db.durableTransaction(() => {
      db.run('UPDATE settings SET data=? WHERE id=1', [JSON.stringify({ requireApiKey: true,
        outboundProxyEnabled: true, outboundProxyUrl: 'http://127.0.0.1:1', outboundNoProxy: '127.0.0.1' })]);
      if (mode === 'off') db.run("DELETE FROM _meta WHERE key='ledgerStartedAt'");
      if (mode === 'saved-disabled') db.run('UPDATE settings SET data=? WHERE id=1', [JSON.stringify({ requireApiKey: true, outboundProxyEnabled: false })]);
      if (mode === 'round-robin') db.run('UPDATE settings SET data=? WHERE id=1', [JSON.stringify({ requireApiKey: true, outboundProxyEnabled: true,
        outboundProxyUrl: 'http://127.0.0.1:1', outboundNoProxy: '127.0.0.1', fallbackStrategy: 'round-robin' })]);
    });
    const before = db.all('SELECT requestId,attemptId,state,costNanoUsd FROM apiKeyAccounting');
    const request = new Request('http://localhost/v1/embeddings', { method: 'POST', headers: { Authorization: 'Bearer fixture-gateway' } });
    const original = { model: 'gemini/gemini-embedding-001', input: 'fixture native original', dimensions: 3 };
    if (mode === 'original-extra') original.privateUnsupported = 'fixture-private';
    let invoked = false;
    const invoke = options => {
      invoked = true;
      if (mode === 'selection-before-core') db.durableTransaction(() => {
        const row = db.get('SELECT * FROM providerConnections WHERE id=?', ['connection-a']);
        db.run('INSERT INTO providerConnections(id,provider,authType,name,email,priority,isActive,data,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?)',
          ['connection-preferred', row.provider, row.authType, row.name, row.email, 1, row.isActive, row.data, row.createdAt, row.updatedAt]);
      });
      return core(options);
    };
    const work = handleHealthyGeminiEmbeddingEntry(request, original, invoke, { adapter: async () => {
      if (mode === 'mutate-after-capture') { original.input = 'fixture-replacement'; original.model = 'gemini/other-model'; }
      return db;
    } }).then(response => ({ response }), error => ({ error }));
    owners.push(work);
    const { response, error } = await work;
    if (['original-extra', 'saved-disabled', 'round-robin', 'selection-before-core'].includes(mode)) {
      expect(error).toMatchObject({ code: mode === 'saved-disabled' ? 'model_accounting_unsupported' : 'api_key_accounting_unavailable' });
      expect(String(error)).not.toContain('fixture-private');
      expect(invoked).toBe(mode === 'selection-before-core'); expect(requests).toHaveLength(1);
      expect(db.all('SELECT requestId,attemptId,state,costNanoUsd FROM apiKeyAccounting')).toEqual(before);
    } else if (mode === 'off') {
      expect(error).toBeUndefined(); expect(invoked).toBe(false);
      expect(response).toBeNull(); expect(requests).toHaveLength(1);
      expect(db.all('SELECT requestId,attemptId,state,costNanoUsd FROM apiKeyAccounting')).toEqual(before);
    } else {
      expect(error).toBeUndefined(); expect(invoked).toBe(true);
      expect(requests[1].body.content.parts).toEqual([{ text: 'fixture native original' }]);
      expect(response.status).toBe(200); expect((await response.json()).usage).toEqual({ prompt_tokens: 10, total_tokens: 10 });
      expect(requests).toHaveLength(2);
      const rows = db.all('SELECT requestId,attemptId,state,costNanoUsd FROM apiKeyAccounting');
      const originalIds = new Set(before.map(row => row.requestId));
      const fresh = rows.filter(row => !originalIds.has(row.requestId));
      expect(fresh).toHaveLength(1); expect(fresh[0]).toMatchObject({ state: 'settled', costNanoUsd: 10000 });
      expect(requests[1].rows.find(row => row.requestId === fresh[0].requestId && row.attemptId === fresh[0].attemptId)?.state).toBe('pending');
    }
    expect(serverFailure).toBeNull();
  });
  it.each(['unchanged', 'budget-crossing', 'dispatcher-settings', 'selection-entry', 'selection-drift', 'context-key', 'context-copy', 'context-getter', 'credential', 'settings', 'key-binding'])('fresh persisted original authority at post-intent boundary: %s', async fault => {
    // Actual successful original POST first; refusal is not support delivery.
    const positiveContext = await createContext(); expect((await start(positiveContext)).value.success).toBe(true);
    expect(requests).toHaveLength(1);
    const { bindGeminiEmbeddingAccounting } = await import('@/lib/apiKeyBudget/geminiEmbeddingAccounting.js');
    const { default: adapter } = await import('../../open-sse/handlers/embeddingProviders/gemini.js');
    const { PROVIDER_MEDIA } = await import('../../open-sse/providers/index.js');
    const noProxy = fault === 'dispatcher-settings' ? '' : '127.0.0.1';
    db.durableTransaction(() => db.run('UPDATE settings SET data=? WHERE id=1', [JSON.stringify({ requireApiKey: true,
      outboundProxyEnabled: true, outboundProxyUrl: 'http://127.0.0.1:1', outboundNoProxy: noProxy })]));
    if (fault === 'budget-crossing') db.durableTransaction(() => db.run('INSERT INTO apiKeyBudgetPolicies(apiKeyId,weeklyLimitNanoUsd,monthlyLimitNanoUsd,version,updatedAt) VALUES(?,?,?,?,?)', ['key-a', 15000, null, 1, '2026-10-03T00:00:00.000Z']));
    const context = await createContext(undefined, fault === 'context-key' ? 'fixture-gateway-b' : 'fixture-gateway'), model = 'gemini-embedding-001', original = { model, input: 'fixture native original', dimensions: 3 }, credentials = { apiKey: 'fixture-upstream' };
    const actual = adapter.buildBody(model, original), image = { model, original, actual, credentials, mediaConfig: PROVIDER_MEDIA.gemini.embeddingConfig,
      headers: adapter.buildHeaders(credentials), url: adapter.buildUrl(model, credentials, { input: original.input }), serialized: JSON.stringify(actual),
      proxyOptions: { persistedGlobalProxy: { url: 'http://127.0.0.1:1', noProxy } } };
    const addPreferredConnection = () => {
      const row = db.get('SELECT * FROM providerConnections WHERE id=?', ['connection-a']);
      db.run('INSERT INTO providerConnections(id,provider,authType,name,email,priority,isActive,data,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?)',
        ['connection-preferred', row.provider, row.authType, row.name, row.email, 1, row.isActive, row.data, row.createdAt, row.updatedAt]);
    };
    if (fault === 'selection-entry') db.durableTransaction(addPreferredConnection);
    if (['selection-entry', 'context-key', 'context-copy', 'context-getter'].includes(fault)) {
      let reads = 0, failure;
      const supplied = ['selection-entry', 'context-key'].includes(fault) ? context : { ...context };
      if (fault === 'context-getter') Object.defineProperty(supplied, 'gate', { get() { reads++; throw new Error('fixture-private-origin-error'); } });
      try { bindGeminiEmbeddingAccounting({ db, credential: 'fixture-gateway', accounting: supplied, connectionId: 'connection-a', image }); } catch (error) { failure = error; }
      expect(failure).toMatchObject({ code: 'api_key_accounting_unavailable' });
      expect(String(failure)).not.toContain('fixture-private-origin-error'); expect(reads).toBe(0);
      expect(requests).toHaveLength(1);
      expect(db.all('SELECT * FROM apiKeyAccounting WHERE requestId=?', [context.requestId])).toHaveLength(0);
      expect(db.all('SELECT * FROM apiKeyAccounting WHERE apiKeyId=?', ['key-b'])).toHaveLength(0);
      return;
    }
    const bound = bindGeminiEmbeddingAccounting({ db, credential: 'fixture-gateway', accounting: context, connectionId: 'connection-a', image });
    const shouldDispatch = ['unchanged', 'budget-crossing'].includes(fault);
    let attempt, acquired = false; const completions = [];
    if (fault === 'dispatcher-settings') fixture.dispatcherHook = () => {
      expect(attempt).toBeTruthy();
      expect(db.get('SELECT state FROM apiKeyAccounting WHERE requestId=? AND attemptId=?', [context.requestId, attempt.attemptId])).toEqual({ state: 'pending' });
      acquired = true;
      db.durableTransaction(() => db.run('UPDATE settings SET data=? WHERE id=1', [JSON.stringify({ requireApiKey: true, outboundProxyEnabled: false })]));
    };
    const accounting = { ...bound, async beforeAttempt(...args) {
      attempt = await bound.beforeAttempt(...args);
      if (!shouldDispatch && fault !== 'dispatcher-settings') db.durableTransaction(() => {
        if (fault === 'credential') { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['connection-a']);
          db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(row.data), apiKey: 'fixture-changed' }), 'connection-a']); }
        else if (fault === 'selection-drift') addPreferredConnection();
        else if (fault === 'settings') db.run('UPDATE settings SET data=? WHERE id=1', [JSON.stringify({ requireApiKey: true, outboundProxyEnabled: false })]);
        else db.run('UPDATE apiKeyBindings SET retiredAt=? WHERE apiKeyId=?', ['2026-10-03T00:00:00.000Z', 'key-a']);
      }); return attempt;
    }, async completeAttempt(handle, completion) { const terminal = await bound.completeAttempt(handle, completion); completions.push({ handle, completion, terminal }); return terminal; } };
    const result = await start(accounting, undefined, image.proxyOptions);
    if (fault === 'dispatcher-settings') expect(acquired).toBe(true);
    if (shouldDispatch) { expect(result.error).toBeUndefined(); expect(result.value.success).toBe(true); }
    else expect(result.error).toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(requests).toHaveLength(shouldDispatch ? 2 : 1);
    expect(completions).toHaveLength(1); expect(completions[0].handle).toBe(attempt);
    if (shouldDispatch) expect(completions[0].completion).toMatchObject({ usage: { input: 10, output: 0 }, outcome: 'success' });
    else expect(completions[0].completion).toEqual({ notDispatched: true, outcome: 'routing_refused' });
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE requestId=? AND attemptId=?', [context.requestId, attempt.attemptId])).toEqual(shouldDispatch ? { state: 'settled', costNanoUsd: 10000 } : { state: 'not_dispatched', costNanoUsd: null });
    if (fault === 'budget-crossing') {
      const nextContext = await createContext(); let nextError;
      try { const next = bindGeminiEmbeddingAccounting({ db, credential: 'fixture-gateway', accounting: nextContext, connectionId: 'connection-a', image }); nextError = (await start(next)).error; } catch (error) { nextError = error; }
      expect(nextError).toMatchObject({ code: 'api_key_budget_exceeded' });
      expect(requests).toHaveLength(2);
      expect(db.all('SELECT * FROM apiKeyAccounting WHERE requestId=?', [nextContext.requestId])).toHaveLength(0);
    }
    expect(serverFailure).toBeNull();
  });
  it.each(['delivered', 'lost-terminal', 'lost-admission', 'failed-status', 'cancel-after-receipt'])('generation own durable ACK and native POST: %s', async mode => {
    const controller = new AbortController(), context = await createContext(controller.signal), entered = latch(), held = latch();
    const lost = new Error('Fixture own ACK delivery lost'); let attempt, returned = false; const completions = [];
    if (mode === 'cancel-after-receipt') respond = async (_request, response) => { entered.resolve(); await held.promise; response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ embedding: { values: [0.1, 0.2, 0.3] }, usageMetadata: { promptTokenCount: 10 } })); };
    else respond = async (_request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='gemini'", [JSON.stringify({ 'gemini-embedding-001': { input: '9' } })]));
      response.writeHead(mode === 'failed-status' ? 401 : 200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ embedding: { values: [0.1, 0.2, 0.3] }, usageMetadata: { promptTokenCount: 10 } }));
    };
    const accounting = { ...context,
      async beforeAttempt(...args) { attempt = await context.beforeAttempt(...args); if (mode === 'lost-admission') { entered.resolve(); await held.promise; throw lost; } return attempt; },
      async completeAttempt(handle, completion) {
        const terminal = await context.completeAttempt(handle, completion); completions.push({ handle, completion, terminal });
        if (mode !== 'cancel-after-receipt') { entered.resolve(); await held.promise; if (mode === 'lost-terminal') throw lost; }
        return terminal;
      } };
    const observed = start(accounting, controller.signal).then(result => { returned = true; return result; }); owners.push(observed);
    try {
      expect(await Promise.race([entered.promise.then(() => null), observed])).toBeNull(); expect(returned).toBe(false);
      expect(attempt).toBeTruthy(); expect(requests).toHaveLength(mode === 'lost-admission' ? 0 : 1);
      if (mode !== 'lost-admission') {
        expect(requests[0]).toMatchObject({ method: 'POST', path: '/v1beta/models/gemini-embedding-001:embedContent', correctKey: true,
          body: { model: 'models/gemini-embedding-001', content: { parts: [{ text: 'fixture native original' }] }, outputDimensionality: 3 } });
        expect(requests[0].rows.find(row => row.requestId === context.requestId && row.attemptId === attempt.attemptId)?.state).toBe('pending');
      }
      if (mode === 'cancel-after-receipt') controller.abort(false); else held.resolve();
      const result = await observed;
      if (mode === 'lost-admission' || mode === 'lost-terminal') expect(result.error).toBe(lost);
      else if (mode === 'cancel-after-receipt') expect(result.error).toBe(false);
      else { expect(result.error).toBeUndefined(); expect(result.value.success).toBe(mode !== 'failed-status'); }
      const row = db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE requestId=? AND attemptId=?', [context.requestId, attempt.attemptId]);
      expect(row).toEqual(mode === 'lost-admission' ? { state: 'pending', costNanoUsd: null } : mode === 'cancel-after-receipt' ? { state: 'unresolved', costNanoUsd: null } : { state: 'settled', costNanoUsd: 10000 });
      expect(completions).toHaveLength(mode === 'lost-admission' ? 0 : 1);
      if (completions.length) { expect(completions[0].handle).toBe(attempt); expect(completions[0].completion.outcome).toBe(mode === 'failed-status' ? 'failed' : mode === 'cancel-after-receipt' ? 'aborted' : 'success'); }
      const winner = completions[0]?.terminal; held.resolve();
      for (let index = 0; index < serverWork.length; index++) await serverWork[index];
      expect(requests).toHaveLength(mode === 'lost-admission' ? 0 : 1); expect(completions[0]?.terminal).toBe(winner);
      expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE requestId=? AND attemptId=?', [context.requestId, attempt.attemptId])).toEqual(row);
      expect(serverFailure).toBeNull();
    } finally { held.resolve(); await observed; for (let index = 0; index < serverWork.length; index++) await serverWork[index]; }
  });
});
