import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

const registryFixture = vi.hoisted(() => ({ baseUrl: null }));
vi.mock('../../open-sse/config/providers.js', async importOriginal => ({ ...(await importOriginal()),
  PROVIDERS: { ...(await importOriginal()).PROVIDERS, get openai() { return { baseUrl: registryFixture.baseUrl }; } } }));
let db, directory, server, baseUrl, BaseExecutor, createAccounting, responder, received, serverFailure;
const old = process.env.DATA_DIR;
const json = { choices: [{ message: { role: 'assistant', content: 'fixture' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } };
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-queued-loopback-')); process.env.DATA_DIR = directory; delete global._dbAdapter; vi.resetModules();
  db = await (await import('@/lib/db/driver.js')).getAdapter();
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
