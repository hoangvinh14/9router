import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DefaultExecutor } from 'open-sse/executors/default.js';
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
const timestamp = '2026-10-03T00:00:00.000Z';
const open = engine => engine === 'node:sqlite' ? createNodeSqliteAdapter(file, owner) : createSqlJsAdapter(file, owner);
const event = (type, value = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`;
const raw = event('message_start', { message: { type: 'message', role: 'assistant', id: 'fixture', model: 'fixture-oauth', content: [], usage: {
  input_tokens: 50, output_tokens: 0, cache_read_input_tokens: 40, cache_creation_input_tokens: 10,
  cache_creation: { ephemeral_5m_input_tokens: 5, ephemeral_1h_input_tokens: 5 }, server_tool_use: { web_search_requests: 0 },
} } }) + event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } }) + event('message_stop');
async function setup(engine, budgeted) {
  fixture.network.mockReset(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-oauth-uncertain-'));
  fs.mkdirSync(path.join(directory, 'db')); file = path.join(directory, 'db/data.sqlite'); owner = acquireWriterOwnership(directory);
  db = await open(engine); await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner); db.ownerInstanceId = owner.instanceId;
  db.durableTransaction(() => {
    db.run('INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES(?,?,1,?)', ['a', 'dummy-key-a', timestamp]);
    retainKeyBindings(db, db.coverage, [{ id: 'a', key: 'dummy-key-a' }]);
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt',?)", [timestamp]);
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','claude',?)", [JSON.stringify({ 'fixture-oauth': { input: '1', output: '2', cached: '0.1', cache_creation: '1.25', cache_creation_1h: '2' } })]);
    db.run('INSERT INTO settings(id,data) VALUES(1,?)', [JSON.stringify({ requireApiKey: true })]);
    db.run('INSERT INTO providerConnections(id,provider,authType,name,priority,isActive,data,createdAt,updatedAt) VALUES(?,?,?,?,?,1,?,?,?)',
      ['c', 'claude', 'oauth', 'fixture', 0, JSON.stringify({ accessToken: 'sk-ant-oat-dummy', refreshToken: 'dummy-refresh' }), timestamp, timestamp]);
  });
  if (budgeted) (await createBudgetContext('a', { adapter: async () => db })).updatePolicy({ weeklyLimitUsd: '1', monthlyLimitUsd: null, expectedVersion: 0 });
  coordinator = getAccountingWriteCoordinator(db);
  return createRequestAccounting(new Request('http://localhost/v1/messages', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true });
}
function inject(engine, installed) {
  if (engine === 'node:sqlite') {
    const original = DatabaseSync.prototype.exec; let releases = 0;
    vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function(sql) {
      if (sql.startsWith('RELEASE') && ++releases === 2) { if (installed) original.call(this, sql); throw new Error('fixture outer ACK unavailable'); }
      return original.call(this, sql);
    });
  } else if (!installed) {
    const rename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (to === file) throw new Error('fixture image install unavailable'); return rename(from, to); });
  } else {
    const rename = fs.renameSync, sync = fs.fsyncSync; let renamed = false;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { const result = rename(from, to); if (to === file) renamed = true; return result; });
    vi.spyOn(fs, 'fsyncSync').mockImplementation(fd => { if (renamed && fs.fstatSync(fd).isDirectory()) throw new Error('fixture directory ACK unavailable'); return sync(fd); });
  }
}
afterEach(async () => { vi.restoreAllMocks(); await coordinator?.stop(); db?.close(); owner?.release(); if (directory) fs.rmSync(directory, { recursive: true, force: true }); });
const cases = ['intent', 'terminal'].flatMap(stage => ['node:sqlite', 'sql.js'].flatMap(engine => [false, true].flatMap(installed => [false, true].map(budgeted => [stage, engine, installed, budgeted]))));
describe('OAuth real adapter ACK uncertainty (mock transport, same-owner inspection, not restart/powerloss)', { timeout: 20000 }, () => {
  it.each(cases)('%s %s installed=%s budgeted=%s cannot use installed row/gap as delivered own ACK', async (stage, engine, installed, budgeted) => {
    const context = await setup(engine, budgeted); let observed;
    const terminalObserved = new Promise(resolve => { observed = resolve; });
    const complete = vi.fn(async (...input) => {
      if (stage === 'terminal') inject(engine, installed);
      try { return await context.completeAttempt(...input); } finally { observed(); }
    });
    const accounting = { ...context, completeAttempt: complete, async beforeAttempt(...input) {
      const work = context.beforeAttempt(...input); if (stage === 'intent') inject(engine, installed); return work;
    } };
    fixture.network.mockImplementation(() => new Response(raw, { headers: { 'content-type': 'text/event-stream' } }));
    const work = new DefaultExecutor('claude').execute({ model: 'fixture-oauth', stream: true, accountingMode: 'native-claude-oauth-sse', connectionId: 'c', accounting,
      credentials: { accessToken: 'sk-ant-oat-dummy' }, body: { model: 'fixture-oauth', stream: true, max_tokens: 100,
        system: [{ type: 'text', text: 'original' }], messages: [{ role: 'user', content: 'fixture' }] } });
    if (stage === 'intent') await expect(work).rejects.toThrow();
    else { const result = await work; await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable'); await terminalObserved; }
    expect(fixture.network).toHaveBeenCalledTimes(stage === 'intent' ? 0 : 1); expect(complete).toHaveBeenCalledTimes(stage === 'intent' ? 0 : 1);
    expect(db.health()).toMatchObject({ healthy: false, poisoned: true });
    vi.restoreAllMocks(); await coordinator.stop(); db.close(); db = await open(engine);
    const rows = db.all('SELECT state,costNanoUsd FROM apiKeyAccounting');
    expect(rows).toEqual(stage === 'intent' ? installed ? [{ state: 'pending', costNanoUsd: null }] : []
      : installed ? [{ state: 'settled', costNanoUsd: 110250 }] : [{ state: 'pending', costNanoUsd: null }]);
    expect(owner.recoveredOwnerInstanceId).toBeFalsy(); expect(fixture.network).toHaveBeenCalledTimes(stage === 'intent' ? 0 : 1);
  });
});
