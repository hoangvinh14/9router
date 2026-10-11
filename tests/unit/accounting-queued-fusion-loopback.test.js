import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const registry = vi.hoisted(() => ({ url: null }));
// Explicit test-only engine selection BEFORE the app DB file is opened. Real
// driver/owner/migration/coverage and sql.js adapter remain unmocked.
vi.mock('@/lib/db/engineAcquisition.js', async original => {
  const actual = await original(); return { ...actual, initializeAvailableAdapter(...args) {
    if (process.env.FUSION_FIXTURE_ENGINE === 'sql.js') return null;
    return actual.initializeAvailableAdapter(...args);
  } };
});
vi.mock('../../open-sse/config/providers.js', async original => ({ ...(await original()),
  PROVIDERS: { ...(await original()).PROVIDERS, get openai() { return { baseUrl: registry.url }; } } }));
let db, directory, server, received, failure, BaseExecutor, handleFusionChat, context, handles, owners, nested, nestedDiagnostics, nestedRegeneration, regenerationCost, ownerTimings;
const previous = process.env.DATA_DIR;
const tlsDirectory = process.env.FUSION_TLS_FIXTURE_DIR;
const connectMode = process.env.FUSION_TLS_PROXY;
let connectProxy, connectUrl, tunnels, proxyFailure, proxySockets, healthRequests;
const savedProxy = () => ({ url: connectMode ? connectUrl : 'http://127.0.0.1:1', noProxy: connectMode ? '' : '127.0.0.1' });
function fixtureServer(listener) {
  if (!tlsDirectory) return http.createServer(listener);
  expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).not.toBe('0');
  expect(process.env.NODE_EXTRA_CA_CERTS).toBe(path.join(tlsDirectory, 'ca.pem'));
  return https.createServer({ key: fs.readFileSync(path.join(tlsDirectory, 'matching.key')),
    cert: fs.readFileSync(path.join(tlsDirectory, 'matching.pem')) }, listener);
}
const delta = 'data: {"choices":[{"index":0,"delta":{"content":"judge prefix"}}]}\n\n';
const terminal = 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n' +
  'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n\n' + 'data: [DONE]\n\n';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
// Cold module transformation is setup, not a storage or generation deadline.
// No DB is opened here; each timed hook still owns a new disposable DB/server.
await Promise.all([
  import('../../open-sse/executors/base.js'),
  import('../../open-sse/services/combo.js'),
  import('@/lib/db/adapters/sqljsAdapter.js'),
  import('@/sse/services/accountingRoutingResolver.js'),
  import('undici'),
]);
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-fusion-http-')); process.env.DATA_DIR = directory;
  delete global._dbAdapter; vi.resetModules(); handles = []; owners = []; received = []; failure = null; nested = false; nestedDiagnostics = []; nestedRegeneration = false; regenerationCost = 200000; ownerTimings = {};
  tunnels = 0; proxyFailure = null; proxySockets = new Set(); connectProxy = null; connectUrl = null; healthRequests = 0;
  if (connectMode !== undefined) {
    expect(connectMode).toBe('connect'); expect(tlsDirectory).toBeTruthy();
    connectProxy = http.createServer((_request, response) => { proxyFailure = new Error('Unexpected non-CONNECT fusion proxy request'); response.writeHead(405); response.end(); });
    const track = socket => { proxySockets.add(socket); socket.on('error', () => {}); socket.once('close', () => proxySockets.delete(socket)); };
    connectProxy.on('connection', track);
    connectProxy.on('connect', (request, socket, head) => {
      if (request.url !== `127.0.0.1:${server.address().port}`) { proxyFailure = new Error('Unexpected fusion CONNECT target'); socket.destroy(); return; }
      tunnels++;
      const remote = net.connect(server.address().port, '127.0.0.1'); track(remote);
      remote.once('connect', () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) remote.write(head); socket.pipe(remote); remote.pipe(socket); });
      socket.once('close', () => remote.destroy()); remote.once('close', () => socket.destroy());
    });
    await new Promise((resolve, reject) => { connectProxy.once('error', reject); connectProxy.listen(0, '127.0.0.1', resolve); });
    connectUrl = `http://127.0.0.1:${connectProxy.address().port}`;
  }
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  if (process.env.FUSION_FIXTURE_ENGINE !== undefined) {
    expect(['node:sqlite', 'sql.js']).toContain(process.env.FUSION_FIXTURE_ENGINE);
    expect(db.driver).toBe(process.env.FUSION_FIXTURE_ENGINE);
  }
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }],
    settings: { requireApiKey: true, outboundProxyEnabled: true, outboundProxyUrl: savedProxy().url, outboundNoProxy: savedProxy().noProxy },
    providerConnections: [{ id: 'c', provider: 'openai', authType: 'apikey', apiKey: 'dummy-provider', isActive: true }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','openai',?)", [JSON.stringify(Object.fromEntries(['fixture-a', 'fixture-b', 'fixture-c', 'fixture-inner-judge', 'fixture-judge'].map(m => [m, { input: '1', output: '2' }])))]);
  });
  server = fixtureServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/fixture-health') {
        healthRequests++; response.writeHead(204); response.end(); return;
      }
      const bytes = []; for await (const chunk of request) bytes.push(chunk);
      const body = JSON.parse(Buffer.concat(bytes).toString());
      const handle = handles.findLast(h => h.model === body.model); expect(handle).toBeTruthy();
      expect(request.method).toBe('POST'); expect(request.headers.authorization).toBe('Bearer dummy-provider'); expect(request.url).toBe('/chat');
      expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [handle.attemptId]).state).toBe('pending');
      if (body.model === 'fixture-judge' || body.model === 'fixture-inner-judge') {
        const predecessors = nested ? body.model === 'fixture-inner-judge' ? ['fixture-a', 'fixture-c'] : nestedRegeneration ? ['fixture-a', 'fixture-b'] : ['fixture-inner-judge', 'fixture-b'] : ['fixture-a', 'fixture-b'];
        for (const model of predecessors) {
          const h = handles.findLast(h => h.model === model); expect(h).toBeTruthy();
          expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId])).toEqual({ state: 'settled',
            costNanoUsd: nestedRegeneration && model === 'fixture-a' ? regenerationCost : 200000 });
          expect(body.messages.at(-1).content).toContain(model);
        }
        expect(body.messages.at(-1).content).toContain('=== PANEL RESPONSES ===');
      }
      received.push({ model: body.model, attemptId: handle.attemptId, body });
      if (body.model === 'fixture-judge' && body.stream) {
        expect(body.stream_options).toEqual({ include_usage: true });
        response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(delta + terminal); return;
      }
      response.writeHead(nestedRegeneration && body.model === 'fixture-c' ? 400 : 200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: body.model }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }));
    } catch (error) { failure = error; response.writeHead(500); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  registry.url = `${tlsDirectory ? 'https' : 'http'}://127.0.0.1:${server.address().port}/chat`; // Fixture candidate AND registry only.
  ({ BaseExecutor } = await import('../../open-sse/executors/base.js'));
  ({ handleFusionChat } = await import('../../open-sse/services/combo.js'));
  // Explicit diagnostic setup only: an owned non-inference GET warms the
  // actual dispatcher/TLS connection before the unchanged 1s collector.
  // It does not establish production cold-start performance or usage authority.
  if (process.env.FUSION_TLS_PREWARM !== undefined) {
    expect(process.env.FUSION_TLS_PREWARM).toBe('health'); expect(tlsDirectory).toBeTruthy(); expect(connectMode).toBe('connect');
    const { proxyAwareFetch } = await import('../../open-sse/utils/proxyFetch.js');
    const response = await proxyAwareFetch(new URL('/fixture-health', registry.url).href,
      { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(2000) }, { enabled: true, url: connectUrl, strictProxy: true });
    expect(response.status).toBe(204); expect(healthRequests).toBe(1); expect(received).toHaveLength(0);
    expect(db.all('SELECT attemptId FROM apiKeyAccounting')).toHaveLength(0);
  }
  context = await (await import('@/lib/apiKeyBudget/requestAccounting.js')).createRequestAccounting(new Request('http://localhost/v1/chat/completions', {
    headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true });
  if (process.env.FUSION_OWNER_TIMING !== undefined) {
    expect(process.env.FUSION_OWNER_TIMING).toBe('diagnostic');
    const original = context;
    const measure = (method, elapsed) => {
      const row = ownerTimings[method] ||= { calls: 0, milliseconds: 0, maximum: 0 };
      row.calls++; row.milliseconds += elapsed; row.maximum = Math.max(row.maximum, elapsed);
    };
    context = { ...original,
      assertRoutingCurrent(...args) { const start = performance.now(); try { return original.assertRoutingCurrent(...args); }
        finally { measure('routingCurrent', performance.now() - start); } },
      gate(...args) { const start = performance.now(); try { return original.gate(...args); }
        finally { measure('gate', performance.now() - start); } },
      async beforeAttempt(...args) { const start = performance.now(); try { return await original.beforeAttempt(...args); }
        finally { measure('beforeAttempt', performance.now() - start); } },
      async completeAttempt(...args) { const start = performance.now(); try { return await original.completeAttempt(...args); }
        finally { measure('completeAttempt', performance.now() - start); } }
    };
  }
});
afterEach(async () => {
  if (process.env.FUSION_OWNER_TIMING) console.info('Owned accounting timing diagnostic', JSON.stringify({
    driver: db?.driver, timings: ownerTimings, steps: nestedDiagnostics, postedModels: received.map(r => r.model),
    ownerErrors: (await Promise.all(owners)).filter(o => o.error).map(o => ({ name: o.error.name, code: o.error.code ?? null,
      causeName: o.error.cause?.name ?? null, causeCode: o.error.cause?.code ?? null })) }));
  if (connectMode) { expect(proxyFailure).toBeNull(); expect(tunnels).toBeGreaterThan(0); }
  for (const socket of proxySockets || []) socket.destroy();
  connectProxy?.closeAllConnections(); if (connectProxy?.listening) await new Promise(resolve => connectProxy.close(resolve));
  server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve));
  vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous;
});
function fusion(accounting, stream = false) {
  const executor = new BaseExecutor('openai', { baseUrl: registry.url, timeoutMs: 2000, retry: { 502: { attempts: 0, delayMs: 0 } } });
  const pending = handleFusionChat({ body: { stream, messages: [{ role: 'user', content: 'fixture original' }] },
    models: ['fixture-a', 'fixture-b'], judgeModel: 'fixture-judge', tuning: { minPanel: 2, stragglerGraceMs: 5, panelHardTimeoutMs: 1000 },
    accounting, log: { info() {}, warn() {} }, handleSingleModel(body, model, _panel, signal) {
      const work = executor.execute({ body: { ...body, model }, model, stream: body.stream,
        ...(body.stream ? { accountingMode: 'live-openai-sse' } : {}), credentials: { apiKey: 'dummy-provider' },
        connectionId: 'c', accounting, signal,
        proxyOptions: { persistedGlobalProxy: savedProxy() } })
        .then(result => { expect(result.accountingOwned).toBe(true); return result.response; });
      owners.push(work.then(response => ({ response }), error => ({ error }))); return work;
    } });
  return pending.then(response => ({ response }), error => ({ error }));
}
async function nestedFusion(accounting, stream = false) {
  nested = true;
  const { createCombo } = await import('@/lib/db/repos/combosRepo.js');
  await createCombo({ name: 'native-outer', models: ['native-left', 'openai/fixture-b'] });
  await createCombo({ name: 'native-left', models: ['openai/fixture-a', 'openai/fixture-c'] });
  await (await import('@/lib/db/repos/settingsRepo.js')).updateSettings({ comboStrategies: {
    'native-outer': { fallbackStrategy: 'fusion', judgeModel: 'openai/fixture-judge' },
    'native-left': { fallbackStrategy: 'fusion', judgeModel: 'openai/fixture-inner-judge' } } });
  const body = { model: 'native-outer', stream, messages: [{ role: 'user', content: 'fixture original' }] };
  await context.captureRoutingGraph(body.model, (await import('@/sse/services/accountingRoutingResolver.js')).createAccountingRoutingResolver(body));
  const executor = new BaseExecutor('openai', { baseUrl: registry.url, timeoutMs: 2000, retry: { 502: { attempts: 0, delayMs: 0 } } });
  const { getModelInfo, getComboModels } = await import('@/sse/services/model.js');
  const { getSettings } = await import('@/lib/db/repos/settingsRepo.js');
  const dispatchStarted = Date.now();
  const trace = (token, phase) => { nestedDiagnostics.push(`${Date.now() - dispatchStarted}ms ${token} ${phase}`); };
  async function dispatch(currentBody, token, _panel, signal) {
    trace(token, 'entry'); accounting.assertRoutingCurrent();
    const info = await getModelInfo(token); accounting.assertRoutingCurrent(); trace(token, 'resolved');
    if (!info.provider) {
      accounting.assertNestedFusionSupported(info.model);
      const models = await getComboModels(token), settings = await getSettings(); accounting.assertRoutingCurrent(); trace(token, 'fusion-start');
      return handleFusionChat({ body: currentBody, models, judgeModel: settings.comboStrategies[token].judgeModel,
        tuning: { minPanel: 2, stragglerGraceMs: 5, panelHardTimeoutMs: 1000 }, accounting, signal, comboName: token,
        log: {
          info(_scope, message) { nestedDiagnostics.push(message); },
          warn(_scope, message) { nestedDiagnostics.push(message); }
        }, handleSingleModel: dispatch });
    }
    trace(token, 'execute');
    const work = executor.execute({ body: { ...currentBody, model: info.model }, model: info.model, stream: currentBody.stream,
      ...(currentBody.stream ? { accountingMode: 'live-openai-sse' } : {}), credentials: { apiKey: 'dummy-provider' },
      connectionId: 'c', accounting, signal, proxyOptions: { persistedGlobalProxy: savedProxy() } })
      .then(result => { trace(token, 'owner-returned'); expect(result.accountingOwned).toBe(true); return result.response; });
    owners.push(work.then(response => ({ response }), error => ({ error }))); return work;
  }
  return dispatch(body, body.model).then(response => ({ response }), error => ({ error }));
}
function injectStorageFault(installed) {
  const file = path.join(directory, 'db/data.sqlite');
  if (db.driver === 'node:sqlite') {
    const exec = DatabaseSync.prototype.exec; let releases = 0;
    vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function(sql) {
      // Exactly one queued member savepoint + its outer transaction release.
      if (sql.startsWith('RELEASE') && ++releases === 2) {
        if (installed) exec.call(this, sql); throw new Error('Fixture fusion outer ACK unavailable');
      }
      return exec.call(this, sql);
    });
  } else {
    expect(db.driver).toBe('sql.js');
    const rename = fs.renameSync, sync = fs.fsyncSync; let renamed = false;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (to === file && !installed) throw new Error('Fixture fusion image install unavailable');
      const result = rename(from, to); if (to === file) renamed = true; return result;
    });
    if (installed) vi.spyOn(fs, 'fsyncSync').mockImplementation(fd => {
      if (renamed && fs.fstatSync(fd).isDirectory()) throw new Error('Fixture fusion directory ACK unavailable');
      return sync(fd);
    });
  }
}
describe('owned native fusion queued ledger ACK boundaries, TLS only under explicit private-CA runner, not app/all-adapter proof', { timeout: 20000 }, () => {
  it.each([false, true])('two-level native fusion keeps five own attempts under captured routing graph stream=%s', async stream => {
    const completions = [];
    const accounting = { ...context,
      async beforeAttempt(...args) { const h = await context.beforeAttempt(...args); handles.push(h); return h; },
      async completeAttempt(h, completion) { completions.push(h.attemptId); return context.completeAttempt(h, completion); } };
    const result = await nestedFusion(accounting, stream);
    if (result.error) await Promise.all(owners);
    if (result.error) console.info('Owned nested fixture diagnostic', JSON.stringify({
      error: result.error.message, stack: result.error.stack, steps: nestedDiagnostics,
      receivedModels: received.map(r => r.model),
      attempts: handles.map(h => ({ model: h.model, row: db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId]) }))
    }));
    expect(result.error).toBeUndefined(); expect(result.response.status).toBe(200);
    if (stream) { const text = await result.response.text(); expect(text).toContain('judge prefix'); expect(text.endsWith('data: [DONE]\n\n')).toBe(true); }
    else {
      const content = (await result.response.json()).choices[0].message.content;
      if (content !== 'fixture-judge') console.info('Owned nested degraded diagnostic', JSON.stringify({ content, steps: nestedDiagnostics,
        receivedModels: received.map(r => r.model), attempts: handles.map(h => ({ model: h.model,
          row: db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId]) })) }));
      expect(content).toBe('fixture-judge');
    }
    await Promise.all(owners); expect(failure).toBeNull(); expect(received).toHaveLength(5); expect(handles).toHaveLength(5);
    expect(new Set(completions).size).toBe(5); expect(completions).toHaveLength(5);
    expect(new Set(handles.map(h => h.requestId))).toEqual(new Set([context.requestId]));
    expect(new Set(handles.map(h => h.attemptId)).size).toBe(5);
    for (const h of handles) expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId]))
      .toEqual({ state: 'settled', costNanoUsd: 200000 });
    expect(db.all('SELECT attemptId FROM apiKeyAccounting')).toHaveLength(5);
  });
  it.each(['deliver', 'lost-inner-ack', 'routing-drift'])('native nested inner completion delivery gates outer judge: %s', async mode => {
    const entered = deferred(), release = deferred(), completions = [];
    const { ApiKeyBudgetError } = await import('@/lib/apiKeyBudget/errors.js');
    const lost = new ApiKeyBudgetError('api_key_accounting_unavailable');
    const accounting = { ...context,
      async beforeAttempt(...args) { const h = await context.beforeAttempt(...args); handles.push(h); return h; },
      async completeAttempt(h, completion) {
        completions.push(h.attemptId); const terminal = await context.completeAttempt(h, completion);
        if (h.model === 'fixture-inner-judge') { entered.resolve(); await release.promise; if (mode === 'lost-inner-ack') throw lost; }
        return terminal;
      } };
    const observed = nestedFusion(accounting);
    try {
      expect(await Promise.race([entered.promise.then(() => null), observed])).toBeNull();
      expect(received).toHaveLength(4); expect(handles).toHaveLength(4);
      expect(handles.some(h => h.model === 'fixture-judge')).toBe(false);
      const inner = handles.find(h => h.model === 'fixture-inner-judge');
      expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [inner.attemptId]))
        .toEqual({ state: 'settled', costNanoUsd: 200000 });
      if (mode === 'routing-drift') db.durableTransaction(() => db.run('UPDATE combos SET models=? WHERE name=?', ['["openai/changed"]', 'native-left']));
      release.resolve(); const result = await observed; await Promise.all(owners);
      if (mode === 'deliver') { expect(result.error).toBeUndefined(); expect(result.response.status).toBe(200); await result.response.json(); }
      else if (result.error) expect(result.error).toMatchObject({ code: 'api_key_accounting_unavailable' });
      else { expect(result.response.status).toBe(503); expect((await result.response.json()).error.code).toBe('api_key_accounting_unavailable'); }
      const count = mode === 'deliver' ? 5 : 4;
      expect(received).toHaveLength(count); expect(handles).toHaveLength(count); expect(completions).toHaveLength(count);
      expect(new Set(completions).size).toBe(count); expect(db.all('SELECT attemptId FROM apiKeyAccounting')).toHaveLength(count);
      for (const h of handles) expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId]))
        .toEqual({ state: 'settled', costNanoUsd: 200000 });
      expect(failure).toBeNull();
    } finally { release.resolve(); await observed; await Promise.all(owners); }
  });
  it.each(['deliver', 'fresh-price', 'lost-panel-ack', 'routing-drift'])('native nested regeneration has a distinct own attempt after exact failed panel ACK: %s', async mode => {
    nestedRegeneration = true;
    const entered = deferred(), release = deferred(), completions = [];
    const { ApiKeyBudgetError } = await import('@/lib/apiKeyBudget/errors.js');
    const lost = new ApiKeyBudgetError('api_key_accounting_unavailable');
    let originalTerminals = 0;
    const accounting = { ...context,
      async beforeAttempt(...args) { const h = await context.beforeAttempt(...args); handles.push(h); return h; },
      async completeAttempt(h, completion) {
        completions.push({ id: h.attemptId, completion }); const terminal = await context.completeAttempt(h, completion);
        if (++originalTerminals === 3) entered.resolve();
        if (h.model === 'fixture-c') { await release.promise; if (mode === 'lost-panel-ack') throw lost; }
        return terminal;
      } };
    const observed = nestedFusion(accounting);
    try {
      expect(await Promise.race([entered.promise.then(() => null), observed])).toBeNull();
      expect(received).toHaveLength(3); expect(handles).toHaveLength(3);
      const originals = [...handles];
      for (const h of originals) expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId]))
        .toEqual({ state: 'settled', costNanoUsd: 200000 });
      const failed = completions.find(c => c.id === originals.find(h => h.model === 'fixture-c').attemptId);
      expect(failed.completion).toMatchObject({ outcome: 'failed' }); expect(failed.completion.usage).not.toBeNull();
      if (mode === 'fresh-price') {
        regenerationCost = 1350000;
        await (await import('@/lib/db/repos/pricingRepo.js')).updatePricing({ openai: { 'fixture-a': { input: '9', output: '9' } } });
      }
      if (mode === 'routing-drift') db.durableTransaction(() => db.run('UPDATE combos SET models=? WHERE name=?', ['["openai/changed"]', 'native-left']));
      release.resolve(); const result = await observed; await Promise.all(owners);
      const positive = mode === 'deliver' || mode === 'fresh-price';
      if (positive) {
        expect(result.error).toBeUndefined(); expect(result.response.status).toBe(200);
        const content = (await result.response.json()).choices[0].message.content;
        if (content !== 'fixture-judge') console.info('Owned regeneration degraded diagnostic', JSON.stringify({ content, steps: nestedDiagnostics,
          receivedModels: received.map(r => r.model), attempts: handles.map(h => ({ model: h.model,
            row: db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId]) })) }));
        expect(content).toBe('fixture-judge');
        expect(received.map(r => r.model).filter(m => m === 'fixture-a')).toHaveLength(2);
        const repeated = handles.filter(h => h.model === 'fixture-a'); expect(repeated).toHaveLength(2);
        expect(repeated[0].attemptId).not.toBe(repeated[1].attemptId);
        expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [repeated[1].attemptId]))
          .toEqual({ state: 'settled', costNanoUsd: regenerationCost });
      } else if (result.error) expect(result.error).toMatchObject({ code: 'api_key_accounting_unavailable' });
      else { expect(result.response.status).toBe(503); expect((await result.response.json()).error.code).toBe('api_key_accounting_unavailable'); }
      const count = positive ? 5 : 3;
      expect(received).toHaveLength(count); expect(handles).toHaveLength(count); expect(completions).toHaveLength(count);
      expect(new Set(completions.map(c => c.id)).size).toBe(count);
      expect(handles.some(h => h.model === 'fixture-inner-judge')).toBe(false);
      expect(new Set(handles.map(h => h.requestId))).toEqual(new Set([context.requestId]));
      expect(db.all('SELECT attemptId FROM apiKeyAccounting')).toHaveLength(count);
      for (const h of originals) expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId]))
        .toEqual({ state: 'settled', costNanoUsd: 200000 });
      expect(failure).toBeNull();
    } finally { release.resolve(); await observed; await Promise.all(owners); }
  });
  if (tlsDirectory) it.each([false, true])('hostname mismatch refuses both panel TLS transports stream=%s without judge or fabricated usage', async stream => {
    server.setSecureContext({ key: fs.readFileSync(path.join(tlsDirectory, 'mismatch.key')),
      cert: fs.readFileSync(path.join(tlsDirectory, 'mismatch.pem')) });
    const completions = [];
    const accounting = { ...context,
      async beforeAttempt(...args) { const h = await context.beforeAttempt(...args); handles.push(h); return h; },
      async completeAttempt(h, completion) { completions.push({ id: h.attemptId, completion }); return context.completeAttempt(h, completion); } };
    const result = await fusion(accounting, stream); await Promise.all(owners);
    expect(result.error).toBeUndefined(); expect(result.response.status).toBe(503);
    expect(received).toHaveLength(0); expect(failure).toBeNull(); expect(handles).toHaveLength(2);
    expect(handles.map(h => h.model).sort()).toEqual(['fixture-a', 'fixture-b']);
    expect(completions).toHaveLength(2); expect(new Set(completions.map(c => c.id)).size).toBe(2);
    for (const c of completions) expect(c.completion).toMatchObject({ usage: null, outcome: 'network_unknown' });
    for (const owner of await Promise.all(owners)) expect(owner.error).toMatchObject({ cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID' } });
    for (const h of handles) expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId]))
      .toEqual({ state: 'unresolved', costNanoUsd: null });
    expect(db.get('SELECT COUNT(*) AS n FROM apiKeyAccounting').n).toBe(2);
  });
  it.each(['panel-completion', 'judge-intent'])('real judge POST waits for its %s delivery, not just installed DB rows', async stage => {
    const entered = deferred(), release = deferred(); let terminals = 0;
    const accounting = { ...context,
      async beforeAttempt(...args) {
        const h = await context.beforeAttempt(...args); handles.push(h);
        if (stage === 'judge-intent' && h.model === 'fixture-judge') { entered.resolve(); await release.promise; } return h;
      },
      async completeAttempt(h, completion) {
        const t = await context.completeAttempt(h, completion); terminals++;
        if (stage === 'panel-completion' && h.model === 'fixture-b') { entered.resolve(); await release.promise; } return t;
      } };
    const observed = fusion(accounting);
    try {
      const first = await Promise.race([entered.promise.then(() => null), observed]); expect(first).toBeNull();
      expect(failure).toBeNull(); expect(received).toHaveLength(2); expect(terminals).toBe(2);
      expect(received.map(r => r.model).sort()).toEqual(['fixture-a', 'fixture-b']);
      for (const h of handles.filter(h => h.model !== 'fixture-judge')) expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId])).toEqual({ state: 'settled', costNanoUsd: 200000 });
      if (stage === 'judge-intent') expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [handles.find(h => h.model === 'fixture-judge').attemptId]).state).toBe('pending');
      else expect(handles).toHaveLength(2);
      release.resolve(); const result = await observed; expect(result.error).toBeUndefined();
      expect((await result.response.json()).choices[0].message.content).toBe('fixture-judge');
      await Promise.all(owners); expect(failure).toBeNull(); expect(received).toHaveLength(3); expect(terminals).toBe(3);
      expect(handles).toHaveLength(3); expect(new Set(handles.map(h => h.attemptId)).size).toBe(3);
      for (const h of handles) expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId])).toEqual({ state: 'settled', costNanoUsd: 200000 });
    } finally { release.resolve(); await observed; await Promise.all(owners); }
  });
  it.each(['deliver', 'lost-ack', 'lost-authorization', 'cancel'])('real fusion judge SSE prefix before terminal ACK/independent authorization: %s', async mode => {
    const ackEntered = deferred(), ackRelease = deferred(), authEntered = deferred(), authRelease = deferred();
    const { ApiKeyBudgetError } = await import('@/lib/apiKeyBudget/errors.js'); const lost = new ApiKeyBudgetError('api_key_accounting_unavailable');
    const completions = []; let authorizations = 0, reader, next;
    const accounting = { ...context,
      async beforeAttempt(...args) { const h = await context.beforeAttempt(...args); handles.push(h); return h; },
      async completeAttempt(h, completion) {
        completions.push(h.attemptId); const t = await context.completeAttempt(h, completion);
        if (h.model === 'fixture-judge') { ackEntered.resolve(); await ackRelease.promise; if (mode === 'lost-ack') throw lost; } return t;
      },
      assertSuccessfulTerminal(t) {
        context.assertSuccessfulTerminal(t); authorizations++;
        if (authorizations === 3) {
          authEntered.resolve(); return authRelease.promise.then(() => { if (mode === 'lost-authorization') throw lost; });
        }
      } };
    const observed = fusion(accounting, true);
    try {
      const result = await observed; expect(result.error).toBeUndefined(); expect(result.response.headers.get('content-type')).toContain('text/event-stream');
      reader = result.response.body.getReader();
      // Actual consumer prefix read occurs before cancellation or any injected loss.
      expect(new TextDecoder().decode((await reader.read()).value)).toBe(delta);
      let delivered = false;
      next = reader.read().then(value => { delivered = true; return { value }; }, error => { delivered = true; return { error }; });
      const first = await Promise.race([ackEntered.promise.then(() => null), next]); expect(first).toBeNull();
      expect(delivered).toBe(false); expect(authorizations).toBe(2); expect(failure).toBeNull(); expect(received).toHaveLength(3);
      const judge = handles.find(h => h.model === 'fixture-judge');
      expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [judge.attemptId])).toEqual({ state: 'settled', costNanoUsd: 200000 });
      if (mode === 'cancel') await reader.cancel('fixture consumer cancelled after prefix/installed ACK');
      ackRelease.resolve();
      if (mode === 'deliver' || mode === 'lost-authorization') {
        const authFirst = await Promise.race([authEntered.promise.then(() => null), next]); expect(authFirst).toBeNull();
        expect(delivered).toBe(false); expect(authorizations).toBe(3); authRelease.resolve();
      }
      const observedNext = await next;
      if (mode === 'deliver') {
        expect(observedNext.error).toBeUndefined(); let text = new TextDecoder().decode(observedNext.value.value);
        for (;;) { const chunk = await reader.read(); if (chunk.done) break; text += new TextDecoder().decode(chunk.value); }
        expect(text).toBe(terminal); expect(authorizations).toBe(3);
      } else if (mode === 'cancel') { expect(observedNext.value).toEqual({ done: true, value: undefined }); expect(authorizations).toBe(2); }
      else { expect(observedNext.error?.message).toBe('Gateway accounting stream unavailable'); expect(authorizations).toBe(mode === 'lost-ack' ? 2 : 3); }
      expect(completions).toHaveLength(3); expect(new Set(completions).size).toBe(3); expect(received).toHaveLength(3);
      for (const h of handles) expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId])).toEqual({ state: 'settled', costNanoUsd: 200000 });
    } finally {
      ackRelease.resolve(); authRelease.resolve(); await observed; if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (next) await next; await Promise.all(owners);
    }
  });
  it.each([false, true])('judge SSE actual storage completion uncertainty installed=%s after consumer prefix blocks terminal, not original winner', async installed => {
    const policy = await (await import('@/lib/apiKeyBudget/service.js')).createBudgetContext('a', { adapter: async () => db });
    policy.updatePolicy({ weeklyLimitUsd: '1', monthlyLimitUsd: '1', expectedVersion: 0 });
    const completions = []; let injected = false, authorizations = 0, reader;
    const accounting = { ...context,
      async beforeAttempt(...args) { const h = await context.beforeAttempt(...args); handles.push(h); return h; },
      async completeAttempt(h, completion) {
        completions.push(h.attemptId);
        if (h.model === 'fixture-judge') { injectStorageFault(installed); injected = true; }
        return context.completeAttempt(h, completion);
      },
      assertSuccessfulTerminal(t) { authorizations++; return context.assertSuccessfulTerminal(t); } };
    const observed = fusion(accounting, true);
    try {
      const result = await observed; expect(result.error).toBeUndefined(); reader = result.response.body.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toBe(delta);
      expect(injected).toBe(false); expect(authorizations).toBe(2);
      await expect(reader.read()).rejects.toThrow('Gateway accounting stream unavailable');
      expect(injected).toBe(true); expect(authorizations).toBe(2); expect(failure).toBeNull(); expect(received).toHaveLength(3);
      expect(completions).toHaveLength(3); expect(new Set(completions).size).toBe(3);
      expect(db.health()).toMatchObject({ healthy: false, poisoned: true });
      await reader.cancel().catch(() => {}); reader.releaseLock(); reader = null;
      vi.restoreAllMocks(); await (await import('@/lib/apiKeyBudget/accountingWriteCoordinator.js')).getAccountingWriteCoordinator(db).stop(); db.close();
      const disk = new DatabaseSync(path.join(directory, 'db/data.sqlite'), { readOnly: true });
      try {
        for (const h of handles) expect({ ...disk.prepare('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?').get(h.attemptId) })
          .toEqual({ state: h.model === 'fixture-judge' && !installed ? 'pending' : 'settled', costNanoUsd: h.model === 'fixture-judge' && !installed ? null : 200000 });
        expect(completions).toHaveLength(3); expect(received).toHaveLength(3);
      } finally { disk.close(); }
    } finally { await observed; if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); } await Promise.all(owners); }
  });
  it.each(['panel-completion', 'judge-intent'].flatMap(stage => [false, true].map(installed => [stage, installed])))('actual storage uncertainty %s installed=%s withholds fusion ACK/POST permission', async (stage, installed) => {
    const policy = await (await import('@/lib/apiKeyBudget/service.js')).createBudgetContext('a', { adapter: async () => db });
    policy.updatePolicy({ weeklyLimitUsd: '1', monthlyLimitUsd: '1', expectedVersion: 0 });
    const aCompleted = deferred(); const completions = []; let injected = false;
    const accounting = { ...context,
      async beforeAttempt(...args) {
        if (stage === 'judge-intent' && args[0].model === 'fixture-judge') { injectStorageFault(installed); injected = true; }
        const h = await context.beforeAttempt(...args); handles.push(h); return h;
      },
      async completeAttempt(h, completion) {
        completions.push(h.attemptId);
        if (stage === 'panel-completion' && h.model === 'fixture-b') {
          await aCompleted.promise; injectStorageFault(installed); injected = true;
        }
        const t = await context.completeAttempt(h, completion); if (h.model === 'fixture-a') aCompleted.resolve(); return t;
      } };
    const observed = fusion(accounting);
    try {
      const result = await observed; expect(result.error).toMatchObject({ code: 'api_key_accounting_unavailable' });
      await Promise.all(owners); expect(injected).toBe(true); expect(failure).toBeNull(); expect(received).toHaveLength(2);
      expect(completions).toHaveLength(2); expect(new Set(completions).size).toBe(2);
      expect(db.health()).toMatchObject({ healthy: false, poisoned: true });
      // Restore fault hooks, drain poisoned coordinator, then inspect persisted
      // bytes read-only. This cannot recreate a lost ACK or admit a successor.
      vi.restoreAllMocks(); await (await import('@/lib/apiKeyBudget/accountingWriteCoordinator.js')).getAccountingWriteCoordinator(db).stop(); db.close();
      const disk = new DatabaseSync(path.join(directory, 'db/data.sqlite'), { readOnly: true });
      try {
        const rows = disk.prepare('SELECT model,state,costNanoUsd FROM apiKeyAccounting').all().map(row => ({ ...row }));
        const expected = [ { model: 'fixture-a', state: 'settled', costNanoUsd: 200000 },
          { model: 'fixture-b', state: stage === 'panel-completion' && !installed ? 'pending' : 'settled', costNanoUsd: stage === 'panel-completion' && !installed ? null : 200000 } ];
        if (stage === 'judge-intent' && installed) expected.push({ model: 'fixture-judge', state: 'pending', costNanoUsd: null });
        expect(rows.sort((a, b) => a.model.localeCompare(b.model))).toEqual(expected.sort((a, b) => a.model.localeCompare(b.model)));
        expect(received).toHaveLength(2);
      } finally { disk.close(); }
    } finally { aCompleted.resolve(); await observed; await Promise.all(owners); }
  });
  it.each(['panel-completion', 'judge-intent'])('lost %s delivery after real installation cannot authorize judge POST', async stage => {
    const { ApiKeyBudgetError } = await import('@/lib/apiKeyBudget/errors.js'); const lost = new ApiKeyBudgetError('api_key_accounting_unavailable');
    let terminals = 0;
    const accounting = { ...context,
      async beforeAttempt(...args) { const h = await context.beforeAttempt(...args); handles.push(h); if (stage === 'judge-intent' && h.model === 'fixture-judge') throw lost; return h; },
      async completeAttempt(h, completion) { const t = await context.completeAttempt(h, completion); terminals++; if (stage === 'panel-completion' && h.model === 'fixture-b') throw lost; return t; } };
    const result = await fusion(accounting); expect(result.error).toBe(lost); await Promise.all(owners);
    expect(failure).toBeNull(); expect(received).toHaveLength(2); expect(terminals).toBe(2);
    for (const h of handles.filter(h => h.model !== 'fixture-judge')) expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId])).toEqual({ state: 'settled', costNanoUsd: 200000 });
    if (stage === 'judge-intent') { expect(handles).toHaveLength(3); expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [handles.find(h => h.model === 'fixture-judge').attemptId]).state).toBe('pending'); }
    else expect(handles).toHaveLength(2);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
});
