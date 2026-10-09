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

// Adapter-owned fresh snapshot prerequisite only. This is NOT app dispatch,
// recovery/healing, a gap ACK or permission to bypass provider owner policy.
for (const engine of ['node:sqlite', 'sql.js']) describe(`unhealthy independently persisted pool proof ${engine}`, { timeout: 20000 }, () => {
  let dir, file, owner, db;
  const options = () => ({ credential: 'request-proof-dummy', provider: 'openai', model: 'fixture-model', connectionId: 'fixture-connection' });
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unhealthy-pool-proof-')); file = path.join(dir, 'data.sqlite'); owner = acquireWriterOwnership(dir);
    db = await (engine === 'sql.js' ? createSqlJsAdapter : createNodeSqliteAdapter)(file, owner); await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner);
    db.durableTransaction(() => {
      db.run("INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES('key-a','request-proof-dummy',1,'2026-10-03T00:00:00.000Z')");
      retainKeyBindings(db, db.coverage, [{ id: 'key-a', key: 'request-proof-dummy' }]);
      db.run('INSERT INTO settings(id,data) VALUES(1,?)', [JSON.stringify({ requireApiKey: true, fallbackStrategy: 'fill-first' })]);
      db.run('INSERT INTO providerConnections(id,provider,authType,priority,isActive,data,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)', ['fixture-connection', 'openai', 'apikey', 1, 1, JSON.stringify({ apiKey: 'dummy-upstream', testStatus: 'active', providerSpecificData: {} }), '2026-10-03T00:00:00.000Z', '2026-10-03T00:00:00.000Z']);
    });
    initializeExplicitPoliciesSync(db); db.durableTransaction(() => db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')"));
  });
  afterEach(() => { vi.restoreAllMocks(); db?.close(); owner?.release(); fs.rmSync(dir, { recursive: true, force: true }); });
  function poison(mutate = () => db.run("UPDATE apiKeys SET name='poisoned-ram-not-authority' WHERE id='key-a'")) {
    if (engine === 'sql.js') {
      const rename = fs.renameSync; vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (to === file) throw new Error('fixture poison'); return rename(from, to); });
    } else {
      const exec = DatabaseSync.prototype.exec; let injected = false; vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (sql) { if (!injected && sql.startsWith('RELEASE')) { injected = true; throw new Error('fixture poison'); } return exec.call(this, sql); });
    }
    expect(() => db.durableTransaction(mutate)).toThrow('fixture poison'); vi.restoreAllMocks(); expect(db.health().healthy).toBe(false);
  }
  const prove = input => db.provePersistedRequest(input || options(), db.coverage);
  function pool(data = { proxyUrl: 'http://pool.invalid:1234', noProxy: 'localhost', type: 'http', strictProxy: true }, active = 1) {
    db.durableTransaction(() => {
      db.run('INSERT INTO proxyPools(id,isActive,testStatus,data,createdAt,updatedAt) VALUES(?,?,?,?,?,?)', ['pool-a', active, 'active', JSON.stringify(data), '2026-10-03T00:00:00.000Z', '2026-10-03T00:00:00.000Z']);
      db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ apiKey: 'dummy-upstream', providerSpecificData: { proxyPoolId: 'pool-a' } }), 'fixture-connection']);
    });
  }
  it('pool comes from same independent persisted snapshot, never poisoned RAM/normal repo or implicit gap', () => {
    pool(); poison(() => db.run('UPDATE proxyPools SET data=? WHERE id=?', [JSON.stringify({ proxyUrl: 'http://poisoned.invalid:5678' }), 'pool-a']));
    const get = vi.spyOn(db, 'get'), all = vi.spyOn(db, 'all'); const result = prove();
    expect(result.proxyPool).toMatchObject({ id: 'pool-a', isActive: true, testStatus: 'active', proxyUrl: 'http://pool.invalid:1234', noProxy: 'localhost', strictProxy: true });
    expect(get).not.toHaveBeenCalled(); expect(all).not.toHaveBeenCalled(); expect(db.coverage.status().gaps).toEqual([]); expect(db.health().healthy).toBe(false);
  });
  it('pool row columns override shadow JSON and snapshot result is deeply immutable', () => {
    pool({ id: 'foreign', isActive: false, testStatus: 'foreign', createdAt: 'foreign', proxyUrl: 'http://pool.invalid:1234', nested: { a: [1] } }); poison();
    const result = prove(); expect(result.proxyPool).toMatchObject({ id: 'pool-a', isActive: true, testStatus: 'active', createdAt: '2026-10-03T00:00:00.000Z' });
    expect(Object.isFrozen(result.proxyPool.nested.a)).toBe(true); expect(() => { result.proxyPool.proxyUrl = 'foreign'; }).toThrow(); expect(prove().proxyPool.proxyUrl).toBe('http://pool.invalid:1234');
  });
  it.each(['missing', 'malformed', 'array'])('%s required pool is unavailable, never fallback to legacy/global', kind => {
    pool(); db.durableTransaction(() => { if (kind === 'missing') db.run("DELETE FROM proxyPools WHERE id='pool-a'"); else db.run("UPDATE proxyPools SET data=? WHERE id='pool-a'", [kind === 'array' ? '[]' : 'bad-json']); });
    poison(); expect(() => prove()).toThrow(/unavailable/); expect(db.coverage.status().gaps).toEqual([]);
  });
  it('inactive pool is accurately persisted config evidence, NOT provider/dispatch eligibility', () => {
    pool({ proxyUrl: 'http://pool.invalid:1234', strictProxy: true, isActive: true }, 0); poison(); expect(prove().proxyPool.isActive).toBe(false); expect(db.coverage.status().gaps).toEqual([]);
  });
  it.each([undefined, '__none__'])('explicit no pool %# returns null without reading unrelated broken pools', id => {
    pool(); db.durableTransaction(() => { db.run("UPDATE proxyPools SET data='bad-json'"); db.run('UPDATE providerConnections SET data=?', [JSON.stringify({ apiKey: 'dummy-upstream', providerSpecificData: { proxyPoolId: id } })]); });
    poison(); expect(prove().proxyPool).toBeNull(); expect(db.coverage.status().gaps).toEqual([]);
  });
  it('selected pool evidence survives normal persisted selection but is not a rotation grant', () => {
    pool(); poison(); const result = db.provePersistedSelection({ credential: 'request-proof-dummy', provider: 'openai', model: 'fixture-model', excludeConnectionIds: [] }, db.coverage);
    expect(result.proxyPool).toMatchObject({ id: 'pool-a', proxyUrl: 'http://pool.invalid:1234' }); expect(result.connection.id).toBe('fixture-connection'); expect(db.health().healthy).toBe(false); expect(db.coverage.status().gaps).toEqual([]);
  });
  it.each([42, {}, []])('malformed referenced pool ID %# cannot be coerced into authority', id => {
    pool(); db.durableTransaction(() => db.run('UPDATE providerConnections SET data=?', [JSON.stringify({ apiKey: 'dummy-upstream', providerSpecificData: { proxyPoolId: id } })])); poison(); expect(() => prove()).toThrow(/unavailable/); expect(db.coverage.status().gaps).toEqual([]);
  });
  it('trimmed pool ID resolves exact persisted row without creating a new identity', () => {
    pool(); db.durableTransaction(() => db.run('UPDATE providerConnections SET data=?', [JSON.stringify({ apiKey: 'dummy-upstream', providerSpecificData: { proxyPoolId: ' pool-a ' } })])); poison(); expect(prove().proxyPool.id).toBe('pool-a'); expect(db.coverage.status().gaps).toEqual([]);
  });
  it('malformed provider-specific config cannot skip required pool authority', () => {
    pool(); db.durableTransaction(() => db.run('UPDATE providerConnections SET data=?', [JSON.stringify({ apiKey: 'dummy-upstream', providerSpecificData: [] })])); poison(); expect(() => prove()).toThrow(/unavailable/); expect(db.coverage.status().gaps).toEqual([]);
  });
  it.each(['url', 'strict', 'active', 'missing', 'proof-failure'])('fresh pool %s change cannot reuse pinned request-context authority', async kind => {
    pool(); poison(); const req = new Request('http://localhost/v1/responses', { headers: { Authorization: 'Bearer request-proof-dummy' } });
    const context = await createRequestAccounting(req, { adapter: async () => db, persistedTarget: { provider: 'openai', model: 'fixture-model', connectionId: 'fixture-connection' }, persistedSelection: true });
    expect(context.gate().budgeted).toBe(false); const original = db.provePersistedSelection.bind(db);
    vi.spyOn(db, 'provePersistedSelection').mockImplementation((...args) => {
      if (kind === 'proof-failure') throw new Error('pool snapshot unavailable');
      const proof = original(...args); const changed = kind === 'missing' ? null : { ...proof.proxyPool, ...(kind === 'url' ? { proxyUrl: 'http://foreign.invalid:5678' } : kind === 'strict' ? { strictProxy: false } : { isActive: false }) };
      return { ...proof, proxyPool: changed };
    });
    expect(() => context.gate()).toThrow(); expect(() => context.beforeAttempt({ provider: 'openai', model: 'fixture-model', connectionId: 'fixture-connection' }, true)).toThrow();
    expect(db.coverage.status().gaps).toEqual([]); expect(db.health().healthy).toBe(false);
  });
  it('pool file-close acknowledgement loss refuses proof without healing', () => {
    pool(); poison(); const close = fs.closeSync; let failed = false;
    vi.spyOn(fs, 'closeSync').mockImplementation(fd => { close(fd); if (!failed) { failed = true; throw new Error('pool close acknowledgement lost'); } });
    expect(() => prove()).toThrow(/unavailable/); expect(db.health().healthy).toBe(false); expect(db.coverage.status().gaps).toEqual([]);
  });
  it('healthy or closed storage cannot grant unhealthy pool proof', () => {
    pool(); expect(() => prove()).toThrow(/unavailable/); db.close(); expect(() => prove()).toThrow(/unavailable/); expect(db.coverage.status().gaps).toEqual([]);
  });
  it('fsync failure rejects all pool authority rather than cached snapshot or healing', () => {
    pool(); poison(); vi.spyOn(fs, 'fsyncSync').mockImplementation(() => { throw new Error('pool fsync unavailable'); }); expect(() => prove()).toThrow(/unavailable/); expect(db.health().healthy).toBe(false);
  });
});
