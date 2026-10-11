import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KiroExecutor } from 'open-sse/executors/kiro.js';
import { acquireWriterOwnership } from '@/lib/db/writerOwnership.js';
import { createNodeSqliteAdapter } from '@/lib/db/adapters/nodeSqliteAdapter.js';
import { createSqlJsAdapter } from '@/lib/db/adapters/sqljsAdapter.js';
import { runMigrationOnce } from '@/lib/db/migrate.js';
import { openAccountingCoverage } from '@/lib/db/accountingCoverage.js';
import { retainKeyBindings } from '@/lib/db/helpers/apiKeyBindings.js';
import { createRequestAccounting } from '@/lib/apiKeyBudget/requestAccounting.js';
import { createBudgetContext } from '@/lib/apiKeyBudget/service.js';
import { getAccountingWriteCoordinator } from '@/lib/apiKeyBudget/accountingWriteCoordinator.js';
import { concatFixtureBytes, fixtureKiroEvent } from '../helpers/accountingKiroFrames.js';
const fixture = vi.hoisted(() => ({ network: vi.fn() }));
vi.mock('open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => fixture.network(...args) }));
let directory, file, owner, db, coordinator;
const timestamp = '2026-10-03T00:00:00.000Z', model = 'claude-sonnet-4.5';
const open = engine => engine === 'node:sqlite' ? createNodeSqliteAdapter(file, owner) : createSqlJsAdapter(file, owner);
const body = () => ({ conversationState: { chatTriggerType: 'MANUAL', conversationId: '12345678-1234-4123-8123-123456789abc',
  currentMessage: { userInputMessage: { content: 'fixture prompt', modelId: model, origin: 'AI_EDITOR' } }, history: [] },
  inferenceConfig: { maxTokens: 100, temperature: 0.5, topP: 1 } });
async function setup(engine, budgeted = true) {
  fixture.network.mockReset(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-kiro-uncertain-'));
  fs.mkdirSync(path.join(directory, 'db')); file = path.join(directory, 'db/data.sqlite'); owner = acquireWriterOwnership(directory);
  db = await open(engine); await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner); db.ownerInstanceId = owner.instanceId;
  db.durableTransaction(() => {
    db.run('INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES(?,?,1,?)', ['a', 'dummy-key-a', timestamp]);
    retainKeyBindings(db, db.coverage, [{ id: 'a', key: 'dummy-key-a' }]);
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt',?)", [timestamp]);
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','kiro',?)", [JSON.stringify({ [model]: { input: '1', output: '2' } })]);
    db.run('INSERT INTO settings(id,data) VALUES(1,?)', [JSON.stringify({ requireApiKey: true })]);
    db.run('INSERT INTO providerConnections(id,provider,authType,name,priority,isActive,data,createdAt,updatedAt) VALUES(?,?,?,?,?,1,?,?,?)',
      ['c', 'kiro', 'apikey', 'fixture', 0, JSON.stringify({ apiKey: null, accessToken: 'dummy-provider', providerSpecificData: { authMethod: 'api_key', region: 'us-east-1' } }), timestamp, timestamp]);
  });
  const service = await createBudgetContext('a', { adapter: async () => db });
  if (budgeted) service.updatePolicy({ weeklyLimitUsd: '1', monthlyLimitUsd: null, expectedVersion: 0 });
  coordinator = getAccountingWriteCoordinator(db);
  return createRequestAccounting(new Request('http://localhost/v1/chat/completions', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true });
}
function inject(engine, installed) {
  if (engine === 'node:sqlite') {
    const original = DatabaseSync.prototype.exec; let releases = 0;
    vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function(sql) {
      // One member savepoint then the actual outer transaction release.
      if (sql.startsWith('RELEASE') && ++releases === 2) { if (installed) original.call(this, sql); throw new Error('Kiro outer terminal ACK unavailable'); }
      return original.call(this, sql);
    });
  } else if (!installed) {
    const rename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (to === file) throw new Error('Kiro terminal image install unavailable'); return rename(from, to); });
  } else {
    const rename = fs.renameSync, sync = fs.fsyncSync; let renamed = false;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { const result = rename(from, to); if (to === file) renamed = true; return result; });
    vi.spyOn(fs, 'fsyncSync').mockImplementation(fd => { if (renamed && fs.fstatSync(fd).isDirectory()) throw new Error('Kiro terminal directory ACK unavailable'); return sync(fd); });
  }
}
afterEach(async () => {
  vi.restoreAllMocks(); await coordinator?.stop(); db?.close(); owner?.release(); if (directory) fs.rmSync(directory, { recursive: true, force: true });
});
describe('Kiro real adapter uncertainty (native prefix and explicit buffered ellipsis repair; mock POST, no restart/powerloss authority)', { timeout: 20000 }, () => {
  it.each(['node:sqlite', 'sql.js'].flatMap(engine => [false, true].flatMap(installed => [1, 2].map(generation => [engine, installed, generation]))))('%s installed=%s unlimited intent%s gap-latch handle is never durable own intent permission', async (engine, installed, generation) => {
    const context = await setup(engine, false), handles = [], gapHandles = []; let intents = 0, injected = false;
    const authorize = vi.fn(value => context.assertSuccessfulTerminal(value)), complete = vi.fn((...input) => context.completeAttempt(...input));
    const accounting = { ...context, completeAttempt: complete, assertSuccessfulTerminal: authorize, async beforeAttempt(...input) {
      intents++; expect(db.health().healthy).toBe(true); expect(input[2].protocol).toBe('native-kiro');
      if (intents === 2) {
        expect(authorize).toHaveBeenCalledTimes(1); expect(complete).toHaveBeenCalledTimes(1);
        expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [handles[0].attemptId])).toEqual({ state: 'settled', costNanoUsd: 140000 });
        expect(input[2].kiroRepairCapture.original).toEqual(body());
      }
      const work = context.beforeAttempt(...input);
      if (intents === generation) { inject(engine, installed); injected = true; }
      const handle = await work;
      if (handle.unrecorded) gapHandles.push(handle); else handles.push(handle);
      return handle;
    } };
    fixture.network.mockImplementation(() => new Response(concatFixtureBytes([
      fixtureKiroEvent('assistantResponseEvent', { content: '...' }),
      fixtureKiroEvent('metricsEvent', { inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, reasoningTokens: 0 }),
      fixtureKiroEvent('messageStopEvent', { stopReason: 'end_turn' }),
    ]), { headers: { 'content-type': 'application/vnd.amazon.eventstream' } }));
    await expect(new KiroExecutor().execute({ model, stream: true, body: body(), accountingMode: 'native-kiro-ellipsis-repair', accounting, connectionId: 'c',
      credentials: { apiKey: null, accessToken: 'dummy-provider', connectionId: 'c', providerSpecificData: { authMethod: 'api_key', region: 'us-east-1' } } })).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    const fallback = engine === 'node:sqlite' || !installed;
    expect(injected).toBe(true); expect(gapHandles).toHaveLength(fallback ? 1 : 0); expect(handles).toHaveLength(generation - 1);
    for (const handle of gapHandles) { expect(handle.unrecorded).toBe(true); if (handles.length) expect(handle.attemptId).not.toBe(handles[0].attemptId); }
    expect(intents).toBe(generation); expect(fixture.network).toHaveBeenCalledTimes(generation - 1); expect(complete).toHaveBeenCalledTimes(generation - 1);
    expect(authorize).toHaveBeenCalledTimes(generation - 1); expect(db.health()).toMatchObject({ healthy: false, poisoned: true });
    expect(() => context.gate()).toThrow('API key accounting storage unavailable');
    vi.restoreAllMocks(); await coordinator.stop(); db.close(); db = await open(engine);
    // Same live owner row inspection: the independently ACKed gap is not an own intent ACK or recovery authority.
    if (generation === 2) expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [handles[0].attemptId])).toEqual({ state: 'settled', costNanoUsd: 140000 });
    const states = db.all('SELECT state,costNanoUsd FROM apiKeyAccounting');
    expect(states.filter(row => row.state === 'settled')).toHaveLength(generation - 1);
    expect(states.filter(row => row.state === 'pending')).toEqual(installed ? [{ state: 'pending', costNanoUsd: null }] : []);
    expect(states).toHaveLength(generation - 1 + (installed ? 1 : 0)); expect(owner.recoveredOwnerInstanceId).toBeFalsy();
    expect(fixture.network).toHaveBeenCalledTimes(generation - 1); expect(complete).toHaveBeenCalledTimes(generation - 1);
  });
  it.each(['node:sqlite', 'sql.js'].flatMap(engine => [false, true].flatMap(installed => ['intent1', 'completion1', 'intent2', 'completion2'].map(stage => [engine, installed, stage]))))('%s installed=%s repair %s withholds own ACK and never substitutes installed rows for permission', async (engine, installed, stage) => {
    const context = await setup(engine), handles = []; let intents = 0, completions = 0, injected = false;
    const authorize = vi.fn(value => context.assertSuccessfulTerminal(value));
    const accounting = { ...context, assertSuccessfulTerminal: authorize, async beforeAttempt(meta, supported, prepared) {
      intents++; expect(supported).toBe(true); expect(prepared.protocol).toBe('native-kiro');
      expect(db.health().healthy).toBe(true);
      if (intents === 2) {
        expect(handles).toHaveLength(1); expect(authorize).toHaveBeenCalledTimes(1);
        expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [handles[0].attemptId])).toEqual({ state: 'settled', costNanoUsd: 140000 });
        const expected = body(); expected.conversationState.currentMessage.userInputMessage.content += '\n\nRetry the previous response because it ended with only an ellipsis. Return the complete final answer, not only ... or ….';
        expect(prepared.kiroRepairCapture.actual).toEqual(expected); expect(JSON.parse(prepared.kiroTransport.serializedBody)).toEqual(expected);
      }
      const work = context.beforeAttempt(meta, supported, prepared);
      if (stage === `intent${intents}`) { inject(engine, installed); injected = true; }
      const handle = await work; expect(handle.unrecorded).toBeFalsy(); handles.push(handle); return handle;
    }, async completeAttempt(attempt, payload) {
      completions++; expect(payload).toMatchObject({ outcome: 'success', usage: { exact: true, input: 100, output: 20, cacheRead: 0, cacheWrite: 0, reasoning: 0 } });
      expect(attempt.attemptId).toBe(handles[completions - 1].attemptId);
      if (stage === `completion${completions}`) { inject(engine, installed); injected = true; }
      return context.completeAttempt(attempt, payload);
    } };
    fixture.network.mockImplementation((_url, init) => {
      const index = fixture.network.mock.calls.length - 1;
      expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [handles[index].attemptId])).toEqual({ state: 'pending' });
      if (index === 0) expect(JSON.parse(init.body)).toEqual(body());
      return new Response(concatFixtureBytes([
        fixtureKiroEvent('assistantResponseEvent', { content: index ? 'Fixture recovered answer.' : '...' }),
        fixtureKiroEvent('metricsEvent', { inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, reasoningTokens: 0 }),
        fixtureKiroEvent('messageStopEvent', { stopReason: 'end_turn' }),
      ]), { headers: { 'content-type': 'application/vnd.amazon.eventstream' } });
    });
    await expect(new KiroExecutor().execute({ model, stream: true, body: body(), accountingMode: 'native-kiro-ellipsis-repair', accounting, connectionId: 'c',
      credentials: { apiKey: null, accessToken: 'dummy-provider', connectionId: 'c', providerSpecificData: { authMethod: 'api_key', region: 'us-east-1' } } })).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    const successor = stage.endsWith('2'), failedCompletion = stage.startsWith('completion');
    expect(injected).toBe(true); expect(intents).toBe(successor ? 2 : 1); expect(completions).toBe((successor ? 1 : 0) + (failedCompletion ? 1 : 0));
    expect(fixture.network).toHaveBeenCalledTimes((successor ? 1 : 0) + (failedCompletion ? 1 : 0));
    expect(authorize).toHaveBeenCalledTimes(successor ? 1 : 0); expect(db.health()).toMatchObject({ healthy: false, poisoned: true });
    expect(() => context.gate()).toThrow('API key accounting storage unavailable');
    vi.restoreAllMocks(); await coordinator.stop(); db.close(); db = await open(engine);
    // Same live owner inspection only. No new context, delivered ACK, response, retry or recovered authority.
    if (successor) expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [handles[0].attemptId])).toEqual({ state: 'settled', costNanoUsd: 140000 });
    const states = db.all('SELECT state,costNanoUsd FROM apiKeyAccounting');
    expect(states.filter(row => row.state === 'settled')).toHaveLength((successor ? 1 : 0) + (failedCompletion && installed ? 1 : 0));
    expect(states.filter(row => row.state === 'pending')).toHaveLength(failedCompletion ? (installed ? 0 : 1) : (installed ? 1 : 0));
    expect(states).toHaveLength((successor ? 1 : 0) + (failedCompletion || installed ? 1 : 0));
    for (const row of states) expect(row.costNanoUsd).toBe(row.state === 'settled' ? 140000 : null);
    expect(owner.recoveredOwnerInstanceId).toBeFalsy(); expect(authorize).toHaveBeenCalledTimes(successor ? 1 : 0);
  });
  it.each(['node:sqlite', 'sql.js'].flatMap(engine => [false, true].map(installed => [engine, installed])))('%s installed=%s uncertain intent delivers no handle or POST even with installed pending row', async (engine, installed) => {
    const context = await setup(engine), complete = vi.fn(), authorize = vi.fn(); let preparedReached = false;
    const accounting = { ...context, completeAttempt: complete, assertSuccessfulTerminal: authorize,
      beforeAttempt(meta, supported, prepared) {
        expect(supported).toBe(true); expect(prepared.protocol).toBe('native-kiro');
        expect(JSON.parse(prepared.kiroTransport.serializedBody)).toEqual(body());
        expect(Object.isFrozen(prepared.credentials)).toBe(true);
        expect(db.health().healthy).toBe(true); expect(db.all('SELECT state FROM apiKeyAccounting')).toEqual([]);
        // Admit valid bounded original/wire before actual coordinator microtask.
        const work = context.beforeAttempt(meta, supported, prepared); preparedReached = true;
        inject(engine, installed); return work;
      } };
    await expect(new KiroExecutor().execute({ model, stream: true, body: body(), accountingMode: 'native-kiro-eventstream', accounting, connectionId: 'c',
      credentials: { apiKey: null, accessToken: 'dummy-provider', connectionId: 'c', providerSpecificData: { authMethod: 'api_key', region: 'us-east-1' } } })).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(preparedReached).toBe(true); expect(fixture.network).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled(); expect(authorize).not.toHaveBeenCalled();
    expect(db.health()).toMatchObject({ healthy: false, poisoned: true });
    expect(() => context.gate()).toThrow('API key accounting storage unavailable');
    vi.restoreAllMocks(); await coordinator.stop(); db.close(); db = await open(engine);
    // Same live owner installed inspection, never an inferred handle or restart permission.
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual(installed ? [{ state: 'pending', costNanoUsd: null }] : []);
    expect(owner.recoveredOwnerInstanceId).toBeFalsy(); expect(fixture.network).not.toHaveBeenCalled();
  });
  it.each(['node:sqlite', 'sql.js'].flatMap(engine => [false, true].map(installed => [engine, installed])))('%s installed=%s withholds own terminal ACK/authorization and poisons writer without regeneration', async (engine, installed) => {
    const context = await setup(engine); let report;
    const receipt = new Promise(resolve => { report = resolve; });
    const complete = vi.fn(async (attempt, payload) => {
      try { const value = await context.completeAttempt(attempt, payload); report({ status: 'resolved', value }); return value; }
      catch (error) { report({ status: 'rejected', code: error.code }); throw error; }
    });
    const authorize = vi.fn(value => context.assertSuccessfulTerminal(value));
    const prefix = fixtureKiroEvent('assistantResponseEvent', { content: 'fixture text' }); let upstream;
    fixture.network.mockImplementation((_url, init) => {
      expect(JSON.parse(init.body)).toEqual(body()); expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'pending', costNanoUsd: null }]);
      return new Response(new ReadableStream({ start(controller) { upstream = controller; controller.enqueue(prefix); } }), { headers: { 'content-type': 'application/vnd.amazon.eventstream' } });
    });
    const result = await new KiroExecutor().execute({ model, stream: true, body: body(), accountingMode: 'native-kiro-eventstream',
      accounting: { ...context, completeAttempt: complete, assertSuccessfulTerminal: authorize }, connectionId: 'c',
      credentials: { apiKey: null, accessToken: 'dummy-provider', connectionId: 'c', providerSpecificData: { authMethod: 'api_key', region: 'us-east-1' } } });
    const reader = result.response.body.getReader();
    try {
      expect((await reader.read()).value).toEqual(prefix); expect(db.health().healthy).toBe(true);
      inject(engine, installed);
      upstream.enqueue(concatFixtureBytes([
        fixtureKiroEvent('metricsEvent', { inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, reasoningTokens: 0 }),
        fixtureKiroEvent('messageStopEvent', { stopReason: 'end_turn' }),
      ])); upstream.close();
      await expect(reader.read()).rejects.toThrow('Gateway accounting stream unavailable');
      expect(await receipt).toEqual({ status: 'rejected', code: 'api_key_accounting_unavailable' });
      expect(complete).toHaveBeenCalledTimes(1); expect(authorize).not.toHaveBeenCalled(); expect(fixture.network).toHaveBeenCalledTimes(1);
      expect(db.health()).toMatchObject({ healthy: false, poisoned: true });
      expect(() => context.gate()).toThrow('API key accounting storage unavailable');
    } finally { try { upstream.close(); } catch { /* already closed */ } reader.releaseLock(); }
    vi.restoreAllMocks(); await coordinator.stop(); db.close(); db = await open(engine);
    // Same live owner read inspection only: installed rows do not recover delivered ACK or authorize a successor.
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual(installed ? [{ state: 'settled', costNanoUsd: 140000 }] : [{ state: 'pending', costNanoUsd: null }]);
    expect(owner.recoveredOwnerInstanceId).toBeFalsy(); expect(authorize).not.toHaveBeenCalled(); expect(complete).toHaveBeenCalledTimes(1);
  });
});
