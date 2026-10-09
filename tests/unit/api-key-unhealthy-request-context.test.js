import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSqlJsAdapter } from '@/lib/db/adapters/sqljsAdapter.js';
import { createNodeSqliteAdapter } from '@/lib/db/adapters/nodeSqliteAdapter.js';
import { acquireWriterOwnership } from '@/lib/db/writerOwnership.js';
import { runMigrationOnce } from '@/lib/db/migrate.js';
import { openAccountingCoverage } from '@/lib/db/accountingCoverage.js';
import { retainKeyBindings } from '@/lib/db/helpers/apiKeyBindings.js';
import { initializeExplicitPoliciesSync } from '../fixtures/legacy-policy-initialization.mjs';
import { createRequestAccounting } from '@/lib/apiKeyBudget/requestAccounting.js';
import { BUDGET_ERROR } from 'open-sse/config/apiKeyBudgetConstants.js';

// Request-context seam only, with explicit INTERNAL resolved target. Does not
// certify app routing/account-selection or actual provider dispatch on outage.
for (const engine of ['node:sqlite', 'sql.js']) describe(`unhealthy request accounting context ${engine}`, { timeout: 20000 }, () => {
  let dir, file, owner, db;
  const target = () => ({ provider: 'openai', model: 'fixture-model', connectionId: 'fixture-connection' });
  const request = headers => new Request('http://localhost/v1/chat/completions', { headers: { Authorization: 'Bearer context-dummy', ...headers } });
  const context = (req = request(), resolvedTarget = target()) => createRequestAccounting(req, { adapter: async () => db, persistedTarget: resolvedTarget });
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unhealthy-request-context-')); file = path.join(dir, 'data.sqlite'); owner = acquireWriterOwnership(dir);
    db = await (engine === 'sql.js' ? createSqlJsAdapter : createNodeSqliteAdapter)(file, owner); await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner); db.ownerInstanceId = owner.instanceId;
    db.durableTransaction(() => {
      db.run("INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES('key-a','context-dummy',1,'2026-10-03T00:00:00.000Z')"); retainKeyBindings(db, db.coverage, [{ id: 'key-a', key: 'context-dummy' }]);
      db.run('INSERT INTO settings(id,data) VALUES(1,?)', [JSON.stringify({ requireApiKey: true, fallbackStrategy: 'fill-first' })]);
      db.run('INSERT INTO providerConnections(id,provider,authType,priority,isActive,data,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)', ['fixture-connection', 'openai', 'apikey', 1, 1, JSON.stringify({ apiKey: 'dummy-upstream', providerSpecificData: {} }), '2026-10-03T00:00:00.000Z', '2026-10-03T00:00:00.000Z']);
    }); initializeExplicitPoliciesSync(db); db.durableTransaction(() => db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')"));
  });
  afterEach(() => { vi.restoreAllMocks(); db?.close(); owner?.release(); fs.rmSync(dir, { recursive: true, force: true }); });
  function poison() {
    if (engine === 'sql.js') { const rename = fs.renameSync; vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (to === file) throw new Error('context fixture poison'); return rename(from, to); }); }
    else { const exec = DatabaseSync.prototype.exec; let injected = false; vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (sql) { if (!injected && sql.startsWith('RELEASE')) { injected = true; throw new Error('context fixture poison'); } return exec.call(this, sql); }); }
    expect(() => db.durableTransaction(() => db.run("UPDATE apiKeys SET name='not-persisted'"))).toThrow('context fixture poison'); vi.restoreAllMocks();
  }
  it('original caller freshproof gates and durable gap before unique unrecorded attempt; one terminal context', async () => {
    poison(); const get = vi.spyOn(db, 'get'), prove = vi.spyOn(db, 'provePersistedRequest'); const c = await context();
    expect(c.gate()).toMatchObject({ budgeted: false }); expect(db.coverage.status().gaps).toEqual([]);
    const a = await c.beforeAttempt({ ...target(), endpoint: 'chat' }, true); expect(a).toMatchObject({ apiKeyId: 'key-a', unrecorded: true }); expect(a.requestId).toBe(c.requestId); expect(db.coverage.status().gaps).toHaveLength(1);
    const terminal = await c.completeAttempt(a, { outcome: 'success' }); expect(terminal).toMatchObject({ state: 'unresolved', unrecorded: true, costNanoUsd: null }); await c.assertSuccessfulTerminal(terminal);
    const b = await c.beforeAttempt({ ...target(), endpoint: 'chat' }, true); expect(b.attemptId).not.toBe(a.attemptId); expect(b.requestId).toBe(a.requestId); expect(prove.mock.calls.length).toBeGreaterThanOrEqual(5); expect(get).not.toHaveBeenCalled(); expect(db.health().healthy).toBe(false);
  });
  it.each(['unknown', 'lower-precedence', 'no-target'])('%s refuses before gap and never falls back to cached identity', async kind => {
    poison(); const req = kind === 'lower-precedence' ? request({ Authorization: 'Bearer unknown', 'x-api-key': 'context-dummy' }) : kind === 'unknown' ? request({ Authorization: 'Bearer unknown' }) : request();
    if (kind === 'no-target') await expect(createRequestAccounting(req, { adapter: async () => db })).rejects.toMatchObject({ code: BUDGET_ERROR.UNAVAILABLE });
    else await expect(context(req)).rejects.toMatchObject({ code: BUDGET_ERROR.UNAVAILABLE }); expect(db.coverage.status().gaps).toEqual([]);
  });
  it.each(['provider', 'model', 'connectionId', 'unsupported'])('%s cannot use verified unlimited caller to dispatch different/unsupported work', async kind => {
    poison(); const c = await context(), meta = { ...target(), endpoint: 'chat' }; if (kind !== 'unsupported') meta[kind] = 'foreign';
    await expect(Promise.resolve().then(() => c.beforeAttempt(meta, kind !== 'unsupported'))).rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED }); expect(db.coverage.status().gaps).toEqual([]);
    expect(() => c.assertSupported(false)).toThrow(/unsupported/);
  });
  it('request/target mutations during awaited context creation do not alter pinned authority', async () => {
    poison(); const req = request(), resolved = target(); const work = context(req, resolved); req.headers.set('Authorization', 'Bearer unknown'); resolved.model = 'foreign';
    const c = await work; expect(c.gate()).toMatchObject({ budgeted: false }); expect((await c.beforeAttempt({ ...target(), endpoint: 'chat' }, true)).unrecorded).toBe(true);
  });
  it('fresh per-attempt proof failure never uses earlier successful gate or creates gap', async () => {
    poison(); const c = await context(); c.gate(); vi.spyOn(db, 'provePersistedRequest').mockImplementation(() => { throw new Error('changed authority'); });
    expect(() => c.beforeAttempt({ ...target(), endpoint: 'chat' }, true)).toThrow(/unavailable/); expect(db.coverage.status().gaps).toEqual([]);
  });
  it('foreign proof connection mutation after first gate denies before durable admission', async () => {
    poison(); const c = await context(), original = db.provePersistedRequest.bind(db);
    vi.spyOn(db, 'provePersistedRequest').mockImplementation((...args) => { const proof = original(...args); return { ...proof, connection: { ...proof.connection, apiKey: 'foreign' } }; });
    expect(() => c.beforeAttempt({ ...target(), endpoint: 'chat' }, true)).toThrow(/unavailable/); expect(db.coverage.status().gaps).toEqual([]);
  });
  it('lost gap ACK never returns attempt handle or successful terminal', async () => {
    poison(); const c = await context(), latch = db.coverage.latchGap.bind(db.coverage);
    vi.spyOn(db.coverage, 'latchGap').mockImplementation((...args) => { latch(...args); throw new Error('lost ACK'); });
    expect(() => c.beforeAttempt({ ...target(), endpoint: 'chat' }, true)).toThrow(/unavailable/); expect(db.coverage.status().gaps).toHaveLength(1);
  });
  it.each(['absent', 'disabled', 'weekly', 'monthly', 'maintenance'])('%s authority denies before request context or gap', async kind => {
    if (kind === 'disabled') db.durableTransaction(() => db.run("UPDATE apiKeys SET isActive=0"));
    if (kind === 'weekly' || kind === 'monthly') db.durableTransaction(() => db.run(`UPDATE apiKeyBudgetPolicies SET ${kind}LimitNanoUsd='1',version=version+1`));
    poison(); if (kind === 'maintenance') db.coverage.enterMaintenance('context fixture maintenance');
    const req = kind === 'absent' ? new Request('http://localhost/v1/chat/completions') : request();
    await expect(context(req)).rejects.toMatchObject({ code: BUDGET_ERROR.UNAVAILABLE }); expect(db.coverage.status().gaps).toEqual([]);
  });
  it.each(['healthy', 'closed', 'maintenance'])('%s transition after request creation cannot reuse successful proof', async kind => {
    poison(); const c = await context(); c.gate();
    if (kind === 'closed') db.close();
    if (kind === 'healthy') vi.spyOn(db, 'health').mockReturnValue({ healthy: true, poisoned: false, closed: false });
    if (kind === 'maintenance') db.coverage.enterMaintenance('context fixture late maintenance');
    expect(() => c.beforeAttempt({ ...target(), endpoint: 'chat' }, true)).toThrow(/unavailable/);
    // The mock is only the authority-transition stimulus, not a healed writer.
    // Restore it before independently checking the sidecar's gap state.
    vi.restoreAllMocks(); expect(db.coverage.status().gaps).toEqual([]);
  });
  it('terminal authorization re-proves config after gap/terminal acknowledgement', async () => {
    poison(); const c = await context(), a = c.beforeAttempt({ ...target(), endpoint: 'chat' }, true), terminal = c.completeAttempt(a, { outcome: 'success' });
    vi.spyOn(db, 'provePersistedRequest').mockImplementation(() => { throw new Error('lost terminal config authority'); });
    expect(() => c.assertSuccessfulTerminal(terminal)).toThrow(/unavailable/); expect(db.health().healthy).toBe(false);
  });
  it('foreign attempt is rejected by the existing sole owner and creates no implicit terminal gap', async () => {
    poison(); const c = await context(), foreign = { attemptId: 'foreign', requestId: c.requestId, apiKeyId: 'key-a', unrecorded: true };
    expect(() => c.completeAttempt(foreign, { outcome: 'success' })).toThrow(/conflict/); expect(db.coverage.status().gaps).toEqual([]);
  });
  it('caller cancellation keeps exact false reason and produces no gap/admission', async () => {
    poison(); const caller = new AbortController(), req = new Request('http://localhost/v1/chat/completions', { headers: { Authorization: 'Bearer context-dummy' }, signal: caller.signal }); const c = await context(req); caller.abort(false);
    let denied = false;
    try { c.beforeAttempt({ ...target(), endpoint: 'chat' }, true); } catch (error) { denied = true; expect(error).toBe(false); }
    expect(denied).toBe(true);
    expect(db.coverage.status().gaps).toEqual([]);
  });
});
