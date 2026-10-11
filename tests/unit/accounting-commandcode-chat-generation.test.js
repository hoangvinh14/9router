import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROVIDERS } from 'open-sse/config/providers.js';
const fixture = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => fixture.post(...args) }));
let execute, db, directory, accounting;
const previous = process.env.DATA_DIR, model = 'deepseek/deepseek-v4-pro';
beforeAll(async () => { ({ executeAccountedCommandCodeChatGeneration: execute } = await import('open-sse/executors/accountedCommandCodeChatGeneration.js')); });
beforeEach(async () => {
  vi.resetModules(); fixture.post.mockReset(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-commandcode-chat-generation-'));
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
afterEach(() => { vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; if (directory) fs.rmSync(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous; });
const options = context => ({ model, stream: true, connectionId: 'c', accounting: context,
  body: { model, stream: true, max_tokens: 64, temperature: 0.3, messages: [{ role: 'user', content: 'fixture prompt' }] },
  credentials: { apiKey: 'dummy-api-key', connectionId: 'c', providerSpecificData: {} }, providerOverrides: null, proxyOptions: null });
const executor = () => ({ provider: 'commandcode', config: structuredClone(PROVIDERS.commandcode) });
const rawSuccess = () => {
  const usage = { inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 0, reasoningTokens: 0 };
  return [{ type: 'start' }, { type: 'start-step' }, { type: 'text-start', id: 'fixture' }, { type: 'text-delta', id: 'fixture', text: 'fixture text' },
    { type: 'text-end', id: 'fixture' }, { type: 'finish-step', finishReason: 'stop', usage }, { type: 'finish', finishReason: 'stop', totalUsage: usage }].map(event => JSON.stringify(event) + '\n').join('');
};
describe('Chat CommandCode per-generation owner (actual ledger/mock POST, no retry loop/socket)', { timeout: 20000 }, () => {
  it('real translation and frozen actual POST require own pending ACK and settle original price', async () => {
    let args;
    const context = { ...accounting, beforeAttempt(meta, supported, wire) {
      expect(Object.isFrozen(wire.commandCodeChatCapture.original.body.messages[0])).toBe(true);
      expect(wire.commandCodeChatCapture.original.runtime.workingDir).toBe(process.cwd());
      expect(wire.commandCodeChatCapture.identity.threadId).toBe(JSON.parse(wire.commandCodeTransport.serializedBody).threadId);
      args.body.messages[0].content = 'changed'; args.credentials.apiKey = 'changed';
      return accounting.beforeAttempt(meta, supported, wire);
    } };
    args = options(context);
    fixture.post.mockImplementation((_url, init, _proxy, contract) => {
      expect(contract.singlePost).toBe(true); expect(contract.commandCodeChatTransport.capture).toBeDefined();
      expect(Object.isFrozen(init.headers)).toBe(true); expect(new Headers(init.headers).get('authorization')).toBe('Bearer dummy-api-key');
      expect(JSON.parse(init.body).params.messages[0].content[0].text).toBe('fixture prompt');
      expect(db.get('SELECT state FROM apiKeyAccounting').state).toBe('pending');
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='commandcode'", [JSON.stringify({ [model]: { input: '9', output: '9' } })]));
      return new Response(rawSuccess(), { headers: { 'content-type': 'application/x-ndjson' } });
    });
    const result = await execute(executor(), args); expect(await result.response.text()).toBe(rawSuccess());
    expect(fixture.post).toHaveBeenCalledTimes(1); expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 140000 }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['deliver', 'lost-delivery'])('initial error own completion ACK before returned status: %s', async mode => {
    let enter, release; const installed = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const lost = new Error('fixture lost Chat generation terminal handle');
    const complete = vi.fn(async (...args) => { const terminal = await accounting.completeAttempt(...args); enter(); await held; if (mode === 'lost-delivery') throw lost; return terminal; });
    const gate = vi.fn(() => accounting.gate());
    fixture.post.mockImplementation(() => new Response(JSON.stringify({ type: 'error', error: { statusCode: 503, message: 'fixture error' } }) + '\n', { headers: { 'content-type': 'application/x-ndjson' } }));
    let returned = false;
    const work = execute(executor(), options({ ...accounting, completeAttempt: complete, gate })).then(value => ({ value }), error => ({ error })).then(result => { returned = true; return result; });
    try {
      await installed; expect(returned).toBe(false); expect(gate).not.toHaveBeenCalled();
      expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', outcome: 'failed', costNanoUsd: null }]);
    } finally { release(); }
    const result = await work;
    if (mode === 'deliver') { expect(result.value.response.status).toBe(503); expect(gate).toHaveBeenCalledTimes(1); }
    else { expect(result.error).toBe(lost); expect(gate).not.toHaveBeenCalled(); }
    expect(complete).toHaveBeenCalledTimes(1); expect(fixture.post).toHaveBeenCalledTimes(1); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['deliver', 'lost-delivery', 'abort-after-delivery'])('own intent ACK gates the only POST: %s', async mode => {
    let enter, release; const installed = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const lost = new Error('fixture lost Chat generation intent handle'), controller = new AbortController();
    const before = vi.fn(async (...args) => { const attempt = await accounting.beforeAttempt(...args); enter(); await held;
      if (mode === 'lost-delivery') throw lost; if (mode === 'abort-after-delivery') controller.abort(false); return attempt; });
    const complete = vi.fn((...args) => accounting.completeAttempt(...args));
    fixture.post.mockImplementation(() => new Response(rawSuccess(), { headers: { 'content-type': 'application/x-ndjson' } }));
    const args = options({ ...accounting, beforeAttempt: before, completeAttempt: complete }); args.signal = controller.signal;
    const work = execute(executor(), args).then(value => ({ value }), error => ({ error }));
    try {
      await installed; expect(fixture.post).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'pending', costNanoUsd: null }]);
    } finally { release(); }
    const result = await work;
    if (mode === 'deliver') {
      expect(await result.value.response.text()).toBe(rawSuccess()); expect(fixture.post).toHaveBeenCalledTimes(1);
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 140000 }]);
    } else if (mode === 'lost-delivery') {
      expect(result.error).toBe(lost); expect(fixture.post).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'pending', costNanoUsd: null }]);
    } else {
      expect(result.error).toBe(false); expect(fixture.post).not.toHaveBeenCalled(); expect(complete).toHaveBeenCalledTimes(1);
      expect(complete.mock.calls[0][1]).toEqual({ notDispatched: true, outcome: 'aborted' });
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'not_dispatched', costNanoUsd: null }]);
    }
    expect(before).toHaveBeenCalledTimes(1); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('budgeted unresolved initial error owns completion but cannot return status or permit successor', async () => {
    const policy = await (await import('@/lib/apiKeyBudget/service.js')).createBudgetContext('a', { adapter: async () => db });
    policy.updatePolicy({ weeklyLimitUsd: '100', monthlyLimitUsd: '100', expectedVersion: 0 });
    const complete = vi.fn((...args) => accounting.completeAttempt(...args));
    fixture.post.mockImplementation(() => new Response(JSON.stringify({ type: 'error', error: { statusCode: 503, message: 'fixture error' } }) + '\n', { headers: { 'content-type': 'application/x-ndjson' } }));
    await expect(execute(executor(), options({ ...accounting, completeAttempt: complete }))).rejects.toMatchObject({ code: 'api_key_accounting_unresolved' });
    expect(complete).toHaveBeenCalledTimes(1); expect(fixture.post).toHaveBeenCalledTimes(1);
    expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', outcome: 'failed', costNanoUsd: null }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('false-like posted transport rejection remains one unresolved network-unknown winner', async () => {
    const complete = vi.fn((...args) => accounting.completeAttempt(...args)); fixture.post.mockRejectedValue(false);
    const result = await execute(executor(), options({ ...accounting, completeAttempt: complete })).then(value => ({ value }), error => ({ error }));
    expect(result).toEqual({ error: false }); expect(complete).toHaveBeenCalledTimes(1); expect(fixture.post).toHaveBeenCalledTimes(1);
    expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', outcome: 'network_unknown', costNanoUsd: null }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('fresh key rotation at actual coordinator dequeue refuses intent and POST without rebuilding', async () => {
    const before = vi.fn((...args) => {
      const work = accounting.beforeAttempt(...args);
      db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']);
        db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(row.data), apiKey: 'dummy-rotated' }), 'c']); });
      return work;
    });
    await expect(execute(executor(), options({ ...accounting, beforeAttempt: before }))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(before).toHaveBeenCalledTimes(1); expect(fixture.post).not.toHaveBeenCalled();
    expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('abort false during pending POST owns one aborted completion and cancels a late response', async () => {
    let enter, resolvePost, cancelled;
    const invoked = new Promise(resolve => { enter = resolve; }), lateCancelled = new Promise(resolve => { cancelled = resolve; });
    const pending = new Promise(resolve => { resolvePost = resolve; }), controller = new AbortController();
    fixture.post.mockImplementation(() => { enter(); return pending; });
    const complete = vi.fn((...args) => accounting.completeAttempt(...args)), args = options({ ...accounting, completeAttempt: complete }); args.signal = controller.signal;
    const work = execute(executor(), args).then(value => ({ value }), error => ({ error }));
    await invoked; controller.abort(false);
    const result = await work; expect(result).toEqual({ error: false }); expect(complete).toHaveBeenCalledTimes(1);
    expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', outcome: 'aborted', costNanoUsd: null }]);
    const cancel = vi.fn(reason => { cancelled(); expect(reason).toBe(false); });
    resolvePost(new Response(new ReadableStream({ cancel })));
    await lateCancelled; expect(cancel).toHaveBeenCalledExactlyOnceWith(false); expect(complete).toHaveBeenCalledTimes(1);
    expect(fixture.post).toHaveBeenCalledTimes(1); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('lost successful terminal ACK withholds finish bytes and authorization without rewriting settled winner', async () => {
    const lost = new Error('fixture lost Chat success terminal handle');
    const complete = vi.fn(async (...args) => { await accounting.completeAttempt(...args); throw lost; });
    const authorize = vi.fn(terminal => accounting.assertSuccessfulTerminal(terminal));
    fixture.post.mockImplementation(() => new Response(rawSuccess(), { headers: { 'content-type': 'application/x-ndjson' } }));
    const result = await execute(executor(), options({ ...accounting, completeAttempt: complete, assertSuccessfulTerminal: authorize }));
    const reader = result.response.body.getReader(), decoder = new TextDecoder(); let text = '';
    try { await expect((async () => { for (;;) { const part = await reader.read(); if (part.done) break; text += decoder.decode(part.value); } })()).rejects.toThrow('Gateway accounting stream unavailable'); }
    finally { reader.releaseLock(); }
    expect(text).toContain('fixture text'); expect(text).not.toContain('finish-step'); expect(text).not.toContain('"type":"finish"');
    expect(authorize).not.toHaveBeenCalled(); expect(complete).toHaveBeenCalledTimes(1); expect(fixture.post).toHaveBeenCalledTimes(1);
    expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', outcome: 'success', costNanoUsd: 140000 }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('guard whole input before body getter or translator/intent/POST', async () => {
    const args = options(accounting); let reads = 0;
    Object.defineProperty(args.body, 'messages', { enumerable: true, get() { reads++; throw new Error('fixture getter'); } });
    await expect(execute(executor(), args)).rejects.toThrow(); expect(reads).toBe(0); expect(fixture.post).not.toHaveBeenCalled();
    expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
});
