import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initializePoliciesOffline } from '@/lib/db/offlinePolicyInitialization.js';
import { createRequestAccounting } from '@/lib/apiKeyBudget/requestAccounting.js';
import { putPolicySync } from '@/lib/db/repos/apiKeyAccountingRepo.js';
import { CodexExecutor } from 'open-sse/executors/codex.js';
import { executeAccountedResponsesCandidate } from 'open-sse/executors/accountedResponses.js';
import { BUDGET_ERROR } from 'open-sse/config/apiKeyBudgetConstants.js';
const network = vi.hoisted(() => vi.fn());
const app = vi.hoisted(() => ({ select: vi.fn(), refresh: vi.fn(), cooldown: vi.fn() }));
vi.mock('open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => network(...args) }));
vi.mock('@/sse/services/auth.js', () => ({ getProviderCredentials: (...args) => app.select(...args), markAccountUnavailable: (...args) => app.cooldown(...args), clearAccountError: async () => {}, extractApiKey: request => request.headers.get('Authorization')?.slice(7), isValidApiKey: async () => true }));
vi.mock('@/sse/services/model.js', () => ({ getModelInfo: async () => ({ provider: 'codex', model: 'gpt-5.5' }), getComboModels: async () => null }));
vi.mock('@/sse/services/tokenRefresh.js', () => ({ checkAndRefreshToken: (...args) => app.refresh(...args), updateProviderCredentials: async () => {} }));
vi.mock('@/lib/usageDb.js', () => ({ trackPendingRequest() {}, appendRequestLog: async () => {}, saveRequestDetail: async () => {}, saveRequestUsage: vi.fn() }));
const mode = 'native-codex-responses-sse';
const url = 'https://chatgpt.com/backend-api/codex/responses';
const body = () => ({ model: 'gpt-5.5', stream: true, store: false, instructions: 'fixture instruction', input: [{ role: 'user', content: [{ type: 'input_text', text: 'fixture' }] }] });
const credentials = () => ({ accessToken: 'dummy-codex-oauth', connectionId: 'codex-connection', providerSpecificData: { chatgptAccountId: 'dummy-account' } });
const options = accounting => ({ accounting, accountingMode: mode, model: 'gpt-5.5', body: body(), stream: true, credentials: credentials(), connectionId: 'codex-connection' });
const final = () => ({ id: 'resp_fixture', object: 'response', model: 'gpt-5.5', status: 'completed', service_tier: 'default', error: null, incomplete_details: null, output: [], usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 10 } } });
const wire = () => [{ type: 'response.created', response: { ...final(), status: 'in_progress', usage: null } }, { type: 'response.completed', response: final() }].map((event, sequence_number) => `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join('');
const response = () => new Response(wire(), { headers: { 'Content-Type': 'text/event-stream' } });
let directory, db;
const previous = process.env.DATA_DIR;
const rows = () => db.all('SELECT * FROM apiKeyAccounting ORDER BY startedAt,attemptId');
const context = () => createRequestAccounting(new Request('http://localhost/v1/responses', { headers: { Authorization: 'Bearer codex-gateway-fixture' } }), { adapter: async () => db });
beforeEach(async () => {
  network.mockReset(); app.select.mockReset(); app.refresh.mockReset(); app.cooldown.mockReset();
  app.select.mockResolvedValue(credentials()); app.refresh.mockImplementation(async (_provider, value) => value); app.cooldown.mockImplementation(() => { throw new Error('Accounting reached cooldown'); });
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-owner-')); process.env.DATA_DIR = directory; delete global._dbAdapter; vi.resetModules();
  db = await (await import('@/lib/db/driver.js')).getAdapter(); await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'codex-key', key: 'codex-gateway-fixture' }] }); db.close(); db = null;
  await initializePoliciesOffline({ directory, actor: 'fixture', reason: 'Codex disposable owner fixture' });
  db = await (await import('@/lib/db/driver.js')).getAdapter(); db.durableTransaction(() => db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')"));
  putPolicySync(db, 'codex-key', { weeklyLimitNanoUsd: '104000', monthlyLimitNanoUsd: null }, 0);
  await (await import('@/lib/db/repos/pricingRepo.js')).updatePricing({ codex: { 'gpt-5.5': { input: '1', output: '2', cached: '0.1', reasoning: '2' } } });
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true }); if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous; });
describe('Codex native OAuth SSE owner (disposable ledger, mocked transport only)', { timeout: 20000 }, () => {
  it.each(['owner', 'executor', 'core', 'app'])('%s one strict POST/terminal owner settles exact native response before next429', async lane => {
    const args = options(await context()), before = JSON.stringify(args.body), executor = new CodexExecutor();
    const peek = vi.spyOn(executor, '_peekSseTransientError').mockImplementation(() => { throw new Error('Second raw reader'); });
    const prefetch = vi.spyOn(executor, 'prefetchImages').mockImplementation(() => { throw new Error('Unexpected preprocessing'); });
    network.mockImplementation((target, init, _proxy, contract) => {
      expect(target).toBe(url); expect(init.method).toBe('POST'); expect(init.redirect).toBe('error'); expect(contract).toEqual({ singlePost: true }); expect(JSON.parse(init.body)).toEqual(body());
      expect(init.headers.get('authorization')).toBe('Bearer dummy-codex-oauth'); expect(init.headers.get('chatgpt-account-id')).toBe('dummy-account'); expect(rows()[0].state).toBe('pending'); return response();
    });
    let res;
    if (lane === 'owner') res = (await executeAccountedResponsesCandidate(executor, args)).response;
    if (lane === 'executor') res = (await executor.execute(args)).response;
    if (lane === 'core') res = (await (await import('open-sse/handlers/chatCore.js')).handleChatCore({ ...args, modelInfo: { provider: 'codex', model: args.model }, sourceFormatOverride: 'openai-responses' })).response;
    if (lane === 'app') res = await (await import('@/sse/handlers/chat.js')).handleChat(new Request('http://localhost/v1/responses', { method: 'POST', headers: { Authorization: 'Bearer codex-gateway-fixture' }, body: JSON.stringify({ ...args.body, model: 'cx/gpt-5.5' }) }));
    expect(res.status).toBe(200); expect(await res.text()).toBe(wire()); expect(JSON.stringify(args.body)).toBe(before); expect(rows()).toHaveLength(1); expect(rows()[0]).toMatchObject({ state: 'settled', costNanoUsd: 104000 });
    expect(peek).not.toHaveBeenCalled(); expect(prefetch).not.toHaveBeenCalled(); expect(executor._currentSessionId).toBeNull();
    await expect(executor.execute(options(await context()))).rejects.toMatchObject({ code: BUDGET_ERROR.EXCEEDED }); expect(network).toHaveBeenCalledTimes(1); expect(app.cooldown).not.toHaveBeenCalled();
  });
  it('no completed event becomes unresolved and cannot peek/retry into successor', async () => {
    network.mockResolvedValue(new Response(wire().split('event: response.completed')[0], { headers: { 'Content-Type': 'text/event-stream' } }));
    const result = await new CodexExecutor().execute(options(await context())); await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable');
    await new Promise(resolve => setImmediate(resolve)); expect(rows()[0]).toMatchObject({ state: 'unresolved', costNanoUsd: null });
    await expect(new CodexExecutor().execute(options(await context()))).rejects.toMatchObject({ code: BUDGET_ERROR.UNRESOLVED }); expect(network).toHaveBeenCalledTimes(1);
  });
  it.each(['tools', 'stateful', 'tier', 'compact', 'lite', 'image', 'implicit', 'json', 'apikey', 'relay', 'transport', 'header', 'mode'])('unsupported %s even unlimited denies without intent, POST, transformation or prefetch', async kind => {
    putPolicySync(db, 'codex-key', { weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null }, 1);
    const args = options(await context()), executor = new CodexExecutor();
    if (kind === 'tools') args.body.tools = [{ type: 'web_search' }];
    if (kind === 'stateful') args.body.previous_response_id = 'resp_other';
    if (kind === 'tier') args.body.service_tier = 'priority';
    if (kind === 'compact') args.body._compact = true;
    if (kind === 'lite') args.body.input.push({ type: 'additional_tools', tools: [] });
    if (kind === 'image') args.body.input[0].content = [{ type: 'image_url', image_url: 'https://fixture.invalid/paid' }];
    if (kind === 'implicit') delete args.body.stream;
    if (kind === 'json') { args.body.stream = false; args.stream = false; }
    if (kind === 'apikey') args.credentials = { apiKey: 'dummy' };
    if (kind === 'relay') args.proxyOptions = { vercelRelayUrl: 'https://fixture.invalid' };
    if (kind === 'transport') args.credentials.runtimeTransport = { baseUrl: 'https://fixture.invalid' };
    if (kind === 'header') args.providerOverrides = { headers: { 'OpenAI-Beta': 'fixture' } };
    if (kind === 'mode') delete args.accountingMode;
    const prefetch = vi.spyOn(executor, 'prefetchImages'); const transform = vi.spyOn(executor, 'transformRequest');
    await expect(executor.execute(args)).rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED }); expect(rows()).toEqual([]); expect(network).not.toHaveBeenCalled(); expect(prefetch).not.toHaveBeenCalled(); expect(transform).not.toHaveBeenCalled();
  });
  it('request-local pinned OAuth/account/session/proxy survive admission mutation and never singleton state', async () => {
    putPolicySync(db, 'codex-key', { weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null }, 1);
    const original = await context(), args = options(original), executor = new CodexExecutor(); executor._currentSessionId = 'foreign-request';
    args.proxyOptions = { connectionProxyEnabled: true, connectionProxyUrl: 'http://original.invalid:8080' };
    args.accounting = { ...original, beforeAttempt: async (...call) => { const attempt = await original.beforeAttempt(...call); args.credentials.accessToken = 'mutated'; args.credentials.providerSpecificData.chatgptAccountId = 'mutated'; args.credentials.connectionId = 'mutated'; args.proxyOptions.connectionProxyUrl = 'http://mutated.invalid:8080'; args.body.instructions = 'mutated'; return attempt; } };
    network.mockImplementation((_target, init, proxy) => { expect(init.headers.get('authorization')).toBe('Bearer dummy-codex-oauth'); expect(init.headers.get('chatgpt-account-id')).toBe('dummy-account'); expect(init.headers.get('session_id')).toBe('codex-connection'); expect(JSON.parse(init.body)).toEqual(body()); expect(proxy.connectionProxyUrl).toBe('http://original.invalid:8080'); return response(); });
    expect(await (await executor.execute(args)).response.text()).toBe(wire()); expect(executor._currentSessionId).toBe('foreign-request'); expect(rows()[0].costNanoUsd).toBe(104000);
  });
  it.each(['max_output_tokens', 'temperature', 'top_p', 'missing-token', 'missing-account', 'missing-session', 'lite-model', 'header-account'])('unsupported %s cannot be stripped into eligible work', async kind => {
    const args = options(await context());
    if (['max_output_tokens', 'temperature', 'top_p'].includes(kind)) args.body[kind] = 1;
    if (kind === 'missing-token') delete args.credentials.accessToken;
    if (kind === 'missing-account') delete args.credentials.providerSpecificData;
    if (kind === 'missing-session') delete args.credentials.connectionId;
    if (kind === 'lite-model') { args.model = 'gpt-6.1-sol'; args.body.model = args.model; }
    if (kind === 'header-account') args.providerOverrides = { headers: { 'ChatGPT-Account-ID': 'foreign-account' } };
    await expect(new CodexExecutor().execute(args)).rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED }); expect(rows()).toEqual([]); expect(network).not.toHaveBeenCalled();
  });
  it('undefined unknown nested field cannot disappear in serialization to make original work eligible', async () => {
    const args = options(await context());
    args.body.input = [{ role: 'user', content: [{ type: 'input_text', text: 'fixture', paid_context: undefined }] }];
    await expect(new CodexExecutor().execute(args)).rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED }); expect(rows()).toEqual([]); expect(network).not.toHaveBeenCalled();
  });
  it('abort after durable admission before invocation preserves exact false reason/not_dispatched', async () => {
    const original = await context(), caller = new AbortController(), args = options(original);
    args.signal = caller.signal; args.accounting = { ...original, beforeAttempt: async (...call) => { const attempt = await original.beforeAttempt(...call); caller.abort(false); return attempt; } };
    await expect(new CodexExecutor().execute(args)).rejects.toBe(false); expect(rows()[0]).toMatchObject({ state: 'not_dispatched', outcome: 'aborted' }); expect(network).not.toHaveBeenCalled();
  });
  it.each(['resolve', 'reject', 'abort'])('terminal authorization %s withholds completed and preserves exact charge', async kind => {
    const original = await context(), caller = new AbortController(); let entered, release, reject;
    const started = new Promise(resolve => { entered = resolve; }), held = new Promise((resolve, fail) => { release = resolve; reject = fail; }), error = new Error('fixture authorization');
    const args = options({ ...original, assertSuccessfulTerminal: async terminal => { entered(); await held; return original.assertSuccessfulTerminal(terminal); } }); args.signal = caller.signal;
    network.mockResolvedValue(response()); const res = (await new CodexExecutor().execute(args)).response; let ended = false;
    const work = res.text().then(value => { ended = true; return { value }; }, error => { ended = true; return { error }; });
    try { await started; expect(ended).toBe(false); expect(rows()[0]).toMatchObject({ state: 'settled', costNanoUsd: 104000 }); if (kind === 'abort') caller.abort(false); }
    finally { if (kind === 'reject') reject(error); else release(); }
    const result = await work; if (kind === 'resolve') expect(result.value).toBe(wire()); else expect(result.error).toBeDefined();
    expect(rows()).toHaveLength(1); expect(rows()[0].costNanoUsd).toBe(104000); expect(network).toHaveBeenCalledTimes(1);
  });
  it('interleaved shared executor pins separate OAuth/account/session while first admission held', async () => {
    putPolicySync(db, 'codex-key', { weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null }, 1);
    const executor = new CodexExecutor(), first = options(await context()), second = options(await context()); let entered, release;
    const started = new Promise(resolve => { entered = resolve; }), held = new Promise(resolve => { release = resolve; }), original = first.accounting;
    first.accounting = { ...original, beforeAttempt: async (...call) => { const attempt = await original.beforeAttempt(...call); entered(); await held; return attempt; } };
    second.credentials = { accessToken: 'dummy-second', connectionId: 'second-session', providerSpecificData: { chatgptAccountId: 'second-account' } }; second.connectionId = 'second-session';
    const observed = []; network.mockImplementation((_target, init) => { observed.push([init.headers.get('authorization'), init.headers.get('chatgpt-account-id'), init.headers.get('session_id')]); return response(); });
    const firstWork = executor.execute(first).then(async result => result.response.text());
    try { await started; expect(await (await executor.execute(second)).response.text()).toBe(wire()); }
    finally { release(); }
    expect(await firstWork).toBe(wire()); expect(observed).toEqual([['Bearer dummy-second', 'second-account', 'second-session'], ['Bearer dummy-codex-oauth', 'dummy-account', 'codex-connection']]);
    expect(rows()).toHaveLength(2); expect(rows().every(row => row.state === 'settled' && row.costNanoUsd === 104000)).toBe(true); expect(executor._currentSessionId).toBeNull();
  });
  it('genuine completed event before EOF leaves pending/deltas available and completed withheld', async () => {
    let close; network.mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(wire())); close = () => controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } }));
    const res = (await new CodexExecutor().execute(options(await context()))).response, reader = res.body.getReader();
    const prefix = await reader.read(); expect(new TextDecoder().decode(prefix.value)).not.toContain('event: response.completed'); expect(rows()[0].state).toBe('pending');
    close(); let text = new TextDecoder().decode(prefix.value); while (true) { const part = await reader.read(); if (part.done) break; text += new TextDecoder().decode(part.value); }
    expect(text).toBe(wire()); expect(rows()[0]).toMatchObject({ state: 'settled', costNanoUsd: 104000 });
  });
  it('app lookalike route denies native authority before account selection or POST', async () => {
    const res = await (await import('@/sse/handlers/chat.js')).handleChat(new Request('http://localhost/lookalike/v1/responses', { method: 'POST', headers: { Authorization: 'Bearer codex-gateway-fixture' }, body: JSON.stringify({ ...body(), model: 'cx/gpt-5.5' }) }));
    expect(res.status).toBe(503); expect((await res.json()).error.code).toBe(BUDGET_ERROR.UNSUPPORTED); expect(rows()).toEqual([]); expect(network).not.toHaveBeenCalled(); expect(app.select).not.toHaveBeenCalled();
  });
});
