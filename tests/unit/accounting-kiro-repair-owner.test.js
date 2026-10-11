import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { KiroExecutor } from 'open-sse/executors/kiro.js';
import { concatFixtureBytes, fixtureKiroEvent } from '../helpers/accountingKiroFrames.js';
const fixture = vi.hoisted(() => ({ network: vi.fn() }));
vi.mock('open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => fixture.network(...args) }));
let standalone, db, directory, createAccounting;
beforeAll(async () => { ({ executeAccountedKiroEllipsisRepairCandidate: standalone } = await import('open-sse/executors/accountedKiroEllipsisRepair.js')); });
const execute = (executor, args) => executor.execute({ ...args, accountingMode: 'native-kiro-ellipsis-repair' });
const previous = process.env.DATA_DIR, model = 'claude-sonnet-4.5';
const instruction = 'Retry the previous response because it ended with only an ellipsis. Return the complete final answer, not only ... or ….';
const body = () => ({ conversationState: { chatTriggerType: 'MANUAL', conversationId: '12345678-1234-4123-8123-123456789abc',
  currentMessage: { userInputMessage: { content: 'fixture prompt', modelId: model, origin: 'AI_EDITOR' } }, history: [] },
  inferenceConfig: { maxTokens: 100, temperature: 0.5, topP: 1 } });
const options = accounting => ({ model, stream: true, body: body(), accounting, connectionId: 'c',
  credentials: { apiKey: null, accessToken: 'dummy-api-key', connectionId: 'c', providerSpecificData: { authMethod: 'api_key', region: 'us-east-1' } } });
const raw = text => concatFixtureBytes([fixtureKiroEvent('assistantResponseEvent', { content: text }),
  fixtureKiroEvent('metricsEvent', { inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, reasoningTokens: 0 }),
  fixtureKiroEvent('messageStopEvent', { stopReason: 'end_turn' })]);
beforeEach(async () => {
  vi.resetModules(); fixture.network.mockReset(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-kiro-repair-owner-')); process.env.DATA_DIR = directory; delete global._dbAdapter;
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }], settings: { requireApiKey: true },
    providerConnections: [{ id: 'c', provider: 'kiro', authType: 'apikey', apiKey: null, accessToken: 'dummy-api-key', providerSpecificData: { authMethod: 'api_key', region: 'us-east-1' } }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','kiro',?)", [JSON.stringify({ [model]: { input: '1', output: '2' } })]);
  });
  createAccounting = () => import('@/lib/apiKeyBudget/requestAccounting.js').then(({ createRequestAccounting }) => createRequestAccounting(
    new Request('http://localhost/v1/chat/completions', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true }));
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; if (directory) fs.rmSync(directory, { recursive: true, force: true }); if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous; });
describe('actual Kiro subclass queued native ellipsis owner (real ledger/mock POST, not legacy family/socket)', { timeout: 20000 }, () => {
  it('standalone omitted mode remains compatible for a genuine normal raw response', async () => {
    const context = await createAccounting();
    fixture.network.mockImplementation(() => new Response(raw('Fixture complete answer.'), { headers: { 'content-type': 'application/vnd.amazon.eventstream' } }));
    const result = await standalone(new KiroExecutor(), options(context));
    expect(new Uint8Array(await result.response.arrayBuffer())).toEqual(raw('Fixture complete answer.'));
    expect(fixture.network).toHaveBeenCalledTimes(1); expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 140000 }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['options-proxy', 'custom-prototype', 'body-getter', 'config-getter', 'signal-proxy', 'fake-signal'])('%s refuses actual subclass mode before programmable reads/admission/POST', async kind => {
    const context = await createAccounting(), before = vi.fn((...args) => context.beforeAttempt(...args)), complete = vi.fn((...args) => context.completeAttempt(...args));
    let args = { ...options({ ...context, beforeAttempt: before, completeAttempt: complete }), accountingMode: 'native-kiro-ellipsis-repair' }, reads = 0;
    const executor = new KiroExecutor(), trap = () => { reads++; throw new Error('fixture repair owner programmable read'); };
    if (kind === 'options-proxy') args = new Proxy(args, { get: trap, ownKeys: trap, getPrototypeOf: trap });
    if (kind === 'custom-prototype') Object.setPrototypeOf(args, { inherited: true });
    if (kind === 'body-getter') Object.defineProperty(args.body, 'conversationState', { enumerable: true, get: trap });
    if (kind === 'config-getter') { executor.config = structuredClone(executor.config); Object.defineProperty(executor.config, 'headers', { enumerable: true, get: trap }); }
    if (kind === 'signal-proxy') args.signal = new Proxy(new AbortController().signal, { get: trap, ownKeys: trap, getPrototypeOf: trap });
    if (kind === 'fake-signal') args.signal = { get aborted() { return trap(); }, throwIfAborted: trap };
    await expect(executor.execute(args)).rejects.toThrow();
    expect(reads).toBe(0); expect(before).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled(); expect(fixture.network).not.toHaveBeenCalled();
    expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('unrecorded gap-style admission handle is not own durable intent ACK and never dispatches or completes uncertain intent', async () => {
    const context = await createAccounting(), before = vi.fn(async () => ({ attemptId: 'fixture gap handle', unrecorded: true })), complete = vi.fn((...args) => context.completeAttempt(...args));
    await expect(execute(new KiroExecutor(), options({ ...context, beforeAttempt: before, completeAttempt: complete }))).rejects.toThrow('Accounting Kiro ellipsis owner unavailable');
    expect(before).toHaveBeenCalledTimes(1); expect(complete).not.toHaveBeenCalled(); expect(fixture.network).not.toHaveBeenCalled();
    expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('retains original whole body/credentials across two own admissions and settles original/fresh prices', async () => {
    const context = await createAccounting(), handles = [], wires = [], complete = vi.fn((...args) => context.completeAttempt(...args)); let args;
    const accounting = { ...context, completeAttempt: complete, async beforeAttempt(meta, supported, wire) {
      wires.push(wire); const handle = await context.beforeAttempt(meta, supported, wire); handles.push(handle);
      expect(handle.unrecorded).toBeFalsy(); expect(Object.isFrozen(wire.credentials.providerSpecificData)).toBe(true);
      args.body.conversationState.currentMessage.userInputMessage.content = 'caller mutation'; args.credentials.accessToken = 'caller mutation';
      return handle;
    } };
    args = options(accounting);
    fixture.network.mockImplementation((url, init, _proxy, contract) => {
      const index = fixture.network.mock.calls.length - 1;
      expect(url).toBe('https://q.us-east-1.amazonaws.com/generateAssistantResponse'); expect(init.redirect).toBe('error'); expect(contract.singlePost).toBe(true);
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer dummy-api-key');
      expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [handles[index].attemptId]).state).toBe('pending');
      const expected = body(); if (index) expected.conversationState.currentMessage.userInputMessage.content += '\n\n' + instruction;
      expect(JSON.parse(init.body)).toEqual(expected);
      if (!index) { expect(contract.kiroTransport).toBeDefined(); db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='kiro'", [JSON.stringify({ [model]: { input: '9', output: '9' } })])); }
      else { expect(contract.kiroRepairTransport).toEqual(wires[index]); expect(wires[index].kiroRepairCapture.actual).toEqual(expected); }
      return new Response(raw(index ? 'Fixture recovered answer.' : '...'), { headers: { 'content-type': 'application/vnd.amazon.eventstream' } });
    });
    const result = await execute(new KiroExecutor(), args);
    expect(new Uint8Array(await result.response.arrayBuffer())).toEqual(raw('Fixture recovered answer.'));
    expect(fixture.network).toHaveBeenCalledTimes(2); expect(complete).toHaveBeenCalledTimes(2); expect(handles).toHaveLength(2);
    expect(handles[0].attemptId).not.toBe(handles[1].attemptId); expect(wires[0].kiroTransport.invocationId).not.toBe(wires[1].kiroTransport.invocationId);
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [handles[0].attemptId])).toEqual({ state: 'settled', costNanoUsd: 140000 });
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [handles[1].attemptId])).toEqual({ state: 'settled', costNanoUsd: 1080000 });
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('installed predecessor settlement without delivered own ACK forbids second admission and POST', async () => {
    const context = await createAccounting(), before = vi.fn((...args) => context.beforeAttempt(...args)); let enter, release;
    const installed = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; }), lost = new Error('fixture lost Kiro repair owner predecessor handle');
    const complete = vi.fn(async (...args) => { await context.completeAttempt(...args); enter(); await held; throw lost; });
    fixture.network.mockImplementation(() => new Response(raw('...'), { headers: { 'content-type': 'application/vnd.amazon.eventstream' } }));
    let returned = false; const work = execute(new KiroExecutor(), options({ ...context, beforeAttempt: before, completeAttempt: complete }))
      .then(value => ({ value }), error => ({ error })).then(result => { returned = true; return result; });
    try {
      await installed; expect(returned).toBe(false); expect(before).toHaveBeenCalledTimes(1); expect(fixture.network).toHaveBeenCalledTimes(1);
      expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', outcome: 'success', costNanoUsd: 140000 }]);
    } finally { release(); }
    expect((await work).error).toBe(lost); expect(before).toHaveBeenCalledTimes(1); expect(fixture.network).toHaveBeenCalledTimes(1); expect(complete).toHaveBeenCalledTimes(1);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['deliver', 'lost', 'abort'])('successor own installed intent ACK %s controls POST2 independently', async mode => {
    const context = await createAccounting(), controller = new AbortController(), handles = [];
    let enter, release; const installed = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const lost = new Error('fixture lost Kiro repair owner successor intent handle');
    const before = vi.fn(async (...args) => {
      const handle = await context.beforeAttempt(...args); handles.push(handle);
      if (handles.length === 2) { enter(); await held; if (mode === 'lost') throw lost; }
      return handle;
    });
    const complete = vi.fn((...args) => context.completeAttempt(...args));
    fixture.network.mockImplementation(() => new Response(raw(fixture.network.mock.calls.length === 1 ? '...' : 'Fixture recovered answer.'), { headers: { 'content-type': 'application/vnd.amazon.eventstream' } }));
    let returned = false; const work = execute(new KiroExecutor(), { ...options({ ...context, beforeAttempt: before, completeAttempt: complete }), signal: controller.signal })
      .then(value => ({ value }), error => ({ error })).then(result => { returned = true; return result; });
    try {
      await installed; expect(returned).toBe(false); expect(before).toHaveBeenCalledTimes(2); expect(complete).toHaveBeenCalledTimes(1); expect(fixture.network).toHaveBeenCalledTimes(1);
      expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [handles[0].attemptId])).toEqual({ state: 'settled', costNanoUsd: 140000 });
      expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [handles[1].attemptId])).toEqual({ state: 'pending', costNanoUsd: null });
      if (mode === 'abort') controller.abort(false);
    } finally { release(); }
    const result = await work;
    if (mode === 'deliver') {
      expect(new Uint8Array(await result.value.response.arrayBuffer())).toEqual(raw('Fixture recovered answer.'));
      expect(fixture.network).toHaveBeenCalledTimes(2); expect(complete).toHaveBeenCalledTimes(2);
      expect(db.get('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [handles[1].attemptId])).toEqual({ state: 'settled', outcome: 'success', costNanoUsd: 140000 });
    } else {
      expect(result.error).toBe(mode === 'lost' ? lost : false); expect(fixture.network).toHaveBeenCalledTimes(1); expect(complete).toHaveBeenCalledTimes(mode === 'lost' ? 1 : 2);
      expect(db.get('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [handles[1].attemptId])).toEqual(mode === 'lost'
        ? { state: 'pending', outcome: null, costNanoUsd: null } : { state: 'not_dispatched', outcome: 'aborted', costNanoUsd: null });
    }
    expect(db.get('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [handles[0].attemptId])).toEqual({ state: 'settled', outcome: 'success', costNanoUsd: 140000 });
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('fresh persisted token rotation after predecessor ACK forbids successor admission without rebuilding retained credentials', async () => {
    const context = await createAccounting(), handles = [];
    const before = vi.fn(async (...args) => { const handle = await context.beforeAttempt(...args); handles.push(handle); return handle; });
    const complete = vi.fn(async (...args) => {
      const terminal = await context.completeAttempt(...args);
      db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']);
        db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(row.data), accessToken: 'dummy-rotated' }), 'c']); });
      return terminal;
    });
    fixture.network.mockImplementation(() => new Response(raw('...'), { headers: { 'content-type': 'application/vnd.amazon.eventstream' } }));
    await expect(execute(new KiroExecutor(), options({ ...context, beforeAttempt: before, completeAttempt: complete }))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(before).toHaveBeenCalledTimes(2); expect(handles).toHaveLength(1); expect(fixture.network).toHaveBeenCalledTimes(1); expect(complete).toHaveBeenCalledTimes(1);
    expect(db.all('SELECT attemptId,state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ attemptId: handles[0].attemptId, state: 'settled', costNanoUsd: 140000 }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('exact both-budget exhaustion after predecessor settlement forbids successor intent/POST2', async () => {
    const policy = await (await import('@/lib/apiKeyBudget/service.js')).createBudgetContext('a', { adapter: async () => db });
    policy.updatePolicy({ weeklyLimitUsd: '0.00014', monthlyLimitUsd: '0.00014', expectedVersion: 0 });
    const context = await createAccounting(), before = vi.fn((...args) => context.beforeAttempt(...args)), complete = vi.fn((...args) => context.completeAttempt(...args));
    fixture.network.mockImplementation(() => new Response(raw('...'), { headers: { 'content-type': 'application/vnd.amazon.eventstream' } }));
    await expect(execute(new KiroExecutor(), options({ ...context, beforeAttempt: before, completeAttempt: complete }))).rejects.toMatchObject({ code: 'api_key_budget_exceeded' });
    expect(before).toHaveBeenCalledTimes(1); expect(fixture.network).toHaveBeenCalledTimes(1); expect(complete).toHaveBeenCalledTimes(1);
    expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', outcome: 'success', costNanoUsd: 140000 }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['http503', 'missing-stop', 'terminal-refusal'])('%s records one unresolved attempt, never converts status/text/EOF into repair permission', async kind => {
    const context = await createAccounting(), before = vi.fn((...args) => context.beforeAttempt(...args)), complete = vi.fn((...args) => context.completeAttempt(...args));
    const bytes = kind === 'missing-stop' ? concatFixtureBytes([fixtureKiroEvent('assistantResponseEvent', { content: '...' }),
      fixtureKiroEvent('metricsEvent', { inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, reasoningTokens: 0 })])
      : concatFixtureBytes([fixtureKiroEvent('assistantResponseEvent', { content: 'Fixture refusal.' }), fixtureKiroEvent('messageStopEvent', { stopReason: 'content_filtered' })]);
    fixture.network.mockImplementation(() => kind === 'http503' ? new Response('fixture upstream unavailable', { status: 503 })
      : new Response(bytes, { headers: { 'content-type': 'application/vnd.amazon.eventstream' } }));
    const work = execute(new KiroExecutor(), options({ ...context, beforeAttempt: before, completeAttempt: complete }));
    if (kind === 'http503') { const result = await work; expect(result.response.status).toBe(503); expect(await result.response.text()).toBe('fixture upstream unavailable'); }
    else await expect(work).rejects.toThrow();
    expect(before).toHaveBeenCalledTimes(1); expect(fixture.network).toHaveBeenCalledTimes(1); expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][1]).toEqual({ usage: null, outcome: kind === 'http503' ? 'failed' : 'network_unknown' });
    expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', outcome: kind === 'http503' ? 'failed' : 'network_unknown', costNanoUsd: null }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('lost final own completion handle withholds recovered binary response without winner rewrite or third POST', async () => {
    const context = await createAccounting(), handles = []; let enter, release;
    const installed = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; }), lost = new Error('fixture lost Kiro repair final handle');
    const before = vi.fn(async (...args) => { const handle = await context.beforeAttempt(...args); handles.push(handle); return handle; });
    const complete = vi.fn(async (...args) => {
      const terminal = await context.completeAttempt(...args);
      if (args[0].attemptId === handles[1]?.attemptId) { enter(); await held; throw lost; }
      return terminal;
    });
    fixture.network.mockImplementation(() => new Response(raw(fixture.network.mock.calls.length === 1 ? '...' : 'Fixture recovered answer.'), { headers: { 'content-type': 'application/vnd.amazon.eventstream' } }));
    let returned = false; const work = execute(new KiroExecutor(), options({ ...context, beforeAttempt: before, completeAttempt: complete }))
      .then(value => ({ value }), error => ({ error })).then(result => { returned = true; return result; });
    try {
      await installed; expect(returned).toBe(false); expect(before).toHaveBeenCalledTimes(2); expect(fixture.network).toHaveBeenCalledTimes(2); expect(complete).toHaveBeenCalledTimes(2);
      for (const handle of handles) expect(db.get('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [handle.attemptId])).toEqual({ state: 'settled', outcome: 'success', costNanoUsd: 140000 });
    } finally { release(); }
    expect((await work).error).toBe(lost); expect(before).toHaveBeenCalledTimes(2); expect(fixture.network).toHaveBeenCalledTimes(2); expect(complete).toHaveBeenCalledTimes(2);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('post-invocation abort false records one unresolved terminal and cancels late body without repair', async () => {
    const context = await createAccounting(), controller = new AbortController(), complete = vi.fn((...args) => context.completeAttempt(...args));
    let enter, deliver, cleaned;
    const invoked = new Promise(resolve => { enter = resolve; }), late = new Promise(resolve => { deliver = resolve; }), cancelled = new Promise(resolve => { cleaned = resolve; });
    fixture.network.mockImplementation(() => { enter(); return late; });
    const work = execute(new KiroExecutor(), { ...options({ ...context, completeAttempt: complete }), signal: controller.signal }).then(value => ({ value }), error => ({ error }));
    await invoked; expect(db.all('SELECT state FROM apiKeyAccounting')).toEqual([{ state: 'pending' }]); controller.abort(false);
    expect((await work).error).toBe(false);
    const cancel = vi.fn(reason => { cleaned(reason); }); deliver(new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'application/vnd.amazon.eventstream' } }));
    expect(await cancelled).toBe(false); expect(cancel).toHaveBeenCalledTimes(1); expect(complete).toHaveBeenCalledTimes(1); expect(fixture.network).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][1]).toEqual({ usage: null, outcome: 'aborted' });
    expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', outcome: 'aborted', costNanoUsd: null }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('actual Kiro subclass request-local repair mode owns both POSTs without legacy integrity delegation', async () => {
    const context = await createAccounting(), complete = vi.fn((...args) => context.completeAttempt(...args)), handles = [];
    const before = vi.fn(async (...args) => { const handle = await context.beforeAttempt(...args); handles.push(handle); return handle; });
    fixture.network.mockImplementation(() => new Response(raw(fixture.network.mock.calls.length === 1 ? '...' : 'Fixture recovered answer.'), { headers: { 'content-type': 'application/vnd.amazon.eventstream' } }));
    const result = await new KiroExecutor().execute({ ...options({ ...context, beforeAttempt: before, completeAttempt: complete }), accountingMode: 'native-kiro-ellipsis-repair' });
    expect(new Uint8Array(await result.response.arrayBuffer())).toEqual(raw('Fixture recovered answer.'));
    expect(before).toHaveBeenCalledTimes(2); expect(complete).toHaveBeenCalledTimes(2); expect(fixture.network).toHaveBeenCalledTimes(2);
    expect(handles[0].attemptId).not.toBe(handles[1].attemptId);
    expect(JSON.parse(fixture.network.mock.calls[0][1].body)).toEqual(body());
    const expected = body(); expected.conversationState.currentMessage.userInputMessage.content += '\n\n' + instruction;
    expect(JSON.parse(fixture.network.mock.calls[1][1].body)).toEqual(expected);
    expect(fixture.network.mock.calls[1][3].kiroRepairTransport.kiroRepairCapture.actual).toEqual(expected);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual(Array.from({ length: 2 }, () => ({ state: 'settled', costNanoUsd: 140000 })));
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('actual subclass accounting mode getter refuses without executing programmable selection', async () => {
    const context = await createAccounting(), before = vi.fn((...args) => context.beforeAttempt(...args)), args = options({ ...context, beforeAttempt: before }); let reads = 0;
    Object.defineProperty(args, 'accountingMode', { enumerable: true, get() { reads++; throw new Error('fixture mode getter ran'); } });
    await expect(new KiroExecutor().execute(args)).rejects.toThrow();
    expect(reads).toBe(0); expect(before).not.toHaveBeenCalled(); expect(fixture.network).not.toHaveBeenCalled();
    expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('twice raw-accounted ellipsis owns both settlements then bounded refusal with no third generation or semantic leak', async () => {
    const context = await createAccounting(), complete = vi.fn((...args) => context.completeAttempt(...args));
    fixture.network.mockImplementation(() => new Response(raw('...'), { headers: { 'content-type': 'application/vnd.amazon.eventstream' } }));
    await expect(execute(new KiroExecutor(), options({ ...context, completeAttempt: complete }))).rejects.toThrow('kiro_ellipsis_retry_failed');
    expect(fixture.network).toHaveBeenCalledTimes(2); expect(complete).toHaveBeenCalledTimes(2);
    expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual(Array.from({ length: 2 }, () => ({ state: 'settled', outcome: 'success', costNanoUsd: 140000 })));
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
});
