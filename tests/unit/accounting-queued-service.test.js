import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

let db, dir, now, createContext, pricing;
const original = process.env.DATA_DIR;
const candidate = { provider: 'fixture', model: 'fixture' };
const usage = { exact: true, input: 1000000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, reasoningIncludedInOutput: true };
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), '9router-queued-service-')); process.env.DATA_DIR = dir; delete global._dbAdapter; vi.resetModules();
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-queued-a' }, { id: 'b', key: 'dummy-queued-b' }] });
  // Explicit disposable fixture activation; never a production activation path.
  db.durableTransaction(() => db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-01T00:00:00.000Z')"));
  now = '2026-10-03T00:00:00.000Z';
  createContext = id => import('@/lib/apiKeyBudget/service.js').then(m => m.createBudgetContext(id, { adapter: async () => db, clock: () => now }));
  pricing = await import('@/lib/db/repos/pricingRepo.js'); await pricing.updatePricing({ fixture: { fixture: { input: '1', output: '2' } } });
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(dir, { recursive: true, force: true }); if (original === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = original; });

describe('queued service fresh monetary authority (not request/config/transport acceptance)', () => {
  it('groups separate request/key intents and settlements without nested per-row durable transactions', async () => {
    const a = await createContext('a'), b = await createContext('b'), durable = vi.spyOn(db, 'durableTransaction');
    const pending = [a.beginAttemptQueued(candidate), b.beginAttemptQueued(candidate)];
    expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
    const [aa, bb] = await Promise.all(pending); expect(durable).toHaveBeenCalledTimes(1);
    expect(aa.apiKeyId).toBe('a'); expect(bb.apiKeyId).toBe('b'); expect(aa.requestId).not.toBe(bb.requestId);
    await pricing.updatePricing({ fixture: { fixture: { input: '99', output: '99' } } }); durable.mockClear();
    const settled = await Promise.all([a.completeAttemptQueued(aa, { usage }), b.completeAttemptQueued(bb, { usage })]);
    expect(settled.map(r => r.costNanoUsd)).toEqual(['1000000000', '1000000000']);
    // Analytics projection can have its own ACK; count only the monetary group
    // using installed outcomes, not an unproven global fsync-count promise.
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 1000000000 }, { state: 'settled', costNanoUsd: 1000000000 }]);
    expect(db.all('SELECT apiKeyId FROM usageHistory ORDER BY apiKeyId')).toEqual([{ apiKeyId: 'a' }, { apiKeyId: 'b' }]);
    expect(durable.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
  it('policy change to zero during wait refuses without intent; neighbor remains independent', async () => {
    const a = await createContext('a'), b = await createContext('b');
    const pending = a.beginAttemptQueued(candidate);
    a.updatePolicy({ weeklyLimitUsd: '0', monthlyLimitUsd: null, expectedVersion: 0 });
    const neighbor = b.beginAttemptQueued(candidate);
    await expect(pending).rejects.toMatchObject({ code: 'api_key_budget_exceeded' });
    const bb = await neighbor; expect(bb.apiKeyId).toBe('b'); expect(db.all('SELECT apiKeyId FROM apiKeyAccounting')).toEqual([{ apiKeyId: 'b' }]);
  });
  it('disable during wait refuses even unlimited and creates no intent', async () => {
    const a = await createContext('a'), pending = a.beginAttemptQueued(candidate);
    db.durableTransaction(() => db.run("UPDATE apiKeys SET isActive=0 WHERE id='a'"));
    await expect(pending).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' }); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
  });
  it('changed pricing authority refuses queued candidate, never silently reprices prepared work', async () => {
    const a = await createContext('a'), pending = a.beginAttemptQueued(candidate);
    // Synchronous mutation before microtask flush, not await that would flush first.
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='fixture'", [JSON.stringify({ fixture: { input: '3', output: '4' } })]));
    await expect(pending).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' }); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
  });
  it('intent startedAt belongs to actual admission window, not enqueue time', async () => {
    const a = await createContext('a'), pending = a.beginAttemptQueued(candidate);
    now = '2026-11-01T00:00:00.000Z'; const attempt = await pending; expect(attempt.startedAt).toBe(now);
    await a.completeAttemptQueued(attempt, { usage }); expect(a.gate().spent.monthly).toBe('1000000000');
  });
  it('abort while queued preserves exact false reason and provably unexecuted intent is removed', async () => {
    const a = await createContext('a'), ctrl = new AbortController();
    const pending = a.beginAttemptQueued(candidate, { signal: ctrl.signal }); ctrl.abort(false);
    await expect(pending).rejects.toBe(false); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
  });
  it('coverage gap introduced during wait blocks budgeted admission, no stale allowance', async () => {
    const a = await createContext('a'); a.updatePolicy({ weeklyLimitUsd: '2', monthlyLimitUsd: null, expectedVersion: 0 });
    const pending = a.beginAttemptQueued(candidate); db.coverage.latchGap('a', 'queued fixture gap');
    await expect(pending).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' }); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
  });
  it('FIFO settlement updates the fresh gate before a following admission in the same group', async () => {
    const a = await createContext('a'); a.updatePolicy({ weeklyLimitUsd: '1', monthlyLimitUsd: null, expectedVersion: 0 });
    const attempt = a.beginAttempt(candidate);
    const settled = a.completeAttemptQueued(attempt, { usage });
    const next = a.beginAttemptQueued(candidate);
    await expect(settled).resolves.toMatchObject({ state: 'settled', costNanoUsd: '1000000000' });
    await expect(next).rejects.toMatchObject({ code: 'api_key_budget_exceeded' });
    expect(db.all('SELECT state FROM apiKeyAccounting')).toEqual([{ state: 'settled' }]);
  });
  it('disable after dispatched intent never discards a queued terminal debit', async () => {
    const a = await createContext('a'), attempt = a.beginAttempt(candidate);
    const settled = a.completeAttemptQueued(attempt, { usage });
    db.durableTransaction(() => db.run("UPDATE apiKeys SET isActive=0 WHERE id='a'"));
    await expect(settled).resolves.toMatchObject({ state: 'settled', costNanoUsd: '1000000000' });
    await expect(a.beginAttemptQueued(candidate)).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
  });
  it('queued completion detaches raw evidence so mutation during wait cannot silently alter charge', async () => {
    const a = await createContext('a'), attempt = a.beginAttempt(candidate), mutableUsage = { ...usage };
    const pending = a.completeAttemptQueued(attempt, { usage: mutableUsage }); mutableUsage.input = 99;
    await expect(pending).resolves.toMatchObject({ state: 'settled', costNanoUsd: '1000000000', usage });
  });
  it('maintenance introduced during queue wait never uses unlimited exception or leaves intent', async () => {
    const a = await createContext('a'), pending = a.beginAttemptQueued(candidate);
    const status = db.coverage.status.bind(db.coverage);
    vi.spyOn(db.coverage, 'status').mockImplementation(key => ({ ...status(key), maintenance: { reason: 'fixture' } }));
    const latch = vi.spyOn(db.coverage, 'latchGap');
    await expect(pending).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(latch).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
  });
  it('retained service payload bytes count toward queue bound even when queue command only contains a token', async () => {
    const a = await createContext('a'); a.updatePolicy({ weeklyLimitUsd: '10', monthlyLimitUsd: null, expectedVersion: 0 });
    const attempts = Array.from({ length: 6 }, () => a.beginAttempt(candidate));
    // Large diagnostic field forces exact-usage canonical payload refusal later;
    // here the sixth enqueue must hit queue memory bound before any mutation.
    const oversized = { ...usage, retainedFixture: 'x'.repeat(200000) }, get = vi.spyOn(db, 'get');
    const pending = attempts.map(attempt => a.completeAttemptQueued(attempt, { usage: oversized }));
    const results = await Promise.allSettled(pending);
    expect(results[5]).toMatchObject({ status: 'rejected', reason: { code: 'api_key_accounting_unavailable' } });
    const preparedIds = get.mock.calls.filter(([sql]) => sql === 'SELECT * FROM apiKeyAccounting WHERE attemptId=?').map(([, params]) => params[0]);
    expect(preparedIds).toContain(attempts[0].attemptId); expect(preparedIds).not.toContain(attempts[5].attemptId);
    expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [attempts[5].attemptId]).state).toBe('pending');
  });
  it('mutation exception after group commit withholds handle and requires budgeted local refusal', async () => {
    const a = await createContext('a'); a.updatePolicy({ weeklyLimitUsd: '2', monthlyLimitUsd: null, expectedVersion: 0 });
    const durable = db.durableTransaction.bind(db);
    vi.spyOn(db, 'durableTransaction').mockImplementation(fn => { durable(fn); throw new Error('queued ACK delivery fixture'); });
    await expect(a.beginAttemptQueued(candidate)).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(1);
    // Installed pending row never retroactively grants the caller dispatch ACK.
  });
});
