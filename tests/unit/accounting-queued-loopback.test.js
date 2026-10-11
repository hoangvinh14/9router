import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

const fixtureEngine = process.env.ACCOUNTING_NATIVE_FIXTURE_ENGINE;
if (fixtureEngine !== undefined && !['node:sqlite', 'sql.js'].includes(fixtureEngine)) throw new Error('Unsupported native accounting fixture engine');
// Select SQL.js before DB open; ownership, coverage, migrations and the actual
// adapter remain production code. This is not a runtime fallback permission.
vi.mock('@/lib/db/engineAcquisition.js', async original => {
  const actual = await original(); return { ...actual, initializeAvailableAdapter(...args) {
    if (process.env.ACCOUNTING_NATIVE_FIXTURE_ENGINE === 'sql.js') return null;
    return actual.initializeAvailableAdapter(...args);
  } };
});
const registryFixture = vi.hoisted(() => ({ baseUrl: null }));
vi.mock('../../open-sse/config/providers.js', async importOriginal => ({ ...(await importOriginal()),
  PROVIDERS: { ...(await importOriginal()).PROVIDERS, get openai() { return { baseUrl: registryFixture.baseUrl }; } } }));
let db, directory, server, baseUrl, BaseExecutor, createAccounting, responder, received, serverFailure, previousCatalogSource;
const old = process.env.DATA_DIR;
// Transform modules outside timed hooks under gate isolation; no DB/network warm-up.
await Promise.all([import('@/sse/services/accountingRoutingResolver.js'), import('@/lib/db/adapters/sqljsAdapter.js')]);
const json = { choices: [{ message: { role: 'assistant', content: 'fixture' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } };
beforeEach(async () => {
  previousCatalogSource = globalThis.__9rCatalogSource;
  directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-queued-loopback-')); process.env.DATA_DIR = directory; delete global._dbAdapter; vi.resetModules();
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  if (fixtureEngine !== undefined) expect(db.driver).toBe(fixtureEngine);
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }, { id: 'b', key: 'dummy-key-b' }], settings: { requireApiKey: true, outboundProxyEnabled: true, outboundProxyUrl: 'http://127.0.0.1:1', outboundNoProxy: '127.0.0.1' },
    providerConnections: [{ id: 'c', provider: 'openai', authType: 'apikey', apiKey: 'dummy-provider' }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','openai',?)", [JSON.stringify({ 'fixture-chat': { input: '1', output: '2' } })]);
  });
  received = []; serverFailure = null;
  responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(json)); };
  server = http.createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const rows = db.all('SELECT requestId,apiKeyId,state FROM apiKeyAccounting');
      received.push({ method: request.method, authorization: request.headers.authorization, body, rows });
      await responder(request, response);
    } catch (error) { serverFailure = error; response.writeHead(500); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}/chat`;
  registryFixture.baseUrl = baseUrl; // Test-only registry; native fetch unchanged.
  ({ BaseExecutor } = await import('../../open-sse/executors/base.js'));
  createAccounting = async (id = 'a') => (await import('@/lib/apiKeyBudget/requestAccounting.js')).createRequestAccounting(new Request('http://localhost/v1/chat/completions', {
    headers: { Authorization: `Bearer dummy-key-${id}` } }), { adapter: async () => db, queued: true });
});
afterEach(async () => {
  if (previousCatalogSource === undefined) delete globalThis.__9rCatalogSource;
  else globalThis.__9rCatalogSource = previousCatalogSource;
  server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve));
  vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true });
  if (old === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = old;
});
const executor = (retry = {}) => new BaseExecutor('openai', { baseUrl, timeoutMs: 2000, retry });
const args = (accounting, marker) => ({ model: 'fixture-chat', body: { messages: [{ role: 'user', content: marker }] }, stream: false,
  credentials: { apiKey: 'dummy-provider' }, connectionId: 'c', accounting,
  // Valid saved NO_PROXY authority bypasses inherited env. No actual relay/proxy.
  proxyOptions: { persistedGlobalProxy: { url: 'http://127.0.0.1:1', noProxy: '127.0.0.1' } } });
describe('queued Base actual loopback native POST (not real provider/proxy/all family)', { timeout: 20000 }, () => {
  it.each(['unchanged', 'routing-drift', 'lost-refusal-ack', 'capacity-drift', 'lost-capacity-refusal-ack', 'catalog-drift', 'lost-catalog-refusal-ack'])('captured actual routing graph at native socket intent/terminal ACK boundaries: %s', async mode => {
    const capacity = mode.includes('capacity');
    const catalogDrift = mode.includes('catalog');
    const lostAck = mode.startsWith('lost-');
    let catalog;
    if (catalogDrift) {
      catalog = await import('../../open-sse/providers/catalogOverride.js');
      fs.writeFileSync(catalog.CATALOG_FILE, JSON.stringify({ models: {}, providers: {} }));
      await catalog.installCatalogSource();
    }
    if (capacity) await (await import('@/lib/db/repos/settingsRepo.js')).updateSettings({
      capacityAdapter: { vision: { enabled: true, models: ['openai/vision-model'] } } });
    await (await import('@/lib/db/repos/combosRepo.js')).createCombo({ name: 'routing-root', models: ['openai/fixture-chat'] });
    const context = await createAccounting();
    const { createAccountingRoutingResolver } = await import('@/sse/services/accountingRoutingResolver.js');
    await context.captureRoutingGraph('routing-root', createAccountingRoutingResolver({ model: 'routing-root', stream: false,
      messages: [{ role: 'user', content: 'native graph' }] }));
    let attempt, enterIntent, releaseIntent, enterTerminal, releaseTerminal;
    const intentEntered = new Promise(resolve => { enterIntent = resolve; }), intentHeld = new Promise(resolve => { releaseIntent = resolve; });
    const terminalEntered = new Promise(resolve => { enterTerminal = resolve; }), terminalHeld = new Promise(resolve => { releaseTerminal = resolve; });
    const lost = new Error('Fixture lost native routing refusal ACK');
    const completions = [];
    const accounting = { ...context,
      async beforeAttempt(...input) { attempt = await context.beforeAttempt(...input); enterIntent(); await intentHeld; return attempt; },
      async completeAttempt(h, completion) {
        completions.push({ id: h.attemptId, completion });
        const terminal = await context.completeAttempt(h, completion);
        if (mode !== 'unchanged') { enterTerminal(); await terminalHeld; if (lostAck) throw lost; }
        return terminal;
      } };
    let returned = false;
    const observed = executor({ 502: { attempts: 2, delayMs: 0 } }).execute(args(accounting, 'native graph'))
      .then(value => ({ value }), error => ({ error })).then(result => { returned = true; return result; });
    try {
      expect(await Promise.race([intentEntered.then(() => null), observed])).toBeNull();
      expect(received).toHaveLength(0); expect(returned).toBe(false);
      expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [attempt.attemptId]).state).toBe('pending');
      if (catalogDrift) fs.writeFileSync(catalog.CATALOG_FILE, JSON.stringify({
        models: { 'openai:fixture-chat': { vision: true } }, providers: {} }));
      else if (capacity) await (await import('@/lib/db/repos/settingsRepo.js')).updateSettings({
        capacityAdapter: { vision: { enabled: false, models: ['openai/vision-model'] } } });
      else if (mode !== 'unchanged') db.durableTransaction(() => db.run('UPDATE combos SET models=? WHERE name=?', ['["openai/changed"]', 'routing-root']));
      releaseIntent();
      if (mode !== 'unchanged') {
        expect(await Promise.race([terminalEntered.then(() => null), observed])).toBeNull();
        expect(returned).toBe(false); expect(received).toHaveLength(0);
        expect(completions).toEqual([{ id: attempt.attemptId, completion: { notDispatched: true, outcome: 'routing_refused' } }]);
        expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [attempt.attemptId]))
          .toEqual({ state: 'not_dispatched', costNanoUsd: null });
      }
      releaseTerminal(); const result = await observed;
      if (mode === 'unchanged') {
        expect(result.error).toBeUndefined(); expect(result.value.response.ok).toBe(true); expect(received).toHaveLength(1);
        expect(received[0].rows).toContainEqual({ requestId: context.requestId, apiKeyId: 'a', state: 'pending' });
        expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [attempt.attemptId]))
          .toEqual({ state: 'settled', costNanoUsd: 200000 });
      } else {
        expect(received).toHaveLength(0);
        if (lostAck) expect(result.error).toBe(lost);
        else expect(result.error).toMatchObject({ code: 'api_key_accounting_unavailable' });
      }
      expect(serverFailure).toBeNull(); expect(completions).toHaveLength(1);
      expect(db.all('SELECT attemptId,requestId FROM apiKeyAccounting')).toEqual([{ attemptId: attempt.attemptId, requestId: context.requestId }]);
      expect(db.coverage.status('a').gaps).toHaveLength(0);
    } finally { releaseIntent(); releaseTerminal(); await observed; }
  });
  it.each(['capacity', 'catalog'])('%s edit after actual failed POST preserves original bill and refuses retry successor', async authority => {
    const settings = await import('@/lib/db/repos/settingsRepo.js');
    let catalog;
    if (authority === 'catalog') {
      catalog = await import('../../open-sse/providers/catalogOverride.js');
      fs.writeFileSync(catalog.CATALOG_FILE, JSON.stringify({ v: 2, models: {}, providers: {} }));
      await catalog.installCatalogSource();
    } else await settings.updateSettings({ capacityAdapter: { vision: { enabled: true, models: ['openai/vision-model'] } } });
    const context = await createAccounting();
    const { createAccountingRoutingResolver } = await import('@/sse/services/accountingRoutingResolver.js');
    await context.captureRoutingGraph('openai/fixture-chat', createAccountingRoutingResolver({ model: 'openai/fixture-chat',
      stream: false, messages: [{ role: 'user', content: 'native capacity original' }] }));
    let attempt; const completions = [];
    const accounting = { ...context,
      async beforeAttempt(...input) { attempt = await context.beforeAttempt(...input); return attempt; },
      async completeAttempt(h, completion) {
        completions.push(h.attemptId); return context.completeAttempt(h, completion);
      } };
    responder = async (_request, response) => {
      expect(attempt).toBeTruthy();
      expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [attempt.attemptId]).state).toBe('pending');
      if (catalog) fs.writeFileSync(catalog.CATALOG_FILE, JSON.stringify({ v: 2,
        models: { 'openai:fixture-chat': { vision: true } }, providers: {} }));
      else await settings.updateSettings({ capacityAdapter: { vision: { enabled: false, models: ['openai/vision-model'] } } });
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='openai'",
        [JSON.stringify({ 'fixture-chat': { input: '9', output: '9' } })]));
      response.writeHead(429, { 'content-type': 'application/json' }); response.end(JSON.stringify(json));
    };
    await expect(executor({ 429: { attempts: 2, delayMs: 0 } }).execute(args(accounting, 'native capacity original')))
      .rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(serverFailure).toBeNull(); expect(received).toHaveLength(1);
    expect(received[0].rows).toContainEqual({ requestId: context.requestId, apiKeyId: 'a', state: 'pending' });
    expect(completions).toEqual([attempt.attemptId]);
    expect(db.all('SELECT attemptId,requestId,state,costNanoUsd,outcome FROM apiKeyAccounting')).toEqual([
      { attemptId: attempt.attemptId, requestId: context.requestId, state: 'settled', costNanoUsd: 200000, outcome: 'failed' } ]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['deliver', 'lost-delivery'])('two-key native completion delivery isolates shared executor/coordinator: %s', async mode => {
    const a = await createAccounting('a'), b = await createAccounting('b'), ex = executor();
    const { createAccountingRoutingResolver } = await import('@/sse/services/accountingRoutingResolver.js');
    for (const context of [a, b]) await context.captureRoutingGraph('openai/fixture-chat', createAccountingRoutingResolver({
      model: 'openai/fixture-chat', stream: false, messages: [{ role: 'user', content: 'native two-key' }] }));
    const handles = {}, completions = [], authorized = [];
    let enter, release, returnedA = false;
    const entered = new Promise(resolve => { enter = resolve; });
    const held = new Promise(resolve => { release = resolve; });
    const lost = new Error('Fixture lost two-key native completion delivery');
    const wrap = (context, key) => ({ ...context,
      async beforeAttempt(...input) { const h = await context.beforeAttempt(...input); handles[key] = h; return h; },
      async completeAttempt(h, completion) {
        const terminal = await context.completeAttempt(h, completion);
        completions.push({ key, attemptId: h.attemptId });
        if (key === 'a') { enter(); await held; if (mode === 'lost-delivery') throw lost; }
        return terminal;
      },
      assertSuccessfulTerminal(terminal) { context.assertSuccessfulTerminal(terminal); authorized.push(key); }
    });
    const workA = ex.execute(args(wrap(a, 'a'), 'a')).then(value => ({ value }), error => ({ error }))
      .then(result => { returnedA = true; return result; });
    let workB;
    try {
      expect(await Promise.race([entered.then(() => null), workA])).toBeNull();
      expect(returnedA).toBe(false); expect(received).toHaveLength(1); expect(authorized).toEqual([]);
      expect(db.get('SELECT apiKeyId,requestId,state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [handles.a.attemptId]))
        .toEqual({ apiKeyId: 'a', requestId: a.requestId, state: 'settled', costNanoUsd: 200000 });
      // B may obtain its own terminal while A's installed row is not A's delivered ACK.
      workB = ex.execute(args(wrap(b, 'b'), 'b')).then(value => ({ value }), error => ({ error }));
      const resultB = await workB;
      expect(resultB.error).toBeUndefined(); expect(resultB.value.response.ok).toBe(true);
      expect(returnedA).toBe(false); expect(authorized).toEqual(['b']); expect(received).toHaveLength(2);
      expect(handles.a.attemptId).not.toBe(handles.b.attemptId); expect(a.requestId).not.toBe(b.requestId);
      for (const [key, context] of [['a', a], ['b', b]]) {
        const post = received.find(r => r.body.messages[0].content === key);
        expect(post.rows).toContainEqual({ apiKeyId: key, requestId: context.requestId, state: 'pending' });
        expect(db.get('SELECT apiKeyId,requestId,state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [handles[key].attemptId]))
          .toEqual({ apiKeyId: key, requestId: context.requestId, state: 'settled', costNanoUsd: 200000 });
      }
      release(); const resultA = await workA;
      if (mode === 'lost-delivery') { expect(resultA.error).toBe(lost); expect(authorized).toEqual(['b']); }
      else { expect(resultA.error).toBeUndefined(); expect(resultA.value.response.ok).toBe(true); expect(authorized).toEqual(['b', 'a']); }
      expect(completions).toEqual([{ key: 'a', attemptId: handles.a.attemptId }, { key: 'b', attemptId: handles.b.attemptId }]);
      expect(received).toHaveLength(2); expect(serverFailure).toBeNull();
      expect(db.all('SELECT attemptId FROM apiKeyAccounting')).toHaveLength(2);
      for (const key of ['a', 'b']) expect(db.coverage.status(key).gaps).toHaveLength(0);
    } finally { release(); await workA; if (workB) await workB; }
  });
  it.each(['unlimited', 'budgeted-a'])('two simultaneous native POST owners isolate post-received cancellation across gateway keys: %s', async mode => {
    if (mode === 'budgeted-a') {
      const { createBudgetContext } = await import('@/lib/apiKeyBudget/service.js');
      const policy = await createBudgetContext('a', { adapter: async () => db });
      policy.updatePolicy({ weeklyLimitUsd: '100', monthlyLimitUsd: '100', expectedVersion: 0 });
    }
    const a = await createAccounting('a'), b = await createAccounting('b'), ex = executor();
    const { createAccountingRoutingResolver } = await import('@/sse/services/accountingRoutingResolver.js');
    for (const context of [a, b]) await context.captureRoutingGraph('openai/fixture-chat', createAccountingRoutingResolver({
      model: 'openai/fixture-chat', stream: false, messages: [{ role: 'user', content: 'native two-key cancel' }] }));
    let enterBoth, release;
    const bothReceived = new Promise(resolve => { enterBoth = resolve; });
    const held = new Promise(resolve => { release = resolve; });
    const serverOwners = [], handles = {}, completions = [], authorized = [];
    responder = (_request, response) => {
      const owner = held.then(() => {
        // Responding after cancellation does not assert that foreign work stopped.
        response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(json));
      }).then(() => null, error => { serverFailure = error; });
      serverOwners.push(owner);
      if (received.length === 2) enterBoth();
      return owner;
    };
    const wrap = (context, key) => ({ ...context,
      async beforeAttempt(...input) { const h = await context.beforeAttempt(...input); handles[key] = h; return h; },
      async completeAttempt(h, completion) {
        const terminal = await context.completeAttempt(h, completion); completions.push({ key, id: h.attemptId }); return terminal;
      },
      assertSuccessfulTerminal(terminal) { context.assertSuccessfulTerminal(terminal); authorized.push(key); }
    });
    const ctrl = new AbortController(), cancelled = new Error('Fixture two-key post-received cancellation');
    const workA = ex.execute({ ...args(wrap(a, 'a'), 'a'), signal: ctrl.signal }).then(value => ({ value }), error => ({ error }));
    let returnedB = false;
    const workB = ex.execute(args(wrap(b, 'b'), 'b')).then(value => ({ value }), error => ({ error }))
      .then(result => { returnedB = true; return result; });
    try {
      expect(await Promise.race([bothReceived.then(() => null), workA, workB])).toBeNull();
      expect(received).toHaveLength(2); expect(returnedB).toBe(false); expect(authorized).toEqual([]);
      for (const [key, context] of [['a', a], ['b', b]]) {
        const post = received.find(r => r.body.messages[0].content === key);
        expect(post.rows).toContainEqual({ apiKeyId: key, requestId: context.requestId, state: 'pending' });
        expect(db.get('SELECT apiKeyId,requestId,state FROM apiKeyAccounting WHERE attemptId=?', [handles[key].attemptId]))
          .toEqual({ apiKeyId: key, requestId: context.requestId, state: 'pending' });
      }
      ctrl.abort(cancelled); const resultA = await workA;
      expect(resultA.error).toBe(cancelled); expect(returnedB).toBe(false); expect(authorized).toEqual([]);
      expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [handles.a.attemptId]))
        .toEqual({ state: 'unresolved', costNanoUsd: null });
      expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [handles.b.attemptId]).state).toBe('pending');
      if (mode === 'budgeted-a') {
        // A's unknown bill is key-local; reject a fresh request before another intent/POST.
        await expect((async () => ex.execute(args(await createAccounting('a'), 'blocked-a')))())
          .rejects.toMatchObject({ code: 'api_key_accounting_unresolved' });
        expect(received).toHaveLength(2); expect(db.all('SELECT attemptId FROM apiKeyAccounting')).toHaveLength(2);
        expect(returnedB).toBe(false); expect(authorized).toEqual([]);
      }
      release(); const resultB = await workB; await Promise.all(serverOwners);
      expect(resultB.error).toBeUndefined(); expect(resultB.value.response.ok).toBe(true); expect(authorized).toEqual(['b']);
      expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [handles.b.attemptId]))
        .toEqual({ state: 'settled', costNanoUsd: 200000 });
      expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [handles.a.attemptId]))
        .toEqual({ state: 'unresolved', costNanoUsd: null });
      expect(completions).toEqual([{ key: 'a', id: handles.a.attemptId }, { key: 'b', id: handles.b.attemptId }]);
      expect(handles.a.attemptId).not.toBe(handles.b.attemptId); expect(a.requestId).not.toBe(b.requestId);
      expect(received).toHaveLength(2); expect(db.all('SELECT attemptId FROM apiKeyAccounting')).toHaveLength(2);
      expect(serverFailure).toBeNull(); for (const key of ['a', 'b']) expect(db.coverage.status(key).gaps).toHaveLength(0);
    } finally {
      release(); await Promise.all([workA, workB]);
      // Both client owners are drained before closing the socket/DB; retain late server work too.
      await Promise.all(serverOwners);
    }
  });
  it('two shared-executor requests POST only with own pending rows and settle separately', async () => {
    const a = await createAccounting('a'), b = await createAccounting('b'), ex = executor();
    const results = await Promise.all([ex.execute(args(a, 'a')), ex.execute(args(b, 'b'))]);
    expect(serverFailure).toBeNull(); expect(received).toHaveLength(2);
    for (const request of received) {
      const id = request.body.messages[0].content;
      expect(request).toMatchObject({ method: 'POST', authorization: 'Bearer dummy-provider' });
      expect(request.rows).toContainEqual({ requestId: id === 'a' ? a.requestId : b.requestId, apiKeyId: id, state: 'pending' });
    }
    expect(results.every(result => result.accountingOwned && result.response.ok)).toBe(true);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 200000 }, { state: 'settled', costNanoUsd: 200000 }]);
  });
  it('failed predecessor settlement ACK precedes successor pending intent and second POST', async () => {
    let count = 0;
    responder = (_request, response) => { response.writeHead(++count === 1 ? 429 : 200, { 'content-type': 'application/json' }); response.end(JSON.stringify(json)); };
    const context = await createAccounting(), ex = executor({ 429: { attempts: 1, delayMs: 0 } });
    const original = context.beforeAttempt;
    let admissions = 0;
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      if (++admissions === 2) expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 200000 }]);
      return original(meta, supported, wire);
    } };
    const result = await ex.execute(args(accounting, 'retry'));
    expect(serverFailure).toBeNull(); expect(result.response.ok).toBe(true); expect(received).toHaveLength(2);
    expect(received[1].rows.map(row => row.state).sort()).toEqual(['pending', 'settled']);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 200000 }, { state: 'settled', costNanoUsd: 200000 }]);
  });
  it.each(['deliver', 'lost-delivery'])('native retry second POST waits for successor own intent ACK: %s', async mode => {
    let count = 0;
    responder = (_request, response) => { response.writeHead(++count === 1 ? 429 : 200, { 'content-type': 'application/json' }); response.end(JSON.stringify(json)); };
    const context = await createAccounting(); let admissions = 0, completed = 0, enter, release;
    const entered = new Promise(resolve => { enter = resolve; });
    const held = new Promise(resolve => { release = resolve; });
    const lost = new Error('Fixture lost native successor intent handle');
    const accounting = { ...context,
      async beforeAttempt(...input) {
        admissions++; const attempt = await context.beforeAttempt(...input);
        if (admissions === 2) { enter(); await held; if (mode === 'lost-delivery') throw lost; }
        return attempt;
      },
      async completeAttempt(...input) { const terminal = await context.completeAttempt(...input); completed++; return terminal; }
    };
    let returned = false;
    const work = executor({ 429: { attempts: 1, delayMs: 0 } }).execute(args(accounting, 'native-successor-ack'))
      .then(value => ({ value }), error => ({ error })).then(result => { returned = true; return result; });
    try {
      await entered;
      expect(serverFailure).toBeNull(); expect(received).toHaveLength(1); expect(returned).toBe(false);
      expect(admissions).toBe(2); expect(completed).toBe(1);
      expect(received[0]).toMatchObject({ method: 'POST', authorization: 'Bearer dummy-provider' });
      expect(received[0].rows).toContainEqual({ requestId: context.requestId, apiKeyId: 'a', state: 'pending' });
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([
        { state: 'settled', costNanoUsd: 200000 }, { state: 'pending', costNanoUsd: null }]);
    } finally { release(); }
    const result = await work;
    expect(serverFailure).toBeNull();
    if (mode === 'deliver') {
      expect(result.error).toBeUndefined(); expect(result.value.response.ok).toBe(true); expect(received).toHaveLength(2); expect(completed).toBe(2);
      expect(received[1]).toMatchObject({ method: 'POST', authorization: 'Bearer dummy-provider' });
      expect(received[1].rows.map(row => row.state).sort()).toEqual(['pending', 'settled']);
      const rows = db.all('SELECT attemptId,requestId,state,costNanoUsd FROM apiKeyAccounting');
      expect(new Set(rows.map(row => row.attemptId)).size).toBe(2); expect(new Set(rows.map(row => row.requestId)).size).toBe(1);
      expect(rows.map(row => [row.state, row.costNanoUsd])).toEqual([['settled', 200000], ['settled', 200000]]);
    } else {
      expect(result.error).toBe(lost); expect(received).toHaveLength(1); expect(completed).toBe(1);
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([
        { state: 'settled', costNanoUsd: 200000 }, { state: 'pending', costNanoUsd: null }]);
    }
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['fresh-price', 'exhausted'])('native retry preserves predecessor price and fresh successor gate: %s', async mode => {
    if (mode === 'exhausted') {
      const { createBudgetContext } = await import('@/lib/apiKeyBudget/service.js');
      const policy = await createBudgetContext('a', { adapter: async () => db });
      policy.updatePolicy({ weeklyLimitUsd: '0.0002', monthlyLimitUsd: '0.0002', expectedVersion: 0 });
    }
    let count = 0;
    responder = (_request, response) => {
      if (++count === 1) {
        expect(db.get('SELECT state FROM apiKeyAccounting').state).toBe('pending');
        db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='openai'", [JSON.stringify({ 'fixture-chat': { input: '10', output: '20' } })]));
      }
      response.writeHead(count === 1 ? 429 : 200, { 'content-type': 'application/json' }); response.end(JSON.stringify(json));
    };
    const context = await createAccounting(), ex = executor({ 429: { attempts: 1, delayMs: 0 } });
    let admissions = 0, completed = 0;
    const accounting = { ...context,
      async beforeAttempt(...input) {
        admissions++;
        if (admissions === 2) expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 200000 }]);
        return context.beforeAttempt(...input);
      },
      async completeAttempt(...input) { const terminal = await context.completeAttempt(...input); completed++; return terminal; }
    };
    if (mode === 'exhausted') {
      await expect(ex.execute(args(accounting, 'native-budget-exhausted'))).rejects.toMatchObject({ code: 'api_key_budget_exceeded' });
      expect(received).toHaveLength(1); expect(admissions).toBe(1); expect(completed).toBe(1);
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 200000 }]);
    } else {
      const result = await ex.execute(args(accounting, 'native-fresh-price'));
      expect(result.response.ok).toBe(true); expect(received).toHaveLength(2); expect(admissions).toBe(2); expect(completed).toBe(2);
      expect(received[1].rows.map(row => row.state).sort()).toEqual(['pending', 'settled']);
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([
        { state: 'settled', costNanoUsd: 200000 }, { state: 'settled', costNanoUsd: 2000000 }]);
    }
    expect(serverFailure).toBeNull(); expect(received[0]).toMatchObject({ method: 'POST', authorization: 'Bearer dummy-provider' });
    expect(received[0].rows).toContainEqual({ requestId: context.requestId, apiKeyId: 'a', state: 'pending' });
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('native success remains blocked until its queued terminal ACK is handed back', async () => {
    const context = await createAccounting();
    let releaseTerminal, enteredTerminal;
    const held = new Promise(resolve => { releaseTerminal = resolve; });
    const entered = new Promise(resolve => { enteredTerminal = resolve; });
    const accounting = { ...context, async completeAttempt(attempt, terminal) {
      enteredTerminal(); await held; return context.completeAttempt(attempt, terminal);
    } };
    let returned = false;
    const work = executor().execute(args(accounting, 'held-terminal'));
    const observed = work.then(result => { returned = true; return result; });
    try {
      await entered;
      expect(serverFailure).toBeNull(); expect(received).toHaveLength(1); expect(returned).toBe(false);
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'pending', costNanoUsd: null }]);
    } finally { releaseTerminal(); }
    const result = await observed;
    expect(result.response.ok).toBe(true);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 200000 }]);
  });
  it('lost terminal-handle delivery after native failed POST cannot authorize a successor POST', async () => {
    responder = (_request, response) => { response.writeHead(429, { 'content-type': 'application/json' }); response.end(JSON.stringify(json)); };
    const context = await createAccounting();
    const lost = new Error('Fixture lost owner terminal handle');
    let admissions = 0;
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      admissions++; return context.beforeAttempt(meta, supported, wire);
    }, async completeAttempt(attempt, terminal) {
      await context.completeAttempt(attempt, terminal);
      // Synthetic lost owner delivery AFTER real queued settlement ACK, not a
      // storage uncertainty/power-loss certificate or permission to recover ACK.
      throw lost;
    } };
    await expect(executor({ 429: { attempts: 1, delayMs: 0 } }).execute(args(accounting, 'lost-terminal'))).rejects.toBe(lost);
    expect(serverFailure).toBeNull(); expect(received).toHaveLength(1); expect(admissions).toBe(1);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 200000 }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('price changes at native upstream cannot replace the stored original terminal price', async () => {
    responder = (_request, response) => {
      expect(db.get('SELECT state FROM apiKeyAccounting').state).toBe('pending');
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='openai'", [JSON.stringify({ 'fixture-chat': { input: '10', output: '20' } })]));
      response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(json));
    };
    const context = await createAccounting();
    const result = await executor().execute(args(context, 'original-price'));
    expect(serverFailure).toBeNull(); expect(received).toHaveLength(1); expect(result.response.ok).toBe(true);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 200000 }]);
    expect(JSON.parse(db.get("SELECT value FROM kv WHERE scope='pricing' AND key='openai'").value)['fixture-chat']).toEqual({ input: '10', output: '20' });
  });
  it.each([
    ['explicit-cache-reasoning', { input: '1', output: '2', cached: '0.25', cache_creation: '1.5', reasoning: '3' }, 195000],
    ['explicit-cache-zero', { input: '1', output: '2', cached: '0', cache_creation: '0', reasoning: '3' }, 170000],
    ['documented-price-fallback', { input: '1', output: '2' }, 200000],
  ])('native raw usage %s preserves inclusive cache/reasoning and original rates', async (_name, rates, expectedCost) => {
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='openai'", [JSON.stringify({ 'fixture-chat': rates })]));
    responder = (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ...json, usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150,
        prompt_tokens_details: { cached_tokens: 40, cache_write_tokens: 10 }, completion_tokens_details: { reasoning_tokens: 20 } } }));
    };
    const context = await createAccounting();
    const result = await executor().execute(args(context, 'cache-reasoning'));
    expect(serverFailure).toBeNull(); expect(received).toHaveLength(1); expect(result.response.ok).toBe(true);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: expectedCost }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('native contradictory raw cache subsets are unresolved, never estimated exact/free', async () => {
    responder = (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ...json, usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150,
        prompt_tokens_details: { cached_tokens: 90, cache_write_tokens: 20 } } }));
    };
    const context = await createAccounting();
    const result = await executor().execute(args(context, 'invalid-cache'));
    expect(serverFailure).toBeNull(); expect(received).toHaveLength(1); expect(result.response.ok).toBe(true);
    // This disposable key is unlimited: unresolved success is allowed only
    // after its own recorded terminal ACK. Budgeted behavior is a separate gate.
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', costNanoUsd: null }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['complete', 'missing-DONE', 'conflicting-usage'])('native buffered SSE %s requires terminal authority, not observed counts', async mode => {
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='openai'", [JSON.stringify({ 'fixture-chat': {
      input: '1', output: '2', cached: '0.25', cache_creation: '1.5', reasoning: '3' } })]));
    const raw = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150,
      prompt_tokens_details: { cached_tokens: 40, cache_write_tokens: 10 }, completion_tokens_details: { reasoning_tokens: 20 } };
    const frame = value => `data: ${JSON.stringify(value)}\r\n\r\n`;
    const payload = frame({ choices: [{ delta: { content: 'fixture-✓' }, finish_reason: 'stop' }] }) + frame({ choices: [], usage: raw }) +
      (mode === 'conflicting-usage' ? frame({ choices: [], usage: { ...raw, prompt_tokens: 101, total_tokens: 151 } }) : '') +
      (mode === 'missing-DONE' ? '' : 'data: [DONE]\r\n\r\n');
    responder = async (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      // Native writes use bounded chunks and actual event-loop yields, no sleeps.
      // TCP may coalesce writes; helper decoder tests prove arbitrary byte splits.
      const bytes = Buffer.from(payload);
      for (let i = 0; i < bytes.length; i += 7) { response.write(bytes.subarray(i, i + 7)); await new Promise(resolve => setImmediate(resolve)); }
      response.end();
    };
    const context = await createAccounting();
    const result = await executor().execute({ ...args(context, 'raw-sse'), stream: true, accountingMode: 'buffered-openai-sse' });
    expect(serverFailure).toBeNull(); expect(received).toHaveLength(1); expect(received[0]).toMatchObject({ method: 'POST', authorization: 'Bearer dummy-provider' });
    expect(received[0].rows).toContainEqual({ requestId: context.requestId, apiKeyId: 'a', state: 'pending' });
    expect(received[0].body).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect(await result.response.text()).toBe(payload);
    const row = db.get('SELECT state,costNanoUsd,terminalJson FROM apiKeyAccounting');
    expect(row).toMatchObject({ state: mode === 'complete' ? 'settled' : 'unresolved', costNanoUsd: mode === 'complete' ? 195000 : null });
    if (mode !== 'complete') expect(JSON.parse(row.terminalJson).usageEvidence).toMatchObject({ kind: 'raw_usage_observation',
      reason: mode === 'missing-DONE' ? 'missing_terminal' : 'invalid_stream', observedCounts: { input: 100, output: 50, cacheRead: 40, cacheWrite: 10, reasoning: 20 } });
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('budgeted native unknown terminal blocks same-key successor but not an independent key', async () => {
    const { createBudgetContext } = await import('@/lib/apiKeyBudget/service.js');
    const policy = await createBudgetContext('a', { adapter: async () => db });
    policy.updatePolicy({ weeklyLimitUsd: '100', monthlyLimitUsd: '100', expectedVersion: 0 });
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ...json, usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150,
        prompt_tokens_details: { cached_tokens: 90, cache_write_tokens: 20 } } })); };
    const a = await createAccounting('a');
    await expect(executor().execute(args(a, 'unknown-a'))).rejects.toMatchObject({ code: 'api_key_accounting_unresolved' });
    expect(serverFailure).toBeNull(); expect(received).toHaveLength(1);
    expect(db.all('SELECT apiKeyId,state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ apiKeyId: 'a', state: 'unresolved', costNanoUsd: null }]);
    await expect(executor().execute(args(await createAccounting('a'), 'blocked-a'))).rejects.toMatchObject({ code: 'api_key_accounting_unresolved' });
    expect(received).toHaveLength(1);
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(json)); };
    const b = await createAccounting('b'); const result = await executor().execute(args(b, 'independent-b'));
    expect(serverFailure).toBeNull(); expect(result.response.ok).toBe(true); expect(received).toHaveLength(2);
    expect(received[1].rows).toContainEqual({ requestId: b.requestId, apiKeyId: 'b', state: 'pending' });
    expect(db.all('SELECT apiKeyId,state,costNanoUsd FROM apiKeyAccounting')).toEqual([
      { apiKeyId: 'a', state: 'unresolved', costNanoUsd: null }, { apiKeyId: 'b', state: 'settled', costNanoUsd: 200000 }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0); expect(db.coverage.status('b').gaps).toHaveLength(0);
  });
  it('native live SSE holds terminal bytes until its own queued ACK', async () => {
    const delta = 'data: {"choices":[{"index":0,"delta":{"content":"fixture"}}]}\n\n';
    const terminal = 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n' +
      `data: ${JSON.stringify({ choices: [], usage: json.usage })}\n\n` + 'data: [DONE]\n\n';
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(delta + terminal); };
    const context = await createAccounting();
    let release, entered;
    const held = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
    const accounting = { ...context, async completeAttempt(attempt, completion) { entered(); await held; return context.completeAttempt(attempt, completion); } };
    const result = await executor().execute({ ...args(accounting, 'live-held'), stream: true, accountingMode: 'live-openai-sse' });
    const reader = result.response.body.getReader(); const decode = new TextDecoder();
    expect(decode.decode((await reader.read()).value)).toBe(delta);
    let delivered = false;
    const next = reader.read().then(value => { delivered = true; return value; });
    try {
      await started;
      expect(delivered).toBe(false); expect(serverFailure).toBeNull(); expect(received).toHaveLength(1);
      expect(received[0].rows).toContainEqual({ requestId: context.requestId, apiKeyId: 'a', state: 'pending' });
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'pending', costNanoUsd: null }]);
    } finally { release(); }
    let text = delta; let chunk = await next;
    while (!chunk.done) { text += decode.decode(chunk.value, { stream: true }); chunk = await reader.read(); }
    text += decode.decode(); reader.releaseLock();
    expect(text).toBe(delta + terminal); expect(result.accountingLive).toBe(true);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 200000 }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('native live EOF without DONE errors delivery and retains observation only after queued terminal ACK', async () => {
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(`data: ${JSON.stringify({ choices: [], usage: json.usage })}\n\n`); };
    const context = await createAccounting();
    let ack;
    const acknowledged = new Promise(resolve => { ack = resolve; });
    const accounting = { ...context, async completeAttempt(attempt, completion) {
      const result = await context.completeAttempt(attempt, completion); ack(result); return result;
    } };
    const result = await executor().execute({ ...args(accounting, 'live-eof'), stream: true, accountingMode: 'live-openai-sse' });
    await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable');
    expect(await acknowledged).toMatchObject({ state: 'unresolved', costNanoUsd: null });
    expect(serverFailure).toBeNull(); expect(received).toHaveLength(1);
    const row = db.get('SELECT state,costNanoUsd,terminalJson FROM apiKeyAccounting');
    expect(row).toMatchObject({ state: 'unresolved', costNanoUsd: null });
    expect(JSON.parse(row.terminalJson).usageEvidence).toMatchObject({ reason: 'missing_terminal', observedCounts: { input: 100, output: 50 } });
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('native live downstream cancellation keeps a sole unresolved aborted owner, no replay', async () => {
    const delta = 'data: {"choices":[{"index":0,"delta":{"content":"fixture"}}]}\n\n';
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.write(delta); };
    const context = await createAccounting();
    let ack, completions = 0;
    const acknowledged = new Promise(resolve => { ack = resolve; });
    const accounting = { ...context, async completeAttempt(attempt, completion) {
      completions++; const result = await context.completeAttempt(attempt, completion); ack(result); return result;
    } };
    const result = await executor().execute({ ...args(accounting, 'live-cancel'), stream: true, accountingMode: 'live-openai-sse' });
    const reader = result.response.body.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(delta);
    await reader.cancel(false); reader.releaseLock();
    expect(await acknowledged).toMatchObject({ state: 'unresolved', costNanoUsd: null });
    expect(serverFailure).toBeNull(); expect(received).toHaveLength(1); expect(completions).toBe(1);
    const row = db.get('SELECT state,costNanoUsd,terminalJson FROM apiKeyAccounting');
    expect(row).toMatchObject({ state: 'unresolved', costNanoUsd: null }); expect(JSON.parse(row.terminalJson).outcome).toBe('aborted');
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('dequeue config refusal prevents socket POST, rows and unlimited gap permission', async () => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      const result = context.beforeAttempt(meta, supported, wire);
      db.durableTransaction(() => db.run("UPDATE settings SET data='{}' WHERE id=1")); return result;
    } };
    await expect(executor().execute(args(accounting, 'deny'))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(received).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
});
