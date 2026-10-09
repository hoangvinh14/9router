import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initializePoliciesOffline } from '@/lib/db/offlinePolicyInitialization.js';
import { handleEmbeddingsCore } from '../../open-sse/handlers/embeddingsCore.js';
import { handleAccountedEmbedding } from '../../open-sse/handlers/embeddingProviders/accountedRequest.js';
import { createRequestAccounting } from '@/lib/apiKeyBudget/requestAccounting.js';
import { putPolicySync } from '@/lib/db/repos/apiKeyAccountingRepo.js';
import { BUDGET_ERROR } from '../../open-sse/config/apiKeyBudgetConstants.js';
import { FORMATS } from '../../open-sse/translator/formats.js';
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), retry: vi.fn(), cooldown: vi.fn(), legacyUsage: vi.fn() }));
vi.mock('../../src/sse/services/auth.js', () => ({
  getProviderCredentials: async () => ({ apiKey: 'provider-fixture', connectionId: 'connection-fixture', connectionName: 'Fixture' }),
  markAccountUnavailable: mocks.cooldown, clearAccountError: async () => {},
  extractApiKey: req => req.headers.get('Authorization')?.slice(7), isValidApiKey: async () => true,
}));
vi.mock('../../src/sse/services/model.js', () => ({ getModelInfo: async () => ({ provider: 'openai', model: 'text-embedding-3-small' }) }));
vi.mock('../../src/sse/services/tokenRefresh.js', () => ({ updateProviderCredentials: async () => {}, checkAndRefreshToken: async (_provider, credentials) => credentials }));
vi.mock('@/lib/usageDb.js', () => ({ saveRequestUsage: mocks.legacyUsage }));
vi.mock('../../src/sse/utils/logger.js', () => ({ request() {}, debug() {}, info() {}, warn() {}, error() {}, maskKey() { return '[fixture]'; } }));
vi.mock('../../open-sse/executors/index.js', () => ({ getExecutor: () => ({ refreshCredentials: mocks.refresh }) }));
vi.mock('../../open-sse/services/tokenRefresh.js', () => ({ refreshWithRetry: mocks.retry }));
let dir, db;
const old = process.env.DATA_DIR;
beforeEach(async () => {
  // Hoisted vi.fn instances survive resetModules/restoreAllMocks; isolate history
  // and one-shot implementations before installing this case's defaults.
  mocks.refresh.mockReset(); mocks.retry.mockReset(); mocks.cooldown.mockReset(); mocks.legacyUsage.mockReset();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'embedding-ledger-')); process.env.DATA_DIR = dir; delete global._dbAdapter; vi.resetModules();
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'key-a', key: 'local-fixture-secret' }] });
  db.close(); db = null;
  await initializePoliciesOffline({ directory: dir, engine: 'node:sqlite', actor: 'fixture', reason: 'fixture-only initialization' });
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  // Fixture-only activation; never an application startup or production caller.
  db.durableTransaction(() => db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')"));
  putPolicySync(db, 'key-a', { weeklyLimitNanoUsd: '1000000000', monthlyLimitNanoUsd: null }, 0);
  // Approved explicit fixture reference; no assumed production catalog mapping.
  await (await import('@/lib/db/repos/pricingRepo.js')).updatePricing({ openai: { 'text-embedding-3-small': { input: '0.02', output: '0' } } });
  const { resolveReferencePriceSync } = await import('@/lib/pricing/referenceResolver.js');
  expect(resolveReferencePriceSync(db, 'openai', 'text-embedding-3-small', 'embeddings')).toMatchObject({ status: 'priced', snapshot: { source: 'manual', rates: { input: '0.02', output: '0' } } });
  vi.stubGlobal('fetch', vi.fn()); mocks.retry.mockImplementation(fn => fn()); mocks.refresh.mockResolvedValue({ apiKey: 'refreshed-fixture' });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db?.close(); delete global._dbAdapter; fs.rmSync(dir, { recursive: true, force: true }); if (old === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = old; });
function request(signal) { return new Request('http://localhost/v1/embeddings', { method: 'POST', headers: { Authorization: 'Bearer local-fixture-secret' }, signal }); }
async function lifecycle(signal) { return createRequestAccounting(request(signal), { adapter: async () => db }); }
const payload = (usage = { prompt_tokens: 100, total_tokens: 100 }) => ({ object: 'list', data: [], model: 'text-embedding-3-small', usage });
const response = (status = 200, usage) => Response.json(payload(usage), { status });
const options = accounting => ({ body: { input: 'fixture only', model: 'text-embedding-3-small' }, modelInfo: { provider: 'openai', model: 'text-embedding-3-small' }, credentials: { apiKey: 'provider-fixture' }, connectionId: 'connection-fixture', accounting });
const rows = () => db.all('SELECT * FROM apiKeyAccounting ORDER BY startedAt,attemptId');
describe('actual embedding attempt ledger at fetch boundary', { timeout: 20000 }, () => {
  it('app handler uses owned identity and returns local refusal without cooldown/double analytics', async () => {
    const { handleEmbeddings } = await import('../../src/sse/handlers/embeddings.js');
    const req = () => new Request('http://localhost/v1/embeddings', { method: 'POST', headers: { Authorization: 'Bearer local-fixture-secret' }, body: JSON.stringify({ model: 'openai/text-embedding-3-small', input: 'fixture' }) });
    fetch.mockResolvedValue(response()); expect((await handleEmbeddings(req())).status).toBe(200); expect(rows()).toHaveLength(1); expect(rows()[0].state).toBe('settled'); expect(mocks.legacyUsage).not.toHaveBeenCalled();
    putPolicySync(db, 'key-a', { weeklyLimitNanoUsd: '0', monthlyLimitNanoUsd: null }, 1);
    const denied = await handleEmbeddings(req()); expect(denied.status).toBe(429); expect((await denied.json()).error.code).toBe(BUDGET_ERROR.EXCEEDED); expect(denied.headers.get('cache-control')).toBe('no-store');
    expect(fetch).toHaveBeenCalledTimes(1); expect(mocks.cooldown).not.toHaveBeenCalled();
  });
  it('parallel request contexts remain distinct and preserve original price after midflight edit', async () => {
    const waiting = []; fetch.mockImplementation(() => new Promise(resolve => waiting.push(resolve)));
    const a = await lifecycle(), b = await lifecycle();
    const first = handleEmbeddingsCore(options(a)), second = handleEmbeddingsCore(options(b));
    await vi.waitFor(() => expect(waiting).toHaveLength(2)); expect(rows().every(row => row.state === 'pending')).toBe(true);
    await (await import('@/lib/db/repos/pricingRepo.js')).updatePricing({ openai: { 'text-embedding-3-small': { input: '9', output: '0' } } });
    waiting[1](response()); waiting[0](response()); await Promise.all([first, second]);
    expect(new Set(rows().map(row => row.requestId)).size).toBe(2); expect(rows().every(row => row.state === 'settled' && JSON.parse(row.priceSnapshotJson).rates.input === '0.02')).toBe(true);
    expect(rows().map(row => String(row.costNanoUsd))).toEqual(['2000', '2000']);
  });
  it('deleted identity during upstream work does not discard its terminal debit', async () => {
    fetch.mockImplementation(async () => { db.durableTransaction(() => db.run("DELETE FROM apiKeys WHERE id='key-a'")); return response(); });
    expect((await handleEmbeddingsCore(options(await lifecycle()))).success).toBe(true); expect(rows()[0]).toMatchObject({ apiKeyId: 'key-a', state: 'settled' });
  });
  it('abort before headers promptly settles ambiguous once and cancels unhanded late response', async () => {
    const ctrl = new AbortController(); let release, cancelCount = 0;
    fetch.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const pending = expect(handleEmbeddingsCore({ ...options(await lifecycle()), signal: ctrl.signal })).rejects.toBe('before-headers');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1)); ctrl.abort('before-headers'); await pending;
    expect(rows()[0]).toMatchObject({ state: 'unresolved', outcome: 'aborted', costNanoUsd: null });
    release(new Response(new ReadableStream({ cancel() { cancelCount++; } })));
    await vi.waitFor(() => expect(cancelCount).toBe(1)); expect(rows()).toHaveLength(1); expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('persists pending before fetch and settles raw usage before response/projection, immutable price', async () => {
    fetch.mockImplementation(async () => { expect(rows()).toHaveLength(1); expect(rows()[0].state).toBe('pending'); return response(); });
    const result = await handleEmbeddingsCore(options(await lifecycle()));
    expect(result.success).toBe(true); expect(result.accountingOwned).toBe(true); expect(rows()[0]).toMatchObject({ apiKeyId: 'key-a', state: 'settled', endpoint: 'embeddings', connectionId: 'connection-fixture' });
    expect(BigInt(rows()[0].costNanoUsd)).toBeGreaterThan(0n); expect(JSON.parse(rows()[0].usageJson)).toMatchObject({ exact: true, input: 100, output: 0 });
    expect(db.get("SELECT COUNT(*) AS n FROM kv WHERE scope='accountingProjection'").n).toBe(1);
  });
  it('missing reference price denies before POST with no attempt effects', async () => {
    await (await import('@/lib/db/repos/pricingRepo.js')).resetPricing('openai', 'text-embedding-3-small');
    await expect(handleEmbeddingsCore(options(await lifecycle()))).rejects.toMatchObject({ code: BUDGET_ERROR.PRICING });
    expect(fetch).not.toHaveBeenCalled(); expect(rows()).toEqual([]);
  });
  it('exhausted gate and unsupported custom adapter both deny before any POST', async () => {
    const accounting = await lifecycle();
    await expect(handleEmbeddingsCore({ ...options(accounting), modelInfo: { provider: 'openai-compatible-fixture', model: 'embedding' } })).rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED });
    putPolicySync(db, 'key-a', { weeklyLimitNanoUsd: '0', monthlyLimitNanoUsd: null }, 1);
    await expect(handleEmbeddingsCore(options(accounting))).rejects.toMatchObject({ code: BUDGET_ERROR.EXCEEDED }); expect(fetch).not.toHaveBeenCalled(); expect(rows()).toEqual([]);
  });
  it.each(['openai-compatible-fixture', 'gemini', 'openrouter'])('unlimited identified key cannot authorize unverified embedding schema %s', async provider => {
    putPolicySync(db, 'key-a', { weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null }, 1);
    fetch.mockResolvedValue(response());
    await expect(handleEmbeddingsCore({ ...options(await lifecycle()), modelInfo: { provider, model: 'embedding-fixture' } })).rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED });
    expect(fetch).not.toHaveBeenCalled(); expect(rows()).toEqual([]); expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('actual POST owner rejects unsupported schema before serialization or intent', async () => {
    const actual = await lifecycle(), serialize = vi.fn(() => { throw new Error('unsupported body serialized'); });
    const beforeAttempt = vi.fn(actual.beforeAttempt);
    await expect(handleAccountedEmbedding({ ...options({ ...actual, beforeAttempt }), provider: 'openrouter', model: 'embedding-fixture', ctx: {}, requestBody: { toJSON: serialize }, url: 'http://fixture.invalid', headers: {}, adapter: { accountingSchema: FORMATS.OPENAI, normalize: vi.fn() } })).rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED });
    expect(serialize).not.toHaveBeenCalled(); expect(beforeAttempt).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled(); expect(rows()).toEqual([]);
  });
  it('OFF unverified compatible adapter preserves legacy dispatch without an intent', async () => {
    db.durableTransaction(() => db.run("DELETE FROM _meta WHERE key='ledgerStartedAt'"));
    fetch.mockResolvedValue(response());
    expect((await handleEmbeddingsCore({ ...options(await lifecycle()), modelInfo: { provider: 'openai-compatible-fixture', model: 'embedding-fixture' } })).success).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1); expect(rows()).toEqual([]);
  });
  it('401 raw exact settlement precedes refresh and second separately gated attempt', async () => {
    fetch.mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response());
    mocks.refresh.mockImplementation(async () => { expect(rows()[0].state).toBe('settled'); return { apiKey: 'refreshed-fixture' }; });
    const result = await handleEmbeddingsCore(options(await lifecycle())); expect(result.success).toBe(true); expect(fetch).toHaveBeenCalledTimes(2); expect(rows()).toHaveLength(2);
    expect(new Set(rows().map(row => row.attemptId)).size).toBe(2); expect(new Set(rows().map(row => row.requestId)).size).toBe(1); expect(rows().every(row => row.state === 'settled')).toBe(true);
  });
  it.each([undefined, {}, { prompt_tokens: 10 }, { prompt_tokens: 10, total_tokens: 10, completion_tokens: 1 }, { prompt_tokens: 10, total_tokens: 10, estimated: true }])('invalid raw usage %# remains null/unresolved and blocks new billable retry', async usage => {
    fetch.mockResolvedValue(Response.json({ error: { message: 'auth failure' }, ...(usage !== undefined ? { usage } : {}) }, { status: 401 }));
    await expect(handleEmbeddingsCore(options(await lifecycle()))).rejects.toMatchObject({ code: BUDGET_ERROR.UNRESOLVED }); expect(fetch).toHaveBeenCalledTimes(1); expect(mocks.refresh).not.toHaveBeenCalled(); expect(rows()[0]).toMatchObject({ state: 'unresolved', costNanoUsd: null });
  });
  it.each([{}, { prompt_tokens: 100 }, { prompt_tokens: 100, total_tokens: 100, completion_tokens: 1 }])('successful HTTP unknown usage %# is a local refusal before normalization', async usage => {
    fetch.mockResolvedValue(response(200, usage));
    const actual = await lifecycle();
    await expect(handleEmbeddingsCore(options(actual))).rejects.toMatchObject({ code: BUDGET_ERROR.UNRESOLVED });
    expect(fetch).toHaveBeenCalledTimes(1); expect(rows()[0]).toMatchObject({ state: 'unresolved', costNanoUsd: null, usageJson: null });
    expect(mocks.cooldown).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('unlimited durable unknown success remains allowed with null money', async () => {
    putPolicySync(db, 'key-a', { weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null }, 1);
    fetch.mockResolvedValue(response(200, {}));
    expect((await handleEmbeddingsCore(options(await lifecycle()))).success).toBe(true);
    expect(rows()[0]).toMatchObject({ state: 'unresolved', costNanoUsd: null }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('exact success at the limit returns normally and only next admission fails', async () => {
    putPolicySync(db, 'key-a', { weeklyLimitNanoUsd: '2000', monthlyLimitNanoUsd: null }, 1);
    fetch.mockResolvedValue(response()); const actual = await lifecycle();
    expect((await handleEmbeddingsCore(options(actual))).success).toBe(true);
    await expect(handleEmbeddingsCore(options(await lifecycle()))).rejects.toMatchObject({ code: BUDGET_ERROR.EXCEEDED });
    expect(rows()[0]).toMatchObject({ state: 'settled', costNanoUsd: 2000 }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([['below', '1000000000'], ['at', '2000']])('failed HTTP exact debit %s limit settles before error/admission mapping', async (_label, limit) => {
    putPolicySync(db, 'key-a', { weeklyLimitNanoUsd: limit, monthlyLimitNanoUsd: null }, 1);
    fetch.mockResolvedValue(response(500)); const actual = await lifecycle();
    if (limit === '2000') await expect(handleEmbeddingsCore(options(actual))).rejects.toMatchObject({ code: BUDGET_ERROR.EXCEEDED });
    else expect((await handleEmbeddingsCore(options(actual))).success).toBe(false);
    expect(rows()[0]).toMatchObject({ state: 'settled', outcome: 'failed', costNanoUsd: 2000 });
    expect(fetch).toHaveBeenCalledTimes(1); expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('app network ambiguity returns typed 503 without cooldown or fallback', async () => {
    fetch.mockRejectedValue(new Error('fixture network rejection'));
    const { handleEmbeddings } = await import('../../src/sse/handlers/embeddings.js');
    const response = await handleEmbeddings(new Request('http://localhost/v1/embeddings', { method: 'POST', headers: { Authorization: 'Bearer local-fixture-secret' }, body: JSON.stringify({ model: 'openai/text-embedding-3-small', input: 'fixture' }) }));
    expect(response.status).toBe(503); expect((await response.json()).error.code).toBe(BUDGET_ERROR.UNRESOLVED);
    expect(response.headers.get('cache-control')).toBe('no-store'); expect(rows()[0].state).toBe('unresolved');
    expect(fetch).toHaveBeenCalledTimes(1); expect(mocks.cooldown).not.toHaveBeenCalled(); expect(mocks.legacyUsage).not.toHaveBeenCalled();
  });
  it.each(['latched', 'latch-failed'])('unlimited settlement write failure %s requires durable gap ACK', async mode => {
    putPolicySync(db, 'key-a', { weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null }, 1);
    const actual = await lifecycle(), run = db.run.bind(db);
    const failure = vi.spyOn(db, 'run').mockImplementation((sql, ...params) => {
      if (sql.startsWith('UPDATE apiKeyAccounting SET state=')) throw new Error('fixture settlement failure');
      return run(sql, ...params);
    });
    const latch = mode === 'latch-failed' ? vi.spyOn(db.coverage, 'latchGap').mockImplementation(() => { throw new Error('fixture gap ACK failure'); }) : null;
    fetch.mockResolvedValue(response());
    try {
      const work = handleEmbeddingsCore(options(actual));
      if (mode === 'latched') { expect((await work).success).toBe(true); expect(db.coverage.status('key-a').gaps.some(gap => !gap.resolvedAt)).toBe(true); }
      else await expect(work).rejects.toMatchObject({ code: BUDGET_ERROR.UNAVAILABLE });
      expect(rows()[0]).toMatchObject({ state: 'pending', costNanoUsd: null }); expect(fetch).toHaveBeenCalledTimes(1); expect(mocks.cooldown).not.toHaveBeenCalled();
    } finally { failure.mockRestore(); latch?.mockRestore(); }
  });
  it('malformed internal terminal rejects once before normalization', async () => {
    fetch.mockResolvedValue(response()); const actual = await lifecycle(); const completeAttempt = vi.fn((handle, payload) => { actual.completeAttempt(handle, payload); return undefined; });
    await expect(handleEmbeddingsCore(options({ ...actual, completeAttempt }))).rejects.toMatchObject({ code: BUDGET_ERROR.UNAVAILABLE });
    expect(completeAttempt).toHaveBeenCalledTimes(1); expect(fetch).toHaveBeenCalledTimes(1); expect(rows()[0].state).toBe('settled');
  });
  it('abort after admission is proven not_dispatched and preserves primitive reason', async () => {
    const ctrl = new AbortController(), actual = await lifecycle(ctrl.signal);
    const accounting = { ...actual, beforeAttempt(...args) { const handle = actual.beforeAttempt(...args); ctrl.abort('primitive-stop'); return handle; } };
    await expect(handleEmbeddingsCore({ ...options(accounting), signal: ctrl.signal })).rejects.toBe('primitive-stop'); expect(fetch).not.toHaveBeenCalled(); expect(rows()[0].state).toBe('not_dispatched');
  });
  it('network rejection records unresolved and no second POST even with successful refresh capability', async () => {
    fetch.mockRejectedValue(new Error('network fixture')); const actual = await lifecycle();
    await expect(handleEmbeddingsCore(options(actual))).rejects.toMatchObject({ code: BUDGET_ERROR.UNRESOLVED }); expect(rows()[0]).toMatchObject({ state: 'unresolved', costNanoUsd: null });
    await expect(handleEmbeddingsCore(options(actual))).rejects.toMatchObject({ code: BUDGET_ERROR.UNRESOLVED }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('settlement failure propagates local error, never retry or second terminal', async () => {
    fetch.mockResolvedValue(response()); const actual = await lifecycle(); const fail = new Error('local persistence failure');
    const completeAttempt = vi.fn(() => { throw fail; }); await expect(handleEmbeddingsCore(options({ ...actual, completeAttempt }))).rejects.toBe(fail);
    expect(completeAttempt).toHaveBeenCalledTimes(1); expect(fetch).toHaveBeenCalledTimes(1); expect(mocks.refresh).not.toHaveBeenCalled(); expect(rows()[0].state).toBe('pending');
    // Complete for fixture teardown, without claiming successful client response.
    actual.completeAttempt(rowsHandle(actual), { usage: null });
    function rowsHandle() { return completeAttempt.mock.calls[0][0]; }
  });
  it('normalization error after settlement cannot duplicate or erase debit', async () => {
    fetch.mockResolvedValue(response()); const actual = await lifecycle();
    await expect(handleAccountedEmbedding({ ...options(actual), provider: 'openai', model: 'text-embedding-3-small', ctx: {}, requestBody: {}, url: 'http://fixture.invalid', headers: {}, adapter: { accountingSchema: FORMATS.OPENAI, normalize() { throw new Error('normalizer fixture'); } } })).rejects.toThrow('normalizer fixture');
    expect(rows()).toHaveLength(1); expect(rows()[0].state).toBe('settled');
  });
  it('OFF creates no intent, disabled identity still denies and storage failure never becomes exemption', async () => {
    db.durableTransaction(() => db.run("DELETE FROM _meta WHERE key='ledgerStartedAt'")); expect(await lifecycle()).toBeNull(); expect(rows()).toEqual([]);
    db.durableTransaction(() => db.run("UPDATE apiKeys SET isActive=0 WHERE id='key-a'")); await expect(lifecycle()).rejects.toMatchObject({ code: BUDGET_ERROR.UNAVAILABLE });
    await expect(createRequestAccounting(request(), { adapter: async () => { throw new Error('secret-bearing storage error'); } })).rejects.toMatchObject({ code: BUDGET_ERROR.UNAVAILABLE });
  });
});
