import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initializePoliciesOffline } from '@/lib/db/offlinePolicyInitialization.js';
import { createRequestAccounting } from '@/lib/apiKeyBudget/requestAccounting.js';
import { putPolicySync } from '@/lib/db/repos/apiKeyAccountingRepo.js';
import { DefaultExecutor } from 'open-sse/executors/default.js';
import { executeAccountedGeminiCandidate } from 'open-sse/executors/accountedGemini.js';
import { BUDGET_ERROR } from 'open-sse/config/apiKeyBudgetConstants.js';
const network = vi.hoisted(() => vi.fn());
vi.mock('open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => network(...args) }));
const app = vi.hoisted(() => ({ select: vi.fn(), cooldown: vi.fn(), refresh: vi.fn(), model: vi.fn() }));
vi.mock('@/sse/services/auth.js', () => ({ getProviderCredentials: (...args) => app.select(...args), markAccountUnavailable: (...args) => app.cooldown(...args),
  clearAccountError: async () => {}, extractApiKey: request => request.headers.get('Authorization')?.slice(7), isValidApiKey: async () => true }));
vi.mock('@/sse/services/model.js', () => ({ getModelInfo: (...args) => app.model(...args), getComboModels: async () => null }));
vi.mock('@/sse/services/tokenRefresh.js', () => ({ checkAndRefreshToken: (...args) => app.refresh(...args), updateProviderCredentials: async () => {} }));
vi.mock('@/lib/usageDb.js', () => ({ trackPendingRequest() {}, appendRequestLog: async () => {}, saveRequestDetail: async () => {}, saveRequestUsage: async () => {} }));
let directory, db;
const previous = process.env.DATA_DIR;
const raw = () => ({ modelVersion: 'fixture-gemini', candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'answer' }] } }],
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 130, cachedContentTokenCount: 40, thoughtsTokenCount: 10 } });
const body = () => ({ contents: [{ role: 'user', parts: [{ text: 'original' }] }], generationConfig: { maxOutputTokens: 100, thinkingConfig: { thinkingBudget: 10 } } });
const rows = () => db.all('SELECT * FROM apiKeyAccounting ORDER BY startedAt,attemptId');
const context = () => createRequestAccounting(new Request('http://localhost/v1beta/models/gemini/fixture-gemini:generateContent', { headers: { Authorization: 'Bearer gemini-fixture-key' } }), { adapter: async () => db });
const options = accounting => ({ model: 'fixture-gemini', body: { ...body(), model: 'fixture-gemini', stream: false }, stream: false,
  credentials: { apiKey: 'provider-fixture' }, accounting, accountingMode: 'native-gemini-json', connectionId: 'gemini-connection' });
beforeEach(async () => {
  network.mockReset(); app.select.mockReset(); app.cooldown.mockReset(); app.refresh.mockReset(); app.model.mockReset();
  app.select.mockResolvedValue({ apiKey: 'provider-fixture', connectionId: 'gemini-connection' }); app.refresh.mockImplementation(async (_provider, credentials) => credentials);
  app.model.mockResolvedValue({ provider: 'gemini', model: 'fixture-gemini' }); app.cooldown.mockImplementation(() => { throw new Error('Accounting failure cooldown'); });
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-owner-')); process.env.DATA_DIR = directory; delete global._dbAdapter; vi.resetModules();
  db = await (await import('@/lib/db/driver.js')).getAdapter(); await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'gemini-key', key: 'gemini-fixture-key' }] }); db.close(); db = null;
  await initializePoliciesOffline({ directory, actor: 'fixture', reason: 'native Gemini disposable fixture' });
  db = await (await import('@/lib/db/driver.js')).getAdapter(); db.durableTransaction(() => db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')"));
  putPolicySync(db, 'gemini-key', { weeklyLimitNanoUsd: '1000000000', monthlyLimitNanoUsd: null }, 0);
  await (await import('@/lib/db/repos/pricingRepo.js')).updatePricing({ gemini: { 'fixture-gemini': { input: '1', output: '2', cached: '0.1' } } });
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true }); if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous; });
describe('Gemini actual POST owner with disposable real ledger (not live HTTP)', { timeout: 20000 }, () => {
  it('pins native config/headers/wire before intent, pending before POST, exact original price and threshold next refusal', async () => {
    putPolicySync(db, 'gemini-key', { weeklyLimitNanoUsd: '124000', monthlyLimitNanoUsd: null }, 1);
    network.mockImplementation(async (url, init, _proxy, transport) => {
      expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/fixture-gemini:generateContent'); expect(init.redirect).toBe('error'); expect(transport).toEqual({ singlePost: true });
      expect(JSON.parse(init.body)).toEqual(body()); expect(init.headers.get('x-goog-api-key')).toBe('provider-fixture'); expect(rows()[0].state).toBe('pending');
      await (await import('@/lib/db/repos/pricingRepo.js')).updatePricing({ gemini: { 'fixture-gemini': { input: '9', output: '9', cached: '9' } } }); return Response.json(raw());
    });
    const result = await executeAccountedGeminiCandidate(new DefaultExecutor('gemini'), options(await context()));
    expect(await result.response.json()).toEqual(raw()); expect(result.accountingOwned).toBe(true); expect(rows()[0]).toMatchObject({ state: 'settled', costNanoUsd: 124000 });
    await expect(executeAccountedGeminiCandidate(new DefaultExecutor('gemini'), options(await context()))).rejects.toMatchObject({ code: BUDGET_ERROR.EXCEEDED }); expect(network).toHaveBeenCalledTimes(1);
  });
  it.each(['wrong-model', 'unknown-usage', 'failed-status', 'network', 'bad-tier'])('%s unresolved nullcost prohibits next POST/cooldown', async mode => {
    network.mockImplementation(async () => { if (mode === 'network') throw new Error('network'); const m = raw(); if (mode === 'wrong-model') m.modelVersion += '-001'; if (mode === 'unknown-usage') delete m.usageMetadata; if (mode === 'bad-tier') m.usageMetadata.serviceTier = 'priority'; return mode === 'failed-status' ? new Response('fail', { status: 429 }) : Response.json(m); });
    await expect(executeAccountedGeminiCandidate(new DefaultExecutor('gemini'), options(await context()))).rejects.toMatchObject({ code: BUDGET_ERROR.UNRESOLVED });
    expect(rows()[0]).toMatchObject({ state: 'unresolved', costNanoUsd: null }); await expect(executeAccountedGeminiCandidate(new DefaultExecutor('gemini'), options(await context()))).rejects.toMatchObject({ code: BUDGET_ERROR.UNRESOLVED }); expect(network).toHaveBeenCalledTimes(1);
  });
  it.each(['OAuth', 'runtimeTransport', 'relay', 'wrong-url', 'tools', 'live', 'provider-header', 'model-mismatch', 'priority', 'serialized-work'])('%s denied before intent even unlimited', async mode => {
    putPolicySync(db, 'gemini-key', { weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null }, 1);
    const args = options(await context()), ex = new DefaultExecutor('gemini');
    if (mode === 'OAuth') args.credentials.accessToken = 'fixture'; if (mode === 'runtimeTransport') args.credentials.runtimeTransport = { baseUrl: 'https://other.invalid' };
    if (mode === 'relay') args.proxyOptions = { vercelRelayUrl: 'https://other.invalid' }; if (mode === 'wrong-url') ex.config = { ...ex.config, baseUrl: 'https://other.invalid' };
    if (mode === 'tools') args.body.tools = []; if (mode === 'live') args.stream = args.body.stream = true;
    if (mode === 'provider-header') args.providerOverrides = { headers: { 'x-goog-user-project': 'fixture' } }; if (mode === 'model-mismatch') args.body.model = 'wrong';
    if (mode === 'priority') args.body.serviceTier = 'priority';
    if (mode === 'serialized-work') args.body.contents[0].parts[0].text = { toJSON: () => 'fake text' };
    await expect(executeAccountedGeminiCandidate(ex, args)).rejects.toBeDefined(); expect(rows()).toEqual([]); expect(network).not.toHaveBeenCalled();
  });
  it('pins original and avoids singleton transforms across admission', async () => {
    const original = await context(), args = options(original), ex = new DefaultExecutor('gemini');
    ex.transformRequest = () => { throw new Error('Lossy transform called'); };
    args.accounting = { ...original, beforeAttempt: async (...input) => { const attempt = await original.beforeAttempt(...input); args.credentials.apiKey = 'mutated'; args.body.contents[0].parts[0].text = 'mutated'; ex.config = { ...ex.config, baseUrl: 'https://other.invalid' }; return attempt; } };
    network.mockImplementation(async (_url, init) => { expect(init.headers.get('x-goog-api-key')).toBe('provider-fixture'); expect(JSON.parse(init.body).contents[0].parts[0].text).toBe('original'); return Response.json(raw()); });
    expect((await executeAccountedGeminiCandidate(ex, args)).response.status).toBe(200); expect(rows()[0].state).toBe('settled');
  });
  it.each(['ACK', 'auth'])('held %s cannot return success; cancel exact reason preserves observed charge', async mode => {
    const original = await context(), caller = new AbortController(); let entered, release;
    const started = new Promise(resolve => { entered = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...original, [mode === 'ACK' ? 'completeAttempt' : 'assertSuccessfulTerminal']: async (...args) => { entered(); await held; return original[mode === 'ACK' ? 'completeAttempt' : 'assertSuccessfulTerminal'](...args); } };
    network.mockResolvedValue(Response.json(raw())); let ended = false;
    const work = executeAccountedGeminiCandidate(new DefaultExecutor('gemini'), { ...options(accounting), signal: caller.signal }).then(value => { ended = true; return { value }; }, error => { ended = true; return { error }; });
    try { await started; expect(ended).toBe(false); caller.abort(false); } finally { release(); }
    expect((await work).error).toBe(false); expect(rows()[0]).toMatchObject({ state: 'settled', costNanoUsd: 124000 }); expect(network).toHaveBeenCalledTimes(1);
  });
  it('persistence exception unchanged, no authorization/synthetic success', async () => {
    const original = await context(), error = new Error('persist failure'), auth = vi.fn(); network.mockResolvedValue(Response.json(raw()));
    await expect(executeAccountedGeminiCandidate(new DefaultExecutor('gemini'), options({ ...original, completeAttempt: async () => { throw error; }, assertSuccessfulTerminal: auth }))).rejects.toBe(error);
    expect(rows()[0].state).toBe('pending'); expect(auth).not.toHaveBeenCalled(); expect(network).toHaveBeenCalledTimes(1);
  });
  it('cancel before invocation durable not-dispatched zero POST', async () => {
    const original = await context(), caller = new AbortController(); const accounting = { ...original, beforeAttempt: async (...args) => { const attempt = await original.beforeAttempt(...args); caller.abort(0); return attempt; } };
    await expect(executeAccountedGeminiCandidate(new DefaultExecutor('gemini'), { ...options(accounting), signal: caller.signal })).rejects.toBe(0); expect(rows()[0].state).toBe('not_dispatched'); expect(network).not.toHaveBeenCalled();
  });
  it('Base explicit mode and core genuine native return avoid converter/double accounting', async () => {
    network.mockImplementation(async () => Response.json(raw())); const args = options(await context());
    const result = await new DefaultExecutor('gemini').execute(args); expect(result.accountingOwned).toBe(true); expect(rows()).toHaveLength(1);
    const { handleChatCore } = await import('open-sse/handlers/chatCore.js');
    const core = await handleChatCore({ ...args, accounting: await context(), modelInfo: { provider: 'gemini', model: args.model }, sourceFormatOverride: 'gemini', log: { debug() {} } });
    expect(await core.response.json()).toEqual(raw()); expect(rows()).toHaveLength(2); expect(network).toHaveBeenCalledTimes(2);
  });
  const request = (suffix = 'gemini/fixture-gemini:generateContent', input = body()) => new Request('http://localhost/v1beta/models/' + suffix, { method: 'POST', headers: { Authorization: 'Bearer gemini-fixture-key', 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  it('actual native wrapper→app→core→owner original config/native response/threshold no reconversion', async () => {
    putPolicySync(db, 'gemini-key', { weeklyLimitNanoUsd: '124000', monthlyLimitNanoUsd: null }, 1); network.mockImplementation(async (_url, init) => { expect(JSON.parse(init.body)).toEqual(body()); return Response.json(raw()); });
    const { POST } = await import('@/app/api/v1beta/models/[...path]/route.js'); const params = { params: Promise.resolve({ path: ['gemini', 'fixture-gemini:generateContent'] }) };
    const response = await POST(request(), params); expect(response.status).toBe(200); expect(await response.json()).toEqual(raw()); expect(response.headers.get('cache-control')).toBe('no-store');
    const next = await POST(request(), params); expect(next.status).toBe(429); expect(rows()[0]).toMatchObject({ state: 'settled', costNanoUsd: 124000 }); expect(network).toHaveBeenCalledTimes(1);
  });
  it('native standard top-level tier is pinned unconverted at actual POST', async () => {
    const input = { ...body(), serviceTier: 'standard' };
    network.mockImplementation(async (_url, init) => { expect(JSON.parse(init.body)).toEqual(input); const message = raw(); message.usageMetadata.serviceTier = 'standard'; return Response.json(message); });
    const { POST } = await import('@/app/api/v1beta/models/[...path]/route.js');
    const response = await POST(request(undefined, input), { params: Promise.resolve({ path: ['gemini', 'fixture-gemini:generateContent'] }) });
    expect(response.status).toBe(200); expect(rows()[0].state).toBe('settled'); expect(network).toHaveBeenCalledTimes(1);
  });
  it('post-invocation cancellation observes late response cleanup with one unresolved completion', async () => {
    const original = await context(), caller = new AbortController(); let entered, release;
    const started = new Promise(resolve => { entered = resolve; });
    const cancel = vi.fn(() => Promise.reject(new Error('foreign cleanup')));
    const late = new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'application/json' } });
    const accounting = { ...original, completeAttempt: vi.fn((...args) => original.completeAttempt(...args)) };
    network.mockImplementation(() => { entered(); return new Promise(resolve => { release = resolve; }); });
    const work = executeAccountedGeminiCandidate(new DefaultExecutor('gemini'), { ...options(accounting), signal: caller.signal }).then(value => ({ value }), error => ({ error }));
    try { await started; caller.abort(false); expect((await work).error).toBe(false); expect(rows()[0]).toMatchObject({ state: 'unresolved', costNanoUsd: null }); }
    finally { release(late); await new Promise(resolve => setImmediate(resolve)); }
    expect(cancel).toHaveBeenCalledWith(false); expect(cancel).toHaveBeenCalledTimes(1); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(network).toHaveBeenCalledTimes(1);
  });
  const nativeEvent = frame => 'data: ' + JSON.stringify(frame) + '\n\n';
  const nativeDelta = () => ({ modelVersion: 'fixture-gemini', candidates: [{ index: 0, content: { role: 'model', parts: [{ text: 'live answer' }] } }] });
  const nativeWire = mode => nativeEvent(nativeDelta()) + (mode === 'missing-finish' ? '' : nativeEvent(raw())) + (mode === 'trailing-invalid' ? 'data: {}\n\n' : '');
  it.each(['owner', 'Base', 'core', 'app'])('live %s passes native raw SSE through sole owner/threshold and next429', async entry => {
    putPolicySync(db, 'gemini-key', { weeklyLimitNanoUsd: '124000', monthlyLimitNanoUsd: null }, 1);
    network.mockImplementation(async (url, init, _proxy, transport) => {
      expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/fixture-gemini:streamGenerateContent?alt=sse');
      expect(JSON.parse(init.body)).toEqual(body()); expect(transport).toEqual({ singlePost: true }); expect(rows()[0].state).toBe('pending');
      return new Response(nativeWire(), { headers: { 'content-type': 'text/event-stream' } });
    });
    const invoke = async () => {
      const args = { ...options(await context()), body: { ...body(), model: 'fixture-gemini', stream: true }, stream: true, accountingMode: 'native-gemini-sse' };
      if (entry === 'owner') return (await executeAccountedGeminiCandidate(new DefaultExecutor('gemini'), args)).response;
      if (entry === 'Base') return (await new DefaultExecutor('gemini').execute(args)).response;
      if (entry === 'core') return (await (await import('open-sse/handlers/chatCore.js')).handleChatCore({ ...args, modelInfo: { provider: 'gemini', model: args.model }, sourceFormatOverride: 'gemini', log: { debug() {} } })).response;
      return (await import('@/app/api/v1beta/models/[...path]/route.js')).POST(request('gemini/fixture-gemini:streamGenerateContent?alt=sse'), { params: Promise.resolve({ path: ['gemini', 'fixture-gemini:streamGenerateContent'] }) });
    };
    const response = await invoke(); expect(response.status).toBe(200); expect(response.headers.get('content-type')).toContain('text/event-stream'); expect(await response.text()).toBe(nativeWire());
    expect(rows()[0]).toMatchObject({ state: 'settled', costNanoUsd: 124000 });
    if (entry === 'app') expect((await invoke()).status).toBe(429);
    else await expect(invoke()).rejects.toMatchObject({ code: BUDGET_ERROR.EXCEEDED });
    expect(network).toHaveBeenCalledTimes(1);
  });
  it.each(['missing-finish', 'trailing-invalid'])('live app %s aborts native success with unresolved/null and no account successor', async mode => {
    network.mockImplementation(async () => new Response(nativeWire(mode), { headers: { 'content-type': 'text/event-stream' } }));
    const { POST } = await import('@/app/api/v1beta/models/[...path]/route.js'); const params = { params: Promise.resolve({ path: ['gemini', 'fixture-gemini:streamGenerateContent'] }) };
    const response = await POST(request('gemini/fixture-gemini:streamGenerateContent?alt=sse'), params); expect(response.status).toBe(200); await expect(response.text()).rejects.toThrow();
    expect(rows()).toHaveLength(1); expect(rows()[0]).toMatchObject({ state: 'unresolved', costNanoUsd: null });
    expect((await POST(request('gemini/fixture-gemini:streamGenerateContent?alt=sse'), params)).status).toBe(503); expect(network).toHaveBeenCalledTimes(1); expect(app.cooldown).not.toHaveBeenCalled();
  });
  it.each(['OAuth', 'tools', 'alt-json', 'duplicate-alt', 'suffix', 'extra-path', 'mode-body'])('live native %s denies before intent/POST including unlimited', async mode => {
    putPolicySync(db, 'gemini-key', { weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null }, 1); const input = body(); let segments = ['gemini', 'fixture-gemini:streamGenerateContent'], query = '?alt=sse';
    if (mode === 'OAuth') app.select.mockResolvedValue({ accessToken: 'fixture', connectionId: 'gemini-connection' });
    if (mode === 'tools') input.tools = [{ googleSearch: {} }]; if (mode === 'alt-json') query = '?alt=json'; if (mode === 'duplicate-alt') query = '?alt=sse&alt=sse';
    if (mode === 'suffix') segments[1] += 'junk'; if (mode === 'extra-path') segments.push('extra'); if (mode === 'mode-body') input.stream = false;
    const { POST } = await import('@/app/api/v1beta/models/[...path]/route.js');
    const response = await POST(request(segments.join('/') + query, input), { params: Promise.resolve({ path: segments }) });
    expect(response.status).toBe(503); expect(rows()).toEqual([]); expect(network).not.toHaveBeenCalled();
  });
  it.each(['tools', 'nontext', 'priority', 'OAuth', 'stream', 'extra-path', 'suffix-lookalike', 'query', 'alias'])('wrapper original %s cannot be converted into eligible work even unlimited', async mode => {
    putPolicySync(db, 'gemini-key', { weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null }, 1); const input = body(); let segments = ['gemini', 'fixture-gemini:generateContent'];
    if (mode === 'tools') input.tools = [{ googleSearch: {} }]; if (mode === 'nontext') input.contents[0].parts = [{ inlineData: { mimeType: 'image/png', data: 'AA==' } }];
    if (mode === 'priority') input.serviceTier = 'priority'; if (mode === 'OAuth') app.select.mockResolvedValue({ accessToken: 'fixture', connectionId: 'gemini-connection' });
    if (mode === 'stream') { segments[1] = 'fixture-gemini:streamGenerateContent'; input.tools = [{ googleSearch: {} }]; } if (mode === 'extra-path') segments.push('extra');
    if (mode === 'suffix-lookalike') segments[1] += 'junk'; if (mode === 'alias') segments = ['alias:generateContent'];
    let req = request(segments.join('/'), input); if (mode === 'query') req = request(segments.join('/') + '?alt=json', input);
    const { POST } = await import('@/app/api/v1beta/models/[...path]/route.js'); const response = await POST(req, { params: Promise.resolve({ path: segments }) });
    expect(response.status).toBe(503); expect(rows()).toEqual([]); expect(network).not.toHaveBeenCalled();
  });
});
