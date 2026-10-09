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
const seams = vi.hoisted(() => ({ core: vi.fn(), settings: vi.fn(), auth: vi.fn(), select: vi.fn(), model: vi.fn(), refresh: vi.fn(), cooldown: vi.fn() }));
vi.mock('@/lib/db/driver.js', () => ({ getAdapter: async () => globalThis.__unhealthyChatFixture }));
vi.mock('@/lib/localDb', () => ({ getSettings: (...args) => seams.settings(...args) }));
vi.mock('open-sse/handlers/chatCore.js', () => ({ handleChatCore: (...args) => seams.core(...args) }));
vi.mock('../../src/sse/services/model.js', () => ({ getModelInfo: (...args) => seams.model(...args), getComboModels: (...args) => seams.model(...args) }));
vi.mock('../../src/sse/services/auth.js', () => ({ extractApiKey: r => r.headers.get('Authorization')?.slice(7), isValidApiKey: (...args) => seams.auth(...args), getProviderCredentials: (...args) => seams.select(...args), markAccountUnavailable: (...args) => seams.cooldown(...args), clearAccountError: (...args) => seams.cooldown(...args) }));
vi.mock('../../src/sse/services/tokenRefresh.js', () => ({ checkAndRefreshToken: (...args) => seams.refresh(...args), updateProviderCredentials: (...args) => seams.refresh(...args) }));
vi.mock('../../src/sse/utils/logger.js', async original => ({ ...(await original()), debug() {}, info() {}, warn() {}, error() {} }));

// Actual route function + real poisoned storage + MOCKED core. This tests entry
// authority, not upstream/transport/EOF/actualHTTP provider certification.
for (const engine of ['node:sqlite', 'sql.js']) describe(`unhealthy app entry ${engine}`, { timeout: 20000 }, () => {
  let dir, owner, db, file;
  const body = () => ({ model: 'openai/fixture-model', input: 'fixture', stream: false });
  const request = (value = body(), url = '/v1/responses', credential = 'entry-dummy') => new Request('http://localhost' + url, { method: 'POST', headers: { Authorization: 'Bearer ' + credential }, body: JSON.stringify(value) });
  const handle = async req => (await import('../../src/sse/handlers/chat.js')).handleChat(req);
  beforeEach(async () => {
    vi.resetModules(); for (const fn of Object.values(seams)) { fn.mockReset(); fn.mockImplementation(() => { throw new Error('ordinary repo/core seam forbidden'); }); }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unhealthy-chat-entry-')); file = path.join(dir, 'data.sqlite'); owner = acquireWriterOwnership(dir);
    db = await (engine === 'sql.js' ? createSqlJsAdapter : createNodeSqliteAdapter)(file, owner); await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner); db.ownerInstanceId = owner.instanceId; globalThis.__unhealthyChatFixture = db;
    db.durableTransaction(() => {
      db.run("INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES('key-a','entry-dummy',1,'2026-10-03T00:00:00.000Z')"); retainKeyBindings(db, db.coverage, [{ id: 'key-a', key: 'entry-dummy' }]);
      db.run('INSERT INTO settings(id,data) VALUES(1,?)', [JSON.stringify({ requireApiKey: true, fallbackStrategy: 'fill-first' })]);
      db.run('INSERT INTO providerConnections(id,provider,authType,priority,isActive,data,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)', ['entry-connection', 'openai', 'apikey', 1, 1, JSON.stringify({ apiKey: 'upstream-dummy', providerSpecificData: {} }), '2026-10-03T00:00:00.000Z', '2026-10-03T00:00:00.000Z']);
    }); initializeExplicitPoliciesSync(db); db.durableTransaction(() => db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')"));
  });
  afterEach(() => { vi.restoreAllMocks(); db?.close(); owner?.release(); delete globalThis.__unhealthyChatFixture; fs.rmSync(dir, { recursive: true, force: true }); });
  function poison() {
    if (engine === 'sql.js') { const rename = fs.renameSync; vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (to === file) throw new Error('entry poison'); return rename(from, to); }); }
    else { const exec = DatabaseSync.prototype.exec; let injected = false; vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (sql) { if (!injected && sql.startsWith('RELEASE')) { injected = true; throw new Error('entry poison'); } return exec.call(this, sql); }); }
    expect(() => db.durableTransaction(() => db.run("UPDATE apiKeys SET name='not-persisted'"))).toThrow('entry poison'); vi.restoreAllMocks();
  }
  function untouched() { for (const key of ['settings', 'auth', 'select', 'model', 'refresh', 'cooldown']) expect(seams[key]).not.toHaveBeenCalled(); }
  it.each(['/v1/responses', '/api/v1/responses'])('persisted caller/settings/selection reach sole context at exact %s without ordinary repositories', async route => {
    poison(); const get = vi.spyOn(db, 'get'), all = vi.spyOn(db, 'all');
    seams.core.mockImplementation(async args => {
      expect(args.modelInfo).toEqual({ provider: 'openai', model: 'fixture-model' }); expect(args.credentials.apiKey).toBe('upstream-dummy'); expect(args.connectionId).toBe('entry-connection'); expect(args.body.input).toBe('fixture');
      expect(db.coverage.status().gaps).toEqual([]); const a = args.accounting.beforeAttempt({ provider: 'openai', model: 'fixture-model', connectionId: args.connectionId, endpoint: 'chat' }, true);
      expect(a.unrecorded).toBe(true); expect(a.requestId).toBe(args.accounting.requestId); expect(db.coverage.status().gaps).toHaveLength(1);
      args.accounting.assertSuccessfulTerminal(args.accounting.completeAttempt(a, { outcome: 'success' }));
      return { success: true, response: Response.json({ fixture: true }) };
    });
    const response = await handle(request(body(), route)); expect(response.status).toBe(200); expect(await response.json()).toEqual({ fixture: true }); expect(seams.core).toHaveBeenCalledTimes(1); untouched(); expect(get).not.toHaveBeenCalled(); expect(all).not.toHaveBeenCalled(); expect(db.health().healthy).toBe(false);
  });
  it.each(['unknown', 'budgeted', 'disabled', 'maintenance', 'round-robin', 'proxy-pool', 'oauth'])('%s refuses before core or gap instead of fallback/healing', async kind => {
    db.durableTransaction(() => {
      if (kind === 'budgeted') db.run('UPDATE apiKeyBudgetPolicies SET weeklyLimitNanoUsd=1,version=version+1');
      if (kind === 'disabled') db.run('UPDATE apiKeys SET isActive=0');
      if (kind === 'round-robin') db.run('UPDATE settings SET data=?', [JSON.stringify({ fallbackStrategy: 'round-robin' })]);
      if (kind === 'proxy-pool') db.run('UPDATE providerConnections SET data=?', [JSON.stringify({ apiKey: 'upstream-dummy', providerSpecificData: { proxyPoolId: 'unreadable-pool' } })]);
      if (kind === 'oauth') db.run("UPDATE providerConnections SET authType='oauth',data=?", [JSON.stringify({ accessToken: 'dummy-oauth' })]);
    }); poison(); if (kind === 'maintenance') db.coverage.enterMaintenance('entry maintenance');
    const response = await handle(request(body(), '/v1/responses', kind === 'unknown' ? 'unknown' : 'entry-dummy')); expect(response.status).toBe(503); expect((await response.json()).error.code).toMatch(/unavailable|unsupported/); expect(seams.core).not.toHaveBeenCalled(); untouched(); expect(db.coverage.status().gaps).toEqual([]);
  });
  it.each(['alias', 'combo', 'tools', 'implicit-stream', 'lookalike-route'])('%s original intent never strips into supported entry', async kind => {
    poison(); const value = body(); if (kind === 'alias') value.model = 'gpt-fixture'; if (kind === 'combo') value.model = 'combo-fixture'; if (kind === 'tools') value.tools = [{ type: 'web_search' }]; if (kind === 'implicit-stream') delete value.stream;
    const response = await handle(request(value, kind === 'lookalike-route' ? '/v1/responses/lookalike' : '/v1/responses')); expect(response.status).toBe(503); expect(seams.core).not.toHaveBeenCalled(); untouched(); expect(db.coverage.status().gaps).toEqual([]);
  });
  it('fresh per-POST selection failure after entry does not reuse earlier credentials or latch', async () => {
    poison(); const prove = db.provePersistedSelection.bind(db);
    seams.core.mockImplementation(async args => { vi.spyOn(db, 'provePersistedSelection').mockImplementation(() => { throw new Error('fresh selection lost'); }); args.accounting.beforeAttempt({ provider: 'openai', model: 'fixture-model', connectionId: 'entry-connection', endpoint: 'chat' }, true); return { success: true, response: Response.json({ incorrect: true }) }; });
    expect(prove({ credential: 'entry-dummy', provider: 'openai', model: 'fixture-model', excludeConnectionIds: [] }, db.coverage).connection.id).toBe('entry-connection');
    const response = await handle(request()); expect(response.status).toBe(503); expect(db.coverage.status().gaps).toEqual([]); untouched();
  });
});
