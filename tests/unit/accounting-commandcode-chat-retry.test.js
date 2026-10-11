import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandCodeExecutor } from 'open-sse/executors/commandcode.js';
const fixture = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => fixture.post(...args) }));
let db, directory, accounting;
const previous = process.env.DATA_DIR, model = 'deepseek/deepseek-v4-pro';
beforeEach(async () => {
  vi.resetModules(); fixture.post.mockReset(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-commandcode-chat-retry-'));
  process.env.DATA_DIR = directory; delete global._dbAdapter;
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }], settings: { requireApiKey: true },
    providerConnections: [{ id: 'c', provider: 'commandcode', authType: 'apikey', apiKey: 'dummy-api-key', providerSpecificData: {} }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','commandcode',?)", [JSON.stringify({ [model]: { input: '1', output: '2' } })]);
  });
  accounting = await (await import('@/lib/apiKeyBudget/requestAccounting.js')).createRequestAccounting(
    new Request('http://localhost/v1/chat/completions', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true });
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous; });
const options = context => ({ model, stream: true, connectionId: 'c', accounting: context, accountingMode: 'chat-commandcode-ndjson-retry',
  body: { model, stream: true, max_tokens: 64, temperature: 0.3, messages: [{ role: 'user', content: 'fixture prompt' }] },
  credentials: { apiKey: 'dummy-api-key', connectionId: 'c', providerSpecificData: {} }, proxyOptions: null, providerOverrides: null });
const initialError = () => new Response(JSON.stringify({ type: 'error', error: { statusCode: 503, message: 'fixture failure' } }) + '\n', { headers: { 'content-type': 'application/x-ndjson' } });
const success = () => {
  const usage = { inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 0, reasoningTokens: 0 };
  return [{ type: 'start' }, { type: 'start-step' }, { type: 'text-start', id: 'fixture' }, { type: 'text-delta', id: 'fixture', text: 'fixture output' },
    { type: 'text-end', id: 'fixture' }, { type: 'finish-step', finishReason: 'stop', usage }, { type: 'finish', finishReason: 'stop', totalUsage: usage }].map(event => JSON.stringify(event) + '\n').join('');
};
describe('actual CommandCodeExecutor Chat retry opt-in (mock POST/actual ledger, real delays)', { timeout: 20000 }, () => {
  it('raw initial503 owns unresolved predecessor then distinct intent/successor while retaining original conversion', async () => {
    const prepared = [], attempts = [], before = vi.fn(async (meta, supported, wire) => {
      prepared.push(wire); const attempt = await accounting.beforeAttempt(meta, supported, wire); attempts.push(attempt); return attempt;
    });
    let args; const complete = vi.fn(async (...input) => {
      const terminal = await accounting.completeAttempt(...input);
      if (complete.mock.calls.length === 1) { args.body.messages[0].content = 'caller changed'; args.credentials.apiKey = 'caller changed'; }
      return terminal;
    });
    fixture.post.mockImplementationOnce(() => initialError()).mockImplementationOnce(() => {
      expect(attempts).toHaveLength(2);
      expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [attempts[0].attemptId])).toEqual({ state: 'unresolved' });
      expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [attempts[1].attemptId])).toEqual({ state: 'pending' });
      return new Response(success(), { headers: { 'content-type': 'application/x-ndjson' } });
    });
    args = options({ ...accounting, beforeAttempt: before, completeAttempt: complete });
    const result = await new CommandCodeExecutor().execute(args); expect(await result.response.text()).toBe(success());
    expect(fixture.post).toHaveBeenCalledTimes(2); expect(before).toHaveBeenCalledTimes(2); expect(complete).toHaveBeenCalledTimes(2);
    expect(prepared[0].commandCodeTransport.serializedBody).toBe(prepared[1].commandCodeTransport.serializedBody);
    expect(prepared[0].commandCodeTransport.sessionId).not.toBe(prepared[1].commandCodeTransport.sessionId);
    expect(db.all('SELECT attemptId FROM apiKeyAccounting')).toHaveLength(2);
    const rows = attempts.map(attempt => db.get('SELECT attemptId,requestId,state,outcome,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [attempt.attemptId]));
    expect(rows).toHaveLength(2); expect(rows[0].attemptId).not.toBe(rows[1].attemptId); expect(rows[0].requestId).toBe(rows[1].requestId);
    expect(rows[0]).toMatchObject({ state: 'unresolved', outcome: 'failed', costNanoUsd: null });
    expect(rows[1]).toMatchObject({ state: 'settled', outcome: 'success', costNanoUsd: 140000 });
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['deliver', 'lost-delivery', 'abort-after-delivery'])('predecessor own terminal ACK gates successor creation: %s', async mode => {
    let enter, release; const installed = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const controller = new AbortController(), lost = new Error('fixture lost Chat retry predecessor handle');
    const before = vi.fn((...args) => accounting.beforeAttempt(...args)), gate = vi.fn(() => accounting.gate());
    const complete = vi.fn(async (...args) => {
      const terminal = await accounting.completeAttempt(...args);
      if (complete.mock.calls.length === 1) {
        enter(); await held; if (mode === 'lost-delivery') throw lost;
        if (mode === 'abort-after-delivery') controller.abort(false);
      }
      return terminal;
    });
    fixture.post.mockImplementationOnce(initialError).mockImplementationOnce(() => new Response(success(), { headers: { 'content-type': 'application/x-ndjson' } }));
    const args = options({ ...accounting, beforeAttempt: before, completeAttempt: complete, gate }); args.signal = controller.signal;
    let returned = false;
    const work = new CommandCodeExecutor().execute(args).then(value => ({ value }), error => ({ error })).then(result => { returned = true; return result; });
    try {
      await installed; expect(returned).toBe(false); expect(before).toHaveBeenCalledTimes(1); expect(fixture.post).toHaveBeenCalledTimes(1);
      expect(complete).toHaveBeenCalledTimes(1); expect(gate).not.toHaveBeenCalled();
      expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', outcome: 'failed', costNanoUsd: null }]);
    } finally { release(); }
    const result = await work;
    if (mode === 'deliver') {
      expect(await result.value.response.text()).toBe(success()); expect(before).toHaveBeenCalledTimes(2); expect(fixture.post).toHaveBeenCalledTimes(2); expect(complete).toHaveBeenCalledTimes(2);
      expect(gate).toHaveBeenCalled();
    } else {
      expect(result.error).toBe(mode === 'lost-delivery' ? lost : false); expect(before).toHaveBeenCalledTimes(1); expect(fixture.post).toHaveBeenCalledTimes(1);
      expect(complete).toHaveBeenCalledTimes(1); expect(gate).not.toHaveBeenCalled();
      expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', outcome: 'failed', costNanoUsd: null }]);
    }
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['deliver', 'lost-delivery', 'abort-after-delivery'])('successor own intent ACK gates POST2: %s', async mode => {
    let enter, release, successor; const installed = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const controller = new AbortController(), lost = new Error('fixture lost Chat retry successor intent handle');
    const before = vi.fn(async (...args) => {
      const attempt = await accounting.beforeAttempt(...args);
      if (before.mock.calls.length === 2) {
        successor = attempt; enter(); await held; if (mode === 'lost-delivery') throw lost;
        if (mode === 'abort-after-delivery') controller.abort(false);
      }
      return attempt;
    });
    const complete = vi.fn((...args) => accounting.completeAttempt(...args));
    fixture.post.mockImplementationOnce(initialError).mockImplementationOnce(() => new Response(success(), { headers: { 'content-type': 'application/x-ndjson' } }));
    const args = options({ ...accounting, beforeAttempt: before, completeAttempt: complete }); args.signal = controller.signal;
    let returned = false;
    const work = new CommandCodeExecutor().execute(args).then(value => ({ value }), error => ({ error })).then(result => { returned = true; return result; });
    try {
      await installed; expect(returned).toBe(false); expect(before).toHaveBeenCalledTimes(2); expect(fixture.post).toHaveBeenCalledTimes(1); expect(complete).toHaveBeenCalledTimes(1);
      expect(db.all('SELECT attemptId FROM apiKeyAccounting')).toHaveLength(2);
      expect(db.get('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [successor.attemptId])).toEqual({ state: 'pending', outcome: null, costNanoUsd: null });
    } finally { release(); }
    const result = await work;
    if (mode === 'deliver') {
      expect(await result.value.response.text()).toBe(success()); expect(fixture.post).toHaveBeenCalledTimes(2); expect(complete).toHaveBeenCalledTimes(2);
      expect(db.get('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [successor.attemptId])).toEqual({ state: 'settled', outcome: 'success', costNanoUsd: 140000 });
    } else {
      expect(result.error).toBe(mode === 'lost-delivery' ? lost : false); expect(fixture.post).toHaveBeenCalledTimes(1);
      expect(complete).toHaveBeenCalledTimes(mode === 'lost-delivery' ? 1 : 2);
      expect(db.get('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [successor.attemptId])).toEqual(
        mode === 'lost-delivery' ? { state: 'pending', outcome: null, costNanoUsd: null } : { state: 'not_dispatched', outcome: 'aborted', costNanoUsd: null });
      if (mode === 'abort-after-delivery') expect(complete.mock.calls[1][1]).toEqual({ notDispatched: true, outcome: 'aborted' });
    }
    expect(before).toHaveBeenCalledTimes(2); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('persisted credential rotation after own predecessor completion refuses successor without rebuild or POST2', async () => {
    const before = vi.fn((...args) => accounting.beforeAttempt(...args));
    const complete = vi.fn(async (...args) => {
      const terminal = await accounting.completeAttempt(...args);
      db.durableTransaction(() => {
        const data = JSON.parse(db.get('SELECT data FROM providerConnections WHERE id=?', ['c']).data);
        data.apiKey = 'dummy-rotated'; db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify(data), 'c']);
      });
      return terminal;
    });
    fixture.post.mockImplementation(initialError);
    await expect(new CommandCodeExecutor().execute(options({ ...accounting, beforeAttempt: before, completeAttempt: complete }))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(before).toHaveBeenCalledTimes(2); expect(complete).toHaveBeenCalledTimes(1); expect(fixture.post).toHaveBeenCalledTimes(1);
    expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', outcome: 'failed', costNanoUsd: null }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('budgeted unresolved predecessor blocks successor admission/POST after own completion', async () => {
    const policy = await (await import('@/lib/apiKeyBudget/service.js')).createBudgetContext('a', { adapter: async () => db });
    policy.updatePolicy({ weeklyLimitUsd: '100', monthlyLimitUsd: '100', expectedVersion: 0 });
    const before = vi.fn((...input) => accounting.beforeAttempt(...input)), complete = vi.fn((...input) => accounting.completeAttempt(...input));
    fixture.post.mockImplementation(initialError);
    await expect(new CommandCodeExecutor().execute(options({ ...accounting, beforeAttempt: before, completeAttempt: complete }))).rejects.toMatchObject({ code: 'api_key_accounting_unresolved' });
    expect(before).toHaveBeenCalledTimes(1); expect(complete).toHaveBeenCalledTimes(1); expect(fixture.post).toHaveBeenCalledTimes(1);
    expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', outcome: 'failed', costNanoUsd: null }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('exhausts exactly three generations with distinct own intents/completions and real1s/2s backoff', async () => {
    const attempts = [], before = vi.fn(async (...args) => { const attempt = await accounting.beforeAttempt(...args); attempts.push(attempt); return attempt; });
    const complete = vi.fn((...args) => accounting.completeAttempt(...args));
    fixture.post.mockImplementation(initialError);
    const result = await new CommandCodeExecutor().execute(options({ ...accounting, beforeAttempt: before, completeAttempt: complete }));
    expect(result.response.status).toBe(503); expect(before).toHaveBeenCalledTimes(3); expect(complete).toHaveBeenCalledTimes(3); expect(fixture.post).toHaveBeenCalledTimes(3);
    expect(new Set(attempts.map(attempt => attempt.attemptId)).size).toBe(3);
    expect(new Set(fixture.post.mock.calls.map(call => call[1].headers['x-session-id'])).size).toBe(3);
    expect(new Set(fixture.post.mock.calls.map(call => call[1].body)).size).toBe(1);
    expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toHaveLength(3);
    for (const attempt of attempts) expect(db.get('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [attempt.attemptId])).toEqual({ state: 'unresolved', outcome: 'failed', costNanoUsd: null });
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('raw initial429 completes once without successor', async () => {
    fixture.post.mockImplementation(() => new Response(JSON.stringify({ type: 'error', error: { statusCode: 429, message: 'fixture limit' } }) + '\n', { headers: { 'content-type': 'application/x-ndjson' } }));
    const complete = vi.fn((...args) => accounting.completeAttempt(...args));
    const result = await new CommandCodeExecutor().execute(options({ ...accounting, completeAttempt: complete }));
    expect(result.response.status).toBe(429); expect(complete).toHaveBeenCalledTimes(1); expect(fixture.post).toHaveBeenCalledTimes(1);
    expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', outcome: 'failed', costNanoUsd: null }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('successor admission snapshots new price without rewriting predecessor', async () => {
    const attempts = [], before = vi.fn(async (...args) => { const attempt = await accounting.beforeAttempt(...args); attempts.push(attempt); return attempt; });
    const complete = vi.fn(async (...args) => {
      const terminal = await accounting.completeAttempt(...args);
      if (complete.mock.calls.length === 1) db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='commandcode'", [JSON.stringify({ [model]: { input: '9', output: '9' } })]));
      return terminal;
    });
    fixture.post.mockImplementationOnce(initialError).mockImplementationOnce(() => new Response(success(), { headers: { 'content-type': 'application/x-ndjson' } }));
    const result = await new CommandCodeExecutor().execute(options({ ...accounting, beforeAttempt: before, completeAttempt: complete }));
    expect(await result.response.text()).toBe(success()); expect(attempts).toHaveLength(2); expect(complete).toHaveBeenCalledTimes(2); expect(fixture.post).toHaveBeenCalledTimes(2);
    const rows = attempts.map(attempt => db.get('SELECT state,outcome,costNanoUsd,priceSnapshotJson FROM apiKeyAccounting WHERE attemptId=?', [attempt.attemptId]));
    expect(rows[0]).toMatchObject({ state: 'unresolved', outcome: 'failed', costNanoUsd: null }); expect(JSON.parse(rows[0].priceSnapshotJson).rates.input).toBe('1');
    expect(rows[1]).toMatchObject({ state: 'settled', outcome: 'success', costNanoUsd: 1080000 }); expect(JSON.parse(rows[1].priceSnapshotJson).rates.input).toBe('9');
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('abort false inside scheduled real backoff leaves predecessor winner and creates no successor', async () => {
    let enter; const scheduled = new Promise(resolve => { enter = resolve; }), controller = new AbortController();
    const originalTimer = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) => {
      const timer = originalTimer(callback, delay, ...args); if (delay === 1000) enter(); return timer;
    });
    const before = vi.fn((...args) => accounting.beforeAttempt(...args)), complete = vi.fn((...args) => accounting.completeAttempt(...args));
    fixture.post.mockImplementation(initialError);
    const args = options({ ...accounting, beforeAttempt: before, completeAttempt: complete }); args.signal = controller.signal;
    const work = new CommandCodeExecutor().execute(args).then(value => ({ value }), error => ({ error }));
    await scheduled; expect(complete).toHaveBeenCalledTimes(1); expect(before).toHaveBeenCalledTimes(1); controller.abort(false);
    expect(await work).toEqual({ error: false }); expect(before).toHaveBeenCalledTimes(1); expect(complete).toHaveBeenCalledTimes(1); expect(fixture.post).toHaveBeenCalledTimes(1);
    expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', outcome: 'failed', costNanoUsd: null }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('actual consumer prefix followed by late raw503 owns unresolved completion but never retries', async () => {
    let release, delivered, acknowledged;
    const held = new Promise(resolve => { release = resolve; }), prefixRead = new Promise(resolve => { delivered = resolve; }), ack = new Promise(resolve => { acknowledged = resolve; });
    const prefix = success().split('\n').slice(0, 4).join('\n') + '\n', encoder = new TextEncoder();
    fixture.post.mockImplementation(() => new Response(new ReadableStream({
      start(controller) { controller.enqueue(encoder.encode(prefix)); },
      async pull(controller) { await held; controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', error: { statusCode: 503, message: 'fixture late error' } }) + '\n')); controller.close(); }
    }, { highWaterMark: 0 }), { headers: { 'content-type': 'application/x-ndjson' } }));
    const complete = vi.fn(async (...args) => { const terminal = await accounting.completeAttempt(...args); acknowledged(); return terminal; });
    const result = await new CommandCodeExecutor().execute(options({ ...accounting, completeAttempt: complete }));
    let received = '';
    const work = (async () => {
      const reader = result.response.body.getReader(), decoder = new TextDecoder();
      try { for (;;) { const chunk = await reader.read(); if (chunk.done) return { ended: true }; received += decoder.decode(chunk.value, { stream: true }); if (received.includes('fixture output')) delivered(); } }
      catch (error) { return { error }; } finally { reader.releaseLock(); }
    })();
    try {
      await prefixRead; expect(received).toContain('fixture output'); expect(received).not.toContain('finish'); expect(complete).not.toHaveBeenCalled(); expect(fixture.post).toHaveBeenCalledTimes(1);
    } finally { release(); }
    expect((await work).error.message).toBe('Gateway accounting stream unavailable'); await ack;
    expect(complete).toHaveBeenCalledTimes(1); expect(fixture.post).toHaveBeenCalledTimes(1);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', costNanoUsd: null }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['options-prototype', 'body-getter', 'mode-getter', 'options-proxy', 'signal-proxy', 'signal-fake', 'signal-native-prototype-fake', 'signal-shadow-aborted', 'signal-shadow-method', 'signal-shadow-reason', 'aggregate-bound'])('hostile %s refuses before programmable reads/admission/POST', async kind => {
    const before = vi.fn((...args) => accounting.beforeAttempt(...args)), complete = vi.fn((...args) => accounting.completeAttempt(...args));
    let args = options({ ...accounting, beforeAttempt: before, completeAttempt: complete }), reads = 0;
    const trap = () => { reads++; throw new Error('fixture programmable read must not run'); };
    if (kind === 'options-prototype') Object.setPrototypeOf(args, { hostile: true });
    if (kind === 'body-getter') Object.defineProperty(args.body.messages[0], 'content', { get: trap, enumerable: true });
    if (kind === 'mode-getter') Object.defineProperty(args, 'accountingMode', { get: trap, enumerable: true });
    if (kind === 'options-proxy') args = new Proxy(args, { get: trap, ownKeys: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap });
    if (kind === 'signal-proxy') args.signal = new Proxy(new AbortController().signal, { get: trap, ownKeys: trap, getPrototypeOf: trap });
    if (kind === 'signal-fake') args.signal = { throwIfAborted: trap, get aborted() { return trap(); }, addEventListener: trap };
    if (kind === 'signal-native-prototype-fake') args.signal = Object.create(AbortSignal.prototype);
    if (kind === 'signal-shadow-aborted') { args.signal = new AbortController().signal; Object.defineProperty(args.signal, 'aborted', { get: trap }); }
    if (kind === 'signal-shadow-method') { args.signal = new AbortController().signal; Object.defineProperty(args.signal, 'throwIfAborted', { value: trap }); }
    if (kind === 'signal-shadow-reason') { args.signal = new AbortController().signal; Object.defineProperty(args.signal, 'reason', { get: trap }); }
    if (kind === 'aggregate-bound') args.body.messages[0].content = 'x'.repeat(140000);
    await expect(new CommandCodeExecutor().execute(args)).rejects.toThrow();
    expect(reads).toBe(0); expect(before).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled(); expect(fixture.post).not.toHaveBeenCalled();
    expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('plain HTTP503 does not masquerade as validated raw initial-error retry permission', async () => {
    fixture.post.mockImplementation(() => new Response('fixture HTTP failure', { status: 503 }));
    const result = await new CommandCodeExecutor().execute(options(accounting)); expect(result.response.status).toBe(503);
    expect(await result.response.text()).toBe('fixture HTTP failure'); expect(fixture.post).toHaveBeenCalledTimes(1);
    expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', outcome: 'failed', costNanoUsd: null }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
});
