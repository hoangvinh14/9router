import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { BaseExecutor } from '../../open-sse/executors/base.js';
import { handleFusionChat } from '../../open-sse/services/combo.js';
const network = vi.hoisted(() => vi.fn());
vi.mock('../../open-sse/config/providers.js', async original => ({ ...(await original()),
  PROVIDERS: { ...(await original()).PROVIDERS, openai: { baseUrl: 'http://fixture.invalid/chat' } } }));
vi.mock('../../open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => network(...args) }));
let db, directory, context, budgetError;
const previous = process.env.DATA_DIR;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const log = { info() {}, warn() {} };
const reply = (content, status = 200) => Response.json({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }, { status });
beforeEach(async () => {
  network.mockReset(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-queued-fusion-')); process.env.DATA_DIR = directory;
  delete global._dbAdapter; vi.resetModules();
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }, { id: 'b', key: 'dummy-key-b' }], settings: { requireApiKey: true },
    providerConnections: [{ id: 'c', provider: 'openai', authType: 'apikey', apiKey: 'dummy-provider', isActive: true }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','openai',?)", [JSON.stringify(Object.fromEntries(['fixture-a', 'fixture-b', 'fixture-c', 'fixture-judge'].map(model => [model, { input: '1', output: '2' }])))]);
  });
  context = await (await import('@/lib/apiKeyBudget/requestAccounting.js')).createRequestAccounting(new Request('http://localhost/v1/chat/completions', {
    headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true });
  const { ApiKeyBudgetError } = await import('@/lib/apiKeyBudget/errors.js'); budgetError = () => new ApiKeyBudgetError('api_key_accounting_unavailable');
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous; });
const sharedExecutor = () => new BaseExecutor('openai', { baseUrl: 'http://fixture.invalid/chat', retry: { 502: { attempts: 0, delayMs: 0 } } });
function fusion(accounting, extra = {}, executor = sharedExecutor()) {
  const calls = [], owners = [];
  const run = handleFusionChat({ body: { stream: false, messages: [{ role: 'user', content: 'original fixture' }] },
    models: ['fixture-a', 'fixture-b'], judgeModel: 'fixture-judge', log,
    tuning: { minPanel: 2, stragglerGraceMs: 5, panelHardTimeoutMs: 1000 }, accounting,
    handleSingleModel: (body, model, panel, signal) => {
      calls.push({ model, panel, signal, body });
      // App dispatcher normally binds selected model into body before Base.
      const wireBody = { ...body, model };
      const work = executor.execute({ model, body: wireBody, stream: false, credentials: { apiKey: 'dummy-provider' }, connectionId: 'c', accounting, signal })
        .then(result => { expect(result.accountingOwned).toBe(true); return result.response; });
      owners.push(work.then(response => ({ response }), error => ({ error })));
      return work;
    }, ...extra });
  // Observe immediately, including while tests await an admission/ACK barrier.
  const observed = run.then(response => ({ response }), error => ({ error }));
  return { run, observed, calls, owners };
}
async function waitBarrier(entered, observed) {
  const first = await Promise.race([entered.promise.then(() => null), observed]);
  if (first !== null) throw first.error || new Error('Fusion finished before required fixture barrier');
}
async function resultOf(observed) {
  const result = await observed;
  if (Object.hasOwn(result, 'error')) throw result.error;
  return result.response;
}
describe('actual fusion → queued Base/service ledger boundaries (mock POST, NOT app/native/family approval)', { timeout: 20000 }, () => {
  it('judge waits for EACH panel delivered completion ACK; successors use fresh prices without repricing panels', async () => {
    const entered = deferred(), release = deferred(); const handles = [];
    const accounting = { ...context,
      async beforeAttempt(...args) { const attempt = await context.beforeAttempt(...args); handles.push(attempt); return attempt; },
      async completeAttempt(attempt, completion) {
        const terminal = await context.completeAttempt(attempt, completion);
        if (attempt.model === 'fixture-b') { entered.resolve(); await release.promise; }
        return terminal;
      } };
    network.mockImplementation(async (_url, options) => {
      const model = JSON.parse(options.body).model;
      expect(options.redirect).toBe('error');
      const attempt = handles.findLast(item => item.model === model);
      expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [attempt.attemptId]).state).toBe('pending');
      if (model === 'fixture-judge') expect(handles.filter(h => h.model !== model).every(h => db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId]).state === 'settled')).toBe(true);
      return reply(model);
    });
    const { observed, calls } = fusion(accounting);
    try {
    await waitBarrier(entered, observed);
    expect(network).toHaveBeenCalledTimes(2); expect(calls).toHaveLength(2);
    const held = handles.find(h => h.model === 'fixture-b'); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [held.attemptId])).toEqual({ state: 'settled', costNanoUsd: 200000 });
    // Real settlement installed is not delivered terminal permission. Only a NEW
    // judge admission after delivery obtains this revised immutable snapshot.
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='openai'", [JSON.stringify(Object.fromEntries(['fixture-a', 'fixture-b', 'fixture-c', 'fixture-judge'].map(model => [model, { input: '9', output: '9' }])))]));
    release.resolve(); const response = await resultOf(observed); expect((await response.json()).choices[0].message.content).toBe('fixture-judge');
    expect(network).toHaveBeenCalledTimes(3); expect(handles).toHaveLength(3); expect(new Set(handles.map(h => h.attemptId)).size).toBe(3);
    expect(new Set(handles.map(h => h.requestId)).size).toBe(1);
    expect(handles.map(h => db.get('SELECT costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId]).costNanoUsd).sort((a, b) => a - b)).toEqual([200000, 200000, 1350000]);
    } finally { release.resolve(); await observed; }
  });
  it('lost panel own completion delivery is a local fatal refusal, NOT judge permission or a second terminal', async () => {
    const lost = budgetError(); const handles = [], completions = [];
    const accounting = { ...context,
      async beforeAttempt(...args) { const h = await context.beforeAttempt(...args); handles.push(h); return h; },
      async completeAttempt(h, completion) { completions.push(h.attemptId); const t = await context.completeAttempt(h, completion); if (h.model === 'fixture-b') throw lost; return t; } };
    network.mockImplementation(async (_url, options) => reply(JSON.parse(options.body).model));
    const { run, calls } = fusion(accounting); await expect(run).rejects.toBe(lost);
    expect(network).toHaveBeenCalledTimes(2); expect(calls).toHaveLength(2); expect(calls.every(c => c.signal.aborted)).toBe(true);
    expect(handles).toHaveLength(2); expect(new Set(completions).size).toBe(2); expect(completions).toHaveLength(2);
    for (const h of handles) expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId])).toEqual({ state: 'settled', costNanoUsd: 200000 });
  });
  it('late straggler settles its own original price AFTER judge response without cancellation or response reuse', async () => {
    const latePost = deferred(), releaseLate = deferred(); const handles = [];
    const accounting = { ...context, async beforeAttempt(...args) { const h = await context.beforeAttempt(...args); handles.push(h); return h; } };
    network.mockImplementation(async (_url, options) => {
      const model = JSON.parse(options.body).model;
      if (model === 'fixture-c') { latePost.resolve(); await releaseLate.promise; }
      return reply(model);
    });
    const { observed, calls, owners } = fusion(accounting, { models: ['fixture-a', 'fixture-b', 'fixture-c'] });
    try {
      await waitBarrier(latePost, observed);
      expect((await (await resultOf(observed)).json()).choices[0].message.content).toBe('fixture-judge');
      const late = handles.find(h => h.model === 'fixture-c');
      expect(network).toHaveBeenCalledTimes(4); expect(calls.find(c => c.model === 'fixture-c').signal.aborted).toBe(false);
      expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [late.attemptId]).state).toBe('pending');
      releaseLate.resolve(); const completed = await Promise.all(owners); expect(completed.every(o => !Object.hasOwn(o, 'error'))).toBe(true);
      for (const h of handles) expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId])).toEqual({ state: 'settled', costNanoUsd: 200000 });
      expect(handles).toHaveLength(4); expect(new Set(handles.map(h => h.attemptId)).size).toBe(4);
      expect(network).toHaveBeenCalledTimes(4);
    } finally { releaseLate.resolve(); await observed; await Promise.all(owners); }
  });
  it('late panel lost completion delivery aborts active judge; installed panel money is not erased or re-finalized', async () => {
    const latePost = deferred(), releaseLate = deferred(), judgePost = deferred(), releaseJudge = deferred();
    const lost = budgetError(), handles = [], completions = [];
    const accounting = { ...context,
      async beforeAttempt(...args) { const h = await context.beforeAttempt(...args); handles.push(h); return h; },
      async completeAttempt(h, completion) { completions.push(h.attemptId); const t = await context.completeAttempt(h, completion); if (h.model === 'fixture-c') throw lost; return t; } };
    network.mockImplementation(async (_url, options) => {
      const model = JSON.parse(options.body).model;
      if (model === 'fixture-c') { latePost.resolve(); await releaseLate.promise; }
      if (model === 'fixture-judge') { judgePost.resolve(); await releaseJudge.promise; }
      return reply(model);
    });
    const { observed, calls, owners } = fusion(accounting, { models: ['fixture-a', 'fixture-b', 'fixture-c'] });
    try {
      await waitBarrier(latePost, observed); await waitBarrier(judgePost, observed);
      expect(calls.find(c => c.model === 'fixture-judge').signal.aborted).toBe(false);
      releaseLate.resolve(); expect((await observed).error).toBe(lost);
      expect(calls.every(c => c.signal.aborted)).toBe(true); expect(network).toHaveBeenCalledTimes(4);
      releaseJudge.resolve(); await Promise.all(owners);
      const late = handles.find(h => h.model === 'fixture-c'), judge = handles.find(h => h.model === 'fixture-judge');
      expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [late.attemptId])).toEqual({ state: 'settled', costNanoUsd: 200000 });
      expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [judge.attemptId])).toEqual({ state: 'unresolved', costNanoUsd: null });
      expect(completions).toHaveLength(4); expect(new Set(completions).size).toBe(4); expect(handles).toHaveLength(4);
    } finally { releaseLate.resolve(); releaseJudge.resolve(); await observed; await Promise.all(owners); }
  });
  it.each(['rotate', 'disable'])('fresh persisted connection %s after panel ACK refuses judge intent/POST; original settlements stay billed', async mode => {
    const entered = deferred(), release = deferred(); const handles = [];
    const accounting = { ...context,
      async beforeAttempt(...args) { const h = await context.beforeAttempt(...args); handles.push(h); return h; },
      async completeAttempt(h, completion) { const t = await context.completeAttempt(h, completion); if (h.model === 'fixture-b') { entered.resolve(); await release.promise; } return t; } };
    network.mockImplementation(async (_url, options) => reply(JSON.parse(options.body).model));
    const { observed, owners } = fusion(accounting);
    try {
      await waitBarrier(entered, observed);
      expect(handles).toHaveLength(2);
      for (const h of handles) expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId]).state).toBe('settled');
      db.durableTransaction(() => mode === 'disable' ? db.run("UPDATE providerConnections SET isActive=0 WHERE id='c'")
        : db.run("UPDATE providerConnections SET data=? WHERE id='c'", [JSON.stringify({ apiKey: 'dummy-rotated' })]));
      release.resolve(); expect((await observed).error).toMatchObject({ code: 'api_key_accounting_unavailable' });
      expect(network).toHaveBeenCalledTimes(2); expect(handles).toHaveLength(2); expect(db.all('SELECT attemptId FROM apiKeyAccounting')).toHaveLength(2);
      for (const h of handles) expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId])).toEqual({ state: 'settled', costNanoUsd: 200000 });
    } finally { release.resolve(); await observed; await Promise.all(owners); }
  });
  it('collector hard timeout returns 503 but does not cancel or orphan actual pending panel owners', async () => {
    const posts = deferred(), release = deferred(); const handles = []; let posted = 0;
    const accounting = { ...context, async beforeAttempt(...args) { const h = await context.beforeAttempt(...args); handles.push(h); return h; } };
    network.mockImplementation(async (_url, options) => {
      if (++posted === 2) posts.resolve(); await release.promise; return reply(JSON.parse(options.body).model);
    });
    const { observed, calls, owners } = fusion(accounting);
    try {
      await waitBarrier(posts, observed); expect(handles).toHaveLength(2);
      const response = await resultOf(observed); expect(response.status).toBe(503);
      expect(calls.every(c => !c.signal.aborted)).toBe(true); expect(network).toHaveBeenCalledTimes(2);
      for (const h of handles) expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId]).state).toBe('pending');
      release.resolve(); expect((await Promise.all(owners)).every(o => !Object.hasOwn(o, 'error'))).toBe(true);
      for (const h of handles) expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId])).toEqual({ state: 'settled', costNanoUsd: 200000 });
      expect(network).toHaveBeenCalledTimes(2);
    } finally { release.resolve(); await observed; await Promise.all(owners); }
  });
  it('two gateway keys concurrently share executor/coordinator without mixing panel/judge request identity', async () => {
    const other = await (await import('@/lib/apiKeyBudget/requestAccounting.js')).createRequestAccounting(new Request('http://localhost/v1/chat/completions', {
      headers: { Authorization: 'Bearer dummy-key-b' } }), { adapter: async () => db, queued: true });
    const handles = [], entered = deferred(), release = deferred(); let panels = 0;
    const wrap = original => ({ ...original, async beforeAttempt(...args) { const h = await original.beforeAttempt(...args); handles.push(h); return h; } });
    network.mockImplementation(async (_url, options) => {
      const model = JSON.parse(options.body).model;
      if (model !== 'fixture-judge') { if (++panels === 4) entered.resolve(); await release.promise; }
      return reply(model);
    });
    const executor = sharedExecutor(), a = fusion(wrap(context), {}, executor), b = fusion(wrap(other), {}, executor);
    const both = Promise.all([a.observed, b.observed]);
    try {
      const first = await Promise.race([entered.promise.then(() => null), both]);
      expect(first).toBeNull(); expect(network).toHaveBeenCalledTimes(4); expect(handles).toHaveLength(4);
      expect(db.all("SELECT state FROM apiKeyAccounting WHERE state='pending'")).toHaveLength(4);
      release.resolve(); expect((await both).every(r => r.response?.ok)).toBe(true);
      await Promise.all([...a.owners, ...b.owners]); expect(network).toHaveBeenCalledTimes(6); expect(handles).toHaveLength(6);
      expect(new Set(handles.map(h => h.attemptId)).size).toBe(6); expect(context.requestId).not.toBe(other.requestId);
      for (const [id, original] of [['a', context], ['b', other]]) {
        const own = handles.filter(h => h.apiKeyId === id); expect(own).toHaveLength(3);
        expect(own.every(h => h.requestId === original.requestId)).toBe(true);
        for (const h of own) expect(db.get('SELECT apiKeyId,requestId,state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId]))
          .toEqual({ apiKeyId: id, requestId: original.requestId, state: 'settled', costNanoUsd: 200000 });
      }
    } finally { release.resolve(); await both; await Promise.all([...a.owners, ...b.owners]); }
  });
  it('fresh dual-budget gate after installed panel settlement blocks judge without treating pending work as reservation', async () => {
    const policy = await (await import('@/lib/apiKeyBudget/service.js')).createBudgetContext('a', { adapter: async () => db });
    policy.updatePolicy({ weeklyLimitUsd: '1', monthlyLimitUsd: '1', expectedVersion: 0 });
    const entered = deferred(), release = deferred(); const handles = [];
    const accounting = { ...context,
      async beforeAttempt(...args) { const h = await context.beforeAttempt(...args); handles.push(h); return h; },
      async completeAttempt(h, completion) { const t = await context.completeAttempt(h, completion); if (h.model === 'fixture-b') { entered.resolve(); await release.promise; } return t; } };
    network.mockImplementation(async (_url, options) => reply(JSON.parse(options.body).model));
    const { observed, owners } = fusion(accounting);
    try {
      await waitBarrier(entered, observed);
      for (const h of handles) expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId])).toEqual({ state: 'settled', costNanoUsd: 200000 });
      policy.updatePolicy({ weeklyLimitUsd: '0.0004', monthlyLimitUsd: '0.0004', expectedVersion: 1 });
      release.resolve(); expect((await observed).error).toMatchObject({ code: 'api_key_budget_exceeded' });
      expect(network).toHaveBeenCalledTimes(2); expect(handles).toHaveLength(2); expect(db.all('SELECT attemptId FROM apiKeyAccounting')).toHaveLength(2);
      for (const h of handles) expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId])).toEqual({ state: 'settled', costNanoUsd: 200000 });
    } finally { release.resolve(); await observed; await Promise.all(owners); }
  });
  it('single-answer degradation creates a NEW attempt and cannot POST before its own intent delivery', async () => {
    const entered = deferred(), release = deferred(); const handles = [];
    const accounting = { ...context, async beforeAttempt(...args) {
      const h = await context.beforeAttempt(...args); handles.push(h);
      if (handles.length === 3) { entered.resolve(); await release.promise; } return h;
    } };
    network.mockImplementation(async (_url, options) => { const model = JSON.parse(options.body).model; return reply(model, model === 'fixture-b' ? 400 : 200); });
    const { observed, calls } = fusion(accounting);
    try {
    await waitBarrier(entered, observed);
    expect(calls).toHaveLength(3); expect(calls[2]).toMatchObject({ model: 'fixture-a', panel: false }); expect(network).toHaveBeenCalledTimes(2);
    expect(handles).toHaveLength(3); expect(new Set(handles.map(h => h.attemptId)).size).toBe(3);
    expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [handles[2].attemptId]).state).toBe('pending');
    for (const h of handles.slice(0, 2)) expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId]).state).toBe('settled');
    release.resolve(); expect((await (await resultOf(observed)).json()).choices[0].message.content).toBe('fixture-a'); expect(network).toHaveBeenCalledTimes(3);
    for (const h of handles) expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [h.attemptId])).toEqual({ state: 'settled', costNanoUsd: 200000 });
    } finally { release.resolve(); await observed; }
  });
});
