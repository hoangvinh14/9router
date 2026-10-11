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
import { createBudgetContext } from '@/lib/apiKeyBudget/service.js';
import { getAccountingWriteCoordinator } from '@/lib/apiKeyBudget/accountingWriteCoordinator.js';
const fixture = vi.hoisted(() => ({ network: vi.fn() }));
vi.mock('open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => fixture.network(...args) }));
let directory, file, owner, db, coordinator;
const timestamp = '2026-10-03T00:00:00.000Z', model = 'deepseek/deepseek-v4-pro';
const open = engine => engine === 'node:sqlite' ? createNodeSqliteAdapter(file, owner) : createSqlJsAdapter(file, owner);
const body = () => ({ threadId: '11111111-1111-4111-8111-111111111111', memory: '',
  config: { workingDir: '/fixture/workspace', date: '2026-10-10', environment: 'linux', structure: [], isGitRepo: false, currentBranch: '', mainBranch: '', gitStatus: '', recentCommits: [] },
  params: { model, stream: true, max_tokens: 64, temperature: 0.3, messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture prompt' }] }] } });
const options = accounting => ({ model, stream: true, body: body(), accountingMode: 'native-commandcode-ndjson', accounting, connectionId: 'c',
  credentials: { apiKey: 'dummy-provider', connectionId: 'c', providerSpecificData: {} } });
const encode = events => new TextEncoder().encode(events.map(event => JSON.stringify(event) + '\n').join(''));
const prefix = () => encode([{ type: 'start' }, { type: 'start-step' }, { type: 'text-start', id: 'text_fixture' },
  { type: 'text-delta', id: 'text_fixture', text: 'fixture text' }, { type: 'text-end', id: 'text_fixture' }]);
const usage = () => ({ inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 0, reasoningTokens: 0 });
async function setup(engine) {
  fixture.network.mockReset(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-commandcode-uncertain-'));
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
  const service = await createBudgetContext('a', { adapter: async () => db });
  service.updatePolicy({ weeklyLimitUsd: '1', monthlyLimitUsd: null, expectedVersion: 0 });
  coordinator = getAccountingWriteCoordinator(db);
  return createRequestAccounting(new Request('http://localhost/v1/chat/completions', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true });
}
function inject(engine, installed) {
  if (engine === 'node:sqlite') {
    const original = DatabaseSync.prototype.exec; let releases = 0;
    vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function(sql) {
      // Single member savepoint then outer release; do not simulate via a service throw.
      if (sql.startsWith('RELEASE') && ++releases === 2) { if (installed) original.call(this, sql); throw new Error('CommandCode outer ACK unavailable'); }
      return original.call(this, sql);
    });
  } else if (!installed) {
    const rename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (to === file) throw new Error('CommandCode image install unavailable'); return rename(from, to); });
  } else {
    const rename = fs.renameSync, sync = fs.fsyncSync; let renamed = false;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { const result = rename(from, to); if (to === file) renamed = true; return result; });
    vi.spyOn(fs, 'fsyncSync').mockImplementation(fd => { if (renamed && fs.fstatSync(fd).isDirectory()) throw new Error('CommandCode directory ACK unavailable'); return sync(fd); });
  }
}
afterEach(async () => {
  vi.restoreAllMocks(); await coordinator?.stop(); db?.close(); owner?.release(); if (directory) fs.rmSync(directory, { recursive: true, force: true });
});
describe('CommandCode actual adapter uncertainty (mock POST, no legacy retry/restart/powerloss authority)', { timeout: 20000 }, () => {
  it.each(['node:sqlite', 'sql.js'].flatMap(engine => [false, true].map(installed => [engine, installed])))('%s installed=%s uncertain intent delivers no handle or POST', async (engine, installed) => {
    const context = await setup(engine), complete = vi.fn(), authorize = vi.fn(); let preparedReached = false;
    const accounting = { ...context, completeAttempt: complete, assertSuccessfulTerminal: authorize,
      beforeAttempt(meta, supported, prepared) {
        expect(supported).toBe(true); expect(prepared.protocol).toBe('native-commandcode');
        expect(JSON.parse(prepared.commandCodeTransport.serializedBody)).toEqual(body()); expect(Object.isFrozen(prepared.credentials)).toBe(true);
        expect(db.health().healthy).toBe(true); expect(db.all('SELECT state FROM apiKeyAccounting')).toEqual([]);
        const work = context.beforeAttempt(meta, supported, prepared); preparedReached = true;
        inject(engine, installed); return work;
      } };
    await expect(new CommandCodeExecutor().execute(options(accounting))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(preparedReached).toBe(true); expect(fixture.network).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled(); expect(authorize).not.toHaveBeenCalled();
    expect(db.health()).toMatchObject({ healthy: false, poisoned: true }); expect(() => context.gate()).toThrow('API key accounting storage unavailable');
    vi.restoreAllMocks(); await coordinator.stop(); db.close(); db = await open(engine);
    // Same live owner inspection only; installed intent does not grant its handle.
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual(installed ? [{ state: 'pending', costNanoUsd: null }] : []);
    expect(owner.recoveredOwnerInstanceId).toBeFalsy(); expect(fixture.network).not.toHaveBeenCalled();
  });
  it.each(['node:sqlite', 'sql.js'].flatMap(engine => [false, true].map(installed => [engine, installed])))('%s installed=%s withholds terminal ACK/authorization after actual consumer text prefix', async (engine, installed) => {
    const context = await setup(engine); let report, upstream;
    const receipt = new Promise(resolve => { report = resolve; });
    const complete = vi.fn(async (attempt, payload) => {
      try { const value = await context.completeAttempt(attempt, payload); report({ status: 'resolved', value }); return value; }
      catch (error) { report({ status: 'rejected', code: error.code }); throw error; }
    });
    const authorize = vi.fn(value => context.assertSuccessfulTerminal(value));
    fixture.network.mockImplementation((_url, init) => {
      expect(JSON.parse(init.body)).toEqual(body()); expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'pending', costNanoUsd: null }]);
      return new Response(new ReadableStream({ start(controller) { upstream = controller; controller.enqueue(prefix()); } }), { headers: { 'content-type': 'application/x-ndjson' } });
    });
    const result = await new CommandCodeExecutor().execute(options({ ...context, completeAttempt: complete, assertSuccessfulTerminal: authorize }));
    const reader = result.response.body.getReader(); let delivered = '';
    try {
      // A line parser may emit one chunk per event. Read through actual delta,
      // never use upstream pull/enqueue as evidence of consumer delivery.
      while (!delivered.includes('text-delta')) { const chunk = await reader.read(); expect(chunk.done).toBe(false); delivered += new TextDecoder().decode(chunk.value); }
      expect(delivered).toContain('fixture text'); expect(delivered).not.toContain('finish'); expect(db.health().healthy).toBe(true);
      inject(engine, installed);
      upstream.enqueue(encode([{ type: 'finish-step', finishReason: 'stop', usage: usage() }, { type: 'finish', finishReason: 'stop', totalUsage: usage() }])); upstream.close();
      await expect((async () => { for (;;) { const chunk = await reader.read(); if (chunk.done) break; delivered += new TextDecoder().decode(chunk.value); } })()).rejects.toThrow('Gateway accounting stream unavailable');
      expect(delivered).not.toContain('finish'); expect(await receipt).toEqual({ status: 'rejected', code: 'api_key_accounting_unavailable' });
      expect(complete).toHaveBeenCalledTimes(1); expect(authorize).not.toHaveBeenCalled(); expect(fixture.network).toHaveBeenCalledTimes(1);
      expect(db.health()).toMatchObject({ healthy: false, poisoned: true }); expect(() => context.gate()).toThrow('API key accounting storage unavailable');
    } finally { try { upstream.close(); } catch { /* closed */ } reader.releaseLock(); }
    vi.restoreAllMocks(); await coordinator.stop(); db.close(); db = await open(engine);
    // Rows are inspected, not re-used as delivered ACK or successor permission.
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual(installed ? [{ state: 'settled', costNanoUsd: 140000 }] : [{ state: 'pending', costNanoUsd: null }]);
    expect(owner.recoveredOwnerInstanceId).toBeFalsy(); expect(authorize).not.toHaveBeenCalled(); expect(complete).toHaveBeenCalledTimes(1);
  });
});
