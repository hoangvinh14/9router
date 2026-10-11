import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandCodeExecutor } from 'open-sse/executors/commandcode.js';
import { acquireWriterOwnership } from '@/lib/db/writerOwnership.js';
import { createNodeSqliteAdapter } from '@/lib/db/adapters/nodeSqliteAdapter.js';
import { createSqlJsAdapter } from '@/lib/db/adapters/sqljsAdapter.js';
import { runMigrationOnce } from '@/lib/db/migrate.js';
import { openAccountingCoverage } from '@/lib/db/accountingCoverage.js';
import { retainKeyBindings } from '@/lib/db/helpers/apiKeyBindings.js';
import { createRequestAccounting } from '@/lib/apiKeyBudget/requestAccounting.js';
import { getAccountingWriteCoordinator } from '@/lib/apiKeyBudget/accountingWriteCoordinator.js';
import { createBudgetContext } from '@/lib/apiKeyBudget/service.js';
const fixture = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => fixture.post(...args) }));
let directory, file, owner, db, coordinator;
const model = 'deepseek/deepseek-v4-pro', timestamp = '2026-10-03T00:00:00.000Z';
const open = engine => engine === 'node:sqlite' ? createNodeSqliteAdapter(file, owner) : createSqlJsAdapter(file, owner);
async function setup(engine) {
  fixture.post.mockReset(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-chat-commandcode-uncertain-'));
  fs.mkdirSync(path.join(directory, 'db')); file = path.join(directory, 'db/data.sqlite'); owner = acquireWriterOwnership(directory);
  db = await open(engine); await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner); db.ownerInstanceId = owner.instanceId;
  db.durableTransaction(() => {
    db.run('INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES(?,?,1,?)', ['a', 'dummy-key-a', timestamp]);
    retainKeyBindings(db, db.coverage, [{ id: 'a', key: 'dummy-key-a' }]);
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt',?)", [timestamp]);
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','commandcode',?)", [JSON.stringify({ [model]: { input: '1', output: '2' } })]);
    db.run('INSERT INTO settings(id,data) VALUES(1,?)', [JSON.stringify({ requireApiKey: true })]);
    db.run('INSERT INTO providerConnections(id,provider,authType,name,priority,isActive,data,createdAt,updatedAt) VALUES(?,?,?,?,?,1,?,?,?)',
      ['c', 'commandcode', 'apikey', 'fixture', 0, JSON.stringify({ apiKey: 'dummy-provider', providerSpecificData: {} }), timestamp, timestamp]);
  });
  coordinator = getAccountingWriteCoordinator(db);
  return createRequestAccounting(new Request('http://localhost/v1/chat/completions', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true });
}
function inject(engine, installed) {
  if (engine === 'node:sqlite') {
    const original = DatabaseSync.prototype.exec; let releases = 0;
    vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function(sql) {
      if (sql.startsWith('RELEASE') && ++releases === 2) { if (installed) original.call(this, sql); throw new Error('Chat CommandCode outer ACK unavailable'); }
      return original.call(this, sql);
    });
  } else if (!installed) {
    const rename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (to === file) throw new Error('Chat CommandCode image install unavailable'); return rename(from, to); });
  } else {
    const rename = fs.renameSync, sync = fs.fsyncSync; let renamed = false;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { const result = rename(from, to); if (to === file) renamed = true; return result; });
    vi.spyOn(fs, 'fsyncSync').mockImplementation(fd => { if (renamed && fs.fstatSync(fd).isDirectory()) throw new Error('Chat CommandCode directory ACK unavailable'); return sync(fd); });
  }
}
afterEach(async () => {
  vi.restoreAllMocks(); await coordinator?.stop(); db?.close(); owner?.release(); if (directory) fs.rmSync(directory, { recursive: true, force: true });
});
const cases = ['node:sqlite', 'sql.js'].flatMap(engine => [false, true].flatMap(installed => ['predecessor-completion', 'successor-intent'].map(stage => [engine, installed, stage])));
describe('actual Chat retry adapter uncertainty (mock POST, no powerloss/recovery/native TLS grant)', { timeout: 20000 }, () => {
  it.each(['node:sqlite', 'sql.js'].flatMap(engine => [false, true].flatMap(installed => ['first-intent', 'success-terminal'].map(stage => [engine, installed, stage]))))(
    '%s installed=%s budgeted %s uncertainty never releases POST or successful finish without own ACK', async (engine, installed, stage) => {
      const context = await setup(engine), policy = await createBudgetContext('a', { adapter: async () => db });
      policy.updatePolicy({ weeklyLimitUsd: '1', monthlyLimitUsd: '1', expectedVersion: 0 });
      let upstream, report; const receipt = new Promise(resolve => { report = resolve; });
      const encode = events => new TextEncoder().encode(events.map(event => JSON.stringify(event) + '\n').join(''));
      const before = vi.fn((...args) => {
        const pending = context.beforeAttempt(...args); if (stage === 'first-intent') inject(engine, installed); return pending;
      });
      const complete = vi.fn(async (...args) => {
        try { const terminal = await context.completeAttempt(...args); report({ terminal }); return terminal; }
        catch (error) { report({ code: error.code }); throw error; }
      });
      const authorize = vi.fn(value => context.assertSuccessfulTerminal(value));
      fixture.post.mockImplementation(() => new Response(new ReadableStream({ start(controller) {
        upstream = controller; controller.enqueue(encode([{ type: 'start' }, { type: 'start-step' }, { type: 'text-start', id: 'fixture' },
          { type: 'text-delta', id: 'fixture', text: 'fixture consumed text' }, { type: 'text-end', id: 'fixture' }]));
      } }), { headers: { 'content-type': 'application/x-ndjson' } }));
      const work = new CommandCodeExecutor().execute({ model, stream: true, connectionId: 'c', accountingMode: 'chat-commandcode-ndjson-retry',
        accounting: { ...context, beforeAttempt: before, completeAttempt: complete, assertSuccessfulTerminal: authorize },
        body: { model, stream: true, max_tokens: 64, temperature: 0.3, messages: [{ role: 'user', content: 'fixture prompt' }] },
        credentials: { apiKey: 'dummy-provider', connectionId: 'c', providerSpecificData: {} }, proxyOptions: null, providerOverrides: null });
      if (stage === 'first-intent') {
        await expect(work).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
        expect(fixture.post).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
      } else {
        const result = await work, reader = result.response.body.getReader(); let delivered = '';
        try {
          while (!delivered.includes('fixture consumed text')) { const chunk = await reader.read(); expect(chunk.done).toBe(false); delivered += new TextDecoder().decode(chunk.value); }
          expect(delivered).not.toContain('finish'); expect(complete).not.toHaveBeenCalled(); expect(db.health().healthy).toBe(true);
          inject(engine, installed);
          const usage = { inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 0, reasoningTokens: 0 };
          upstream.enqueue(encode([{ type: 'finish-step', finishReason: 'stop', usage }, { type: 'finish', finishReason: 'stop', totalUsage: usage }])); upstream.close();
          await expect((async () => { for (;;) { const chunk = await reader.read(); if (chunk.done) break; delivered += new TextDecoder().decode(chunk.value); } })()).rejects.toThrow('Gateway accounting stream unavailable');
          expect(delivered).not.toContain('finish'); expect(await receipt).toEqual({ code: 'api_key_accounting_unavailable' });
        } finally { reader.releaseLock(); try { upstream.close(); } catch { /* already closed */ } }
        expect(fixture.post).toHaveBeenCalledTimes(1); expect(complete).toHaveBeenCalledTimes(1);
      }
      expect(before).toHaveBeenCalledTimes(1); expect(authorize).not.toHaveBeenCalled(); expect(db.health()).toMatchObject({ healthy: false, poisoned: true });
      expect(() => context.gate()).toThrow('API key accounting storage unavailable');
      vi.restoreAllMocks(); await coordinator.stop(); db.close(); db = await open(engine);
      // Inspection under same live owner, not recovery or delivered ACK.
      expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual(stage === 'first-intent'
        ? installed ? [{ state: 'pending', outcome: null, costNanoUsd: null }] : []
        : installed ? [{ state: 'settled', outcome: 'success', costNanoUsd: 140000 }] : [{ state: 'pending', outcome: null, costNanoUsd: null }]);
      expect(owner.recoveredOwnerInstanceId).toBeFalsy(); expect(authorize).not.toHaveBeenCalled();
    });
  it.each(cases)('%s installed=%s %s withholds own handle and POST2', async (engine, installed, stage) => {
    const context = await setup(engine), attempts = [], gapHandles = []; let injected = false;
    const before = vi.fn((...args) => {
      expect(args[2].commandCodeChatCapture.actual.params.messages[0].content[0].text).toBe('fixture prompt');
      expect(Object.isFrozen(args[2].commandCodeChatCapture.original)).toBe(true);
      const work = context.beforeAttempt(...args);
      if (stage === 'successor-intent' && before.mock.calls.length === 2) { expect(db.health().healthy).toBe(true); inject(engine, installed); injected = true; }
      return work.then(attempt => { if (attempt.unrecorded) gapHandles.push(attempt); else attempts.push(attempt); return attempt; });
    });
    const complete = vi.fn((...args) => {
      if (stage === 'predecessor-completion') { expect(db.health().healthy).toBe(true); inject(engine, installed); injected = true; }
      return context.completeAttempt(...args);
    });
    const authorize = vi.fn();
    fixture.post.mockImplementation((_url, init) => {
      expect(JSON.parse(init.body).params.messages[0].content[0].text).toBe('fixture prompt');
      expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [attempts[0].attemptId])).toEqual({ state: 'pending' });
      return new Response(JSON.stringify({ type: 'error', error: { statusCode: 503, message: 'fixture initial error' } }) + '\n', { headers: { 'content-type': 'application/x-ndjson' } });
    });
    await expect(new CommandCodeExecutor().execute({ model, stream: true, connectionId: 'c', accountingMode: 'chat-commandcode-ndjson-retry',
      accounting: { ...context, beforeAttempt: before, completeAttempt: complete, assertSuccessfulTerminal: authorize },
      body: { model, stream: true, max_tokens: 64, temperature: 0.3, messages: [{ role: 'user', content: 'fixture prompt' }] },
      credentials: { apiKey: 'dummy-provider', connectionId: 'c', providerSpecificData: {} }, proxyOptions: null, providerOverrides: null })).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(injected).toBe(true); expect(attempts).toHaveLength(1);
    // Existing unlimited service may deliver its separately ACKed gap latch,
    // never a durable intent ACK. This owner must refuse it before fetch.
    const fallback = stage === 'successor-intent' && (engine === 'node:sqlite' || !installed);
    expect(gapHandles).toHaveLength(fallback ? 1 : 0);
    for (const handle of gapHandles) { expect(handle.unrecorded).toBe(true); expect(handle.attemptId).not.toBe(attempts[0].attemptId); }
    expect(before).toHaveBeenCalledTimes(stage === 'predecessor-completion' ? 1 : 2);
    expect(complete).toHaveBeenCalledTimes(1); expect(fixture.post).toHaveBeenCalledTimes(1); expect(authorize).not.toHaveBeenCalled();
    expect(db.health()).toMatchObject({ healthy: false, poisoned: true }); expect(() => context.gate()).toThrow('API key accounting storage unavailable');
    vi.restoreAllMocks(); await coordinator.stop(); db.close(); db = await open(engine);
    // Same LIVE owner row inspection, never handle reconstruction or restart.
    const predecessor = db.get('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [attempts[0].attemptId]);
    expect(predecessor).toEqual(stage === 'predecessor-completion' && !installed ? { state: 'pending', outcome: null, costNanoUsd: null } : { state: 'unresolved', outcome: 'failed', costNanoUsd: null });
    const successors = db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting WHERE attemptId<>?', [attempts[0].attemptId]);
    expect(successors).toEqual(stage === 'successor-intent' && installed ? [{ state: 'pending', outcome: null, costNanoUsd: null }] : []);
    expect(owner.recoveredOwnerInstanceId).toBeFalsy(); expect(fixture.post).toHaveBeenCalledTimes(1); expect(complete).toHaveBeenCalledTimes(1); expect(authorize).not.toHaveBeenCalled();
  });
});
