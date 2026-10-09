import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initializePoliciesOffline } from '@/lib/db/offlinePolicyInitialization.js';
import { createRequestAccounting } from '@/lib/apiKeyBudget/requestAccounting.js';
import { putPolicySync } from '@/lib/db/repos/apiKeyAccountingRepo.js';
import { DefaultExecutor } from 'open-sse/executors/default.js';
import { executeAccountedAnthropicCandidate } from 'open-sse/executors/accountedAnthropic.js';
import { BUDGET_ERROR } from 'open-sse/config/apiKeyBudgetConstants.js';
const network = vi.hoisted(() => vi.fn());
vi.mock('open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => network(...args) }));
const legacyUsage = vi.hoisted(() => vi.fn());
const appFixture = vi.hoisted(() => ({ standard: true, select: vi.fn(), cooldown: vi.fn(), refresh: vi.fn(), model: vi.fn() }));
vi.mock('@/sse/services/auth.js', () => ({ getProviderCredentials: (...args) => appFixture.select(...args), markAccountUnavailable: (...args) => appFixture.cooldown(...args),
  clearAccountError: async () => {}, extractApiKey: request => request.headers.get('Authorization')?.slice(7), isValidApiKey: async () => true }));
vi.mock('@/sse/services/model.js', () => ({ getModelInfo: (...args) => appFixture.model(...args), getComboModels: async () => null }));
vi.mock('@/sse/services/tokenRefresh.js', () => ({ checkAndRefreshToken: (...args) => appFixture.refresh(...args), updateProviderCredentials: async () => {} }));
vi.mock('@/lib/usageDb.js', () => ({ trackPendingRequest() {}, appendRequestLog: async () => {}, saveRequestDetail: async () => {}, saveRequestUsage: legacyUsage }));
vi.mock('open-sse/executors/index.js', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, getExecutor: provider => {
    if (provider !== 'anthropic') return actual.getExecutor(provider);
    const ex = new DefaultExecutor(provider);
    if (appFixture.standard) ex.config = { ...ex.config, headers: { 'anthropic-version': '2023-06-01' } };
    return ex; // Explicit standard-only fixture, no production beta removal.
  } };
});
let directory, db;
const previous = process.env.DATA_DIR;
const event = (type, payload = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
const wire = (mode = 'exact') => event('message_start', { message: { type: 'message', id: 'msg_fixture', role: 'assistant', model: mode === 'wrong-model' ? 'wrong-model' : 'fixture-native', content: [],
  usage: { input_tokens: 50, output_tokens: 0, cache_read_input_tokens: 40, cache_creation_input_tokens: 10,
    cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 0 }, server_tool_use: { web_search_requests: mode === 'paid-tool' ? 1 : 0 } } } }) +
  event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } }) + (mode === 'missing-stop' ? '' : event('message_stop'));
const rows = () => db.all('SELECT * FROM apiKeyAccounting ORDER BY startedAt,attemptId');
const context = () => createRequestAccounting(new Request('http://localhost/v1/chat/completions', { headers: { Authorization: 'Bearer native-fixture-key' } }), { adapter: async () => db });
// Current registry defaults include beta headers, still outside this candidate.
// Fixture explicitly opts into standard API-version-only transport, not a change
// to production registry/defaults or automatic removal of beta request semantics.
const executor = () => { const ex = new DefaultExecutor('anthropic'); ex.config = { ...ex.config, headers: { 'anthropic-version': '2023-06-01' } }; return ex; };
const options = accounting => ({ model: 'fixture-native', body: Object.freeze({ model: 'fixture-native', messages: [{ role: 'user', content: 'fixture' }], max_tokens: 100, stream: false }), stream: true,
  credentials: { apiKey: 'provider-fixture' }, accounting, accountingMode: 'buffered-claude-sse', connectionId: 'native-connection' });
beforeEach(async () => {
  appFixture.standard = true; appFixture.select.mockReset(); appFixture.cooldown.mockReset(); appFixture.refresh.mockReset(); appFixture.model.mockReset();
  appFixture.select.mockResolvedValue({ apiKey: 'provider-fixture', connectionId: 'native-connection' });
  appFixture.refresh.mockImplementation(async (_provider, credentials) => credentials);
  appFixture.model.mockResolvedValue({ provider: 'anthropic', model: 'fixture-native' });
  appFixture.cooldown.mockImplementation(() => { throw new Error('Accounting failure entered cooldown'); });
  network.mockReset(); legacyUsage.mockReset(); directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-owner-')); process.env.DATA_DIR = directory; delete global._dbAdapter; vi.resetModules();
  db = await (await import('@/lib/db/driver.js')).getAdapter(); await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'native-key', key: 'native-fixture-key' }] }); db.close(); db = null;
  await initializePoliciesOffline({ directory, actor: 'fixture', reason: 'native owner disposable fixture' });
  db = await (await import('@/lib/db/driver.js')).getAdapter(); db.durableTransaction(() => db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')"));
  putPolicySync(db, 'native-key', { weeklyLimitNanoUsd: '1000000000', monthlyLimitNanoUsd: null }, 0);
  await (await import('@/lib/db/repos/pricingRepo.js')).updatePricing({ anthropic: { 'fixture-native': { input: '1', output: '2', cached: '0.1', cache_creation: '1.25' } } });
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true }); if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous; });
describe('unconnected API-key Anthropic actual POST candidate with real ledger (not app approval)', { timeout: 20000 }, () => {
  it('actual POST sees pending intent, frozen raw request and original price; exact threshold returns normally and next admission denies', async () => {
    putPolicySync(db, 'native-key', { weeklyLimitNanoUsd: '106500', monthlyLimitNanoUsd: null }, 1);
    const accounting = await context(), args = options(accounting), before = JSON.stringify(args.body);
    network.mockImplementation(async (url, init) => {
      expect(url).toBe('https://api.anthropic.com/v1/messages'); expect(init.redirect).toBe('error'); expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toMatchObject({ model: 'fixture-native', stream: true }); expect(JSON.parse(init.body).stream_options).toBeUndefined();
      expect(rows()).toHaveLength(1); expect(rows()[0].state).toBe('pending');
      await (await import('@/lib/db/repos/pricingRepo.js')).updatePricing({ anthropic: { 'fixture-native': { input: '9', output: '9', cached: '9', cache_creation: '9' } } });
      return new Response(wire(), { headers: { 'content-type': 'text/event-stream' } });
    });
    const result = await executeAccountedAnthropicCandidate(executor(), args);
    expect(await result.response.text()).toBe(wire()); expect(JSON.stringify(args.body)).toBe(before);
    expect(rows()).toHaveLength(1); expect(rows()[0]).toMatchObject({ state: 'settled', costNanoUsd: 106500 });
    await expect(executeAccountedAnthropicCandidate(executor(), options(await context()))).rejects.toMatchObject({ code: BUDGET_ERROR.EXCEEDED });
    expect(network).toHaveBeenCalledTimes(1);
  });
  it.each(['missing-stop', 'wrong-model', 'paid-tool', 'network', 'failed-status'])('%s produces durable unresolved null cost and cannot grant another POST', async mode => {
    network.mockImplementation(async () => { if (mode === 'network') throw new Error('network error'); return new Response(mode === 'failed-status' ? 'provider error' : wire(mode), { status: mode === 'failed-status' ? 429 : 200, headers: { 'content-type': 'text/event-stream' } }); });
    await expect(executeAccountedAnthropicCandidate(executor(), options(await context()))).rejects.toMatchObject({ code: BUDGET_ERROR.UNRESOLVED });
    expect(rows()).toHaveLength(1); expect(rows()[0]).toMatchObject({ state: 'unresolved', costNanoUsd: null, usageJson: null });
    await expect(executeAccountedAnthropicCandidate(executor(), options(await context()))).rejects.toMatchObject({ code: BUDGET_ERROR.UNRESOLVED }); expect(network).toHaveBeenCalledTimes(1);
  });
  it.each(['OAuth', 'Claude provider', 'wrong destination', 'wrong format', 'model mismatch', 'live-mode', 'server tools', 'pricing tier', 'beta header'])('unsupported %s refuses before intent and POST, including unlimited', async mode => {
    putPolicySync(db, 'native-key', { weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null }, 1);
    const args = options(await context()), ex = mode === 'Claude provider' ? new DefaultExecutor('claude') : executor();
    if (mode === 'OAuth') args.credentials = { accessToken: 'fixture' };
    if (mode === 'wrong destination') args.credentials = { apiKey: 'fixture', runtimeTransport: { format: 'claude', baseUrl: 'https://fixture.invalid/messages' } };
    if (mode === 'wrong format') args.credentials = { apiKey: 'fixture', runtimeTransport: { format: 'openai', baseUrl: 'https://api.anthropic.com/v1/messages' } };
    if (mode === 'model mismatch') args.body = { ...args.body, model: 'wrong' };
    if (mode === 'live-mode') args.accountingMode = 'live-openai-sse';
    if (mode === 'server tools') args.body = { ...args.body, tools: [{ type: 'web_search_20250305', name: 'web_search' }] };
    if (mode === 'pricing tier') args.body = { ...args.body, service_tier: 'priority' };
    if (mode === 'beta header') args.providerOverrides = { headers: { 'anthropic-beta': 'fixture-beta' } };
    await expect(executeAccountedAnthropicCandidate(ex, args)).rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED });
    expect(rows()).toEqual([]); expect(network).not.toHaveBeenCalled();
  });
  it('persistence rejection escapes unchanged with no successor or authorization', async () => {
    const original = await context(), error = new Error('fixture persistence failure');
    const accounting = { ...original, completeAttempt: vi.fn(() => Promise.reject(error)), assertSuccessfulTerminal: vi.fn() };
    network.mockResolvedValue(new Response(wire(), { headers: { 'content-type': 'text/event-stream' } }));
    await expect(executeAccountedAnthropicCandidate(executor(), options(accounting))).rejects.toBe(error);
    expect(rows()).toHaveLength(1); expect(rows()[0].state).toBe('pending'); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1);
    expect(accounting.assertSuccessfulTerminal).not.toHaveBeenCalled(); expect(network).toHaveBeenCalledTimes(1);
  });
  it.each(['resolve', 'reject', 'abort'])('awaited trusted authorization %s cannot release a premature response', async mode => {
    const original = await context(), caller = new AbortController(); let entered, release, reject;
    const started = new Promise(resolve => { entered = resolve; }), held = new Promise((resolve, fail) => { release = resolve; reject = fail; });
    const error = new Error('authorization refused');
    const accounting = { ...original, assertSuccessfulTerminal: vi.fn(async terminal => { entered(); await held; return original.assertSuccessfulTerminal(terminal); }) };
    network.mockResolvedValue(new Response(wire(), { headers: { 'content-type': 'text/event-stream' } }));
    let ended = false;
    const work = executeAccountedAnthropicCandidate(executor(), { ...options(accounting), signal: caller.signal }).then(value => { ended = true; return { value }; }, caught => { ended = true; return { error: caught }; });
    try { await started; expect(ended).toBe(false); expect(rows()[0].state).toBe('settled'); if (mode === 'abort') caller.abort(false); }
    finally { if (mode === 'reject') reject(error); else release(); }
    const outcome = await work;
    if (mode === 'resolve') expect(outcome.value.response.status).toBe(200);
    else expect(outcome.error).toBe(mode === 'abort' ? false : error);
    expect(accounting.assertSuccessfulTerminal).toHaveBeenCalledTimes(1); expect(network).toHaveBeenCalledTimes(1);
  });
  it('abort after admission before invocation is durable not_dispatched and zero POST', async () => {
    const original = await context(), caller = new AbortController();
    const accounting = { ...original, beforeAttempt: async (...args) => { const attempt = await original.beforeAttempt(...args); caller.abort(0); return attempt; } };
    await expect(executeAccountedAnthropicCandidate(executor(), { ...options(accounting), signal: caller.signal })).rejects.toBe(0);
    expect(rows()).toHaveLength(1); expect(rows()[0].state).toBe('not_dispatched'); expect(network).not.toHaveBeenCalled();
  });
  it('post-invocation abort preserves exact reason and observes late response cancellation without another completion', async () => {
    const original = await context(), caller = new AbortController(); let entered, release;
    const started = new Promise(resolve => { entered = resolve; });
    const cancel = vi.fn(() => Promise.reject(new Error('late cleanup failure')));
    const lateResponse = new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'text/event-stream' } });
    const accounting = { ...original, completeAttempt: vi.fn((...args) => original.completeAttempt(...args)) };
    network.mockImplementation(() => { entered(); return new Promise(resolve => { release = resolve; }); });
    const work = executeAccountedAnthropicCandidate(executor(), { ...options(accounting), signal: caller.signal }).then(value => ({ value }), error => ({ error }));
    try { await started; caller.abort(false); expect((await work).error).toBe(false); expect(rows()[0]).toMatchObject({ state: 'unresolved', costNanoUsd: null }); }
    finally { release(lateResponse); await new Promise(resolve => setImmediate(resolve)); }
    expect(cancel).toHaveBeenCalledTimes(1); expect(cancel).toHaveBeenCalledWith(false);
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(network).toHaveBeenCalledTimes(1);
  });
  it('unexpected response destination is unresolved and disposes the unread body once', async () => {
    const cancel = vi.fn(() => Promise.reject(new Error('foreign cleanup failure')));
    const response = new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'text/event-stream' } });
    Object.defineProperty(response, 'url', { value: 'https://other.invalid/messages' });
    network.mockResolvedValue(response);
    await expect(executeAccountedAnthropicCandidate(executor(), options(await context()))).rejects.toMatchObject({ code: BUDGET_ERROR.UNRESOLVED });
    expect(cancel).toHaveBeenCalledTimes(1); expect(rows()[0]).toMatchObject({ state: 'unresolved', costNanoUsd: null }); expect(network).toHaveBeenCalledTimes(1);
  });
  it.each(['redirected', 'wrong-media', 'held-cleanup'])('unhanded %s response disposes once without waiting foreign cleanup', async mode => {
    let release;
    const held = new Promise(resolve => { release = resolve; });
    const cancel = vi.fn(() => mode === 'held-cleanup' ? held : Promise.reject(new Error('foreign cleanup rejection')));
    const response = new Response(new ReadableStream({ cancel }), { headers: { 'content-type': mode === 'wrong-media' ? 'application/json' : 'text/event-stream' } });
    if (mode === 'redirected') Object.defineProperty(response, 'redirected', { value: true });
    if (mode === 'held-cleanup') Object.defineProperty(response, 'url', { value: 'https://other.invalid/messages' });
    network.mockResolvedValue(response);
    try {
      await expect(executeAccountedAnthropicCandidate(executor(), options(await context()))).rejects.toMatchObject({ code: BUDGET_ERROR.UNRESOLVED });
      expect(cancel).toHaveBeenCalledTimes(1); expect(rows()[0]).toMatchObject({ state: 'unresolved', costNanoUsd: null });
      expect(network).toHaveBeenCalledTimes(1);
    } finally { release(); await held; }
  });
  it('production registry beta defaults still refuse with zero intent and POST', async () => {
    await expect(executeAccountedAnthropicCandidate(new DefaultExecutor('anthropic'), options(await context()))).rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED });
    expect(rows()).toEqual([]); expect(network).not.toHaveBeenCalled();
  });
  it.each(['implicit accounting mode', 'live client body', 'OAuth-shaped API key', '1h cache request'])('request policy %s denies before durable intent and POST', async mode => {
    const args = options(await context());
    if (mode === 'implicit accounting mode') delete args.accountingMode;
    else args.accountingMode = 'buffered-claude-sse';
    if (mode === 'live client body') args.body = { ...args.body, stream: true };
    if (mode === 'OAuth-shaped API key') args.credentials = { apiKey: 'sk-ant-oat01-fixture' };
    if (mode === '1h cache request') args.body = { ...args.body, system: [{ type: 'text', text: 'fixture', cache_control: { type: 'ephemeral', ttl: '1h' } }] };
    await expect(executeAccountedAnthropicCandidate(executor(), args)).rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED });
    expect(rows()).toEqual([]); expect(network).not.toHaveBeenCalled();
  });
  it('wire credentials headers/model remain pinned across awaited admission without mutating caller', async () => {
    const original = await context(), ex = executor(), credentials = { apiKey: 'provider-fixture' };
    const body = { model: 'fixture-native', messages: [{ role: 'user', content: 'original' }], max_tokens: 100, stream: false };
    const headers = { Accept: 'text/event-stream' };
    const accounting = { ...original, beforeAttempt: async (...args) => {
      const attempt = await original.beforeAttempt(...args);
      body.messages[0].content = 'changed'; credentials.apiKey = 'changed-key'; headers.Accept = 'application/json';
      ex.config.baseUrl = 'https://changed.invalid/messages'; return attempt;
    } };
    network.mockImplementation(async (url, init) => {
      expect(url).toBe('https://api.anthropic.com/v1/messages'); expect(init.headers['x-api-key']).toBe('provider-fixture');
      expect(new Headers(init.headers).get('accept')).toBe('text/event-stream');
      expect(JSON.parse(init.body).messages[0].content).toBe('original');
      return new Response(wire(), { headers: { 'content-type': 'text/event-stream' } });
    });
    await executeAccountedAnthropicCandidate(ex, { ...options(accounting), accountingMode: 'buffered-claude-sse', credentials, body, providerOverrides: { headers } });
    expect(rows()[0]).toMatchObject({ state: 'settled', costNanoUsd: 106500 }); expect(network).toHaveBeenCalledTimes(1);
    expect(body.stream).toBe(false); expect(body.messages[0].content).toBe('changed');
  });
  it('standard 5m cache request remains supported with unchanged caller bytes', async () => {
    const args = options(await context());
    args.body = { ...args.body, system: [{ type: 'text', text: 'fixture', cache_control: { type: 'ephemeral', ttl: '5m' } }] };
    const before = JSON.stringify(args.body);
    network.mockImplementation(async (_url, init) => {
      expect(JSON.parse(init.body).system[0].cache_control.ttl).toBe('5m');
      return new Response(wire(), { headers: { 'content-type': 'text/event-stream' } });
    });
    await executeAccountedAnthropicCandidate(executor(), args);
    expect(JSON.stringify(args.body)).toBe(before); expect(rows()[0]).toMatchObject({ state: 'settled', costNanoUsd: 106500 });
  });
  it.each(['message cache', 'tool cache', 'unknown TTL'])('unsupported %s cache request refuses before intent and POST', async mode => {
    const args = options(await context());
    if (mode === 'message cache') args.body = { ...args.body, messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture', cache_control: { type: 'ephemeral', ttl: '1h' } }] }] };
    if (mode === 'tool cache') args.body = { ...args.body, tools: [{ name: 'fixture', input_schema: { type: 'object' }, cache_control: { type: 'ephemeral', ttl: '1h' } }] };
    if (mode === 'unknown TTL') args.body = { ...args.body, system: [{ type: 'text', text: 'fixture', cache_control: { type: 'ephemeral', ttl: 'future' } }] };
    await expect(executeAccountedAnthropicCandidate(executor(), args)).rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED });
    expect(rows()).toEqual([]); expect(network).not.toHaveBeenCalled();
  });
  it.each(['message shape', 'server tool', 'cache TTL', 'tool schema'])('post-serialization %s change denies before intent and POST', async mode => {
    const ex = executor(), originalTransform = ex.transformRequest.bind(ex);
    // Nested serialization hooks are not on the top-level request field list.
    // Validation must inspect the exact serialized payload, not the prior object.
    ex.transformRequest = (...args) => {
      const transformed = originalTransform(...args);
      if (mode === 'message shape') transformed.messages = [{ role: 'user', content: 'fixture', toJSON: () => ({ role: 'system', content: 'changed' }) }];
      if (mode === 'server tool' || mode === 'tool schema') transformed.tools = [{ name: 'fixture', input_schema: { type: 'object' },
        toJSON: () => mode === 'server tool' ? { type: 'web_search_20250305', name: 'web_search' } : { name: 'fixture', input_schema: [] } }];
      if (mode === 'cache TTL') transformed.system = [{ type: 'text', text: 'fixture', cache_control: { type: 'ephemeral', ttl: '5m' },
        toJSON: () => ({ type: 'text', text: 'fixture', cache_control: { type: 'ephemeral', ttl: '1h' } }) }];
      return transformed;
    };
    await expect(executeAccountedAnthropicCandidate(ex, options(await context()))).rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED });
    expect(rows()).toEqual([]); expect(network).not.toHaveBeenCalled();
  });
  it('semantics-preserving nested serialization is validated from pinned wire bytes', async () => {
    const ex = executor(), originalTransform = ex.transformRequest.bind(ex);
    ex.transformRequest = (...args) => {
      const transformed = originalTransform(...args);
      transformed.tools = [{ name: 'fixture', input_schema: { type: 'object' }, toJSON: () => ({ name: 'fixture', input_schema: { type: 'object' } }) }];
      return transformed;
    };
    network.mockImplementation(async (_url, init) => {
      expect(JSON.parse(init.body).tools).toEqual([{ name: 'fixture', input_schema: { type: 'object' } }]);
      return new Response(wire(), { headers: { 'content-type': 'text/event-stream' } });
    });
    const result = await executeAccountedAnthropicCandidate(ex, options(await context()));
    expect(result.transformedBody.tools).toEqual([{ name: 'fixture', input_schema: { type: 'object' } }]);
    expect(rows()[0]).toMatchObject({ state: 'settled', costNanoUsd: 106500 }); expect(network).toHaveBeenCalledTimes(1);
  });
  it.each(['throwing serialization', 'cyclic serialization'])('%s refuses before admission and POST', async mode => {
    const ex = executor(), originalTransform = ex.transformRequest.bind(ex);
    ex.transformRequest = (...args) => {
      const transformed = originalTransform(...args);
      if (mode === 'throwing serialization') transformed.messages = [{ role: 'user', content: 'fixture', toJSON: () => { throw new Error('serialization failure'); } }];
      else transformed.messages[0].content = transformed.messages;
      return transformed;
    };
    await expect(executeAccountedAnthropicCandidate(ex, options(await context()))).rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED });
    expect(rows()).toEqual([]); expect(network).not.toHaveBeenCalled();
  });
  it('explicit Base entry owns one native POST with durable price snapshot and no caller mutation', async () => {
    const args = options(await context()), before = JSON.stringify(args.body);
    network.mockImplementation(async (url, init) => {
      expect(url).toBe('https://api.anthropic.com/v1/messages'); expect(init.redirect).toBe('error');
      expect(rows()[0].state).toBe('pending'); expect(JSON.parse(init.body).stream).toBe(true);
      return new Response(wire(), { headers: { 'content-type': 'text/event-stream' } });
    });
    const result = await executor().execute(args);
    expect(result.accountingOwned).toBe(true); expect(rows()[0]).toMatchObject({ state: 'settled', costNanoUsd: 106500 });
    expect(JSON.stringify(args.body)).toBe(before); expect(network).toHaveBeenCalledTimes(1);
  });
  it('explicit Base entry cannot retry paid status uncertainty despite configured retries', async () => {
    const ex = executor(); ex.config.retry = { 429: { attempts: 3, delayMs: 1 } };
    network.mockResolvedValue(new Response('paid status unknown', { status: 429 }));
    await expect(ex.execute(options(await context()))).rejects.toMatchObject({ code: BUDGET_ERROR.UNRESOLVED });
    expect(rows()).toHaveLength(1); expect(rows()[0]).toMatchObject({ state: 'unresolved', costNanoUsd: null });
    expect(network).toHaveBeenCalledTimes(1);
  });
  it('explicit Base entry awaits durable completion before response', async () => {
    const original = await context(); let entered, release;
    const started = new Promise(resolve => { entered = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...original, completeAttempt: vi.fn(async (...args) => { entered(); await held; return original.completeAttempt(...args); }) };
    network.mockResolvedValue(new Response(wire(), { headers: { 'content-type': 'text/event-stream' } }));
    let ended = false;
    const work = executor().execute(options(accounting)).then(value => { ended = true; return { value }; }, error => { ended = true; return { error }; });
    // A rejection before POST is observed too, so the test never hangs waiting
    // for an entry point that has not yet been connected.
    try {
      const entry = await Promise.race([started.then(() => 'entered'), work.then(() => 'ended')]);
      expect(entry).toBe('entered'); expect(ended).toBe(false); expect(rows()[0].state).toBe('pending');
    } finally { release(); }
    const result = await work; expect(result.error).toBeUndefined(); expect(rows()[0].state).toBe('settled');
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(network).toHaveBeenCalledTimes(1);
  });
  it.each(['registry beta', 'OAuth provider', 'live caller', 'missing mode'])('Base entry %s denial stays zero-intent/POST', async mode => {
    const args = options(await context());
    let ex = executor();
    if (mode === 'registry beta') ex = new DefaultExecutor('anthropic');
    if (mode === 'OAuth provider') ex = new DefaultExecutor('claude');
    if (mode === 'live caller') args.body = { ...args.body, stream: true };
    if (mode === 'missing mode') delete args.accountingMode;
    await expect(ex.execute(args)).rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED });
    expect(rows()).toEqual([]); expect(network).not.toHaveBeenCalled();
  });
  it('OFF Base entry retains registry beta headers and non-stream client wire unchanged', async () => {
    const args = { ...options(null), stream: false }, before = JSON.stringify(args.body);
    network.mockImplementation(async (_url, init) => {
      expect(JSON.parse(init.body).stream).toBe(false);
      expect(new Headers(init.headers).has('anthropic-beta')).toBe(true);
      return new Response('fixture response', { headers: { 'content-type': 'application/json' } });
    });
    const result = await new DefaultExecutor('anthropic').execute(args);
    expect(await result.response.text()).toBe('fixture response'); expect(result.accountingOwned).toBeUndefined();
    expect(JSON.stringify(args.body)).toBe(before); expect(rows()).toEqual([]); expect(network).toHaveBeenCalledTimes(1);
  });
  it('actual owner exposes captured native message only after exact settlement, preserving raw SSE response', async () => {
    const nativeWire = wire().replace('event: message_delta',
      event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) +
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'native answer' } }) +
      event('content_block_stop', { index: 0 }) + 'event: message_delta');
    network.mockResolvedValue(new Response(nativeWire, { headers: { 'content-type': 'text/event-stream' } }));
    const result = await executor().execute(options(await context()));
    expect(result.accountingMessage).toMatchObject({ id: 'msg_fixture', model: 'fixture-native', type: 'message', role: 'assistant',
      content: [{ type: 'text', text: 'native answer' }], stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 50, output_tokens: 20, cache_read_input_tokens: 40, cache_creation_input_tokens: 10 } });
    expect(rows()[0]).toMatchObject({ state: 'settled', costNanoUsd: 106500 });
    expect(await result.response.text()).toBe(nativeWire); expect(network).toHaveBeenCalledTimes(1);
  });
  it('actual owner malformed native client-tool JSON is durable unresolved, not empty JSON success', async () => {
    const nativeWire = wire().replace('event: message_delta',
      event('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'tool_1', name: 'fixture', input: {} } }) +
      event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{' } }) +
      event('content_block_stop', { index: 0 }) + 'event: message_delta');
    network.mockResolvedValue(new Response(nativeWire, { headers: { 'content-type': 'text/event-stream' } }));
    await expect(executor().execute(options(await context()))).rejects.toMatchObject({ code: BUDGET_ERROR.UNRESOLVED });
    expect(rows()[0]).toMatchObject({ state: 'unresolved', costNanoUsd: null, usageJson: null }); expect(network).toHaveBeenCalledTimes(1);
  });
  it('native owner message and SSE result stay withheld through trusted authorization', async () => {
    const original = await context(); let entered, release;
    const started = new Promise(resolve => { entered = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...original, assertSuccessfulTerminal: vi.fn(async terminal => { entered(); await held; return original.assertSuccessfulTerminal(terminal); }) };
    network.mockResolvedValue(new Response(wire(), { headers: { 'content-type': 'text/event-stream' } }));
    let delivered;
    const work = executor().execute(options(accounting)).then(result => { delivered = result; return result; });
    try { await started; expect(delivered).toBeUndefined(); expect(rows()[0].state).toBe('settled'); }
    finally { release(); }
    const result = await work;
    expect(result.accountingMessage).toMatchObject({ model: 'fixture-native', usage: { output_tokens: 20 } });
    expect(await result.response.text()).toBe(wire()); expect(network).toHaveBeenCalledTimes(1);
  });
  it('chatCore standard raw Claude non-stream releases native JSON after actual owner settlement', async () => {
    const { handleChatCore } = await import('open-sse/handlers/chatCore.js');
    const args = options(await context()), before = JSON.stringify(args.body);
    network.mockImplementation(async (_url, init) => {
      expect(rows()[0].state).toBe('pending'); expect(JSON.parse(init.body).stream).toBe(true);
      return new Response(wire(), { headers: { 'content-type': 'text/event-stream' } });
    });
    const result = await handleChatCore({ ...args, modelInfo: { provider: 'anthropic', model: 'fixture-native' }, sourceFormatOverride: 'claude' });
    expect(JSON.stringify(args.body)).toBe(before);
    expect(result.success).toBe(true); expect(result.response.headers.get('content-type')).toContain('application/json');
    expect(await result.response.json()).toMatchObject({ id: 'msg_fixture', type: 'message', model: 'fixture-native', stop_reason: 'end_turn', usage: { output_tokens: 20 } });
    expect(rows()[0]).toMatchObject({ state: 'settled', costNanoUsd: 106500 }); expect(network).toHaveBeenCalledTimes(1); expect(legacyUsage).not.toHaveBeenCalled();
  });
  it.each(['missing-stop', 'failed-status'])('chatCore native %s is local unresolved, not synthetic success/502/refresh', async mode => {
    const { handleChatCore } = await import('open-sse/handlers/chatCore.js');
    network.mockResolvedValue(new Response(wire(mode), { status: mode === 'failed-status' ? 401 : 200, headers: { 'content-type': 'text/event-stream' } }));
    await expect(handleChatCore({ ...options(await context()), modelInfo: { provider: 'anthropic', model: 'fixture-native' }, sourceFormatOverride: 'claude' }))
      .rejects.toMatchObject({ code: BUDGET_ERROR.UNRESOLVED });
    expect(rows()[0]).toMatchObject({ state: 'unresolved', costNanoUsd: null }); expect(network).toHaveBeenCalledTimes(1); expect(legacyUsage).not.toHaveBeenCalled();
  });
  it.each(['live tools', 'OpenAI source', 'beta headers'])('chatCore native %s remains denied before intent/POST', async mode => {
    const { handleChatCore } = await import('open-sse/handlers/chatCore.js');
    const args = options(await context());
    if (mode === 'live tools') args.body = { ...args.body, stream: true, tools: [{ name: 'fixture', input_schema: {} }] };
    if (mode === 'beta headers') args.providerOverrides = { headers: { 'anthropic-beta': 'fixture' } };
    await expect(handleChatCore({ ...args, modelInfo: { provider: 'anthropic', model: 'fixture-native' }, sourceFormatOverride: mode === 'OpenAI source' ? 'openai' : 'claude' }))
      .rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED });
    expect(rows()).toEqual([]); expect(network).not.toHaveBeenCalled();
  });
  it('chatCore native JSON and success callback wait for trusted owner authorization', async () => {
    const { handleChatCore } = await import('open-sse/handlers/chatCore.js');
    const original = await context(); let entered, release;
    const started = new Promise(resolve => { entered = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...original, assertSuccessfulTerminal: vi.fn(async terminal => { entered(); await held; return original.assertSuccessfulTerminal(terminal); }) };
    const success = vi.fn(); network.mockResolvedValue(new Response(wire(), { headers: { 'content-type': 'text/event-stream' } }));
    let delivered;
    const work = handleChatCore({ ...options(accounting), modelInfo: { provider: 'anthropic', model: 'fixture-native' }, sourceFormatOverride: 'claude', onRequestSuccess: success })
      .then(result => { delivered = result; return result; });
    try { await started; expect(delivered).toBeUndefined(); expect(success).not.toHaveBeenCalled(); expect(rows()[0].state).toBe('settled'); }
    finally { release(); }
    expect((await work).success).toBe(true); expect(success).toHaveBeenCalledTimes(1); expect(network).toHaveBeenCalledTimes(1);
  });
  it.each(['abort', 'throw'])('chatCore native success callback %s cannot release JSON or rewrite settled cost', async mode => {
    const { handleChatCore } = await import('open-sse/handlers/chatCore.js');
    const caller = new AbortController(), error = new Error('fixture callback failure');
    const success = vi.fn(async () => { if (mode === 'abort') caller.abort(false); else throw error; });
    network.mockResolvedValue(new Response(wire(), { headers: { 'content-type': 'text/event-stream' } }));
    await expect(handleChatCore({ ...options(await context()), signal: caller.signal, modelInfo: { provider: 'anthropic', model: 'fixture-native' }, sourceFormatOverride: 'claude', onRequestSuccess: success }))
      .rejects.toBe(mode === 'abort' ? false : error);
    expect(rows()).toHaveLength(1); expect(rows()[0]).toMatchObject({ state: 'settled', costNanoUsd: 106500 });
    expect(success).toHaveBeenCalledTimes(1); expect(network).toHaveBeenCalledTimes(1); expect(legacyUsage).not.toHaveBeenCalled();
  });
  it('app messages standard native request settles at threshold and next admission refuses without cooldown or legacy debit', async () => {
    const { handleChat } = await import('@/sse/handlers/chat.js');
    putPolicySync(db, 'native-key', { weeklyLimitNanoUsd: '106500', monthlyLimitNanoUsd: null }, 1);
    const request = () => new Request('http://localhost/v1/messages', { method: 'POST', headers: { Authorization: 'Bearer native-fixture-key' },
      body: JSON.stringify({ model: 'anthropic/fixture-native', messages: [{ role: 'user', content: 'fixture' }], max_tokens: 100, stream: false }) });
    network.mockImplementation(async (_url, init) => {
      expect(rows()[0].state).toBe('pending'); expect(JSON.parse(init.body)).toMatchObject({ model: 'fixture-native', stream: true });
      return new Response(wire(), { headers: { 'content-type': 'text/event-stream' } });
    });
    const first = await handleChat(request()); expect(first.status).toBe(200); expect(await first.json()).toMatchObject({ type: 'message', model: 'fixture-native' });
    expect(rows()[0]).toMatchObject({ state: 'settled', costNanoUsd: 106500 });
    const next = await handleChat(request()); expect(next.status).toBe(429); expect((await next.json()).error.code).toBe(BUDGET_ERROR.EXCEEDED);
    expect(network).toHaveBeenCalledTimes(1); expect(appFixture.cooldown).not.toHaveBeenCalled(); expect(legacyUsage).not.toHaveBeenCalled();
  });
  it('app native missing terminal is durable unresolved and cannot choose another account or refresh', async () => {
    const { handleChat } = await import('@/sse/handlers/chat.js');
    network.mockResolvedValue(new Response(wire('missing-stop'), { headers: { 'content-type': 'text/event-stream' } }));
    const request = () => new Request('http://localhost/v1/messages', { method: 'POST', headers: { Authorization: 'Bearer native-fixture-key' },
      body: JSON.stringify({ model: 'anthropic/fixture-native', messages: [{ role: 'user', content: 'fixture' }], max_tokens: 100, stream: false }) });
    const response = await handleChat(request()); expect(response.status).toBe(503); expect((await response.json()).error.code).toBe(BUDGET_ERROR.UNRESOLVED);
    expect(rows()[0]).toMatchObject({ state: 'unresolved', costNanoUsd: null });
    const next = await handleChat(request()); expect(next.status).toBe(503); expect((await next.json()).error.code).toBe(BUDGET_ERROR.UNRESOLVED);
    expect(network).toHaveBeenCalledTimes(1); expect(appFixture.select).toHaveBeenCalledTimes(1); expect(appFixture.refresh).toHaveBeenCalledTimes(1);
    expect(appFixture.cooldown).not.toHaveBeenCalled(); expect(legacyUsage).not.toHaveBeenCalled();
  });
  const liveOptions = accounting => ({ ...options(accounting), body: { ...options(accounting).body, stream: true }, accountingMode: 'native-claude-sse' });
  it.each(['owner', 'Base', 'core', 'app'])('explicit native Messages SSE %s standard-only fixture preserves raw wire/threshold/no duplicate debit', async lane => {
    putPolicySync(db, 'native-key', { weeklyLimitNanoUsd: '106500', monthlyLimitNanoUsd: null }, 1);
    const args = liveOptions(await context());
    const raw = wire().replace('event: message_delta', event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) +
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'fixture' } }) + event('content_block_stop', { index: 0 }) + 'event: message_delta');
    network.mockImplementation((url, init, _proxy, contract) => {
      expect(url).toBe('https://api.anthropic.com/v1/messages'); expect(contract).toEqual({ singlePost: true }); expect(init.redirect).toBe('error');
      expect(JSON.parse(init.body)).toMatchObject({ model: 'fixture-native', stream: true }); expect(rows()[0].state).toBe('pending');
      return new Response(raw, { headers: { 'Content-Type': 'text/event-stream' } });
    });
    let response;
    if (lane === 'owner') response = (await executeAccountedAnthropicCandidate(executor(), args)).response;
    if (lane === 'Base') response = (await executor().execute(args)).response;
    if (lane === 'core') response = (await (await import('open-sse/handlers/chatCore.js')).handleChatCore({ ...args, modelInfo: { provider: 'anthropic', model: 'fixture-native' }, sourceFormatOverride: 'claude' })).response;
    if (lane === 'app') response = await (await import('@/sse/handlers/chat.js')).handleChat(new Request('http://localhost/v1/messages', { method: 'POST', headers: { Authorization: 'Bearer native-fixture-key' }, body: JSON.stringify({ ...args.body, model: 'anthropic/fixture-native' }) }));
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toContain('text/event-stream'); expect(await response.text()).toBe(raw);
    expect(rows()).toHaveLength(1); expect(rows()[0]).toMatchObject({ state: 'settled', costNanoUsd: 106500 }); expect(legacyUsage).not.toHaveBeenCalled(); expect(appFixture.cooldown).not.toHaveBeenCalled();
    await expect(executeAccountedAnthropicCandidate(executor(), liveOptions(await context()))).rejects.toMatchObject({ code: BUDGET_ERROR.EXCEEDED }); expect(network).toHaveBeenCalledTimes(1);
  });
  it.each(['missing-stop', 'trailing-error'])('Messages live owner %s leaves unresolved/no successor without synthetic success', async mode => {
    network.mockResolvedValue(new Response(wire(mode === 'missing-stop' ? mode : 'exact') + (mode === 'trailing-error' ? event('error', { error: {} }) : ''), { headers: { 'Content-Type': 'text/event-stream' } }));
    const result = await executeAccountedAnthropicCandidate(executor(), liveOptions(await context()));
    await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable'); await new Promise(resolve => setImmediate(resolve));
    expect(rows()[0]).toMatchObject({ state: 'unresolved', costNanoUsd: null });
    await expect(executeAccountedAnthropicCandidate(executor(), liveOptions(await context()))).rejects.toMatchObject({ code: BUDGET_ERROR.UNRESOLVED }); expect(network).toHaveBeenCalledTimes(1);
  });
  it.each(['missing-stop', 'trailing-error'])('app live %s does not select successor account or cooldown after terminal failure', async mode => {
    const { handleChat } = await import('@/sse/handlers/chat.js');
    network.mockResolvedValue(new Response(wire(mode === 'missing-stop' ? mode : 'exact') + (mode === 'trailing-error' ? event('error', { error: {} }) : ''), { headers: { 'Content-Type': 'text/event-stream' } }));
    const request = () => new Request('http://localhost/v1/messages', { method: 'POST', headers: { Authorization: 'Bearer native-fixture-key' }, body: JSON.stringify({ ...liveOptions(null).body, model: 'anthropic/fixture-native' }) });
    const response = await handleChat(request()); expect(response.status).toBe(200); await expect(response.text()).rejects.toThrow('Gateway accounting stream unavailable'); await new Promise(resolve => setImmediate(resolve));
    expect(rows()).toHaveLength(1); expect(rows()[0]).toMatchObject({ state: 'unresolved', costNanoUsd: null });
    const next = await handleChat(request()); expect(next.status).toBe(503); expect((await next.json()).error.code).toBe(BUDGET_ERROR.UNRESOLVED);
    expect(network).toHaveBeenCalledTimes(1); expect(appFixture.select).toHaveBeenCalledTimes(1); expect(appFixture.cooldown).not.toHaveBeenCalled(); expect(legacyUsage).not.toHaveBeenCalled();
  });
  it.each(['omitted', 'string', 'number', 'lookalike', 'trailing-slash', 'live-beta', 'live-oauth'])('app native %s cannot widen exact explicit intent/route/transport authority', async mode => {
    const { handleChat } = await import('@/sse/handlers/chat.js'); putPolicySync(db, 'native-key', { weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null }, 1);
    const body = { ...liveOptions(null).body, model: 'anthropic/fixture-native' };
    if (mode === 'omitted') delete body.stream;
    if (mode === 'string') body.stream = 'true';
    if (mode === 'number') body.stream = 1;
    if (mode === 'live-beta') appFixture.standard = false;
    if (mode === 'live-oauth') appFixture.select.mockResolvedValue({ accessToken: 'fixture', connectionId: 'native-connection' });
    const endpoint = mode === 'lookalike' ? '/prefix/v1/messages-extra' : mode === 'trailing-slash' ? '/v1/messages/' : '/v1/messages';
    const response = await handleChat(new Request(`http://localhost${endpoint}`, { method: 'POST', headers: { Authorization: 'Bearer native-fixture-key' }, body: JSON.stringify(body) }));
    expect(response.status).toBe(503); expect((await response.json()).error.code).toBe(BUDGET_ERROR.UNSUPPORTED); expect(rows()).toEqual([]); expect(network).not.toHaveBeenCalled(); expect(appFixture.cooldown).not.toHaveBeenCalled();
  });
  it.each(['registry beta', 'live tools', 'OpenAI endpoint', 'OAuth credentials'])('app native %s remains zero-intent/POST denied including unlimited', async mode => {
    const { handleChat } = await import('@/sse/handlers/chat.js');
    putPolicySync(db, 'native-key', { weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null }, 1);
    if (mode === 'registry beta') appFixture.standard = false;
    if (mode === 'OAuth credentials') appFixture.select.mockResolvedValue({ accessToken: 'fixture-oauth', connectionId: 'native-connection' });
    const request = new Request(`http://localhost/v1/${mode === 'OpenAI endpoint' ? 'chat/completions' : 'messages'}`, { method: 'POST', headers: { Authorization: 'Bearer native-fixture-key' },
      body: JSON.stringify({ model: 'anthropic/fixture-native', messages: [{ role: 'user', content: 'fixture' }], max_tokens: 100, stream: mode === 'live tools',
        ...(mode === 'live tools' ? { tools: [{ name: 'fixture', input_schema: {} }] } : {}) }) });
    const response = await handleChat(request); expect(response.status).toBe(503); expect((await response.json()).error.code).toBe(BUDGET_ERROR.UNSUPPORTED);
    expect(rows()).toEqual([]); expect(network).not.toHaveBeenCalled(); expect(appFixture.cooldown).not.toHaveBeenCalled();
  });
  it.each(['registry beta', 'oauth', 'buffered-mode-live', 'live-mode-buffered', 'tools', 'image', 'thinking', 'relay', 'nested-unknown'])('live %s remains denied before intent/POST including unlimited', async mode => {
    putPolicySync(db, 'native-key', { weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null }, 1);
    const args = liveOptions(await context()), ex = mode === 'registry beta' ? new DefaultExecutor('anthropic') : executor();
    if (mode === 'oauth') args.credentials.accessToken = 'fixture';
    if (mode === 'buffered-mode-live') args.accountingMode = 'buffered-claude-sse';
    if (mode === 'live-mode-buffered') args.body.stream = false;
    if (mode === 'tools') args.body.tools = [{ name: 'fixture', input_schema: {} }];
    if (mode === 'image') args.body.messages = [{ role: 'user', content: [{ type: 'image', source: { type: 'url', url: 'https://fixture.invalid' } }] }];
    if (mode === 'thinking') args.body.thinking = { type: 'enabled', budget_tokens: 10 };
    if (mode === 'relay') args.proxyOptions = { vercelRelayUrl: 'https://relay.invalid' };
    if (mode === 'nested-unknown') args.body.messages = [{ role: 'user', content: 'fixture', paid_context: true }];
    await expect(executeAccountedAnthropicCandidate(ex, args)).rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED }); expect(rows()).toEqual([]); expect(network).not.toHaveBeenCalled();
  });
  it.each(['json-media', 'wrong-url', 'redirect', 'locked-reader'])('native live constructor %s is one unresolved owner without buffered fallback', async mode => {
    const res = new Response(wire(), { headers: { 'Content-Type': mode === 'json-media' ? 'application/json' : 'text/event-stream' } });
    if (mode === 'wrong-url') Object.defineProperty(res, 'url', { value: 'https://fixture.invalid' });
    if (mode === 'redirect') Object.defineProperty(res, 'redirected', { value: true });
    let reader; if (mode === 'locked-reader') reader = res.body.getReader(); network.mockResolvedValue(res);
    try { await expect(executeAccountedAnthropicCandidate(executor(), liveOptions(await context()))).rejects.toMatchObject({ code: BUDGET_ERROR.UNRESOLVED }); }
    finally { reader?.releaseLock(); }
    expect(rows()).toHaveLength(1); expect(rows()[0]).toMatchObject({ state: 'unresolved', costNanoUsd: null }); expect(network).toHaveBeenCalledTimes(1);
  });
  it.each(['headroom', 'pxpipe', 'original-tools'])('native live core %s cannot be removed by external preprocessing to gain eligibility', async mode => {
    const args = liveOptions(await context()); if (mode === 'original-tools') args.body.tools = [{ name: 'fixture', input_schema: {} }];
    await expect((await import('open-sse/handlers/chatCore.js')).handleChatCore({ ...args, modelInfo: { provider: 'anthropic', model: 'fixture-native' }, sourceFormatOverride: 'claude', headroomEnabled: mode === 'headroom', pxpipeEnabled: mode === 'pxpipe' })).rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED });
    expect(rows()).toEqual([]); expect(network).not.toHaveBeenCalled();
  });
  it('actual native owner requests strict single-POST transport contract', async () => {
    network.mockImplementation(async (_url, _init, _proxy, contract) => {
      expect(contract).toEqual({ singlePost: true });
      return new Response(wire(), { headers: { 'content-type': 'text/event-stream' } });
    });
    await executor().execute(options(await context()));
    expect(rows()[0]).toMatchObject({ state: 'settled', costNanoUsd: 106500 }); expect(network).toHaveBeenCalledTimes(1);
  });
  it('native relay override refuses before durable intent and transport invocation', async () => {
    await expect(executor().execute({ ...options(await context()), proxyOptions: { vercelRelayUrl: 'https://relay.invalid' } }))
      .rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED });
    expect(rows()).toEqual([]); expect(network).not.toHaveBeenCalled();
  });
  it('native owner pins proxy destination options across asynchronous admission', async () => {
    const original = await context(), proxyOptions = { connectionProxyEnabled: true, connectionProxyUrl: 'http://127.0.0.1:1', strictProxy: true };
    const accounting = { ...original, beforeAttempt: async (...args) => {
      const attempt = await original.beforeAttempt(...args);
      proxyOptions.vercelRelayUrl = 'https://changed.invalid'; proxyOptions.connectionProxyUrl = 'http://changed.invalid'; return attempt;
    } };
    network.mockImplementation(async (_url, _init, proxy, contract) => {
      expect(proxy).toEqual({ connectionProxyEnabled: true, connectionProxyUrl: 'http://127.0.0.1:1', strictProxy: true });
      expect(contract).toEqual({ singlePost: true });
      return new Response(wire(), { headers: { 'content-type': 'text/event-stream' } });
    });
    await executor().execute({ ...options(accounting), proxyOptions });
    expect(rows()[0]).toMatchObject({ state: 'settled', costNanoUsd: 106500 }); expect(network).toHaveBeenCalledTimes(1);
  });
  it('durable completion is awaited before success response or a same-request successor', async () => {
    const original = await context(); let entered, release;
    const started = new Promise(resolve => { entered = resolve; }), hold = new Promise(resolve => { release = resolve; });
    const accounting = { ...original, completeAttempt: vi.fn(async (...args) => { entered(); await hold; return original.completeAttempt(...args); }) };
    network.mockResolvedValue(new Response(wire(), { headers: { 'content-type': 'text/event-stream' } }));
    let ended = false; const work = executeAccountedAnthropicCandidate(executor(), options(accounting)).then(result => { ended = true; return result; });
    try { await started; expect(ended).toBe(false); expect(rows()[0].state).toBe('pending'); expect(network).toHaveBeenCalledTimes(1); } finally { release(); }
    await work; expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(rows()[0].state).toBe('settled');
  });
});
