import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Session } from 'node:inspector';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ network: vi.fn(), contexts: [], handles: [], completions: [], afterCompletion: null, afterIntent: null, nested: false, regeneration: false, upstreamUrl: 'http://fixture.invalid/chat', owners: [], timings: {}, steps: [], startedAt: null,
  measure(name, elapsed) { const row = this.timings[name] ||= { calls: 0, milliseconds: 0, maximum: 0 };
    row.calls++; row.milliseconds += elapsed; row.maximum = Math.max(row.maximum, elapsed); },
  step(name, model = null) { if (this.startedAt !== null && this.steps.length < 256)
    this.steps.push({ name, model, milliseconds: performance.now() - this.startedAt }); }, legacy: vi.fn() }));
vi.mock('../../open-sse/config/providers.js', async original => ({ ...(await original()),
  PROVIDERS: { ...(await original()).PROVIDERS, get openai() { return { baseUrl: fixture.upstreamUrl, forceStream: false }; } } }));
vi.mock('../../open-sse/utils/proxyFetch.js', async original => {
  if (process.env.FUSION_APP_TRANSPORT !== 'http') return { proxyAwareFetch: (...args) => fixture.network(...args) };
  const actual = await original();
  return { ...actual, async proxyAwareFetch(...args) {
    try { return await actual.proxyAwareFetch(...args); }
    catch (error) {
      console.info('Owned app native transport refusal', JSON.stringify({ name: error.name, code: error.code ?? null,
        causeName: error.cause?.name ?? null, causeCode: error.cause?.code ?? null,
        location: error.stack?.split('\n')[1]?.trim() ?? null }));
      throw error;
    }
  } };
});
vi.mock('@/lib/usageDb.js', () => ({ trackPendingRequest() {}, appendRequestLog: async () => {}, saveRequestDetail: async () => {}, saveRequestUsage: fixture.legacy }));
// Observe actual composite/core work immediately; outer timeout may return
// while already-dispatched owners still retain their own terminal sinks.
vi.mock('../../open-sse/services/combo.js', async original => {
  const exports = await original();
  const observe = name => (...args) => {
    const work = vi.importActual('../../open-sse/services/combo.js').then(actual => actual[name](...args));
    fixture.owners.push(work.then(value => ({ value }), error => ({ error }))); return work;
  };
  return { ...exports, handleFusionChat: observe('handleFusionChat'), handleComboChat: observe('handleComboChat') };
});
vi.mock('../../open-sse/handlers/chatCore.js', () => ({ handleChatCore(...args) {
  // Mock factories survive resetModules; resolve the current executor/cache and
  // Error-class graph per invocation, never dispatch through a prior test URL.
  const start = performance.now();
  if (process.env.FUSION_APP_TIMING) fixture.step('core-start', args[0]?.modelInfo?.model ?? null);
  const work = vi.importActual('../../open-sse/handlers/chatCore.js').then(actual => actual.handleChatCore(...args));
  const observed = work.then(value => ({ value }), error => ({ error }));
  fixture.owners.push(observed.then(result => {
    if (process.env.FUSION_APP_TIMING) { fixture.measure('core', performance.now() - start); fixture.step('core-return'); }
    return result;
  })); return work;
} }));
// Request-local opt-in ONLY in fixture. App default stays synchronous/OFF.
vi.mock('@/lib/apiKeyBudget/requestAccounting.js', () => ({ async createRequestAccounting(request, options = {}) {
    // Mock factories survive resetModules. Resolve BOTH actual implementation
    // and driver afresh, so Error-class identity matches the current app/core.
    const actual = await vi.importActual('@/lib/apiKeyBudget/requestAccounting.js');
    const current = await import('@/lib/db/driver.js');
    const ctx = await actual.createRequestAccounting(request, { ...options, adapter: current.getAdapter, queued: true });
    expect(ctx).not.toBeNull(); fixture.contexts.push(ctx);
    const diagnostic = process.env.FUSION_APP_TIMING === 'diagnostic';
    const syncMeasure = method => (...args) => {
      const start = performance.now(); try { return ctx[method](...args); }
      finally { fixture.measure(method, performance.now() - start); }
    };
    return { ...ctx, ...(diagnostic ? { gate: syncMeasure('gate'), assertRoutingCurrent: syncMeasure('assertRoutingCurrent') } : {}),
      async beforeAttempt(...args) {
        const start = performance.now(); let h;
        try { h = await ctx.beforeAttempt(...args); }
        finally { if (diagnostic) fixture.measure('intentACK', performance.now() - start); }
        fixture.handles.push(h); if (diagnostic) fixture.step('intent-ACK', h.model);
        if (fixture.afterIntent) await fixture.afterIntent(h); return h;
      },
      completeAttempt(h, completion) {
        const work = (async () => {
          const start = performance.now(); let t;
          fixture.completions.push(h.attemptId);
          try { t = await ctx.completeAttempt(h, completion); }
          finally { if (diagnostic) fixture.measure('completionACK', performance.now() - start); }
          if (diagnostic) fixture.step('completion-ACK', h.model);
          if (fixture.afterCompletion) await fixture.afterCompletion(h, t); return t;
        })();
        fixture.owners.push(work.then(value => ({ value }), error => ({ error }))); return work;
      } };
  } }));
let db, directory, handleChat, server, serverFailure, delayMonitor, cpuStart, profileSession, previousCatalogSource;
const catalogInstalled = process.env.FUSION_APP_CATALOG === 'installed';
if (process.env.FUSION_APP_CATALOG !== undefined && !catalogInstalled) throw new Error('Unsupported app catalog fixture');
const profileDirectory = process.env.FUSION_APP_PROFILE_DIR;
if (profileDirectory && process.env.FUSION_APP_TIMING !== 'diagnostic') throw new Error('App profile requires timing diagnostic');
const profileCommand = (session, name) => new Promise((resolve, reject) => session.post(name, (error, result) => error ? reject(error) : resolve(result)));
const timingDiagnostic = process.env.FUSION_APP_TIMING === 'diagnostic';
if (process.env.FUSION_APP_TIMING !== undefined && !timingDiagnostic) throw new Error('Unsupported app timing diagnostic');
const nativeHttp = process.env.FUSION_APP_TRANSPORT === 'http';
if (process.env.FUSION_APP_TRANSPORT !== undefined && !nativeHttp) throw new Error('Unsupported app fixture transport');
const previous = process.env.DATA_DIR;
const json = model => ({ choices: [{ message: { role: 'assistant', content: model }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } });
// Cold Vite transformation of the full app/executor graph is setup, not an
// inference or hook deadline. Prewarm under the gate's dummy HOME/DATA_DIR;
// every test still resets modules and acquires its own disposable real DB.
await Promise.all([import('../../src/sse/handlers/chat.js'), import('undici')]);
beforeEach(async () => {
  previousCatalogSource = globalThis.__9rCatalogSource;
  fixture.network.mockReset(); fixture.legacy.mockReset(); fixture.contexts.length = 0; fixture.handles.length = 0;
  fixture.timings = {}; fixture.steps = []; fixture.startedAt = null; delayMonitor = null; cpuStart = null; profileSession = null;
  fixture.owners.length = 0; fixture.completions.length = 0; fixture.afterCompletion = null; fixture.afterIntent = null; fixture.nested = false; fixture.regeneration = false;
  server = null; serverFailure = null; fixture.upstreamUrl = 'http://fixture.invalid/chat';
  if (nativeHttp) {
    server = http.createServer(async (request, response) => {
      try {
        expect(request.method).toBe('POST'); expect(request.url).toBe('/chat');
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const reply = await fixture.network(fixture.upstreamUrl, { method: request.method, redirect: 'error',
          headers: request.headers, body: Buffer.concat(chunks).toString('utf8') });
        response.writeHead(reply.status, Object.fromEntries(reply.headers.entries()));
        response.end(Buffer.from(await reply.arrayBuffer()));
      } catch (error) { serverFailure = error; response.writeHead(500); response.end(); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    fixture.upstreamUrl = `http://127.0.0.1:${server.address().port}/chat`;
  }
  directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-fusion-app-')); process.env.DATA_DIR = directory;
  delete global._dbAdapter; vi.resetModules(); db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }],
    providerConnections: [{ id: 'c', provider: 'openai', authType: 'apikey', apiKey: 'dummy-provider', isActive: true }],
    settings: { requireApiKey: true,
      ...(nativeHttp ? { outboundProxyEnabled: true, outboundProxyUrl: 'http://127.0.0.1:1', outboundNoProxy: '127.0.0.1' } : {}),
      comboStrategies: {
      outer: { fallbackStrategy: 'fusion', judgeModel: 'openai/fixture-judge', fusionTuning: { minPanel: 2, stragglerGraceMs: 5, panelHardTimeoutMs: 1000 } },
      left: { fallbackStrategy: 'fallback' }, right: { fallbackStrategy: 'fallback' } } } });
  if (timingDiagnostic) {
    // Observe fresh reads/commits without logging SQL, bindings, credentials or
    // captured material. Timings overlap nested calls; sums are not wall time.
    for (const name of ['get', 'all', 'durableTransaction']) {
      const actual = db[name].bind(db);
      db[name] = (...args) => { const start = performance.now(); try { return actual(...args); }
        finally { if (fixture.startedAt !== null) fixture.measure('db-' + name, performance.now() - start); } };
    }
    const actual = db.coverage.status.bind(db.coverage);
    db.coverage.status = (...args) => { const start = performance.now(); try { return actual(...args); }
      finally { if (fixture.startedAt !== null) fixture.measure('coverage-status', performance.now() - start); } };
  }
  const { createCombo } = await import('@/lib/db/repos/combosRepo.js');
  await createCombo({ name: 'outer', models: ['left', 'right'] });
  await createCombo({ name: 'left', models: ['openai/fixture-a'] });
  await createCombo({ name: 'right', models: ['openai/fixture-b'] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','openai',?)", [JSON.stringify(Object.fromEntries(['fixture-a', 'fixture-b', 'fixture-judge'].map(m => [m, { input: '1', output: '2' }])))]);
  });
  if (catalogInstalled) {
    const catalog = await import('../../open-sse/providers/catalogOverride.js');
    fs.writeFileSync(catalog.CATALOG_FILE, JSON.stringify({ v: 2, models: {}, providers: {} }));
    await catalog.installCatalogSource();
  }
  ({ handleChat } = await import('../../src/sse/handlers/chat.js'));
  // The observers resolve actual modules per invocation. Acquire the current
  // module graph in setup after resetModules, not within the 1s panel timer.
  // No inference, ledger mutation or network warm-up is performed here.
  await Promise.all([vi.importActual('../../open-sse/handlers/chatCore.js'),
    vi.importActual('../../open-sse/services/combo.js')]);
  if (profileDirectory) {
    profileSession = new Session(); profileSession.connect();
    await profileCommand(profileSession, 'Profiler.enable');
  }
  if (timingDiagnostic) {
    const actual = handleChat;
    handleChat = async (...args) => {
      if (profileSession) await profileCommand(profileSession, 'Profiler.start');
      fixture.startedAt = performance.now(); cpuStart = process.cpuUsage();
      delayMonitor = monitorEventLoopDelay({ resolution: 10 }); delayMonitor.enable();
      try { return await actual(...args); }
      finally { fixture.measure('app-response', performance.now() - fixture.startedAt); fixture.step('app-response'); }
    };
  }
  if (nativeHttp) {
    const actual = handleChat;
    handleChat = async (...args) => {
      const response = await actual(...args);
      if (response.status >= 400) {
        let code = null; try { code = (await response.clone().json()).error?.code ?? null; } catch { /* diagnostic only */ }
        console.info('Owned app native refusal receipt', JSON.stringify({ status: response.status, code,
          posted: fixture.network.mock.calls.length, handles: fixture.handles.length,
          rows: db.all('SELECT state,costNanoUsd,outcome FROM apiKeyAccounting') }));
      }
      return response;
    };
  }
  fixture.network.mockImplementation(async (url, options) => {
    expect(url).toBe(fixture.upstreamUrl); expect(options.redirect).toBe('error');
    const body = JSON.parse(options.body), h = fixture.handles.findLast(h => h.model === body.model); expect(h).toBeTruthy();
    if (timingDiagnostic) fixture.step('owned-POST-received', h.model);
    expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId]).state).toBe('pending');
    expect(options.headers.Authorization || options.headers.authorization).toBe('Bearer dummy-provider');
    if (body.model === 'fixture-judge' || body.model === 'fixture-inner-judge') {
      const predecessorModels = fixture.nested
        ? body.model === 'fixture-inner-judge' ? ['fixture-a', 'fixture-c'] : fixture.regeneration ? ['fixture-a', 'fixture-b'] : ['fixture-inner-judge', 'fixture-b']
        : ['fixture-a', 'fixture-b'];
      for (const model of predecessorModels) {
        const panel = fixture.handles.findLast(h => h.model === model); expect(panel).toBeTruthy();
        expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [panel.attemptId]).state).toBe('settled');
      }
      expect(body.messages.at(-1).content).toContain('=== PANEL RESPONSES ===');
      if (fixture.nested) for (const model of predecessorModels) expect(body.messages.at(-1).content).toContain(model);
    }
    if (body.stream) return new Response('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: 'judge prefix' } }] }) + '\n\n' +
      'data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n' +
      'data: ' + JSON.stringify({ choices: [], usage: json(body.model).usage }) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    return Response.json(json(body.model), { status: fixture.regeneration && body.model === 'fixture-c' ? 400 : 200 });
  });
});
afterEach(async () => {
  // Dependency barrier, not status polling: callbacks may append successor
  // owners while a prior composite drains. Consume every newly stored promise.
  let consumed = 0;
  while (consumed < fixture.owners.length) {
    const pending = fixture.owners.slice(consumed); consumed += pending.length; await Promise.all(pending);
  }
  if (profileSession) {
    try {
      if (fixture.startedAt !== null) {
        const { profile } = await profileCommand(profileSession, 'Profiler.stop');
        // Owned disposable artifacts only; profile contains source/function
        // metadata, never request arguments or persisted authority snapshots.
        fs.writeFileSync(path.join(profileDirectory, path.basename(directory) + '.cpuprofile'), JSON.stringify(profile), { mode: 0o600 });
      }
    } finally { profileSession.disconnect(); }
  }
  if (timingDiagnostic && fixture.startedAt !== null) {
    delayMonitor.disable(); const cpu = process.cpuUsage(cpuStart);
    console.info('Owned app timing diagnostic', JSON.stringify({ driver: db.driver,
      drainedMilliseconds: performance.now() - fixture.startedAt, cpuMilliseconds: { user: cpu.user / 1000, system: cpu.system / 1000 },
      eventLoopMilliseconds: { mean: Number.isFinite(delayMonitor.mean) ? delayMonitor.mean / 1e6 : null,
        maximum: delayMonitor.max / 1e6, p99: delayMonitor.percentile(99) / 1e6 },
      timings: fixture.timings, steps: fixture.steps, stepLimitReached: fixture.steps.length === 256,
      posted: fixture.network.mock.calls.length, handles: fixture.handles.length, completions: fixture.completions.length }));
  }
  if (previousCatalogSource === undefined) delete globalThis.__9rCatalogSource;
  else globalThis.__9rCatalogSource = previousCatalogSource;
  server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve));
  vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous;
  expect(serverFailure).toBeNull();
});
const request = (stream = false, key = 'dummy-key-a') => new Request('http://localhost/v1/chat/completions', { method: 'POST',
  headers: { Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: 'outer', stream, messages: [{ role: 'user', content: 'fixture original' }] }) });
async function configureNestedFusion() {
  fixture.nested = true;
  await (await import('@/lib/db/repos/settingsRepo.js')).updateSettings({ comboStrategies: {
    outer: { fallbackStrategy: 'fusion', judgeModel: 'openai/fixture-judge', fusionTuning: { minPanel: 2, stragglerGraceMs: 5, panelHardTimeoutMs: 1000 } },
    left: { fallbackStrategy: 'fusion', judgeModel: 'openai/fixture-inner-judge', fusionTuning: { minPanel: 2, stragglerGraceMs: 5, panelHardTimeoutMs: 1000 } },
    right: { fallbackStrategy: 'fallback' } } });
  db.durableTransaction(() => {
    db.run('UPDATE combos SET models=? WHERE name=?', ['["openai/fixture-a","openai/fixture-c"]', 'left']);
    db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='openai'", [JSON.stringify(Object.fromEntries(
      ['fixture-a', 'fixture-b', 'fixture-c', 'fixture-inner-judge', 'fixture-judge'].map(m => [m, { input: '1', output: '2' }])))]);
  });
}
describe('actual app auth/model/nested fallback/fusion → core → queued Base with mocked POST only', { timeout: 20000 }, () => {
  it.each(['invalid-enabled', 'unsupported-url', 'invalid-no-proxy'])('malformed saved proxy %s refuses queued app before intent or transport', async mode => {
    const settings = await (await import('@/lib/db/repos/settingsRepo.js')).getSettings();
    db.durableTransaction(() => db.run('UPDATE settings SET data=? WHERE id=1', [JSON.stringify({ ...settings,
      outboundProxyEnabled: mode === 'invalid-enabled' ? 'true' : true,
      outboundProxyUrl: mode === 'unsupported-url' ? 'socks5://127.0.0.1:1' : 'http://127.0.0.1:1',
      outboundNoProxy: mode === 'invalid-no-proxy' ? 127 : '127.0.0.1' })]));
    const response = await handleChat(request()); expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('api_key_accounting_unavailable');
    expect(fixture.network).not.toHaveBeenCalled(); expect(fixture.handles).toHaveLength(0); expect(fixture.completions).toHaveLength(0);
    expect(db.all('SELECT attemptId FROM apiKeyAccounting')).toHaveLength(0); expect(fixture.legacy).not.toHaveBeenCalled();
  });
  it.each(['deliver', 'fresh-price', 'lost-panel-ack', 'routing-drift'])('actual app nested regeneration preserves original failed-panel bill and new own intent: %s', async mode => {
    await configureNestedFusion(); fixture.regeneration = true;
    let enter, release, originalsCompleted = 0;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const { ApiKeyBudgetError } = await import('@/lib/apiKeyBudget/errors.js');
    const lost = new ApiKeyBudgetError('api_key_accounting_unavailable');
    fixture.afterCompletion = async h => {
      if (++originalsCompleted === 3) enter();
      if (h.model === 'fixture-c') { await held; if (mode === 'lost-panel-ack') throw lost; }
    };
    const observed = handleChat(request()).then(response => ({ response }), error => ({ error }));
    try {
      expect(await Promise.race([entered.then(() => null), observed])).toBeNull();
      expect(fixture.network).toHaveBeenCalledTimes(3); expect(fixture.handles).toHaveLength(3);
      const originals = [...fixture.handles];
      for (const h of originals) expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId]))
        .toEqual({ state: 'settled', costNanoUsd: 200000 });
      if (mode === 'fresh-price') await (await import('@/lib/db/repos/pricingRepo.js')).updatePricing({ openai: { 'fixture-a': { input: '9', output: '9' } } });
      if (mode === 'routing-drift') db.durableTransaction(() => db.run('UPDATE combos SET models=? WHERE name=?', ['["openai/changed"]', 'left']));
      release(); const result = await observed; expect(result.error).toBeUndefined();
      const payload = await result.response.json(), positive = mode === 'deliver' || mode === 'fresh-price';
      if (positive) {
        expect(result.response.status).toBe(200); expect(payload.choices[0].message.content).toBe('fixture-judge');
        const repeated = fixture.handles.filter(h => h.model === 'fixture-a'); expect(repeated).toHaveLength(2);
        expect(repeated[0].attemptId).not.toBe(repeated[1].attemptId);
        expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [repeated[1].attemptId]))
          .toEqual({ state: 'settled', costNanoUsd: mode === 'fresh-price' ? 1350000 : 200000 });
      } else { expect(result.response.status).toBe(503); expect(payload.error.code).toBe('api_key_accounting_unavailable'); }
      const count = positive ? 5 : 3;
      expect(fixture.network).toHaveBeenCalledTimes(count); expect(fixture.handles).toHaveLength(count);
      expect(fixture.completions).toHaveLength(count); expect(new Set(fixture.completions).size).toBe(count);
      expect(fixture.handles.some(h => h.model === 'fixture-inner-judge')).toBe(false);
      expect(new Set(fixture.handles.map(h => h.requestId))).toEqual(new Set([fixture.contexts[0].requestId]));
      expect(db.all('SELECT attemptId FROM apiKeyAccounting')).toHaveLength(count);
      for (const h of originals) expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId]))
        .toEqual({ state: 'settled', costNanoUsd: 200000 });
      expect(fixture.legacy).not.toHaveBeenCalled();
    } finally { release(); await observed; }
  });
  it.each(['tools', 'media', 'extra-option'])('unsupported nested original %s refuses whole preflight before any intent or POST', async mode => {
    await configureNestedFusion();
    const body = { model: 'outer', stream: false, messages: [{ role: 'user', content: 'fixture original' }] };
    if (mode === 'tools') body.tools = [{ type: 'function', function: { name: 'fixture-tool', parameters: { type: 'object' } } }];
    if (mode === 'media') body.messages[0].content = [{ type: 'text', text: 'fixture original' },
      { type: 'image_url', image_url: { url: 'https://fixture.invalid/image.png' } }];
    if (mode === 'extra-option') body.temperature = 0;
    const response = await handleChat(new Request('http://localhost/v1/chat/completions', { method: 'POST',
      headers: { Authorization: 'Bearer dummy-key-a' }, body: JSON.stringify(body) }));
    expect(response.status).toBe(503); expect((await response.json()).error.code).toBe('model_accounting_unsupported');
    expect(fixture.network).not.toHaveBeenCalled(); expect(fixture.handles).toHaveLength(0); expect(fixture.completions).toHaveLength(0);
    expect(db.all('SELECT attemptId FROM apiKeyAccounting')).toHaveLength(0); expect(fixture.legacy).not.toHaveBeenCalled();
  });
  it.each([false, true])('actual nested fusion keeps five own POST/terminal identities under one graph/context stream=%s', async stream => {
    await configureNestedFusion();
    const response = await handleChat(request(stream)); expect(response.status).toBe(200);
    if (stream) { const text = await response.text(); expect(text).toContain('judge prefix'); expect(text.endsWith('data: [DONE]\n\n')).toBe(true); }
    else expect((await response.json()).choices[0].message.content).toBe('fixture-judge');
    expect(fixture.contexts).toHaveLength(1); expect(fixture.network).toHaveBeenCalledTimes(5); expect(fixture.handles).toHaveLength(5);
    expect(fixture.handles.map(h => h.model).sort()).toEqual(['fixture-a', 'fixture-b', 'fixture-c', 'fixture-inner-judge', 'fixture-judge'].sort());
    expect(new Set(fixture.handles.map(h => h.requestId))).toEqual(new Set([fixture.contexts[0].requestId]));
    expect(new Set(fixture.handles.map(h => h.attemptId)).size).toBe(5); expect(new Set(fixture.completions).size).toBe(5);
    expect(fixture.completions).toHaveLength(5); expect(db.all('SELECT attemptId FROM apiKeyAccounting')).toHaveLength(5);
    for (const h of fixture.handles) expect(db.get('SELECT state,costNanoUsd,apiKeyId FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId]))
      .toEqual({ state: 'settled', costNanoUsd: 200000, apiKeyId: 'a' });
    expect(fixture.legacy).not.toHaveBeenCalled();
  });
  it.each(['deliver-fresh-price', 'lost-ack', 'routing-drift'])('nested inner judge own completion delivery controls outer admission: %s', async mode => {
    await configureNestedFusion();
    let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const { ApiKeyBudgetError } = await import('@/lib/apiKeyBudget/errors.js');
    const lost = new ApiKeyBudgetError('api_key_accounting_unavailable');
    fixture.afterCompletion = async h => { if (h.model === 'fixture-inner-judge') { enter(); await held; if (mode === 'lost-ack') throw lost; } };
    const observed = handleChat(request()).then(response => ({ response }), error => ({ error }));
    try {
      expect(await Promise.race([entered.then(() => null), observed])).toBeNull();
      expect(fixture.network).toHaveBeenCalledTimes(4); expect(fixture.handles).toHaveLength(4);
      expect(fixture.handles.some(h => h.model === 'fixture-judge')).toBe(false);
      const inner = fixture.handles.find(h => h.model === 'fixture-inner-judge');
      expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [inner.attemptId])).toEqual({ state: 'settled', costNanoUsd: 200000 });
      if (mode === 'routing-drift') db.durableTransaction(() => db.run('UPDATE combos SET models=? WHERE name=?', ['["openai/fixture-a"]', 'right']));
      if (mode === 'deliver-fresh-price') await (await import('@/lib/db/repos/pricingRepo.js')).updatePricing({ openai: {
        'fixture-a': { input: '1', output: '2' }, 'fixture-b': { input: '1', output: '2' }, 'fixture-c': { input: '1', output: '2' },
        'fixture-inner-judge': { input: '1', output: '2' }, 'fixture-judge': { input: '9', output: '9' } } });
      release(); const result = await observed; expect(result.error).toBeUndefined();
      const payload = await result.response.json();
      if (mode === 'deliver-fresh-price') { expect(result.response.status).toBe(200); expect(payload.choices[0].message.content).toBe('fixture-judge'); }
      else { expect(result.response.status).toBe(503); expect(payload.error.code).toBe('api_key_accounting_unavailable'); }
      const count = mode === 'deliver-fresh-price' ? 5 : 4;
      expect(fixture.network).toHaveBeenCalledTimes(count); expect(fixture.handles).toHaveLength(count);
      expect(fixture.completions).toHaveLength(count); expect(new Set(fixture.completions).size).toBe(count);
      expect(db.all('SELECT attemptId FROM apiKeyAccounting')).toHaveLength(count);
      for (const h of fixture.handles) expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId]))
        .toEqual({ state: 'settled', costNanoUsd: h.model === 'fixture-judge' ? 1350000 : 200000 });
      expect(fixture.legacy).not.toHaveBeenCalled();
    } finally { release(); await observed; }
  });
  it.each(['deliver', 'lost-ack', 'routing-drift', 'proxy-drift'])('nested outer judge own intent delivery, not installed row, authorizes POST: %s', async mode => {
    await configureNestedFusion();
    let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const { ApiKeyBudgetError } = await import('@/lib/apiKeyBudget/errors.js');
    const lost = new ApiKeyBudgetError('api_key_accounting_unavailable');
    fixture.afterIntent = async h => { if (h.model === 'fixture-judge') { enter(); await held; if (mode === 'lost-ack') throw lost; } };
    const observed = handleChat(request()).then(response => ({ response }), error => ({ error }));
    try {
      expect(await Promise.race([entered.then(() => null), observed])).toBeNull();
      expect(fixture.network).toHaveBeenCalledTimes(4); expect(fixture.handles).toHaveLength(5); expect(fixture.completions).toHaveLength(4);
      const judge = fixture.handles.find(h => h.model === 'fixture-judge');
      expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [judge.attemptId])).toEqual({ state: 'pending', costNanoUsd: null });
      if (mode === 'routing-drift') db.durableTransaction(() => db.run('UPDATE combos SET models=? WHERE name=?', ['["openai/fixture-a"]', 'right']));
      if (mode === 'proxy-drift') {
        const saved = await (await import('@/lib/db/repos/settingsRepo.js')).getSettings();
        db.durableTransaction(() => db.run('UPDATE settings SET data=? WHERE id=1', [JSON.stringify({ ...saved,
          outboundProxyEnabled: true, outboundProxyUrl: 'http://127.0.0.1:1', outboundNoProxy: 'different.fixture.invalid' })]));
      }
      release(); const result = await observed; expect(result.error).toBeUndefined();
      const payload = await result.response.json();
      if (mode === 'deliver') { expect(result.response.status).toBe(200); expect(payload.choices[0].message.content).toBe('fixture-judge'); }
      else { expect(result.response.status).toBe(503); expect(payload.error.code).toBe('api_key_accounting_unavailable'); }
      expect(fixture.network).toHaveBeenCalledTimes(mode === 'deliver' ? 5 : 4);
      expect(fixture.handles).toHaveLength(5); expect(db.all('SELECT attemptId FROM apiKeyAccounting')).toHaveLength(5);
      expect(fixture.completions).toHaveLength(mode === 'lost-ack' ? 4 : 5);
      expect(new Set(fixture.completions).size).toBe(fixture.completions.length);
      for (const h of fixture.handles) expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId]))
        .toEqual(h.model === 'fixture-judge' && mode !== 'deliver'
          ? { state: mode === 'lost-ack' ? 'pending' : 'not_dispatched', costNanoUsd: null }
          : { state: 'settled', costNanoUsd: 200000 });
      expect(fixture.legacy).not.toHaveBeenCalled();
    } finally { release(); await observed; }
  });
  it.each([false, true])('nested fallback panels preserve one context across app/core judge stream=%s', async stream => {
    const response = await handleChat(request(stream)); expect(response.status).toBe(200);
    if (stream) { const text = await response.text(); expect(text).toContain('judge prefix'); expect(text.endsWith('data: [DONE]\n\n')).toBe(true); }
    else expect((await response.json()).choices[0].message.content).toBe('fixture-judge');
    expect(fixture.contexts).toHaveLength(1); expect(fixture.network).toHaveBeenCalledTimes(3); expect(fixture.handles).toHaveLength(3);
    expect(new Set(fixture.handles.map(h => h.requestId))).toEqual(new Set([fixture.contexts[0].requestId]));
    expect(new Set(fixture.handles.map(h => h.attemptId)).size).toBe(3);
    for (const h of fixture.handles) expect(db.get('SELECT state,costNanoUsd,apiKeyId FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId])).toEqual({ state: 'settled', costNanoUsd: 200000, apiKeyId: 'a' });
    expect(fixture.legacy).not.toHaveBeenCalled();
  });
  it.each(['deliver', 'lost-ack', 'fresh-policy'])('app nested panels own ACK before fresh judge admission: %s', async mode => {
    let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const { ApiKeyBudgetError } = await import('@/lib/apiKeyBudget/errors.js');
    const lost = new ApiKeyBudgetError('api_key_accounting_unavailable');
    fixture.afterCompletion = async h => { if (h.model === 'fixture-b') { enter(); await held; if (mode === 'lost-ack') throw lost; } };
    const policy = await (await import('@/lib/apiKeyBudget/service.js')).createBudgetContext('a', { adapter: async () => db });
    if (mode === 'fresh-policy') policy.updatePolicy({ weeklyLimitUsd: '1', monthlyLimitUsd: '1', expectedVersion: 0 });
    const observed = handleChat(request()).then(response => ({ response }), error => ({ error }));
    try {
      const first = await Promise.race([entered.then(() => null), observed]); expect(first).toBeNull();
      expect(fixture.network).toHaveBeenCalledTimes(2); expect(fixture.handles).toHaveLength(2);
      for (const h of fixture.handles) expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId])).toEqual({ state: 'settled', costNanoUsd: 200000 });
      if (mode === 'fresh-policy') policy.updatePolicy({ weeklyLimitUsd: '0.0004', monthlyLimitUsd: '0.0004', expectedVersion: 1 });
      release(); const result = await observed; expect(result.error).toBeUndefined();
      const payload = await result.response.json();
      if (mode === 'deliver') { expect(result.response.status).toBe(200); expect(payload.choices[0].message.content).toBe('fixture-judge'); }
      else {
        expect(result.response.status).toBe(mode === 'fresh-policy' ? 429 : 503);
        expect(payload.error.code).toBe(mode === 'fresh-policy' ? 'api_key_budget_exceeded' : 'api_key_accounting_unavailable');
        expect(JSON.stringify(payload)).not.toContain('dummy-provider');
      }
      const count = mode === 'deliver' ? 3 : 2;
      expect(fixture.contexts).toHaveLength(1); expect(fixture.network).toHaveBeenCalledTimes(count); expect(fixture.handles).toHaveLength(count);
      expect(fixture.completions).toHaveLength(count); expect(new Set(fixture.completions).size).toBe(count);
      expect(db.all('SELECT attemptId FROM apiKeyAccounting')).toHaveLength(count);
      for (const h of fixture.handles) expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId])).toEqual({ state: 'settled', costNanoUsd: 200000 });
      expect(fixture.legacy).not.toHaveBeenCalled();
    } finally { release(); await observed; }
  });
  it.each(['oversize', 'cycle'])('actual queued app graph %s refuses before any intent or POST', async mode => {
    db.durableTransaction(() => db.run('UPDATE combos SET models=? WHERE name=?', [JSON.stringify(mode === 'oversize'
      ? Array.from({ length: 32 }, (_, i) => 'openai/fixture-' + i) : ['outer', 'right']), 'outer']));
    const response = await handleChat(request()); expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('api_key_accounting_unavailable');
    expect(fixture.contexts).toHaveLength(1); expect(fixture.handles).toHaveLength(0); expect(fixture.network).not.toHaveBeenCalled();
    expect(db.all('SELECT attemptId FROM apiKeyAccounting')).toHaveLength(0);
  });
  it('routing graph drift after collected panel settlement preserves money and refuses judge admission', async () => {
    let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    fixture.afterCompletion = async h => { if (h.model === 'fixture-b') { enter(); await held; } };
    const observed = handleChat(request()).then(response => ({ response }), error => ({ error }));
    try {
      expect(await Promise.race([entered.then(() => null), observed])).toBeNull();
      expect(fixture.network).toHaveBeenCalledTimes(2);
      db.durableTransaction(() => db.run('UPDATE combos SET models=? WHERE name=?', ['["openai/fixture-a"]', 'right']));
      release(); const result = await observed; expect(result.error).toBeUndefined(); expect(result.response.status).toBe(503);
      expect((await result.response.json()).error.code).toBe('api_key_accounting_unavailable');
      expect(fixture.handles).toHaveLength(2); expect(fixture.network).toHaveBeenCalledTimes(2); expect(fixture.completions).toHaveLength(2);
      for (const h of fixture.handles) expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId])).toEqual({ state: 'settled', costNanoUsd: 200000 });
      expect(db.all('SELECT attemptId FROM apiKeyAccounting')).toHaveLength(2);
    } finally { release(); await observed; }
  });
  it('actual invalid gateway key refuses before accounting/context/selection or POST', async () => {
    const response = await handleChat(request(false, 'dummy-invalid')); expect(response.status).toBe(401);
    expect(fixture.contexts).toHaveLength(0); expect(fixture.handles).toHaveLength(0); expect(fixture.network).not.toHaveBeenCalled();
    expect(db.all('SELECT attemptId FROM apiKeyAccounting')).toHaveLength(0);
  });
});
