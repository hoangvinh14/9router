import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initializePoliciesOffline } from '@/lib/db/offlinePolicyInitialization.js';
import { createRequestAccounting } from '@/lib/apiKeyBudget/requestAccounting.js';
import { putPolicySync } from '@/lib/db/repos/apiKeyAccountingRepo.js';
import { BaseExecutor } from '../../open-sse/executors/base.js';
import { BUDGET_ERROR } from '../../open-sse/config/apiKeyBudgetConstants.js';
const network = vi.hoisted(() => vi.fn());
const legacyUsage = vi.hoisted(() => vi.fn());
const accounts = vi.hoisted(() => ({ select: vi.fn(), cooldown: vi.fn(), preRefresh: vi.fn() }));
const models = vi.hoisted(() => ({ info: vi.fn(), combo: vi.fn() }));
vi.mock('@/lib/usageDb.js', () => ({ trackPendingRequest() {}, appendRequestLog: async () => {}, saveRequestDetail: async () => {}, saveRequestUsage: legacyUsage }));
vi.mock('../../src/sse/services/auth.js', () => ({ getProviderCredentials: (...args) => accounts.select(...args), markAccountUnavailable: (...args) => accounts.cooldown(...args), clearAccountError: async () => {}, extractApiKey: req => req.headers.get('Authorization')?.slice(7), isValidApiKey: async () => true }));
vi.mock('../../src/sse/services/model.js', () => ({ getModelInfo: (...args) => models.info(...args), getComboModels: (...args) => models.combo(...args) }));
vi.mock('../../src/sse/services/tokenRefresh.js', () => ({ checkAndRefreshToken: (...args) => accounts.preRefresh(...args), updateProviderCredentials: async () => {} }));
vi.mock('../../src/sse/utils/logger.js', async importOriginal => ({ ...(await importOriginal()), request() {}, response() {}, stream() {}, line() {}, errorLine() {}, debug() {}, info() {}, warn() {}, error() {} }));
vi.mock('../../open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => network(...args) }));
let dir, db;
const old = process.env.DATA_DIR;
beforeEach(async () => {
  models.info.mockReset(); models.combo.mockReset();
  models.info.mockImplementation(async () => ({ provider: 'openai', model: 'fixture-chat' })); models.combo.mockResolvedValue(null);
  accounts.select.mockReset(); accounts.cooldown.mockReset(); accounts.preRefresh.mockReset();
  accounts.select.mockImplementation(async () => ({ apiKey: 'provider-fixture', connectionId: 'chat-connection', connectionName: 'Fixture' }));
  accounts.cooldown.mockImplementation(() => { throw new Error('local accounting entered cooldown'); });
  accounts.preRefresh.mockImplementation(async (_p, credentials) => credentials);
  network.mockReset(); legacyUsage.mockReset(); legacyUsage.mockResolvedValue(undefined); dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-accounting-')); process.env.DATA_DIR = dir; delete global._dbAdapter; vi.resetModules();
  db = await (await import('@/lib/db/driver.js')).getAdapter(); await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'chat-key', key: 'chat-fixture-secret' }] }); db.close(); db = null;
  await initializePoliciesOffline({ directory: dir, actor: 'fixture', reason: 'fixture chat initialization' });
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  // Test-only activation, no application writer or production invocation.
  db.durableTransaction(() => db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')"));
  putPolicySync(db, 'chat-key', { weeklyLimitNanoUsd: '1000000000', monthlyLimitNanoUsd: null }, 0);
  await (await import('@/lib/db/repos/pricingRepo.js')).updatePricing({ openai: { 'fixture-chat': { input: '1', output: '2' } } });
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(dir, { recursive: true, force: true }); if (old === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = old; });
const rows = () => db.all('SELECT * FROM apiKeyAccounting ORDER BY startedAt,attemptId');
const ctx = () => createRequestAccounting(new Request('http://localhost/v1/chat/completions', { headers: { Authorization: 'Bearer chat-fixture-secret' } }), { adapter: async () => db });
const args = accounting => ({ model: 'fixture-chat', body: { messages: [{ role: 'user', content: 'fixture' }], stream: false }, stream: false, credentials: { apiKey: 'provider-fixture' }, accounting, connectionId: 'chat-connection' });
const result = (status = 200, usage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }) => Response.json({ choices: [{ message: { role: 'assistant', content: 'fixture' }, finish_reason: 'stop' }], ...(usage ? { usage } : {}) }, { status });
const executor = retry => new BaseExecutor('openai', { baseUrl: 'http://fixture.invalid/chat', retry: { 429: { attempts: 0, delayMs: 0 }, 502: { attempts: 0, delayMs: 0 }, ...retry } });
describe('per POST accounted Base chat', { timeout: 20000 }, () => {
  it.each(['json', 'live', 'zero', 'missing-cache', 'conflicting-cache', 'missing-DONE'])('DeepSeek OpenAI %s owns raw terminal evidence before translation', async mode => {
    models.info.mockResolvedValue({ provider: 'deepseek', model: 'deepseek-chat' });
    await (await import('@/lib/db/repos/pricingRepo.js')).updatePricing({ deepseek: { 'deepseek-chat': { input: '1', output: '2', cached: '0.1', reasoning: '3' } } });
    let raw = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, prompt_cache_hit_tokens: 40, prompt_cache_miss_tokens: 60, prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 10 } };
    if (mode === 'zero') raw = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 0 };
    if (mode === 'missing-cache') delete raw.prompt_cache_hit_tokens;
    if (mode === 'conflicting-cache') raw.prompt_tokens_details.cached_tokens = 30;
    const live = ['live', 'missing-DONE'].includes(mode), frames = 'data: {"choices":[{"index":0,"delta":{"content":"fixture"},"finish_reason":"stop"}]}\n\n' + `data: ${JSON.stringify({ choices: [], usage: raw })}\n\n` + (mode === 'missing-DONE' ? '' : 'data: [DONE]\n\n');
    network.mockImplementation(async (url, init) => {
      expect(url).toBe('https://api.deepseek.com/chat/completions'); expect(rows()).toHaveLength(1); expect(rows()[0].state).toBe('pending');
      const wire = JSON.parse(init.body); expect(wire.stream).toBe(live); if (live) expect(wire.stream_options.include_usage).toBe(true);
      return live ? new Response(frames, { headers: { 'content-type': 'text/event-stream' } }) : result(200, raw);
    });
    const { handleChat } = await import('../../src/sse/handlers/chat.js');
    const response = await handleChat(new Request('http://localhost/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer chat-fixture-secret' }, body: JSON.stringify({ model: 'deepseek/deepseek-chat', messages: [{ role: 'user', content: 'fixture' }], stream: live }) }));
    if (mode === 'missing-DONE') await expect(response.text()).rejects.toThrow('Gateway accounting stream unavailable');
    else if (['missing-cache', 'conflicting-cache'].includes(mode)) { expect(response.status).toBe(503); expect((await response.json()).error.code).toBe(BUDGET_ERROR.UNRESOLVED); }
    else { expect(response.status).toBe(200); if (live) expect(await response.text()).toBe(frames); else expect((await response.json()).choices[0].message.content).toBe('fixture'); }
    expect(network).toHaveBeenCalledTimes(1); expect(rows()).toHaveLength(1); expect(rows()[0].provider).toBe('deepseek'); expect(accounts.cooldown).not.toHaveBeenCalled(); expect(legacyUsage).not.toHaveBeenCalled();
    if (['missing-cache', 'conflicting-cache', 'missing-DONE'].includes(mode)) {
      expect(rows()[0].state).toBe('unresolved'); expect(rows()[0].costNanoUsd).toBeNull(); expect(rows()[0].usageJson).toBeNull();
      if (mode === 'missing-DONE') expect(JSON.parse(rows()[0].terminalJson).usageEvidence.reason).toBe('missing_terminal');
    } else { expect(rows()[0].state).toBe('settled'); expect(String(rows()[0].costNanoUsd)).toBe(mode === 'zero' ? '0' : '174000'); }
  });
  it.each(['exact', 'unknown'])('DeepSeek failed-response %s settles before any internal retry', async mode => {
    await (await import('@/lib/db/repos/pricingRepo.js')).updatePricing({ deepseek: { 'deepseek-chat': { input: '1', output: '2', cached: '0.1' } } });
    const { DefaultExecutor } = await import('../../open-sse/executors/default.js');
    const ex = new DefaultExecutor('deepseek'); ex.config = { ...ex.config, retry: { 429: { attempts: 1, delayMs: 0 } } }; ex.computeRetryDelay = vi.fn(() => 0);
    const raw = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, prompt_cache_hit_tokens: 40, prompt_cache_miss_tokens: 60 };
    network.mockResolvedValueOnce(result(429, mode === 'exact' ? raw : null)).mockImplementationOnce(async () => {
      expect(rows()).toHaveLength(2); expect(rows().filter(row => row.state === 'settled')).toHaveLength(1); return result(200, raw);
    });
    const work = ex.execute({ ...args(await ctx()), model: 'deepseek-chat' });
    if (mode === 'unknown') { await expect(work).rejects.toMatchObject({ code: BUDGET_ERROR.UNRESOLVED }); expect(ex.computeRetryDelay).not.toHaveBeenCalled(); }
    else { expect((await work).response.status).toBe(200); expect(rows().every(row => row.state === 'settled' && String(row.costNanoUsd) === '164000')).toBe(true); expect(new Set(rows().map(row => row.requestId)).size).toBe(1); expect(new Set(rows().map(row => row.attemptId)).size).toBe(2); }
    expect(network).toHaveBeenCalledTimes(mode === 'exact' ? 2 : 1); expect(accounts.cooldown).not.toHaveBeenCalled(); expect(legacyUsage).not.toHaveBeenCalled();
  });
  it('two gateway keys share a singleton executor without sharing attempts or changing frozen prices', async () => {
    const { createApiKey } = await import('@/lib/db/repos/apiKeysRepo.js');
    const secondKey = await createApiKey('Fixture second', 'fixture-machine');
    putPolicySync(db, secondKey.id, { weeklyLimitNanoUsd: '1000000000', monthlyLimitNanoUsd: null }, 0);
    putPolicySync(db, 'chat-key', { weeklyLimitNanoUsd: '200000', monthlyLimitNanoUsd: null }, 1);
    const { getExecutor } = await import('../../open-sse/executors/index.js');
    expect(getExecutor('openai')).toBe(getExecutor('openai'));
    const text = 'data: {"choices":[{"index":0,"delta":{"content":"fixture"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n\ndata: [DONE]\n\n';
    let enterFirst, releaseFirst;
    const firstEntered = new Promise(resolve => { enterFirst = resolve; });
    network.mockImplementationOnce(() => { enterFirst(); return new Promise(resolve => { releaseFirst = () => resolve(new Response(text, { headers: { 'content-type': 'text/event-stream' } })); }); }).mockImplementation(async () => new Response(text, { headers: { 'content-type': 'text/event-stream' } }));
    const { handleChat } = await import('../../src/sse/handlers/chat.js');
    const req = key => new Request('http://localhost/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: 'openai/fixture-chat', messages: [{ role: 'user', content: 'fixture' }], stream: false }) });
    const first = handleChat(req('chat-fixture-secret'));
    try {
      await firstEntered; expect(rows()).toHaveLength(1); expect(rows()[0].apiKeyId).toBe('chat-key'); expect(rows()[0].state).toBe('pending');
      await (await import('@/lib/db/repos/pricingRepo.js')).updatePricing({ openai: { 'fixture-chat': { input: '3', output: '6' } } });
      const second = await handleChat(req(secondKey.key)); expect(second.status).toBe(200); await second.json();
      expect(rows()).toHaveLength(2); expect(rows().find(row => row.apiKeyId === 'chat-key').state).toBe('pending');
      expect(String(rows().find(row => row.apiKeyId === secondKey.id).costNanoUsd)).toBe('600000');
    } finally { releaseFirst?.(); }
    const firstResponse = await first; expect(firstResponse.status).toBe(200); await firstResponse.json();
    expect(String(rows().find(row => row.apiKeyId === 'chat-key').costNanoUsd)).toBe('200000');
    expect(new Set(rows().map(row => row.requestId)).size).toBe(2); expect(new Set(rows().map(row => row.attemptId)).size).toBe(2);
    expect(rows().every(row => row.state === 'settled')).toBe(true);
    expect((await handleChat(req('chat-fixture-secret'))).status).toBe(429); expect(network).toHaveBeenCalledTimes(2);
    expect((await handleChat(req(secondKey.key))).status).toBe(200); expect(network).toHaveBeenCalledTimes(3);
    expect(rows().filter(row => row.apiKeyId === secondKey.id).map(row => String(row.costNanoUsd))).toEqual(['600000', '600000']);
    expect(accounts.cooldown).not.toHaveBeenCalled(); expect(legacyUsage).not.toHaveBeenCalled();
  });
  it.each(['claude', 'stale-transport', 'destination-override'])('DeepSeek %s cannot authorize a different POST schema', async mode => {
    models.info.mockResolvedValue({ provider: 'deepseek', model: 'deepseek-chat' });
    await (await import('@/lib/db/repos/pricingRepo.js')).updatePricing({ deepseek: { 'deepseek-chat': { input: '1', output: '2' } } });
    if (mode === 'stale-transport' || mode === 'destination-override') {
      const { DefaultExecutor } = await import('../../open-sse/executors/default.js'), accounting = await ctx();
      const ex = new DefaultExecutor('deepseek');
      const runtimeTransport = mode === 'stale-transport' ? { format: 'claude', baseUrl: 'https://api.deepseek.com/anthropic/v1/messages' } : { format: 'openai', baseUrl: 'https://fixture.invalid/chat/completions' };
      await expect(ex.execute({ ...args(accounting), model: 'deepseek-chat', credentials: { apiKey: 'fixture', runtimeTransport } })).rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED });
    } else {
      const { handleChat } = await import('../../src/sse/handlers/chat.js');
      const response = await handleChat(new Request('http://localhost/v1/messages', { method: 'POST', headers: { Authorization: 'Bearer chat-fixture-secret' }, body: JSON.stringify({ model: 'deepseek/deepseek-chat', max_tokens: 20, messages: [{ role: 'user', content: 'fixture' }], stream: false }) }));
      expect(response.status).toBe(503); expect((await response.json()).error.code).toBe(BUDGET_ERROR.UNSUPPORTED);
    }
    expect(network).not.toHaveBeenCalled(); expect(rows()).toEqual([]); expect(accounts.cooldown).not.toHaveBeenCalled();
  });
  it('actual app/core forced-stream config reaches Base; raw usage settles before client JSON', async () => {
    const { handleChat } = await import('../../src/sse/handlers/chat.js');
    const text = 'data: ' + JSON.stringify({ id: 'fixture-response', choices: [{ index: 0, delta: { role: 'assistant', content: 'fixture' }, finish_reason: 'stop' }] }) + '\n\n' +
      'data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }) + '\n\ndata: [DONE]\n\n';
    network.mockImplementation(async (_url, init) => { const body = JSON.parse(init.body); expect(body.stream).toBe(true); expect(body.stream_options.include_usage).toBe(true); expect(rows()[0].state).toBe('pending'); return new Response(text, { headers: { 'content-type': 'text/event-stream' } }); });
    const req = () => new Request('http://localhost/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer chat-fixture-secret', accept: 'application/json' }, body: JSON.stringify({ model: 'openai/fixture-chat', messages: [{ role: 'user', content: 'fixture' }], stream: false }) });
    const response = await handleChat(req());
    expect(response.status).toBe(200); expect((await response.json()).choices[0].message.content).toBe('fixture'); expect(rows()).toHaveLength(1); expect(rows()[0].state).toBe('settled'); expect(String(rows()[0].costNanoUsd)).toBe('200000'); expect(legacyUsage).not.toHaveBeenCalled();
    putPolicySync(db, 'chat-key', { weeklyLimitNanoUsd: '0', monthlyLimitNanoUsd: null }, 1);
    const denied = await handleChat(req()); expect(denied.status).toBe(429); expect(network).toHaveBeenCalledTimes(1);
  });
  it('actual app live raw stream forwards delta before durable terminal, no legacy estimator/analytics', async () => {
    const { handleChat } = await import('../../src/sse/handlers/chat.js');
    let upstream;
    network.mockImplementation(async () => new Response(new ReadableStream({ start(c) { upstream = c; } }), { headers: { 'content-type': 'text/event-stream' } }));
    const req = new Request('http://localhost/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer chat-fixture-secret' }, body: JSON.stringify({ model: 'openai/fixture-chat', messages: [{ role: 'user', content: 'fixture' }], stream: true }) });
    const response = await handleChat(req); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(rows()[0].state).toBe('pending');
    const reader = response.body.getReader(), encoder = new TextEncoder(), decoder = new TextDecoder();
    const delta = 'data: {"choices":[{"index":0,"delta":{"content":"fixture"}}]}\n\n';
    upstream.enqueue(encoder.encode(delta)); expect(decoder.decode((await reader.read()).value)).toBe(delta); expect(rows()[0].state).toBe('pending');
    const terminal = 'data: {"choices":[{"index":0,"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n\ndata: [DONE]\n\n';
    upstream.enqueue(encoder.encode(terminal)); upstream.close();
    let tail = ''; for (;;) { const chunk = await reader.read(); if (chunk.done) break; expect(rows()[0].state).toBe('settled'); tail += decoder.decode(chunk.value); }
    expect(tail).toBe(terminal); expect(String(rows()[0].costNanoUsd)).toBe('200000'); expect(rows()).toHaveLength(1); expect(network).toHaveBeenCalledTimes(1); expect(legacyUsage).not.toHaveBeenCalled();
  });
  it.each(['unpriced', 'gap-acked', 'gap-failed', 'threshold'])('actual live valid terminal %s uses trusted request-local policy', async mode => {
    if (mode !== 'threshold') putPolicySync(db, 'chat-key', { weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null }, 1);
    else putPolicySync(db, 'chat-key', { weeklyLimitNanoUsd: '200000', monthlyLimitNanoUsd: null }, 1);
    if (mode === 'unpriced') await (await import('@/lib/db/repos/pricingRepo.js')).resetPricing('openai', 'fixture-chat');
    const text = 'data: {"choices":[{"index":0,"delta":{"content":"fixture"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n\ndata: [DONE]\n\n';
    const run = db.run.bind(db);
    const failure = mode.startsWith('gap-') ? vi.spyOn(db, 'run').mockImplementation((sql, ...params) => {
      if (sql.startsWith('UPDATE apiKeyAccounting SET state=')) throw new Error('fixture live settlement failure');
      return run(sql, ...params);
    }) : null;
    const latch = mode === 'gap-failed' ? vi.spyOn(db.coverage, 'latchGap').mockImplementation(() => { throw new Error('fixture live gap ACK failure'); }) : null;
    network.mockResolvedValue(new Response(text, { headers: { 'content-type': 'text/event-stream' } }));
    const { handleChat } = await import('../../src/sse/handlers/chat.js');
    const req = () => new Request('http://localhost/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer chat-fixture-secret' }, body: JSON.stringify({ model: 'openai/fixture-chat', messages: [{ role: 'user', content: 'fixture' }], stream: true }) });
    try {
      const response = await handleChat(req()); expect(response.status).toBe(200);
      if (mode === 'gap-failed') await expect(response.text()).rejects.toThrow('Gateway accounting stream unavailable');
      else expect(await response.text()).toBe(text);
      expect(rows()).toHaveLength(1); expect(network).toHaveBeenCalledTimes(1);
      if (mode === 'unpriced') expect(rows()[0]).toMatchObject({ state: 'unresolved', costNanoUsd: null, usageJson: null });
      else if (mode.startsWith('gap-')) { expect(rows()[0]).toMatchObject({ state: 'pending', costNanoUsd: null }); if (mode === 'gap-acked') expect(db.coverage.status('chat-key').gaps.some(gap => !gap.resolvedAt)).toBe(true); }
      else { expect(rows()[0]).toMatchObject({ state: 'settled', costNanoUsd: 200000 }); expect((await handleChat(req())).status).toBe(429); expect(network).toHaveBeenCalledTimes(1); }
      expect(accounts.cooldown).not.toHaveBeenCalled(); expect(legacyUsage).not.toHaveBeenCalled();
    } finally { failure?.mockRestore(); latch?.mockRestore(); }
  });
  it('actual app auth refresh settles each POST separately before retry JSON conversion', async () => {
    const { getExecutor } = await import('../../open-sse/executors/index.js');
    const refresh = vi.spyOn(getExecutor('openai'), 'refreshCredentials').mockImplementation(async () => {
      expect(rows()).toHaveLength(1); expect(rows()[0].state).toBe('settled'); return { accessToken: 'refreshed-fixture' };
    });
    const { handleChat } = await import('../../src/sse/handlers/chat.js');
    network.mockResolvedValueOnce(result(401)).mockImplementationOnce(async () => {
      expect(rows()).toHaveLength(2); expect(rows().filter(row => row.state === 'settled')).toHaveLength(1);
      return new Response('data: {"choices":[{"index":0,"delta":{"content":"fixture"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    });
    const response = await handleChat(new Request('http://localhost/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer chat-fixture-secret' }, body: JSON.stringify({ model: 'openai/fixture-chat', messages: [{ role: 'user', content: 'fixture' }], stream: false }) }));
    expect(response.status).toBe(200); expect((await response.json()).choices[0].message.content).toBe('fixture');
    expect(network).toHaveBeenCalledTimes(2); expect(refresh).toHaveBeenCalledTimes(1);
    expect(new Set(rows().map(row => row.requestId)).size).toBe(1); expect(new Set(rows().map(row => row.attemptId)).size).toBe(2);
    expect(rows().every(row => row.state === 'settled')).toBe(true); expect(rows().map(row => String(row.costNanoUsd))).toEqual(['200000', '200000']); expect(legacyUsage).not.toHaveBeenCalled();
  });
  it('usage-less actual app auth error refuses before refresh/cooldown/second POST', async () => {
    const { getExecutor } = await import('../../open-sse/executors/index.js'); const refresh = vi.spyOn(getExecutor('openai'), 'refreshCredentials');
    const { handleChat } = await import('../../src/sse/handlers/chat.js'); network.mockResolvedValue(result(401, null));
    const response = await handleChat(new Request('http://localhost/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer chat-fixture-secret' }, body: JSON.stringify({ model: 'openai/fixture-chat', messages: [{ role: 'user', content: 'fixture' }], stream: false }) }));
    expect(response.status).toBe(503); expect((await response.json()).error.code).toBe(BUDGET_ERROR.UNRESOLVED); expect(refresh).not.toHaveBeenCalled(); expect(network).toHaveBeenCalledTimes(1); expect(rows()[0].state).toBe('unresolved');
  });
  it('caller abort during foreign auth refresh is prompt and never dispatches again', async () => {
    const { getExecutor } = await import('../../open-sse/executors/index.js'); let rejectRefresh;
    const refresh = vi.spyOn(getExecutor('openai'), 'refreshCredentials').mockImplementation(() => new Promise((_resolve, reject) => { rejectRefresh = reject; }));
    const { handleChat } = await import('../../src/sse/handlers/chat.js'); network.mockResolvedValue(result(401));
    const ctrl = new AbortController();
    const pending = expect(handleChat(new Request('http://localhost/v1/chat/completions', { method: 'POST', signal: ctrl.signal, headers: { Authorization: 'Bearer chat-fixture-secret' }, body: JSON.stringify({ model: 'openai/fixture-chat', messages: [{ role: 'user', content: 'fixture' }], stream: false }) }))).rejects.toBe(17);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1)); ctrl.abort(17); await pending;
    rejectRefresh(new Error('late fixture refresh')); await Promise.resolve();
    expect(network).toHaveBeenCalledTimes(1); expect(rows()).toHaveLength(1); expect(rows()[0].state).toBe('settled');
  });
  it('actual account fallback preserves one context and distinct settled POSTs', async () => {
    const { handleChat } = await import('../../src/sse/handlers/chat.js');
    accounts.select.mockImplementation(async (_provider, excluded) => ({ apiKey: 'fixture', connectionId: excluded.size ? 'account-b' : 'account-a', connectionName: 'Fixture' }));
    accounts.cooldown.mockImplementation(async () => { expect(rows()[0].state).toBe('settled'); return { shouldFallback: true }; });
    network.mockResolvedValueOnce(result(400)).mockResolvedValueOnce(new Response('data: {"choices":[{"index":0,"delta":{"content":"fixture"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }));
    const response = await handleChat(new Request('http://localhost/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer chat-fixture-secret' }, body: JSON.stringify({ model: 'openai/fixture-chat', messages: [{ role: 'user', content: 'fixture' }], stream: false }) }));
    expect(response.status).toBe(200); expect((await response.json()).choices[0].message.content).toBe('fixture'); expect(network).toHaveBeenCalledTimes(2); expect(accounts.cooldown).toHaveBeenCalledTimes(1);
    expect(rows().every(row => row.state === 'settled')).toBe(true); expect(new Set(rows().map(row => row.requestId)).size).toBe(1); expect(new Set(rows().map(row => row.attemptId)).size).toBe(2); expect(new Set(rows().map(row => row.connectionId))).toEqual(new Set(['account-a', 'account-b'])); expect(legacyUsage).not.toHaveBeenCalled();
  });
  it('failed exact debit exhausting policy stops before cooldown/account fallback', async () => {
    const { handleChat } = await import('../../src/sse/handlers/chat.js');
    putPolicySync(db, 'chat-key', { weeklyLimitNanoUsd: '1', monthlyLimitNanoUsd: null }, 1); network.mockResolvedValue(result(400));
    const response = await handleChat(new Request('http://localhost/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer chat-fixture-secret' }, body: JSON.stringify({ model: 'openai/fixture-chat', messages: [{ role: 'user', content: 'fixture' }], stream: false }) }));
    expect(response.status).toBe(429); expect((await response.json()).error.code).toBe(BUDGET_ERROR.EXCEEDED); expect(rows()[0].state).toBe('settled'); expect(accounts.cooldown).not.toHaveBeenCalled(); expect(accounts.select).toHaveBeenCalledTimes(1); expect(network).toHaveBeenCalledTimes(1);
  });
  it('abort during account selection does not dispatch or create attempt', async () => {
    const { handleChat } = await import('../../src/sse/handlers/chat.js'); let rejectSelection;
    accounts.select.mockImplementation(() => new Promise((_resolve, reject) => { rejectSelection = reject; }));
    const ctrl = new AbortController();
    const pending = expect(handleChat(new Request('http://localhost/v1/chat/completions', { method: 'POST', signal: ctrl.signal, headers: { Authorization: 'Bearer chat-fixture-secret' }, body: JSON.stringify({ model: 'openai/fixture-chat', messages: [{ role: 'user', content: 'fixture' }], stream: false }) }))).rejects.toBe('selection-stop');
    await vi.waitFor(() => expect(accounts.select).toHaveBeenCalledTimes(1)); ctrl.abort('selection-stop'); await pending; rejectSelection(new Error('late selection'));
    expect(network).not.toHaveBeenCalled(); expect(rows()).toEqual([]); expect(accounts.cooldown).not.toHaveBeenCalled();
  });
  it.each([false, true])('actual capacity augmentation combo=%s preserves priority and one POST owner', async combo => {
    await (await import('@/lib/db/repos/settingsRepo.js')).updateSettings({ capacityAdapter: { vision: { enabled: true, models: ['openai/gpt-4o'] } } });
    await (await import('@/lib/db/repos/pricingRepo.js')).updatePricing({ openai: { 'gpt-4o': { input: '3', output: '6' } } });
    models.info.mockImplementation(async name => ({ provider: 'openai', model: name.split('/')[1] }));
    models.combo.mockImplementation(async name => combo && name === 'capacity-combo' ? ['openai/fixture-chat'] : null);
    const original = { model: combo ? 'capacity-combo' : 'openai/fixture-chat', messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] }], stream: false };
    const frozen = structuredClone(original);
    network.mockImplementation(async (_url, init) => {
      const wire = JSON.parse(init.body); expect(wire.model).toBe('gpt-4o'); expect(wire.messages[0].content.some(block => block.type === 'image_url')).toBe(true);
      expect(rows()).toHaveLength(1); expect(rows()[0].state).toBe('pending'); expect(rows()[0].model).toBe('gpt-4o');
      return new Response('data: {"choices":[{"index":0,"delta":{"content":"fixture"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    });
    const { handleChat } = await import('../../src/sse/handlers/chat.js');
    const response = await handleChat(new Request('http://localhost/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer chat-fixture-secret' }, body: JSON.stringify(original) }));
    expect(response.status).toBe(200); expect((await response.json()).choices[0].message.content).toBe('fixture');
    expect(network).toHaveBeenCalledTimes(1); expect(rows()).toHaveLength(1); expect(rows()[0].state).toBe('settled'); expect(String(rows()[0].costNanoUsd)).toBe('600000'); expect(original).toEqual(frozen); expect(legacyUsage).not.toHaveBeenCalled();
  });
  it.each(['accounted', 'off', 'cancelled'])('capacity fallback %s preserves sequence and prior settlement', async mode => {
    if (mode === 'off') db.durableTransaction(() => db.run("DELETE FROM _meta WHERE key='ledgerStartedAt'"));
    await (await import('@/lib/db/repos/settingsRepo.js')).updateSettings({ capacityAdapter: { vision: { enabled: true, models: ['openai/gpt-4o'] } } });
    await (await import('@/lib/db/repos/pricingRepo.js')).updatePricing({ openai: { 'gpt-4o': { input: '3', output: '6' } } });
    models.info.mockImplementation(async name => ({ provider: 'openai', model: name.split('/')[1] }));
    const ctrl = new AbortController(), attempted = [];
    accounts.cooldown.mockImplementation(async () => {
      if (mode !== 'off') { expect(rows()).toHaveLength(1); expect(rows()[0].state).toBe('settled'); expect(String(rows()[0].costNanoUsd)).toBe('600000'); }
      if (mode === 'cancelled') ctrl.abort('capacity-stop');
      return { shouldFallback: false };
    });
    network.mockImplementation(async (_url, init) => {
      const wire = JSON.parse(init.body); attempted.push(wire.model);
      if (attempted.length === 1) return result(402);
      expect(wire.model).toBe('fixture-chat');
      if (mode !== 'off') { expect(rows()).toHaveLength(2); expect(rows().filter(row => row.state === 'settled')).toHaveLength(1); }
      return new Response('data: {"choices":[{"index":0,"delta":{"content":"fixture"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    });
    const { handleChat } = await import('../../src/sse/handlers/chat.js');
    const work = handleChat(new Request('http://localhost/v1/chat/completions', { method: 'POST', signal: ctrl.signal, headers: { Authorization: 'Bearer chat-fixture-secret' }, body: JSON.stringify({ model: 'openai/fixture-chat', messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] }], stream: false }) }));
    if (mode === 'cancelled') { await expect(work).rejects.toBe('capacity-stop'); expect(attempted).toEqual(['gpt-4o']); expect(rows()).toHaveLength(1); }
    else {
      const response = await work; expect(response.status).toBe(200); expect((await response.json()).choices[0].message.content).toBe('fixture'); expect(attempted).toEqual(['gpt-4o', 'fixture-chat']);
      if (mode === 'off') expect(rows()).toEqual([]);
      else { expect(rows()).toHaveLength(2); expect(new Set(rows().map(row => row.requestId)).size).toBe(1); expect(new Set(rows().map(row => row.attemptId)).size).toBe(2); expect(rows().every(row => row.state === 'settled')).toBe(true); expect(rows().map(row => String(row.costNanoUsd)).sort()).toEqual(['200000', '600000']); expect(legacyUsage).not.toHaveBeenCalled(); }
    }
  });
  it.each(['unsupported', 'nested', 'unknown', 'exhausted'])('capacity %s refuses without unowned or subsequent POST', async kind => {
    const pool = kind === 'unsupported' ? 'anthropic/claude-sonnet-4.6' : 'openai/gpt-4o';
    await (await import('@/lib/db/repos/settingsRepo.js')).updateSettings({ capacityAdapter: { vision: { enabled: true, models: [pool] } } });
    await (await import('@/lib/db/repos/pricingRepo.js')).updatePricing({ openai: { 'gpt-4o': { input: '3', output: '6' } } });
    models.info.mockImplementation(async name => kind === 'nested' && name === pool ? { provider: null } : ({ provider: name.startsWith('anthropic/') ? 'anthropic' : 'openai', model: name.split('/')[1] }));
    if (kind === 'nested') models.combo.mockImplementation(async name => name === pool ? [pool] : null);
    if (kind === 'exhausted') putPolicySync(db, 'chat-key', { weeklyLimitNanoUsd: '600000', monthlyLimitNanoUsd: null }, 1);
    network.mockResolvedValue(result(400, kind === 'unknown' ? null : undefined));
    const { handleChat } = await import('../../src/sse/handlers/chat.js');
    const response = await handleChat(new Request('http://localhost/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer chat-fixture-secret' }, body: JSON.stringify({ model: 'openai/fixture-chat', messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] }], stream: false }) }));
    expect(response.status).toBe(kind === 'exhausted' ? 429 : 503); expect((await response.json()).error.code).toBe(kind === 'exhausted' ? BUDGET_ERROR.EXCEEDED : kind === 'unknown' ? BUDGET_ERROR.UNRESOLVED : BUDGET_ERROR.UNSUPPORTED);
    expect(network).toHaveBeenCalledTimes(['unknown', 'exhausted'].includes(kind) ? 1 : 0); expect(accounts.cooldown).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(['unknown', 'exhausted'].includes(kind) ? 1 : 0);
  });
  it.each(['accounted', 'off', 'cycle', 'depth16', 'depth17', 'nested-fusion'])('nested combo %s keeps branch-local context and bounded dispatch', async mode => {
    if (mode === 'off') db.durableTransaction(() => db.run("DELETE FROM _meta WHERE key='ledgerStartedAt'"));
    const depth = mode === 'depth16' ? 16 : mode === 'depth17' ? 17 : 2;
    models.combo.mockImplementation(async name => {
      if (!/^combo-\d+$/.test(name)) return null;
      const n = Number(name.slice(6));
      if (mode === 'cycle') return [n === 0 ? 'combo-1' : 'combo-0'];
      return [n + 1 < depth ? `combo-${n + 1}` : 'openai/fixture-chat'];
    });
    models.info.mockImplementation(async name => name.startsWith('combo-') ? { provider: null, model: name } : { provider: 'openai', model: name.split('/')[1] });
    if (mode === 'nested-fusion') await (await import('@/lib/db/repos/settingsRepo.js')).updateSettings({ comboStrategies: { 'combo-1': { fallbackStrategy: 'fusion' } } });
    network.mockResolvedValue(new Response('data: {"choices":[{"index":0,"delta":{"content":"fixture"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }));
    const { handleChat } = await import('../../src/sse/handlers/chat.js');
    const response = await handleChat(new Request('http://localhost/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer chat-fixture-secret' }, body: JSON.stringify({ model: 'combo-0', messages: [{ role: 'user', content: 'fixture' }], stream: false }) }));
    const deny = ['cycle', 'depth17', 'nested-fusion'].includes(mode);
    expect(response.status).toBe(deny ? 503 : 200);
    if (deny) { expect((await response.json()).error.code).toBe(BUDGET_ERROR.UNSUPPORTED); expect(network).not.toHaveBeenCalled(); expect(rows()).toEqual([]); }
    else { expect((await response.json()).choices[0].message.content).toBe('fixture'); expect(network).toHaveBeenCalledTimes(1); expect(rows()).toHaveLength(mode === 'off' ? 0 : 1); if (mode !== 'off') { expect(rows()[0].state).toBe('settled'); expect(String(rows()[0].costNanoUsd)).toBe('200000'); } }
    expect(accounts.cooldown).not.toHaveBeenCalled();
  });
  it.each(['diamond', 'paid-cycle', 'unknown', 'exhausted', 'cancelled'])('nested %s preserves paid predecessors and terminal authority', async mode => {
    const graph = mode === 'diamond' ? { root: ['left', 'right'], left: ['shared'], right: ['shared'], shared: ['openai/fixture-chat'] }
      : mode === 'paid-cycle' ? { root: ['openai/fixture-chat', 'loop'], loop: ['root'] }
        : { root: ['child', 'openai/fixture-chat'], child: ['openai/fixture-chat', 'openai/fixture-chat'] };
    models.combo.mockImplementation(async name => graph[name] || null);
    models.info.mockImplementation(async name => graph[name] ? { provider: null, model: name } : { provider: 'openai', model: name.split('/')[1] });
    if (mode === 'exhausted') putPolicySync(db, 'chat-key', { weeklyLimitNanoUsd: '1', monthlyLimitNanoUsd: null }, 1);
    const ctrl = new AbortController();
    accounts.cooldown.mockImplementation(async () => {
      expect(rows()).toHaveLength(1); expect(rows()[0].state).toBe('settled'); expect(String(rows()[0].costNanoUsd)).toBe('200000');
      if (mode === 'cancelled') ctrl.abort(17);
      return { shouldFallback: false };
    });
    network.mockResolvedValueOnce(result(402, mode === 'unknown' ? null : undefined)).mockImplementationOnce(async () => {
      expect(mode).toBe('diamond'); expect(rows()).toHaveLength(2); expect(rows().filter(row => row.state === 'settled')).toHaveLength(1);
      return new Response('data: {"choices":[{"index":0,"delta":{"content":"fixture"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    });
    const { handleChat } = await import('../../src/sse/handlers/chat.js');
    const work = handleChat(new Request('http://localhost/v1/chat/completions', { method: 'POST', signal: ctrl.signal, headers: { Authorization: 'Bearer chat-fixture-secret' }, body: JSON.stringify({ model: 'root', messages: [{ role: 'user', content: 'fixture' }], stream: false }) }));
    if (mode === 'cancelled') await expect(work).rejects.toBe(17);
    else {
      const response = await work;
      expect(response.status).toBe(mode === 'diamond' ? 200 : mode === 'exhausted' ? 429 : 503);
      const body = await response.json();
      if (mode === 'diamond') expect(body.choices[0].message.content).toBe('fixture');
      else expect(body.error.code).toBe(mode === 'paid-cycle' ? BUDGET_ERROR.UNSUPPORTED : mode === 'unknown' ? BUDGET_ERROR.UNRESOLVED : BUDGET_ERROR.EXCEEDED);
    }
    expect(network).toHaveBeenCalledTimes(mode === 'diamond' ? 2 : 1); expect(rows()).toHaveLength(mode === 'diamond' ? 2 : 1);
    expect(new Set(rows().map(row => row.requestId)).size).toBe(1); expect(new Set(rows().map(row => row.attemptId)).size).toBe(rows().length);
    if (mode === 'unknown') { expect(rows()[0].state).toBe('unresolved'); expect(rows()[0].costNanoUsd).toBeNull(); }
    else { expect(rows().every(row => row.state === 'settled')).toBe(true); expect(rows().every(row => String(row.costNanoUsd) === '200000')).toBe(true); }
    expect(accounts.cooldown).toHaveBeenCalledTimes(['unknown', 'exhausted'].includes(mode) ? 0 : 1); expect(legacyUsage).not.toHaveBeenCalled();
  });
  it('actual sequential combo uses distinct model snapshots under one request identity', async () => {
    models.combo.mockImplementation(async name => name === 'fixture-combo' ? ['openai/fixture-chat', 'openai/fixture-second'] : null);
    models.info.mockImplementation(async name => ({ provider: 'openai', model: name.split('/')[1] }));
    await (await import('@/lib/db/repos/pricingRepo.js')).updatePricing({ openai: { 'fixture-second': { input: '2', output: '4' } } });
    accounts.cooldown.mockResolvedValue({ shouldFallback: false });
    network.mockResolvedValueOnce(result(402)).mockImplementationOnce(async () => {
      expect(rows()).toHaveLength(2); expect(rows().filter(row => row.state === 'settled')).toHaveLength(1);
      return new Response('data: {"choices":[{"index":0,"delta":{"content":"fixture"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    });
    const { handleChat } = await import('../../src/sse/handlers/chat.js');
    const response = await handleChat(new Request('http://localhost/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer chat-fixture-secret' }, body: JSON.stringify({ model: 'fixture-combo', messages: [{ role: 'user', content: 'fixture' }], stream: false }) }));
    expect(response.status).toBe(200); expect((await response.json()).choices[0].message.content).toBe('fixture');
    expect(network).toHaveBeenCalledTimes(2); expect(new Set(rows().map(row => row.requestId)).size).toBe(1); expect(new Set(rows().map(row => row.attemptId)).size).toBe(2);
    expect(rows().find(row => row.model === 'fixture-chat').costNanoUsd).toBe(200000); expect(rows().find(row => row.model === 'fixture-second').costNanoUsd).toBe(400000); expect(rows().every(row => row.state === 'settled')).toBe(true); expect(legacyUsage).not.toHaveBeenCalled();
  });
  it.each(['unknown', 'exhausted'])('combo local %s terminates without swallowing or another model', async kind => {
    models.combo.mockImplementation(async name => name === 'fixture-combo' ? ['openai/fixture-chat', 'openai/fixture-second'] : null);
    models.info.mockImplementation(async name => ({ provider: 'openai', model: name.split('/')[1] }));
    if (kind === 'exhausted') putPolicySync(db, 'chat-key', { weeklyLimitNanoUsd: '1', monthlyLimitNanoUsd: null }, 1);
    network.mockResolvedValue(result(402, kind === 'unknown' ? null : undefined));
    const { handleChat } = await import('../../src/sse/handlers/chat.js');
    const response = await handleChat(new Request('http://localhost/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer chat-fixture-secret' }, body: JSON.stringify({ model: 'fixture-combo', messages: [{ role: 'user', content: 'fixture' }], stream: false }) }));
    expect(response.status).toBe(kind === 'unknown' ? 503 : 429); expect((await response.json()).error.code).toBe(kind === 'unknown' ? BUDGET_ERROR.UNRESOLVED : BUDGET_ERROR.EXCEEDED);
    expect(network).toHaveBeenCalledTimes(1); expect(accounts.cooldown).not.toHaveBeenCalled(); expect(rows()).toHaveLength(1);
  });
  it.each(['judge', 'regenerate', 'nested-judge'])('fusion with nested sequential %s shares only request context', async mode => {
    const graph = { root: ['child', 'openai/fixture-second'], child: ['openai/fixture-chat'] };
    models.combo.mockImplementation(async name => graph[name] || null);
    models.info.mockImplementation(async name => graph[name] ? { provider: null, model: name } : { provider: 'openai', model: name.split('/')[1] });
    await (await import('@/lib/db/repos/pricingRepo.js')).updatePricing({ openai: { 'fixture-second': { input: '2', output: '4' } } });
    await (await import('@/lib/db/repos/settingsRepo.js')).updateSettings({ comboStrategies: { root: { fallbackStrategy: 'fusion', judgeModel: mode === 'nested-judge' ? 'child' : 'openai/fixture-chat', fusionTuning: { panelHardTimeoutMs: 2000, stragglerGraceMs: 5, minPanel: 2 } } } });
    accounts.cooldown.mockResolvedValue({ shouldFallback: false });
    network.mockImplementation(async (_url, init) => {
      const input = JSON.parse(init.body);
      expect(input.model).not.toBe('child'); expect(init.signal).toBeInstanceOf(AbortSignal);
      if (network.mock.calls.length > 2) expect(rows().filter(row => row.state === 'settled')).toHaveLength(2);
      if (input.model === 'fixture-second' && mode === 'regenerate') return result(402);
      return new Response('data: {"choices":[{"index":0,"delta":{"content":"fixture"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    });
    const { handleChat } = await import('../../src/sse/handlers/chat.js');
    const response = await handleChat(new Request('http://localhost/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer chat-fixture-secret' }, body: JSON.stringify({ model: 'root', messages: [{ role: 'user', content: 'fixture' }], stream: false }) }));
    expect(response.status).toBe(200); expect((await response.json()).choices[0].message.content).toBe('fixture');
    expect(network).toHaveBeenCalledTimes(3); expect(rows()).toHaveLength(3); expect(rows().every(row => row.state === 'settled')).toBe(true);
    expect(new Set(rows().map(row => row.requestId)).size).toBe(1); expect(new Set(rows().map(row => row.attemptId)).size).toBe(3);
    expect(rows().map(row => String(row.costNanoUsd)).sort()).toEqual(['200000', '200000', '400000']); expect(legacyUsage).not.toHaveBeenCalled();
  });
  it.each(['fatal', 'cancel'])('nested panel prerefresh observes fusion %s signal before any child POST', async mode => {
    const graph = { root: ['child', 'openai/fixture-second'], child: ['openai/fixture-chat'] };
    models.combo.mockImplementation(async name => graph[name] || null);
    models.info.mockImplementation(async name => graph[name] ? { provider: null, model: name } : { provider: 'openai', model: name.split('/')[1] });
    await (await import('@/lib/db/repos/pricingRepo.js')).updatePricing({ openai: { 'fixture-second': { input: '2', output: '4' } } });
    await (await import('@/lib/db/repos/settingsRepo.js')).updateSettings({ comboStrategies: { root: { fallbackStrategy: 'fusion', judgeModel: 'openai/fixture-chat', fusionTuning: { panelHardTimeoutMs: 2000, stragglerGraceMs: 5, minPanel: 2 } } } });
    let resolveChild, childStarted, networkEntered, childForeign;
    const started = new Promise(resolve => { childStarted = resolve; });
    const entered = new Promise(resolve => { networkEntered = resolve; });
    const helper = await import('../../open-sse/utils/abortableWork.js');
    const originalAwait = helper.awaitAbortableWork, observed = [], lateErrors = [];
    let observedChild = false;
    const observer = vi.spyOn(helper, 'awaitAbortableWork').mockImplementation((invoke, signal) => originalAwait(() => {
      const work = invoke();
      if (work === childForeign && childForeign) observedChild = true;
      observed.push(Promise.resolve(work).then(() => undefined, error => { lateErrors.push(error); }));
      return work;
    }, signal));
    accounts.select.mockImplementation(async (_provider, _excluded, model) => ({ apiKey: 'fixture', connectionId: model === 'fixture-chat' ? 'child-connection' : 'other-connection', connectionName: 'Fixture' }));
    accounts.preRefresh.mockImplementation((_provider, credentials) => {
      if (credentials.connectionId !== 'child-connection') return credentials;
      childForeign = new Promise(resolve => { resolveChild = () => resolve(credentials); });
      childStarted(); return childForeign;
    });
    network.mockImplementation(async (_url, init) => {
      expect(JSON.parse(init.body).model).toBe('fixture-second'); networkEntered(); await started;
      if (mode === 'fatal') return result(402, null);
      return new Response('data: {"choices":[{"index":0,"delta":{"content":"fixture"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    });
    const ctrl = new AbortController(), { handleChat } = await import('../../src/sse/handlers/chat.js');
    const work = handleChat(new Request('http://localhost/v1/chat/completions', { method: 'POST', signal: ctrl.signal, headers: { Authorization: 'Bearer chat-fixture-secret' }, body: JSON.stringify({ model: 'root', messages: [{ role: 'user', content: 'fixture' }], stream: false }) }));
    try {
      try {
        if (mode === 'cancel') { const rejection = expect(work).rejects.toBe(17); await Promise.all([started, entered]); ctrl.abort(17); await rejection; }
        else { const response = await work; expect(response.status).toBe(503); expect((await response.json()).error.code).toBe(BUDGET_ERROR.UNRESOLVED); }
      } finally {
        resolveChild?.();
        // Join the raw invocation promises, not only wrappers that reject early
        // on abort. Descendant invocations can be registered while draining.
        let size;
        do { size = observed.length; await Promise.all(observed.slice()); } while (observed.length !== size);
      }
      expect(observedChild).toBe(true);
      expect(lateErrors.some(error => mode === 'cancel' ? error === 17 : error?.code === BUDGET_ERROR.UNRESOLVED)).toBe(true);
      expect(network).toHaveBeenCalledTimes(1); expect(rows()).toHaveLength(1); expect(rows()[0].connectionId).toBe('other-connection');
      if (mode === 'fatal') { expect(rows()[0].state).toBe('unresolved'); expect(rows()[0].costNanoUsd).toBeNull(); }
      expect(accounts.cooldown).not.toHaveBeenCalled(); expect(legacyUsage).not.toHaveBeenCalled();
    } finally { observer.mockRestore(); }
  });
  it.each(['judge', 'regenerate', 'unknown'])('actual fusion %s owns each panel and follow-up POST', async kind => {
    models.combo.mockImplementation(async name => name === 'fixture-fusion' ? ['openai/fixture-chat', 'openai/fixture-second'] : null);
    models.info.mockImplementation(async name => ({ provider: 'openai', model: name.split('/')[1] }));
    await (await import('@/lib/db/repos/pricingRepo.js')).updatePricing({ openai: { 'fixture-second': { input: '2', output: '4' } } });
    await (await import('@/lib/db/repos/settingsRepo.js')).updateSettings({ comboStrategies: { 'fixture-fusion': { fallbackStrategy: 'fusion', judgeModel: 'openai/fixture-chat', fusionTuning: { panelHardTimeoutMs: 2000, stragglerGraceMs: 5, minPanel: 2 } } } });
    accounts.cooldown.mockResolvedValue({ shouldFallback: false });
    network.mockImplementation(async (_url, init) => {
      const input = JSON.parse(init.body);
      if (input.model === 'fixture-second' && kind !== 'judge') return result(402, kind === 'unknown' ? null : undefined);
      if (rows().length > 2) expect(rows().filter(row => row.state === 'settled')).toHaveLength(2);
      return new Response('data: {"choices":[{"index":0,"delta":{"content":"fixture"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    });
    const { handleChat } = await import('../../src/sse/handlers/chat.js');
    const response = await handleChat(new Request('http://localhost/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer chat-fixture-secret' }, body: JSON.stringify({ model: 'fixture-fusion', messages: [{ role: 'user', content: 'fixture' }], stream: false }) }));
    if (kind === 'unknown') {
      expect(response.status).toBe(503); expect((await response.json()).error.code).toBe(BUDGET_ERROR.UNRESOLVED); expect(network).toHaveBeenCalledTimes(2); expect(rows().some(row => row.state === 'unresolved')).toBe(true); expect(accounts.cooldown).not.toHaveBeenCalled();
    } else {
      expect(response.status).toBe(200); expect((await response.json()).choices[0].message.content).toBe('fixture'); expect(network).toHaveBeenCalledTimes(3); expect(rows()).toHaveLength(3); expect(rows().every(row => row.state === 'settled')).toBe(true); expect(new Set(rows().map(row => row.requestId)).size).toBe(1); expect(new Set(rows().map(row => row.attemptId)).size).toBe(3); expect(rows().map(row => String(row.costNanoUsd)).sort()).toEqual(['200000', '200000', '400000']); expect(legacyUsage).not.toHaveBeenCalled();
    }
  });
  it.each(['one-empty', 'all-empty'])('fusion %s counts usable prose separately from acknowledged billable panels', async kind => {
    models.combo.mockImplementation(async name => name === 'fixture-fusion' ? ['openai/fixture-chat', 'openai/fixture-second'] : null);
    models.info.mockImplementation(async name => ({ provider: 'openai', model: name.split('/')[1] }));
    await (await import('@/lib/db/repos/pricingRepo.js')).updatePricing({ openai: { 'fixture-second': { input: '2', output: '4' } } });
    await (await import('@/lib/db/repos/settingsRepo.js')).updateSettings({ comboStrategies: { 'fixture-fusion': { fallbackStrategy: 'fusion', judgeModel: 'openai/fixture-second', fusionTuning: { panelHardTimeoutMs: 2000, stragglerGraceMs: 5, minPanel: 2 } } } });
    network.mockImplementation(async (_url, init) => {
      const input = JSON.parse(init.body); const followup = network.mock.calls.length > 2;
      if (followup) { expect(input.model).toBe('fixture-chat'); expect(rows().filter(row => row.state === 'settled')).toHaveLength(2); }
      const content = followup ? 'regenerated' : kind === 'all-empty' || input.model === 'fixture-second' ? '   ' : 'fixture';
      return new Response('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }] }) + '\n\ndata: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    });
    const { handleChat } = await import('../../src/sse/handlers/chat.js');
    const response = await handleChat(new Request('http://localhost/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer chat-fixture-secret' }, body: JSON.stringify({ model: 'fixture-fusion', messages: [{ role: 'user', content: 'fixture' }], stream: false }) }));
    const count = kind === 'all-empty' ? 2 : 3;
    expect(response.status).toBe(kind === 'all-empty' ? 503 : 200);
    const json = await response.json();
    if (kind === 'all-empty') expect(json.error.message).toBe('All fusion panel models failed');
    else expect(json.choices[0].message.content).toBe('regenerated');
    expect(network).toHaveBeenCalledTimes(count); expect(rows()).toHaveLength(count);
    expect(new Set(rows().map(row => row.requestId)).size).toBe(1); expect(new Set(rows().map(row => row.attemptId)).size).toBe(count);
    expect(rows().every(row => row.state === 'settled')).toBe(true);
    expect(rows().map(row => String(row.costNanoUsd)).sort()).toEqual(kind === 'all-empty' ? ['200000', '400000'] : ['200000', '200000', '400000']);
    expect(accounts.cooldown).not.toHaveBeenCalled(); expect(legacyUsage).not.toHaveBeenCalled();
  });
  it.each(['exact-after-client', 'unknown-during-judge'])('real fusion late straggler %s retains its own terminal', async kind => {
    const panel = ['openai/fixture-chat', 'openai/fixture-second', 'openai/fixture-late'];
    models.combo.mockImplementation(async name => name === 'fixture-fusion' ? panel : null);
    models.info.mockImplementation(async name => ({ provider: 'openai', model: name.split('/')[1] }));
    await (await import('@/lib/db/repos/pricingRepo.js')).updatePricing({ openai: { 'fixture-second': { input: '2', output: '4' }, 'fixture-late': { input: '3', output: '6' } } });
    await (await import('@/lib/db/repos/settingsRepo.js')).updateSettings({ comboStrategies: { 'fixture-fusion': { fallbackStrategy: 'fusion', judgeModel: 'openai/fixture-chat', fusionTuning: { panelHardTimeoutMs: 2000, stragglerGraceMs: 5, minPanel: 2 } } } });
    const raw = exact => new Response('data: {"choices":[{"index":0,"delta":{"content":"fixture"},"finish_reason":"stop"}]}\n\n' + (exact ? 'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n\n' : '') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    let releaseLate, releaseJudge, lateSignal; let chatCalls = 0;
    network.mockImplementation(async (_url, init) => {
      const input = JSON.parse(init.body);
      if (input.model === 'fixture-late') { lateSignal = init.signal; return new Promise(resolve => { releaseLate = resolve; }); }
      if (input.model === 'fixture-chat' && ++chatCalls === 2) {
        expect(rows().filter(row => row.state === 'settled')).toHaveLength(2);
        if (kind === 'unknown-during-judge') return new Promise(resolve => { releaseJudge = resolve; });
      }
      return raw(true);
    });
    const { handleChat } = await import('../../src/sse/handlers/chat.js');
    const pending = handleChat(new Request('http://localhost/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer chat-fixture-secret' }, body: JSON.stringify({ model: 'fixture-fusion', messages: [{ role: 'user', content: 'fixture' }], stream: false }) }));
    await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(4));
    expect(rows()).toHaveLength(4); expect(new Set(rows().map(row => row.requestId)).size).toBe(1); expect(new Set(rows().map(row => row.attemptId)).size).toBe(4);
    if (kind === 'exact-after-client') {
      const response = await pending; expect(response.status).toBe(200); await response.json();
      expect(lateSignal.aborted).toBe(false); expect(rows().find(row => row.model === 'fixture-late').state).toBe('pending');
      await (await import('@/lib/db/repos/pricingRepo.js')).updatePricing({ openai: { 'fixture-late': { input: '9', output: '9' } } });
      releaseLate(raw(true));
      await vi.waitFor(() => expect(rows().find(row => row.model === 'fixture-late').state).toBe('settled'));
      const late = rows().find(row => row.model === 'fixture-late'); expect(String(late.costNanoUsd)).toBe('600000'); expect(JSON.parse(late.priceSnapshotJson).rates.input).toBe('3');
      expect(rows().every(row => row.state === 'settled')).toBe(true);
    } else {
      releaseLate(raw(false)); const response = await pending;
      expect(response.status).toBe(503); expect((await response.json()).error.code).toBe(BUDGET_ERROR.UNRESOLVED);
      await vi.waitFor(() => expect(rows().filter(row => row.state === 'unresolved')).toHaveLength(2));
      expect(rows().filter(row => row.state === 'settled')).toHaveLength(2);
      expect(rows().find(row => row.model === 'fixture-late')).toMatchObject({ state: 'unresolved', costNanoUsd: null });
      releaseJudge(raw(true)); await Promise.resolve();
      expect(rows()).toHaveLength(4);
    }
    expect(network).toHaveBeenCalledTimes(4); expect(accounts.cooldown).not.toHaveBeenCalled(); expect(legacyUsage).not.toHaveBeenCalled();
  });
  it('fusion fatal during held preparation prevents that panel POST and leaves no orphan intent', async () => {
    models.combo.mockImplementation(async name => name === 'fixture-fusion' ? ['openai/fixture-chat', 'openai/fixture-held'] : null);
    models.info.mockImplementation(async name => ({ provider: 'openai', model: name.split('/')[1] }));
    accounts.select.mockImplementation(async (_provider, _excluded, model) => ({ apiKey: 'fixture', connectionId: model, connectionName: 'Fixture' }));
    let releasePreparation;
    accounts.preRefresh.mockImplementation(async (_provider, credentials) => credentials.connectionId === 'fixture-held' ? new Promise(resolve => { releasePreparation = () => resolve(credentials); }) : credentials);
    await (await import('@/lib/db/repos/settingsRepo.js')).updateSettings({ comboStrategies: { 'fixture-fusion': { fallbackStrategy: 'fusion', fusionTuning: { panelHardTimeoutMs: 2000, stragglerGraceMs: 5 } } } });
    network.mockImplementation(async () => { expect(releasePreparation).toBeTypeOf('function'); return result(402, null); });
    const { handleChat } = await import('../../src/sse/handlers/chat.js');
    const response = await handleChat(new Request('http://localhost/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer chat-fixture-secret' }, body: JSON.stringify({ model: 'fixture-fusion', messages: [{ role: 'user', content: 'fixture' }], stream: false }) }));
    expect(response.status).toBe(503); expect((await response.json()).error.code).toBe(BUDGET_ERROR.UNRESOLVED); releasePreparation(); await Promise.resolve();
    expect(network).toHaveBeenCalledTimes(1); expect(rows()).toHaveLength(1); expect(rows()[0].state).toBe('unresolved'); expect(accounts.cooldown).not.toHaveBeenCalled();
  });
  it.each(['single', 'sequential'].flatMap(route => ['signal', 'downstream'].map(kind => [route, kind])))('actual %s live %s cancellation ends before durable ACK without request fallback', async (route, kind) => {
    if (route === 'sequential') {
      models.combo.mockImplementation(async name => name === 'fixture-cancel-combo' ? ['openai/fixture-chat', 'openai/fixture-second'] : null);
      models.info.mockImplementation(async name => ({ provider: 'openai', model: name.split('/')[1] }));
    }
    let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), hold = new Promise(resolve => { release = resolve; });
    const accountingModule = await import('@/lib/apiKeyBudget/requestAccounting.js'), create = accountingModule.createRequestAccounting;
    let sinkWork;
    const completion = vi.fn((accounting, ...input) => {
      sinkWork = hold.then(() => accounting.completeAttempt(...input)); enter(); return sinkWork;
    });
    vi.spyOn(accountingModule, 'createRequestAccounting').mockImplementation(async (...input) => {
      const accounting = await create(...input);
      return { ...accounting, completeAttempt: (...terminal) => completion(accounting, ...terminal) };
    });
    let cancelReason;
    network.mockImplementation(async () => new Response(new ReadableStream({ cancel(reason) { cancelReason = reason; } }), { headers: { 'content-type': 'text/event-stream' } }));
    const controller = new AbortController(), { handleChat } = await import('../../src/sse/handlers/chat.js');
    const response = await handleChat(new Request('http://localhost/v1/chat/completions', { method: 'POST', signal: controller.signal, headers: { Authorization: 'Bearer chat-fixture-secret' }, body: JSON.stringify({ model: route === 'sequential' ? 'fixture-cancel-combo' : 'openai/fixture-chat', messages: [{ role: 'user', content: 'fixture' }], stream: true }) }));
    expect(response.status).toBe(200); expect(rows()).toHaveLength(1); expect(rows()[0].state).toBe('pending');
    let localDone = false, local;
    try {
      if (kind === 'signal') {
        controller.abort(false);
        local = response.text().then(value => { localDone = true; return { value }; }, error => { localDone = true; return { error }; });
      } else local = response.body.cancel(false).then(() => { localDone = true; });
      await entered; await vi.waitFor(() => expect(localDone).toBe(true), { timeout: 200 });
      if (kind === 'signal') expect((await local).error?.message).toBe('Gateway accounting stream unavailable'); else await local;
      expect(cancelReason).toBe(false); expect(completion).toHaveBeenCalledTimes(1);
      expect(completion.mock.calls[0][2]).toEqual({ usage: null, outcome: 'aborted' });
      expect(rows()).toHaveLength(1); expect(rows()[0].state).toBe('pending');
      expect(network).toHaveBeenCalledTimes(1); expect(accounts.cooldown).not.toHaveBeenCalled(); expect(legacyUsage).not.toHaveBeenCalled();
    } finally { release(); await sinkWork; await local; }
    expect(rows()).toHaveLength(1); expect(rows()[0]).toMatchObject({ state: 'unresolved', outcome: 'aborted', costNanoUsd: null });
    expect(network).toHaveBeenCalledTimes(1); expect(completion).toHaveBeenCalledTimes(1);
  });
  it.each(['single', 'sequential', 'fusion-judge'].flatMap(route => ['before-delta', 'after-delta'].map(kind => [route, kind])))('actual %s uncanceled %s failure closes locally without successor while terminal ACK is held', async (route, kind) => {
    if (route !== 'single') {
      models.combo.mockImplementation(async name => name === 'fixture-failure-combo' ? ['openai/fixture-chat', 'openai/fixture-second'] : null);
      models.info.mockImplementation(async name => ({ provider: 'openai', model: name.split('/')[1] }));
      await (await import('@/lib/db/repos/pricingRepo.js')).updatePricing({ openai: { 'fixture-second': { input: '1', output: '2' } } });
    }
    if (route === 'fusion-judge') await (await import('@/lib/db/repos/settingsRepo.js')).updateSettings({ comboStrategies: { 'fixture-failure-combo': { fallbackStrategy: 'fusion', judgeModel: 'openai/fixture-chat', fusionTuning: { panelHardTimeoutMs: 2000, stragglerGraceMs: 5, minPanel: 2 } } } });
    let enter, release, upstream, sinkWork;
    const entered = new Promise(resolve => { enter = resolve; }), hold = new Promise(resolve => { release = resolve; });
    const accountingModule = await import('@/lib/apiKeyBudget/requestAccounting.js'), create = accountingModule.createRequestAccounting;
    const completion = vi.fn((accounting, attempt, terminal) => {
      if (terminal.outcome !== 'network_unknown') return accounting.completeAttempt(attempt, terminal);
      sinkWork = hold.then(() => accounting.completeAttempt(attempt, terminal)); enter(); return sinkWork;
    });
    vi.spyOn(accountingModule, 'createRequestAccounting').mockImplementation(async (...input) => { const accounting = await create(...input); return { ...accounting, completeAttempt: (...terminal) => completion(accounting, ...terminal) }; });
    network.mockImplementation(async (_url, init) => {
      const body = JSON.parse(init.body);
      if (route === 'fusion-judge' && network.mock.calls.length <= 2) {
        expect(body.stream).toBe(true); // Actual force-stream panel wire contract.
        return new Response('data: {"choices":[{"index":0,"delta":{"content":"panel"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
      }
      if (route === 'fusion-judge') expect(rows().filter(row => row.state === 'settled')).toHaveLength(2);
      return new Response(new ReadableStream({ start(controller) { upstream = controller; } }), { headers: { 'content-type': 'text/event-stream' } });
    });
    const { handleChat } = await import('../../src/sse/handlers/chat.js');
    const response = await handleChat(new Request('http://localhost/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer chat-fixture-secret' }, body: JSON.stringify({ model: route === 'single' ? 'openai/fixture-chat' : 'fixture-failure-combo', messages: [{ role: 'user', content: 'fixture' }], stream: true }) }));
    const posts = route === 'fusion-judge' ? 3 : 1;
    expect(response.status).toBe(200); expect(network).toHaveBeenCalledTimes(posts); expect(rows()).toHaveLength(posts);
    const reader = response.body.getReader();
    if (kind === 'after-delta') { upstream.enqueue(new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"content":"partial"}}]}\n\n')); expect(new TextDecoder().decode((await reader.read()).value)).toContain('partial'); }
    let localDone = false;
    const local = reader.read().then(value => { localDone = true; return { value }; }, error => { localDone = true; return { error }; });
    upstream.error(new Error('private transport failure'));
    try {
      await entered; await vi.waitFor(() => expect(localDone).toBe(true), { timeout: 200 });
      expect((await local).error?.message).toBe('Gateway accounting stream unavailable');
      expect(rows().filter(row => row.state === 'pending')).toHaveLength(1);
      expect(network).toHaveBeenCalledTimes(posts); expect(rows()).toHaveLength(posts); expect(accounts.cooldown).not.toHaveBeenCalled(); expect(legacyUsage).not.toHaveBeenCalled();
    } finally { release(); await sinkWork; await local; }
    expect(rows().filter(row => row.state === 'unresolved')).toHaveLength(1); expect(rows().find(row => row.state === 'unresolved')).toMatchObject({ outcome: 'network_unknown', costNanoUsd: null });
    expect(network).toHaveBeenCalledTimes(posts); expect(completion).toHaveBeenCalledTimes(posts);
  });
  it('live Base downstream cancel settles once and blocks next POST', async () => {
    network.mockResolvedValue(new Response(new ReadableStream(), { headers: { 'content-type': 'text/event-stream' } }));
    const accounting = await ctx();
    const reply = await executor().execute({ ...args(accounting), stream: true, accountingMode: 'live-openai-sse' });
    expect(rows()[0].state).toBe('pending'); await reply.response.body.cancel('gone');
    expect(rows()[0]).toMatchObject({ state: 'unresolved', outcome: 'aborted', costNanoUsd: null });
    await expect(executor().execute(args(accounting))).rejects.toMatchObject({ code: BUDGET_ERROR.UNRESOLVED }); expect(network).toHaveBeenCalledTimes(1);
  });
  it.each(['json', 'locked'])('successful live %s cannot leak pending or synthesize terminal', async kind => {
    const upstream = kind === 'json' ? result() : new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    const heldReader = kind === 'locked' ? upstream.body.getReader() : null;
    network.mockResolvedValue(upstream); const accounting = await ctx(), completeAttempt = vi.fn(accounting.completeAttempt);
    try {
      await expect(executor({ 502: { attempts: 1, delayMs: 0 } }).execute({ ...args({ ...accounting, completeAttempt }), stream: true, accountingMode: 'live-openai-sse' })).rejects.toMatchObject({ code: BUDGET_ERROR.UNRESOLVED });
      expect(completeAttempt).toHaveBeenCalledTimes(1); expect(rows()).toHaveLength(1); expect(rows()[0]).toMatchObject({ state: 'unresolved', costNanoUsd: null }); expect(network).toHaveBeenCalledTimes(1);
    } finally { await heldReader?.cancel(); }
  });
  it('live missing DONE persists unknown and blocks another dispatch', async () => {
    network.mockResolvedValue(new Response('data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n\n', { headers: { 'content-type': 'text/event-stream' } }));
    const accounting = await ctx();
    const reply = await executor().execute({ ...args(accounting), stream: true, accountingMode: 'live-openai-sse' });
    await expect(reply.response.text()).rejects.toThrow('Gateway accounting stream unavailable'); expect(rows()[0]).toMatchObject({ state: 'unresolved', costNanoUsd: null });
    const row = rows()[0], terminal = JSON.parse(row.terminalJson);
    expect(row.usageJson).toBeNull(); expect(row.resolutionVersion).toBe(1);
    expect(terminal.usageEvidence).toMatchObject({ kind: 'raw_usage_observation', reason: 'missing_terminal', observedCounts: { input: 100, output: 50 } });
    expect(terminal.usageEvidence.observedCounts).not.toHaveProperty('exact');
    expect(db.get("SELECT COUNT(*) AS n FROM kv WHERE scope='accountingProjection'").n).toBe(0);
    await expect(executor().execute(args(accounting))).rejects.toMatchObject({ code: BUDGET_ERROR.UNRESOLVED }); expect(network).toHaveBeenCalledTimes(1);
  });
  it.each(['read-error', 'abort', 'partial-event'])('buffered %s keeps only complete observed usage without EOF authority', async kind => {
    let upstream, observed;
    const encoded = new TextEncoder().encode('data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}' + (kind === 'partial-event' ? '' : '\n\n'));
    network.mockResolvedValue(new Response(new ReadableStream({ start(c) { upstream = c; c.enqueue(encoded); }, pull() { observed = true; } }), { headers: { 'content-type': 'text/event-stream' } }));
    const controller = new AbortController(), accounting = await ctx(), completeAttempt = vi.fn(accounting.completeAttempt);
    const pending = executor().execute({ ...args({ ...accounting, completeAttempt }), stream: true, accountingMode: 'buffered-openai-sse', signal: controller.signal });
    const rejected = kind === 'abort' ? expect(pending).rejects.toBe(17) : expect(pending).rejects.toMatchObject({ code: BUDGET_ERROR.UNRESOLVED });
    await vi.waitFor(() => expect(observed).toBe(true));
    if (kind === 'abort') controller.abort(17); else upstream.error(new Error('fixture interrupted body'));
    await rejected; expect(completeAttempt).toHaveBeenCalledTimes(1); expect(network).toHaveBeenCalledTimes(1);
    const row = rows()[0], terminal = JSON.parse(row.terminalJson);
    expect(row).toMatchObject({ state: 'unresolved', costNanoUsd: null, usageJson: null, resolutionVersion: 1 });
    if (kind === 'partial-event') expect(terminal).not.toHaveProperty('usageEvidence');
    else expect(terminal.usageEvidence).toMatchObject({ reason: kind === 'abort' ? 'cancelled' : 'interrupted', observedCounts: { input: 100, output: 50 } });
    expect(db.get("SELECT COUNT(*) AS n FROM kv WHERE scope='accountingProjection'").n).toBe(0);
  });
  it('management routes read actual POST ledger and recover unknown without diagnostic auto-debit', async () => {
    const accounting = await ctx(); network.mockResolvedValueOnce(result());
    await executor().execute(args(accounting));
    network.mockResolvedValueOnce(new Response('data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n\n', { headers: { 'content-type': 'text/event-stream' } }));
    const unknown = await executor().execute({ ...args(accounting), stream: true, accountingMode: 'live-openai-sse' });
    await expect(unknown.response.text()).rejects.toThrow('Gateway accounting stream unavailable');
    const unresolved = rows().find(row => row.state === 'unresolved');
    expect(JSON.parse(unresolved.terminalJson).usageEvidence.observedCounts.input).toBe(100);
    const management = await import('@/lib/apiKeyBudget/management.js');
    const status = await management.getBudgetManagement('chat-key');
    expect(status).toMatchObject({ enforcementActive: false, status: 'inactive', counts: { pending: 0, unresolved: 1 }, weekly: { spentUsd: '0.0002' }, monthly: { spentUsd: '0.0002' } });
    const usage = await management.getUsageManagement('chat-key');
    expect(usage.breakdown[0]).toMatchObject({ attempts: 2, chargedAttempts: 1, unresolved: 1, knownCostUsd: '0.0002', totalCostUsd: null });
    // Actual route function + signed dashboard session, not actual HTTP transport.
    const oldSecret = process.env.JWT_SECRET; process.env.JWT_SECRET = 'disposable-chat-management-session';
    try {
      const { NextRequest } = await import('next/server');
      const token = await (await import('@/lib/auth/dashboardSession.js')).createDashboardAuthToken();
      const listing = await import('@/app/api/keys/[id]/accounting/route.js');
      const recovery = await import('@/app/api/keys/[id]/accounting/[attemptId]/resolve/route.js');
      const params = { params: Promise.resolve({ id: 'chat-key', attemptId: unresolved.attemptId }) };
      const base = 'http://localhost:20128/api/keys/chat-key/accounting';
      const request = (url, body, authenticated = true, origin = 'http://localhost:20128') => new NextRequest(url, { method: body ? 'POST' : 'GET', headers: { host: 'localhost:20128', origin, ...(authenticated ? { cookie: `auth_token=${token}` } : { authorization: 'Bearer chat-fixture-secret' }) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const read = vi.spyOn(db, 'all');
      expect((await listing.GET(request(base, null, false), params)).status).toBe(401); expect(read).not.toHaveBeenCalled(); read.mockRestore();
      const response = await listing.GET(request(base), params); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
      const publicRows = await response.json(); expect(publicRows.attempts).toHaveLength(2);
      expect(publicRows.attempts.find(row => row.state === 'unresolved')).toMatchObject({ usage: null, costUsd: null, resolutionVersion: 1 });
      expect(JSON.stringify(publicRows)).not.toMatch(/chat-fixture-secret|provider-fixture|priceSnapshot|terminalJson|usageEvidence|ownerInstanceId|observedCounts/);
      await (await import('@/lib/db/repos/pricingRepo.js')).updatePricing({ openai: { 'fixture-chat': { input: '9', output: '9' } } });
      const input = { action: 'exact_usage', operationId: 'actual-ledger-route-recovery', expectedVersion: 1, reason: 'operator reviewed', evidence: 'independent fixture provider record', usage: { exact: true, input: 100, output: 50, cacheRead: 0, cacheWrite: 0, reasoning: 0, reasoningIncludedInOutput: true } };
      const url = `${base}/${unresolved.attemptId}/resolve`;
      expect((await recovery.POST(request(url, input, true, 'https://attacker.example'), params)).status).toBe(403);
      expect(rows().find(row => row.attemptId === unresolved.attemptId).state).toBe('unresolved');
      let receipt;
      for (let n = 0; n < 2; n++) {
        const recovered = await recovery.POST(request(url, input), params); expect(recovered.status).toBe(200);
        const result = await recovered.json(); expect(result).toMatchObject({ state: 'settled', costUsd: '0.0002', resolutionVersion: 2, recoveryReceipt: { operationId: input.operationId, costUsd: '0.0002' } });
        if (receipt) expect(result.recoveryReceipt).toEqual(receipt); receipt = result.recoveryReceipt;
      }
      expect(db.get("SELECT COUNT(*) AS n FROM apiKeyAccountingAudit WHERE operationId=?", [input.operationId]).n).toBe(1);
      expect(db.get("SELECT actor FROM apiKeyAccountingAudit WHERE operationId=?", [input.operationId]).actor).toBe('dashboard-session');
      expect(db.get("SELECT COUNT(*) AS n FROM kv WHERE scope='accountingProjection'").n).toBe(2);
      expect((await management.getBudgetManagement('chat-key')).weekly.spentUsd).toBe('0.0004');
      expect((await management.getUsageManagement('chat-key')).breakdown[0]).toMatchObject({ knownCostUsd: '0.0004', totalCostUsd: '0.0004', unresolved: 0 });
      expect(network).toHaveBeenCalledTimes(2); expect(legacyUsage).not.toHaveBeenCalled();
    } finally { if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret; }
  });
  it('diagnostic observation cannot debit, clear unresolved or overwrite manual recovery', async () => {
    const accounting = await ctx();
    const attempt = await accounting.beforeAttempt({ provider: 'openai', model: 'fixture-chat', endpoint: 'chat' }, true);
    const usageEvidence = { version: 1, kind: 'raw_usage_observation', schema: 'openai', endpoint: 'chat', reason: 'invalid_stream', observedCounts: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, reasoning: 0, reasoningIncludedInOutput: true } };
    for (const bad of [{ ...usageEvidence, raw: 'secret' }, { ...usageEvidence, observedCounts: { ...usageEvidence.observedCounts, exact: true } }, { ...usageEvidence, observedCounts: { ...usageEvidence.observedCounts, cacheRead: 101 } }]) {
      expect(() => accounting.completeAttempt(attempt, { usageEvidence: bad })).toThrow(); expect(rows()[0].state).toBe('pending');
    }
    const first = accounting.completeAttempt(attempt, { usageEvidence, outcome: 'network_unknown' });
    expect(accounting.completeAttempt(attempt, { usageEvidence, outcome: 'network_unknown' })).toEqual(first);
    expect(rows()[0]).toMatchObject({ state: 'unresolved', costNanoUsd: null, usageJson: null, resolutionVersion: 1 });
    expect(() => accounting.gate()).toThrow(); expect(legacyUsage).not.toHaveBeenCalled();
    const { resolveAttemptSync } = await import('@/lib/db/repos/apiKeyAccountingRepo.js');
    resolveAttemptSync(db, attempt.attemptId, { operationId: 'fixture-evidence-recovery', expectedVersion: 1, action: 'waive', actor: 'fixture', reason: 'reviewed fixture', evidence: 'operator fixture decision' });
    expect(() => accounting.completeAttempt(attempt, { usageEvidence: { ...usageEvidence, reason: 'cancelled' }, outcome: 'aborted' })).toThrow();
    expect(rows()[0]).toMatchObject({ state: 'waived', costNanoUsd: 0, resolutionVersion: 2 });
    expect(db.get("SELECT COUNT(*) AS n FROM apiKeyAccountingAudit WHERE action='observation_conflict'").n).toBe(1);
  });
  it('live app multiple-choice refuses before any POST', async () => {
    const { handleChat } = await import('../../src/sse/handlers/chat.js');
    const request = new Request('http://localhost/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer chat-fixture-secret' }, body: JSON.stringify({ model: 'openai/fixture-chat', messages: [{ role: 'user', content: 'fixture' }], stream: true, n: 2 }) });
    const response = await handleChat(request); expect(response.status).toBe(503); expect((await response.json()).error.code).toBe(BUDGET_ERROR.UNSUPPORTED); expect(network).not.toHaveBeenCalled(); expect(rows()).toEqual([]);
  });
  it('live real-ledger ACK winner survives downstream cancellation', async () => {
    network.mockResolvedValue(new Response('data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }));
    const accounting = await ctx(); let acknowledge;
    const completeAttempt = vi.fn((...args) => new Promise(resolve => { acknowledge = () => resolve(accounting.completeAttempt(...args)); }));
    const reply = await executor().execute({ ...args({ ...accounting, completeAttempt }), stream: true, accountingMode: 'live-openai-sse' });
    const reader = reply.response.body.getReader(); const pending = reader.read(); await vi.waitFor(() => expect(completeAttempt).toHaveBeenCalledTimes(1));
    expect(rows()[0].state).toBe('pending'); const cancelled = reader.cancel('after EOF before ACK'); acknowledge();
    await cancelled; expect((await pending).done).toBe(true); expect(rows()[0].state).toBe('settled'); expect(String(rows()[0].costNanoUsd)).toBe('200000'); expect(completeAttempt).toHaveBeenCalledTimes(1);
  });
  it('effective upstream stream uses a detached wire flag/options without mutating client intent', async () => {
    const input = args(await ctx());
    input.body.stream_options = Object.freeze({ include_usage: false, fixture_option: 'preserved' });
    Object.freeze(input.body);
    network.mockResolvedValue(new Response('data: {"choices":[],"usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0}}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }));
    const reply = await executor().execute({ ...input, stream: true, accountingMode: 'buffered-openai-sse' });
    const wire = JSON.parse(network.mock.calls[0][1].body);
    expect(wire.stream).toBe(true);
    expect(wire.stream_options).toEqual({ include_usage: true, fixture_option: 'preserved' });
    expect(input.body.stream).toBe(false);
    expect(input.body.stream_options).toEqual({ include_usage: false, fixture_option: 'preserved' });
    expect(reply.transformedBody).not.toBe(input.body);
    expect(rows()[0].state).toBe('settled');
    expect(network).toHaveBeenCalledTimes(1);
  });
  it.each(['missing-usage', 'missing-done', 'zero'])('forced buffered SSE %s never guesses counts', async kind => {
    let text = kind === 'missing-usage' ? '' : 'data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }) + '\n\n';
    if (kind !== 'missing-done') text += 'data: [DONE]\n\n';
    network.mockResolvedValue(new Response(text, { headers: { 'content-type': 'text/event-stream' } }));
    const work = executor().execute({ ...args(await ctx()), stream: true, accountingMode: 'buffered-openai-sse' });
    if (kind === 'zero') await work;
    else await expect(work).rejects.toMatchObject({ code: BUDGET_ERROR.UNRESOLVED });
    expect(rows()[0].state).toBe(kind === 'zero' ? 'settled' : 'unresolved'); expect(rows()[0].costNanoUsd).toBe(kind === 'zero' ? 0 : null);
    const terminal = JSON.parse(rows()[0].terminalJson);
    if (kind === 'missing-done') {
      expect(rows()[0].usageJson).toBeNull(); expect(terminal.usageEvidence).toMatchObject({ reason: 'missing_terminal', observedCounts: { input: 0, output: 0 } });
      expect(db.get("SELECT COUNT(*) AS n FROM kv WHERE scope='accountingProjection'").n).toBe(0);
    } else expect(terminal).not.toHaveProperty('usageEvidence');
  });
  it.each(['budgeted', 'unlimited', 'threshold'])('JSON terminal %s uses current policy without retrospective settled gating', async mode => {
    if (mode === 'unlimited') putPolicySync(db, 'chat-key', { weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null }, 1);
    if (mode === 'threshold') putPolicySync(db, 'chat-key', { weeklyLimitNanoUsd: '200000', monthlyLimitNanoUsd: null }, 1);
    network.mockResolvedValue(result(200, mode === 'threshold' ? undefined : null));
    const accounting = await ctx(), ex = executor();
    const work = ex.execute(args(accounting));
    if (mode === 'budgeted') await expect(work).rejects.toMatchObject({ code: BUDGET_ERROR.UNRESOLVED });
    else expect((await work).response.status).toBe(200);
    expect(rows()).toHaveLength(1); expect(rows()[0].state).toBe(mode === 'threshold' ? 'settled' : 'unresolved');
    expect(rows()[0].costNanoUsd).toBe(mode === 'threshold' ? 200000 : null); expect(network).toHaveBeenCalledTimes(1);
    if (mode === 'threshold') { await expect(ex.execute(args(accounting))).rejects.toMatchObject({ code: BUDGET_ERROR.EXCEEDED }); expect(network).toHaveBeenCalledTimes(1); }
  });
  it.each(['latched', 'latch-failed'])('unlimited successful JSON recording failure %s follows durable gap contract', async mode => {
    putPolicySync(db, 'chat-key', { weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null }, 1);
    const accounting = await ctx(), run = db.run.bind(db);
    const failure = vi.spyOn(db, 'run').mockImplementation((sql, ...params) => {
      if (sql.startsWith('UPDATE apiKeyAccounting SET state=')) throw new Error('fixture settlement write failure');
      return run(sql, ...params);
    });
    const latch = mode === 'latch-failed' ? vi.spyOn(db.coverage, 'latchGap').mockImplementation(() => { throw new Error('fixture gap ACK failed'); }) : null;
    network.mockResolvedValue(result());
    try {
      const work = executor().execute(args(accounting));
      if (mode === 'latched') { expect((await work).response.status).toBe(200); expect(db.coverage.status('chat-key').gaps.some(gap => !gap.resolvedAt)).toBe(true); }
      else await expect(work).rejects.toMatchObject({ code: BUDGET_ERROR.UNAVAILABLE });
      expect(network).toHaveBeenCalledTimes(1); expect(rows()).toHaveLength(1); expect(rows()[0].state).toBe('pending'); expect(rows()[0].costNanoUsd).toBeNull();
    } finally { failure.mockRestore(); latch?.mockRestore(); }
  });
  it('malformed internal terminal cannot authorize successful JSON', async () => {
    const actual = await ctx(); network.mockResolvedValue(result());
    const completeAttempt = vi.fn((...params) => { actual.completeAttempt(...params); return { state: 'settled', unrecorded: true, costNanoUsd: '200000' }; });
    await expect(executor().execute(args({ ...actual, completeAttempt }))).rejects.toMatchObject({ code: BUDGET_ERROR.UNAVAILABLE });
    expect(completeAttempt).toHaveBeenCalledTimes(1); expect(network).toHaveBeenCalledTimes(1); expect(rows()[0].state).toBe('settled');
  });
  it('raw counts settle before replay response, exactly one attempt/projection', async () => {
    network.mockImplementation(async () => { expect(rows()[0].state).toBe('pending'); return result(); });
    const reply = await executor().execute(args(await ctx())); expect(reply.accountingOwned).toBe(true); expect(rows()).toHaveLength(1); expect(rows()[0].state).toBe('settled'); expect(String(rows()[0].costNanoUsd)).toBe('200000');
    expect((await reply.response.json()).usage.prompt_tokens).toBe(100); expect(db.get("SELECT COUNT(*) AS n FROM kv WHERE scope='accountingProjection'").n).toBe(1);
  });
  it('internal status retry settles first exact debit before second intent', async () => {
    network.mockResolvedValueOnce(result(429)).mockImplementationOnce(async () => { expect(rows()).toHaveLength(2); expect(rows().filter(row => row.state === 'settled')).toHaveLength(1); return result(); });
    await executor({ 429: { attempts: 1, delayMs: 0 } }).execute(args(await ctx())); expect(network).toHaveBeenCalledTimes(2); expect(rows().every(row => row.state === 'settled')).toBe(true); expect(new Set(rows().map(row => row.attemptId)).size).toBe(2);
  });
  it('failed response with unknown usage blocks retries before hook/backoff/new POST', async () => {
    const ex = executor({ 429: { attempts: 1, delayMs: 0 } }); ex.computeRetryDelay = vi.fn(); network.mockResolvedValue(result(429, null));
    await expect(ex.execute(args(await ctx()))).rejects.toMatchObject({ code: BUDGET_ERROR.UNRESOLVED }); expect(network).toHaveBeenCalledTimes(1); expect(ex.computeRetryDelay).not.toHaveBeenCalled(); expect(rows()[0]).toMatchObject({ state: 'unresolved', costNanoUsd: null });
  });
  it('settlement failure is not caught as network error or completed twice', async () => {
    const actual = await ctx(), handles = [], fail = new Error('storage fixture'); network.mockResolvedValue(result());
    const completeAttempt = vi.fn(handle => { handles.push(handle); throw fail; });
    await expect(executor({ 502: { attempts: 1, delayMs: 0 } }).execute(args({ ...actual, completeAttempt }))).rejects.toBe(fail); expect(completeAttempt).toHaveBeenCalledTimes(1); expect(network).toHaveBeenCalledTimes(1);
    actual.completeAttempt(handles[0], { usage: null });
  });
  it('retry hook exception after settlement does not duplicate ledger terminal', async () => {
    const ex = executor({ 429: { attempts: 1, delayMs: 0 } }); ex.computeRetryDelay = () => { throw new Error('hook fixture'); }; network.mockResolvedValue(result(429));
    await expect(ex.execute(args(await ctx()))).rejects.toThrow('hook fixture'); expect(rows()).toHaveLength(1); expect(rows()[0].state).toBe('settled'); expect(network).toHaveBeenCalledTimes(1);
  });
  it('unsupported stream refuses before any billable POST', async () => { await expect(executor().execute({ ...args(await ctx()), stream: true })).rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED }); expect(network).not.toHaveBeenCalled(); expect(rows()).toEqual([]); });
  it('headers abort settles ambiguous once, late response cannot debit or retry', async () => {
    let release; const ctrl = new AbortController(); network.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const pending = expect(executor().execute({ ...args(await ctx()), signal: ctrl.signal })).rejects.toBe(7); await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(1)); ctrl.abort(7); await pending;
    let cancelled = 0; release(new Response(new ReadableStream({ cancel() { cancelled++; } }))); await vi.waitFor(() => expect(cancelled).toBe(1)); expect(rows()[0]).toMatchObject({ state: 'unresolved', costNanoUsd: null, outcome: 'aborted' });
  });
  it('OFF does not install buffering/attempt owner', async () => {
    db.durableTransaction(() => db.run("DELETE FROM _meta WHERE key='ledgerStartedAt'")); expect(await ctx()).toBeNull(); const upstream = result(); network.mockResolvedValue(upstream);
    expect((await executor().execute(args(null))).response).toBe(upstream); expect(rows()).toEqual([]);
  });
});
