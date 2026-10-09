import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireWriterOwnership } from '@/lib/db/writerOwnership.js';
import { createNodeSqliteAdapter } from '@/lib/db/adapters/nodeSqliteAdapter.js';
import { createSqlJsAdapter } from '@/lib/db/adapters/sqljsAdapter.js';
import { runMigrationOnce } from '@/lib/db/migrate.js';
import { openAccountingCoverage } from '@/lib/db/accountingCoverage.js';
import { retainKeyBindings } from '@/lib/db/helpers/apiKeyBindings.js';
import { initializePoliciesOffline } from '@/lib/db/offlinePolicyInitialization.js';
import { createRequestAccounting } from '@/lib/apiKeyBudget/requestAccounting.js';
import { putPolicySync, finalizeAttemptSync, sumSpendSync } from '@/lib/db/repos/apiKeyAccountingRepo.js';
import { BaseExecutor } from '../../open-sse/executors/base.js';
import { BUDGET_ERROR } from '../../open-sse/config/apiKeyBudgetConstants.js';
const network = vi.hoisted(() => vi.fn());
vi.mock('../../open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => network(...args) }));
let directory, file, owner, db;
afterEach(() => { vi.restoreAllMocks(); db?.close(); owner?.release(); if (directory) fs.rmSync(directory, { recursive: true, force: true }); });
const open = engine => engine === 'node:sqlite' ? createNodeSqliteAdapter(file, owner) : createSqlJsAdapter(file, owner);
async function setup(engine) {
  network.mockReset(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-chat-ack-')); fs.mkdirSync(path.join(directory, 'db')); file = path.join(directory, 'db', 'data.sqlite');
  owner = acquireWriterOwnership(directory); db = await open(engine); await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner);
  db.durableTransaction(() => {
    db.run("INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES('ack-key','ack-fixture-secret',1,'2026-10-03T00:00:00.000Z')");
    retainKeyBindings(db, db.coverage, [{ id: 'ack-key', key: 'ack-fixture-secret' }]);
  });
  db.close(); db = null; owner.release(); owner = null;
  await initializePoliciesOffline({ directory, engine, actor: 'fixture', reason: 'ACK lifecycle fixture only' });
  owner = acquireWriterOwnership(directory); db = await open(engine); db.coverage = openAccountingCoverage(db, owner); db.ownerInstanceId = owner.instanceId;
  db.durableTransaction(() => {
    // Explicit disposable-fixture activation only. No production activation API.
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','openai',?)", [JSON.stringify({ 'ack-model': { input: '1', output: '2' } })]);
  });
  putPolicySync(db, 'ack-key', { weeklyLimitNanoUsd: '1000000000', monthlyLimitNanoUsd: null }, 0);
}
function inject(engine, installed) {
  if (engine === 'node:sqlite') {
    const original = DatabaseSync.prototype.exec; let injected = false;
    vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (sql) {
      if (!injected && sql.startsWith('RELEASE')) { injected = true; if (installed) original.call(this, sql); throw new Error('fixture settlement RELEASE ACK lost'); }
      return original.call(this, sql);
    });
  } else if (!installed) {
    const original = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (to === file) throw new Error('fixture settlement rename failed'); return original(from, to); });
  } else {
    const rename = fs.renameSync, sync = fs.fsyncSync; let renamed = false;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { const value = rename(from, to); if (to === file) renamed = true; return value; });
    vi.spyOn(fs, 'fsyncSync').mockImplementation(fd => { if (renamed && fs.fstatSync(fd).isDirectory()) throw new Error('fixture installed directory ACK lost'); return sync(fd); });
  }
}
describe('actual Base POST settlement ACK durability across owned adapters', { timeout: 20000 }, () => {
  it.each([['node:sqlite', false], ['node:sqlite', true], ['sql.js', false], ['sql.js', true]])('%s installed=%s never reports successful terminal after failed ACK', async (engine, installed) => {
    await setup(engine);
    const context = await createRequestAccounting(new Request('http://localhost/v1/chat/completions', { headers: { Authorization: 'Bearer ack-fixture-secret' } }), { adapter: async () => db });
    const complete = vi.fn((...args) => context.completeAttempt(...args));
    const accounting = { ...context, completeAttempt: complete };
    network.mockImplementation(async () => {
      expect(db.get('SELECT state FROM apiKeyAccounting').state).toBe('pending');
      inject(engine, installed);
      return Response.json({ choices: [{ message: { role: 'assistant', content: 'fixture' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } });
    });
    const executor = new BaseExecutor('openai', { baseUrl: 'http://fixture.invalid/chat', retry: { 502: { attempts: 2, delayMs: 0 } } });
    const retry = vi.spyOn(executor, 'shouldRetry');
    await expect(executor.execute({ model: 'ack-model', body: { messages: [{ role: 'user', content: 'fixture' }] }, stream: false, credentials: { apiKey: 'provider-fixture' }, accounting })).rejects.toMatchObject({ code: BUDGET_ERROR.UNAVAILABLE });
    expect(complete).toHaveBeenCalledTimes(1); expect(network).toHaveBeenCalledTimes(1); expect(retry).not.toHaveBeenCalled();
    expect(db.health().healthy).toBe(false); expect(() => context.gate()).toThrow();
    vi.restoreAllMocks(); db.close(); db = await open(engine); db.coverage = openAccountingCoverage(db, owner); db.ownerInstanceId = owner.instanceId;
    // Same owner remains live: this is installed-state inspection, NOT restart
    // adoption, dead-owner recovery, or a retrofit of the lost acknowledgement.
    expect(owner.recoveredOwnerInstanceId).toBeFalsy();
    const row = db.get('SELECT * FROM apiKeyAccounting');
    expect(row.state).toBe(installed ? 'settled' : 'pending'); expect(row.costNanoUsd).toBe(installed ? 200000 : null);
    expect(db.get('SELECT COUNT(*) AS n FROM usageHistory').n).toBe(0);
    if (installed) {
      const terminal = JSON.parse(row.terminalJson);
      expect(finalizeAttemptSync(db, row.attemptId, terminal).costNanoUsd).toBe('200000');
      expect(finalizeAttemptSync(db, row.attemptId, terminal).costNanoUsd).toBe('200000');
      expect(sumSpendSync(db, 'ack-key', '2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z')).toBe('200000');
      expect(db.get('SELECT COUNT(*) AS n FROM apiKeyAccounting').n).toBe(1);
    } else {
      expect(row.terminalJson).toBeNull(); expect(row.finishedAt).toBeNull(); expect(row.usageJson).toBeNull();
    }
  });
});
