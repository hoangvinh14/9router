import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initializePoliciesOffline } from '@/lib/db/offlinePolicyInitialization.js';
import { createRequestAccounting } from '@/lib/apiKeyBudget/requestAccounting.js';
import { putPolicySync } from '@/lib/db/repos/apiKeyAccountingRepo.js';
import { DefaultExecutor } from 'open-sse/executors/default.js';
import { executeAccountedResponsesCandidate } from 'open-sse/executors/accountedResponses.js';
import { ACCOUNTED_RESPONSES_MODE } from 'open-sse/config/accountedResponsesCandidate.js';
import { BUDGET_ERROR } from 'open-sse/config/apiKeyBudgetConstants.js';
const network = vi.hoisted(() => vi.fn());
vi.mock('open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => network(...args) }));
const legacyUsage = vi.hoisted(() => vi.fn());
const appFixture = vi.hoisted(() => ({ select: vi.fn(), cooldown: vi.fn(), refresh: vi.fn(), model: vi.fn() }));
vi.mock('@/sse/services/auth.js', () => ({ getProviderCredentials: (...args) => appFixture.select(...args), markAccountUnavailable: (...args) => appFixture.cooldown(...args),
  clearAccountError: async () => {}, extractApiKey: request => request.headers.get('Authorization')?.slice(7), isValidApiKey: async () => true }));
vi.mock('@/sse/services/model.js', () => ({ getModelInfo: (...args) => appFixture.model(...args), getComboModels: async () => null }));
vi.mock('@/sse/services/tokenRefresh.js', () => ({ checkAndRefreshToken: (...args) => appFixture.refresh(...args), updateProviderCredentials: async () => {} }));
vi.mock('@/lib/usageDb.js', () => ({ trackPendingRequest() {}, appendRequestLog: async () => {}, saveRequestDetail: async () => {}, saveRequestUsage: legacyUsage }));
let directory, db;
const previous = process.env.DATA_DIR;
const rows = () => db.all('SELECT * FROM apiKeyAccounting ORDER BY startedAt,attemptId');
const context = () => createRequestAccounting(new Request('http://localhost/v1/responses', { headers: { Authorization: 'Bearer responses-fixture-key' } }), { adapter: async () => db });
const body = () => ({ model: 'fixture-responses', stream: false, input: 'fixture', store: false });
const options = accounting => ({ model: 'fixture-responses', body: body(), stream: false, credentials: { apiKey: 'provider-fixture' },
  accounting, accountingMode: ACCOUNTED_RESPONSES_MODE, connectionId: 'responses-connection' });
const message = () => ({ id: 'resp_fixture', object: 'response', model: 'fixture-responses', status: 'completed', service_tier: 'default', error: null, incomplete_details: null,
  output: [{ id: 'msg_fixture', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'fixture', annotations: [] }] }],
  usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 10 } } });
const response = () => Response.json(message());
beforeEach(async () => {
  appFixture.select.mockReset(); appFixture.cooldown.mockReset(); appFixture.refresh.mockReset(); appFixture.model.mockReset(); legacyUsage.mockReset();
  appFixture.select.mockResolvedValue({ apiKey: 'provider-fixture', connectionId: 'responses-connection' });
  appFixture.refresh.mockImplementation(async (_provider, credentials) => credentials);
  appFixture.model.mockResolvedValue({ provider: 'openai', model: 'fixture-responses' });
  appFixture.cooldown.mockImplementation(() => { throw new Error('Accounting failure entered cooldown'); });
  network.mockReset(); directory = fs.mkdtempSync(path.join(os.tmpdir(), 'responses-owner-')); process.env.DATA_DIR = directory; delete global._dbAdapter; vi.resetModules();
  db = await (await import('@/lib/db/driver.js')).getAdapter(); await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'responses-key', key: 'responses-fixture-key' }] }); db.close(); db = null;
  await initializePoliciesOffline({ directory, actor: 'fixture', reason: 'Responses owner disposable fixture' });
  db = await (await import('@/lib/db/driver.js')).getAdapter(); db.durableTransaction(() => db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')"));
  putPolicySync(db, 'responses-key', { weeklyLimitNanoUsd: '1000000000', monthlyLimitNanoUsd: null }, 0);
  await (await import('@/lib/db/repos/pricingRepo.js')).updatePricing({ openai: { 'fixture-responses': { input: '1', output: '2', cached: '0.1', reasoning: '2' } } });
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true }); if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous; });
describe('native Responses JSON real-ledger owner candidate (network mock, not app approval)', { timeout: 20000 }, () => {
  it('pending intent before single strict POST, original price, exact native output at threshold and next429', async () => {
    putPolicySync(db, 'responses-key', { weeklyLimitNanoUsd: '104000', monthlyLimitNanoUsd: null }, 1);
    const args = options(await context()), before = JSON.stringify(args.body);
    network.mockImplementation(async (url, init, _proxy, contract) => {
      expect(url).toBe('https://api.openai.com/v1/responses'); expect(init.method).toBe('POST'); expect(init.redirect).toBe('error'); expect(contract).toEqual({ singlePost: true });
      expect(JSON.parse(init.body)).toEqual(body()); expect(rows()[0].state).toBe('pending');
      await (await import('@/lib/db/repos/pricingRepo.js')).updatePricing({ openai: { 'fixture-responses': { input: '9', output: '9', cached: '9', reasoning: '9' } } });
      return response();
    });
    const result = await executeAccountedResponsesCandidate(new DefaultExecutor('openai'), args);
    expect(await result.response.json()).toEqual(message()); expect(result.accountingMessage).toEqual(message()); expect(result.response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.stringify(args.body)).toBe(before); expect(rows()).toHaveLength(1); expect(rows()[0]).toMatchObject({ state: 'settled', costNanoUsd: 104000 });
    await expect(executeAccountedResponsesCandidate(new DefaultExecutor('openai'), options(await context()))).rejects.toMatchObject({ code: BUDGET_ERROR.EXCEEDED }); expect(network).toHaveBeenCalledTimes(1);
  });
  it.each(['background', 'previous_response_id', 'conversation', 'tools', 'include', 'prompt_cache_retention', 'metadata', 'unknown'])('unsupported %s refuses even unlimited before intent/POST', async field => {
    putPolicySync(db, 'responses-key', { weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null }, 1);
    const args = options(await context()); args.body[field] = field === 'tools' ? [{ type: 'web_search' }] : 'fixture';
    await expect(executeAccountedResponsesCandidate(new DefaultExecutor('openai'), args)).rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED }); expect(rows()).toEqual([]); expect(network).not.toHaveBeenCalled();
  });
  it.each(['tier', 'nested-image', 'nested-item-reference', 'nested-unknown', 'provider', 'oauth', 'runtime', 'relay', 'live', 'mode', 'model', 'beta-header'])('unsupported %s denies before intent/POST', async mode => {
    const args = options(await context()); let executor = new DefaultExecutor('openai');
    if (mode === 'tier') args.body.service_tier = 'priority';
    if (mode === 'nested-image') args.body.input = [{ role: 'user', content: [{ type: 'input_image', image_url: 'https://fixture.invalid' }] }];
    if (mode === 'nested-item-reference') args.body.input = [{ type: 'item_reference', id: 'resp_other' }];
    if (mode === 'nested-unknown') args.body.input = [{ role: 'user', content: 'fixture', paid_context: true }];
    if (mode === 'provider') executor = new DefaultExecutor('codex');
    if (mode === 'oauth') args.credentials = { accessToken: 'fixture' };
    if (mode === 'runtime') args.credentials.runtimeTransport = { baseUrl: 'https://fixture.invalid' };
    if (mode === 'relay') args.proxyOptions = { vercelRelayUrl: 'https://fixture.invalid' };
    if (mode === 'live') { args.stream = true; args.body.stream = true; }
    if (mode === 'mode') delete args.accountingMode;
    if (mode === 'model') args.body.model = 'wrong';
    if (mode === 'beta-header') args.providerOverrides = { headers: { 'OpenAI-Beta': 'fixture' } };
    await expect(executeAccountedResponsesCandidate(executor, args)).rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED }); expect(rows()).toEqual([]); expect(network).not.toHaveBeenCalled();
  });
  it.each(['incomplete', 'missing-usage', 'redirect', 'wrong-url', 'failed-status', 'network'])('%s is unresolved null money with no successor', async mode => {
    network.mockImplementation(() => {
      if (mode === 'network') throw new Error('fixture transport');
      if (mode === 'failed-status') return new Response('fixture failure', { status: 429 });
      const value = message(); if (mode === 'incomplete') value.status = 'incomplete'; if (mode === 'missing-usage') delete value.usage;
      const res = Response.json(value); if (mode === 'redirect') Object.defineProperty(res, 'redirected', { value: true });
      if (mode === 'wrong-url') Object.defineProperty(res, 'url', { value: 'https://other.invalid' }); return res;
    });
    await expect(executeAccountedResponsesCandidate(new DefaultExecutor('openai'), options(await context()))).rejects.toMatchObject({ code: BUDGET_ERROR.UNRESOLVED });
    expect(rows()[0]).toMatchObject({ state: 'unresolved', costNanoUsd: null, usageJson: null });
    await expect(executeAccountedResponsesCandidate(new DefaultExecutor('openai'), options(await context()))).rejects.toMatchObject({ code: BUDGET_ERROR.UNRESOLVED }); expect(network).toHaveBeenCalledTimes(1);
  });
  it('persistence rejection escapes unchanged without authorization/fallback', async () => {
    const original = await context(), error = new Error('fixture persistence'); const accounting = { ...original, completeAttempt: vi.fn(() => Promise.reject(error)), assertSuccessfulTerminal: vi.fn() };
    network.mockResolvedValue(response()); await expect(executeAccountedResponsesCandidate(new DefaultExecutor('openai'), options(accounting))).rejects.toBe(error);
    expect(rows()[0].state).toBe('pending'); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(accounting.assertSuccessfulTerminal).not.toHaveBeenCalled(); expect(network).toHaveBeenCalledTimes(1);
  });
  it('pinned proxy/body/header survive mutation during awaited admission', async () => {
    const original = await context(), args = options(original); args.proxyOptions = { connectionProxyEnabled: true, connectionProxyUrl: 'http://fixture-original:8080' };
    args.accounting = { ...original, beforeAttempt: async (...call) => { const attempt = await original.beforeAttempt(...call); args.proxyOptions.connectionProxyUrl = 'http://fixture-mutated:8080'; args.body.input = 'mutated'; args.credentials.apiKey = 'mutated'; return attempt; } };
    network.mockImplementation((_url, init, proxy) => { expect(proxy.connectionProxyUrl).toBe('http://fixture-original:8080'); expect(JSON.parse(init.body).input).toBe('fixture'); expect(init.headers.get('authorization')).toBe('Bearer provider-fixture'); return response(); });
    await executeAccountedResponsesCandidate(new DefaultExecutor('openai'), args); expect(rows()[0].state).toBe('settled');
  });
  it('abort after admission before invocation persists not_dispatched with exact primitive reason', async () => {
    const original = await context(), caller = new AbortController(); const accounting = { ...original, beforeAttempt: async (...args) => { const attempt = await original.beforeAttempt(...args); caller.abort(0); return attempt; } };
    await expect(executeAccountedResponsesCandidate(new DefaultExecutor('openai'), { ...options(accounting), signal: caller.signal })).rejects.toBe(0);
    expect(rows()[0].state).toBe('not_dispatched'); expect(network).not.toHaveBeenCalled();
  });
  it.each(['resolve', 'reject', 'abort'])('terminal authorization %s never releases response early or erases exact charge', async mode => {
    const original = await context(), caller = new AbortController(); let entered, release, reject;
    const started = new Promise(resolve => { entered = resolve; }), held = new Promise((resolve, fail) => { release = resolve; reject = fail; }), error = new Error('fixture authorization');
    const accounting = { ...original, assertSuccessfulTerminal: async terminal => { entered(); await held; return original.assertSuccessfulTerminal(terminal); } };
    network.mockResolvedValue(response()); let ended = false;
    const work = executeAccountedResponsesCandidate(new DefaultExecutor('openai'), { ...options(accounting), signal: caller.signal }).then(value => { ended = true; return { value }; }, error => { ended = true; return { error }; });
    try { await started; expect(ended).toBe(false); expect(rows()[0]).toMatchObject({ state: 'settled', costNanoUsd: 104000 }); if (mode === 'abort') caller.abort(false); }
    finally { if (mode === 'reject') reject(error); else release(); }
    const result = await work; if (mode === 'resolve') expect(result.value.accountingMessage).toEqual(message()); else expect(result.error).toBe(mode === 'abort' ? false : error);
    expect(rows()).toHaveLength(1); expect(rows()[0].costNanoUsd).toBe(104000); expect(network).toHaveBeenCalledTimes(1);
  });
  it('Base explicit candidate entry returns native JSON and never chat-completions wire', async () => {
    network.mockImplementation((url, init) => { expect(url).toBe('https://api.openai.com/v1/responses'); expect(JSON.parse(init.body)).toEqual(body()); return response(); });
    const result = await new DefaultExecutor('openai').execute(options(await context()));
    expect(result.accountingOwned).toBe(true); expect(await result.response.json()).toEqual(message()); expect(rows()[0].costNanoUsd).toBe(104000);
  });
  it('core native Responses JSON is unchanged and durable-authorized, without legacy debit', async () => {
    const { handleChatCore } = await import('open-sse/handlers/chatCore.js'); const args = options(await context()), before = JSON.stringify(args.body);
    network.mockResolvedValue(response());
    const result = await handleChatCore({ ...args, modelInfo: { provider: 'openai', model: 'fixture-responses' }, sourceFormatOverride: 'openai-responses' });
    expect(result.success).toBe(true); expect(await result.response.json()).toEqual(message()); expect(JSON.stringify(args.body)).toBe(before);
    expect(rows()[0]).toMatchObject({ state: 'settled', costNanoUsd: 104000 }); expect(network).toHaveBeenCalledTimes(1); expect(legacyUsage).not.toHaveBeenCalled();
  });
  it('app Responses JSON settles at threshold then refuses next admission with no cooldown', async () => {
    const { handleChat } = await import('@/sse/handlers/chat.js'); putPolicySync(db, 'responses-key', { weeklyLimitNanoUsd: '104000', monthlyLimitNanoUsd: null }, 1);
    const request = () => new Request('http://localhost/v1/responses', { method: 'POST', headers: { Authorization: 'Bearer responses-fixture-key' }, body: JSON.stringify({ ...body(), model: 'openai/fixture-responses' }) });
    network.mockImplementation((url, init) => { expect(url).toBe('https://api.openai.com/v1/responses'); expect(rows()[0].state).toBe('pending'); expect(JSON.parse(init.body)).toEqual(body()); return response(); });
    const first = await handleChat(request()); expect(first.status).toBe(200); expect(await first.json()).toEqual(message()); expect(rows()[0].costNanoUsd).toBe(104000);
    const next = await handleChat(request()); expect(next.status).toBe(429); expect((await next.json()).error.code).toBe(BUDGET_ERROR.EXCEEDED);
    expect(network).toHaveBeenCalledTimes(1); expect(appFixture.cooldown).not.toHaveBeenCalled(); expect(legacyUsage).not.toHaveBeenCalled();
  });
  it('app incomplete native JSON refuses unknown and successor without account refresh/cooldown', async () => {
    const { handleChat } = await import('@/sse/handlers/chat.js'); const raw = message(); raw.status = 'incomplete'; network.mockResolvedValue(Response.json(raw));
    const request = () => new Request('http://localhost/v1/responses', { method: 'POST', headers: { Authorization: 'Bearer responses-fixture-key' }, body: JSON.stringify({ ...body(), model: 'openai/fixture-responses' }) });
    const first = await handleChat(request()); expect(first.status).toBe(503); expect((await first.json()).error.code).toBe(BUDGET_ERROR.UNRESOLVED);
    expect(rows()[0]).toMatchObject({ state: 'unresolved', costNanoUsd: null }); expect((await handleChat(request())).status).toBe(503);
    expect(network).toHaveBeenCalledTimes(1); expect(appFixture.select).toHaveBeenCalledTimes(1); expect(appFixture.refresh).toHaveBeenCalledTimes(1); expect(appFixture.cooldown).not.toHaveBeenCalled();
  });
  const streamWire = () => {
    const final = message(), item = final.output[0], part = item.content[0];
    const events = [
      { type: 'response.created', response: { ...final, status: 'in_progress', output: [], usage: null } },
      { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
      { type: 'response.content_part.added', output_index: 0, item_id: item.id, content_index: 0, part: { ...part, text: '' } },
      { type: 'response.output_text.delta', output_index: 0, item_id: item.id, content_index: 0, delta: part.text },
      { type: 'response.output_text.done', output_index: 0, item_id: item.id, content_index: 0, text: part.text },
      { type: 'response.content_part.done', output_index: 0, item_id: item.id, content_index: 0, part },
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response: final },
    ];
    return events.map((event, sequence_number) => `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join('');
  };
  const liveOptions = accounting => ({ ...options(accounting), stream: true, body: { ...body(), stream: true }, accountingMode: 'native-responses-sse' });
  it.each(['owner', 'Base', 'core', 'app'])('explicit Responses SSE %s preserves native wire and settles before terminal at threshold', async lane => {
    putPolicySync(db, 'responses-key', { weeklyLimitNanoUsd: '104000', monthlyLimitNanoUsd: null }, 1);
    const text = streamWire(), args = liveOptions(await context());
    network.mockImplementation((url, init, _proxy, contract) => {
      expect(url).toBe('https://api.openai.com/v1/responses'); expect(init.redirect).toBe('error'); expect(contract).toEqual({ singlePost: true });
      expect(JSON.parse(init.body)).toEqual(args.body); expect(rows()[0].state).toBe('pending');
      return new Response(text, { headers: { 'Content-Type': 'text/event-stream' } });
    });
    let res;
    if (lane === 'owner') res = (await executeAccountedResponsesCandidate(new DefaultExecutor('openai'), args)).response;
    if (lane === 'Base') res = (await new DefaultExecutor('openai').execute(args)).response;
    if (lane === 'core') res = (await (await import('open-sse/handlers/chatCore.js')).handleChatCore({ ...args, modelInfo: { provider: 'openai', model: 'fixture-responses' }, sourceFormatOverride: 'openai-responses' })).response;
    if (lane === 'app') res = await (await import('@/sse/handlers/chat.js')).handleChat(new Request('http://localhost/v1/responses', { method: 'POST', headers: { Authorization: 'Bearer responses-fixture-key' }, body: JSON.stringify({ ...args.body, model: 'openai/fixture-responses' }) }));
    expect(res.status).toBe(200); expect(res.headers.get('content-type')).toContain('text/event-stream'); expect(await res.text()).toBe(text);
    expect(rows()).toHaveLength(1); expect(rows()[0]).toMatchObject({ state: 'settled', costNanoUsd: 104000 }); expect(legacyUsage).not.toHaveBeenCalled(); expect(appFixture.cooldown).not.toHaveBeenCalled();
    await expect(executeAccountedResponsesCandidate(new DefaultExecutor('openai'), liveOptions(await context()))).rejects.toMatchObject({ code: BUDGET_ERROR.EXCEEDED }); expect(network).toHaveBeenCalledTimes(1);
  });
  it.each(['missing-completed', 'late-invalid'])('Responses SSE owner %s produces unresolved/no successor without synthetic terminal', async mode => {
    const text = mode === 'missing-completed' ? streamWire().split('event: response.completed')[0] : streamWire() + 'event: response.audio.delta\ndata: {}\n\n';
    network.mockResolvedValue(new Response(text, { headers: { 'Content-Type': 'text/event-stream' } }));
    const result = await executeAccountedResponsesCandidate(new DefaultExecutor('openai'), liveOptions(await context()));
    await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable');
    await new Promise(resolve => setImmediate(resolve)); expect(rows()[0]).toMatchObject({ state: 'unresolved', costNanoUsd: null });
    await expect(executeAccountedResponsesCandidate(new DefaultExecutor('openai'), liveOptions(await context()))).rejects.toMatchObject({ code: BUDGET_ERROR.UNRESOLVED }); expect(network).toHaveBeenCalledTimes(1);
  });
  it.each(['json-mode-live', 'sse-mode-buffered', 'wire-stream-mismatch', 'live-background', 'live-oauth', 'live-beta'])('native %s cannot bypass pinned mode/request authority', async mode => {
    const args = liveOptions(await context());
    if (mode === 'json-mode-live') args.accountingMode = ACCOUNTED_RESPONSES_MODE;
    if (mode === 'sse-mode-buffered') { args.stream = false; args.body.stream = false; }
    if (mode === 'wire-stream-mismatch') args.body.stream = false;
    if (mode === 'live-background') args.body.background = true;
    if (mode === 'live-oauth') args.credentials.accessToken = 'fixture';
    if (mode === 'live-beta') args.providerOverrides = { headers: { 'OpenAI-Beta': 'fixture' } };
    await expect(executeAccountedResponsesCandidate(new DefaultExecutor('openai'), args)).rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED }); expect(rows()).toEqual([]); expect(network).not.toHaveBeenCalled();
  });
  it.each(['json-media', 'wrong-url', 'redirected', 'locked-reader'])('live construction %s leaves one unresolved owner and never buffered JSON success', async mode => {
    const res = mode === 'json-media' ? response() : new Response(streamWire(), { headers: { 'Content-Type': 'text/event-stream' } });
    if (mode === 'wrong-url') Object.defineProperty(res, 'url', { value: 'https://other.invalid' });
    if (mode === 'redirected') Object.defineProperty(res, 'redirected', { value: true });
    let reader; if (mode === 'locked-reader') reader = res.body.getReader();
    network.mockResolvedValue(res);
    try { await expect(executeAccountedResponsesCandidate(new DefaultExecutor('openai'), liveOptions(await context()))).rejects.toMatchObject({ code: BUDGET_ERROR.UNRESOLVED }); }
    finally { reader?.releaseLock(); }
    expect(rows()).toHaveLength(1); expect(rows()[0]).toMatchObject({ state: 'unresolved', costNanoUsd: null }); expect(network).toHaveBeenCalledTimes(1);
  });
  it('Base OFF keeps existing chat endpoint behavior with explicit candidate mode inert', async () => {
    network.mockImplementation((url, init) => { expect(url).toBe('https://api.openai.com/v1/chat/completions'); expect(JSON.parse(init.body).stream).toBe(false); return new Response('fixture'); });
    const args = options(null); const result = await new DefaultExecutor('openai').execute(args);
    expect(result.accountingOwned).toBeUndefined(); expect(await result.response.text()).toBe('fixture'); expect(rows()).toEqual([]);
  });
  it.each(['streaming-tools', 'implicit-stream', 'background', 'previous_response_id', 'tools', 'priority', 'oauth'])('app unsupported native %s refuses before intent/POST', async mode => {
    const { handleChat } = await import('@/sse/handlers/chat.js');
    putPolicySync(db, 'responses-key', { weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null }, 1);
    const requestBody = { ...body(), model: 'openai/fixture-responses' };
    if (mode === 'streaming-tools') { requestBody.stream = true; requestBody.tools = [{ type: 'web_search' }]; }
    if (mode === 'implicit-stream') delete requestBody.stream;
    if (mode === 'background') requestBody.background = true;
    if (mode === 'previous_response_id') requestBody.previous_response_id = 'resp_other';
    if (mode === 'tools') requestBody.tools = [{ type: 'web_search' }];
    if (mode === 'priority') requestBody.service_tier = 'priority';
    if (mode === 'oauth') appFixture.select.mockResolvedValue({ accessToken: 'fixture', connectionId: 'responses-connection' });
    const result = await handleChat(new Request('http://localhost/v1/responses', { method: 'POST', headers: { Authorization: 'Bearer responses-fixture-key' }, body: JSON.stringify(requestBody) }));
    expect(result.status).toBe(503); expect((await result.json()).error.code).toBe(BUDGET_ERROR.UNSUPPORTED);
    expect(rows()).toEqual([]); expect(network).not.toHaveBeenCalled(); expect(appFixture.cooldown).not.toHaveBeenCalled();
  });
  it.each(['headroom', 'pxpipe', 'original-tools'])('core native %s is denied before external preprocessing or POST', async mode => {
    const { handleChatCore } = await import('open-sse/handlers/chatCore.js');
    const args = options(await context());
    if (mode === 'original-tools') args.body.tools = [{ type: 'web_search' }];
    await expect(handleChatCore({ ...args, modelInfo: { provider: 'openai', model: 'fixture-responses' }, sourceFormatOverride: 'openai-responses',
      headroomEnabled: mode === 'headroom', pxpipeEnabled: mode === 'pxpipe', headroomUrl: 'http://fixture.invalid',
      pxpipeTransform: () => { throw new Error('Unapproved external preprocessing'); } })).rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED });
    expect(rows()).toEqual([]); expect(network).not.toHaveBeenCalled();
  });
});
