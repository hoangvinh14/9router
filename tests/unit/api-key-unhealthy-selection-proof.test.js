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

// Persisted selection prerequisite only: canonical INTERNAL provider/model input,
// no aliases/combos, no dispatch, no support/price/proxy approval and no gap ACK.
// Round-robin needs durable updates and remains unavailable, never downgraded.
for (const engine of ['node:sqlite', 'sql.js']) describe(`unhealthy persisted selection ${engine}`, { timeout: 20000 }, () => {
  let dir, file, owner, db;
  const input = () => ({ credential: 'selection-dummy', provider: 'openai', model: 'fixture-model', excludeConnectionIds: [] });
  const prove = value => db.provePersistedSelection(value || input(), db.coverage);
  function addConnection(id, priority, data = {}, active = 1, provider = 'openai') {
    db.run('INSERT INTO providerConnections(id,provider,authType,priority,isActive,data,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)', [id, provider, 'apikey', priority, active, JSON.stringify({ apiKey: 'dummy-' + id, providerSpecificData: {}, ...data }), '2026-10-03T00:00:00.000Z', '2026-10-03T00:00:00.000Z']);
  }
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unhealthy-selection-proof-')); file = path.join(dir, 'data.sqlite'); owner = acquireWriterOwnership(dir);
    db = await (engine === 'sql.js' ? createSqlJsAdapter : createNodeSqliteAdapter)(file, owner); await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner);
    db.durableTransaction(() => {
      db.run("INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES('key-a','selection-dummy',1,'2026-10-03T00:00:00.000Z')"); retainKeyBindings(db, db.coverage, [{ id: 'key-a', key: 'selection-dummy' }]);
      db.run('INSERT INTO settings(id,data) VALUES(1,?)', [JSON.stringify({ requireApiKey: true, fallbackStrategy: 'fill-first' })]);
      addConnection('later', 5); addConnection('first', 1);
    }); initializeExplicitPoliciesSync(db); db.durableTransaction(() => db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')"));
  });
  afterEach(() => { vi.restoreAllMocks(); db?.close(); owner?.release(); fs.rmSync(dir, { recursive: true, force: true }); });
  function poison(mutate = () => db.run("UPDATE apiKeys SET name='not-persisted'")) {
    if (engine === 'sql.js') { const rename = fs.renameSync; vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (to === file) throw new Error('selection poison'); return rename(from, to); }); }
    else { const exec = DatabaseSync.prototype.exec; let injected = false; vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (sql) { if (!injected && sql.startsWith('RELEASE')) { injected = true; throw new Error('selection poison'); } return exec.call(this, sql); }); }
    expect(() => db.durableTransaction(mutate)).toThrow('selection poison'); vi.restoreAllMocks(); expect(db.health().healthy).toBe(false);
  }
  it('fresh persisted settings/caller/priority selection without any poisoned RAM or implicit gap', () => {
    poison(); const get = vi.spyOn(db, 'get'), all = vi.spyOn(db, 'all'); const p = prove();
    expect(p).toMatchObject({ apiKeyId: 'key-a', provider: 'openai', model: 'fixture-model', connection: { id: 'first', apiKey: 'dummy-first', priority: 1 }, settings: { fallbackStrategy: 'fill-first' } });
    expect(Object.isFrozen(p.connection)).toBe(true); expect(Object.isFrozen(p.settings)).toBe(true); expect(get).not.toHaveBeenCalled(); expect(all).not.toHaveBeenCalled(); expect(db.coverage.status().gaps).toEqual([]);
  });
  it.each(['disabled', 'model-locked', 'all-locked', 'excluded'])('%s retains normal availability filtering, never forces a connection', kind => {
    db.durableTransaction(() => {
      if (kind === 'disabled') db.run("UPDATE providerConnections SET isActive=0 WHERE id='first'");
      if (kind === 'model-locked' || kind === 'all-locked') db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ apiKey: 'dummy-first', 'modelLock_fixture-model': '2999-01-01T00:00:00.000Z' }), 'first']);
      if (kind === 'all-locked') db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ apiKey: 'dummy-later', 'modelLock_fixture-model': '2999-01-01T00:00:00.000Z' }), 'later']);
    }); poison(); const options = input(); if (kind === 'excluded') options.excludeConnectionIds = ['first'];
    if (kind === 'all-locked') expect(() => prove(options)).toThrow(/unavailable/);
    else expect(prove(options).connection.id).toBe('later'); expect(db.coverage.status().gaps).toEqual([]);
  });
  it.each(['global-round-robin', 'provider-round-robin', 'malformed-settings', 'malformed-connection', 'unknown-caller', 'budgeted', 'maintenance'])('%s denies instead of cache/healing/routing preference change', kind => {
    db.durableTransaction(() => {
      if (kind === 'global-round-robin') db.run('UPDATE settings SET data=?', [JSON.stringify({ fallbackStrategy: 'round-robin' })]);
      if (kind === 'provider-round-robin') db.run('UPDATE settings SET data=?', [JSON.stringify({ fallbackStrategy: 'fill-first', providerStrategies: { openai: { fallbackStrategy: 'round-robin' } } })]);
      if (kind === 'malformed-settings') db.run("UPDATE settings SET data='null'");
      if (kind === 'malformed-connection') db.run("UPDATE providerConnections SET data='[]' WHERE id='first'");
      if (kind === 'budgeted') db.run('UPDATE apiKeyBudgetPolicies SET weeklyLimitNanoUsd=1,version=version+1');
    }); poison(); if (kind === 'maintenance') db.coverage.enterMaintenance('selection fixture maintenance');
    const options = input(); if (kind === 'unknown-caller') options.credential = 'foreign'; expect(() => prove(options)).toThrow(/unavailable/); expect(db.coverage.status().gaps).toEqual([]);
  });
  it('poisoned priority/token/settings mutations never become persisted selection authority', () => {
    poison(() => { db.run("UPDATE providerConnections SET priority=0,data=? WHERE id='later'", [JSON.stringify({ apiKey: 'poisoned' })]); db.run('UPDATE settings SET data=?', [JSON.stringify({ fallbackStrategy: 'round-robin' })]); });
    expect(prove().connection.id).toBe('first'); expect(prove().connection.apiKey).toBe('dummy-first'); expect(prove().settings.fallbackStrategy).toBe('fill-first');
  });
  it('provider fill-first override remains effective even when global strategy is round-robin', () => {
    db.durableTransaction(() => db.run('UPDATE settings SET data=?', [JSON.stringify({ fallbackStrategy: 'round-robin', providerStrategies: { openai: { fallbackStrategy: 'fill-first' } } })]));
    poison(); expect(prove().connection.id).toBe('first');
  });
  it.each(['tie', 'zero', 'account-lock', 'expired-lock'])('%s matches ordinary priority and lock semantics', kind => {
    db.durableTransaction(() => {
      if (kind === 'tie') db.run('UPDATE providerConnections SET priority=1');
      if (kind === 'zero') db.run("UPDATE providerConnections SET priority=0 WHERE id='first'");
      if (kind === 'account-lock' || kind === 'expired-lock') db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ apiKey: 'dummy-first', modelLock___all: kind === 'account-lock' ? '2999-01-01T00:00:00.000Z' : '2000-01-01T00:00:00.000Z' }), 'first']);
    });
    // Capture only the normal repository's order while healthy, not credentials
    // as outage authority. Stable ties intentionally retain database row order.
    const order = db.all('SELECT * FROM providerConnections WHERE provider = ? AND isActive = ?', ['openai', 1]).sort((a, b) => (a.priority || 999) - (b.priority || 999));
    poison(); expect(prove().connection.id).toBe(kind === 'account-lock' ? 'later' : order[0].id); expect(db.coverage.status().gaps).toEqual([]);
  });
  it.each(['codex-enabled', 'codex-excluded'])('%s respects persisted Codex enabled-model filtering', kind => {
    db.durableTransaction(() => {
      db.run("UPDATE providerConnections SET provider='codex'");
      db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ accessToken: 'dummy-oauth', providerSpecificData: { enabledModels: ['other-model'] } }), 'first']);
      db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ accessToken: 'dummy-oauth', providerSpecificData: { enabledModels: ['fixture-model'] } }), 'later']);
    }); poison(); const options = { ...input(), provider: 'codex' }; if (kind === 'codex-excluded') options.excludeConnectionIds = ['later'];
    if (kind === 'codex-excluded') expect(() => prove(options)).toThrow(/unavailable/);
    else expect(prove(options).connection.id).toBe('later'); expect(db.coverage.status().gaps).toEqual([]);
  });
  it.each(['foreign-provider', 'malformed-exclusions', 'all-excluded', 'missing-settings', 'malformed-overrides', 'malformed-override'])('%s denies before selection evidence or gap', kind => {
    db.durableTransaction(() => {
      if (kind === 'missing-settings') db.run('DELETE FROM settings');
      if (kind === 'malformed-overrides') db.run('UPDATE settings SET data=?', [JSON.stringify({ providerStrategies: [] })]);
      if (kind === 'malformed-override') db.run('UPDATE settings SET data=?', [JSON.stringify({ providerStrategies: { openai: [] } })]);
    }); poison(); const options = input();
    if (kind === 'foreign-provider') options.provider = 'unverified';
    if (kind === 'malformed-exclusions') options.excludeConnectionIds = ['first', null];
    if (kind === 'all-excluded') options.excludeConnectionIds = ['first', 'later'];
    expect(() => prove(options)).toThrow(/unavailable/); expect(db.coverage.status().gaps).toEqual([]);
  });
  it('coverage generation race cannot combine caller/selection evidence from different authority', () => {
    poison(); const status = db.coverage.status.bind(db.coverage); let reads = 0;
    vi.spyOn(db.coverage, 'status').mockImplementation(id => { const s = status(id); return { ...s, generation: s.generation + (reads++ > 1 ? 1 : 0) }; });
    expect(() => prove()).toThrow(/unavailable/); expect(db.coverage.status().gaps).toEqual([]);
  });
  it('reader close acknowledgement failure denies selected credentials without restoring writer', () => {
    poison(); const close = fs.closeSync; let failed = false;
    vi.spyOn(fs, 'closeSync').mockImplementation(fd => { close(fd); if (!failed) { failed = true; throw new Error('selection close acknowledgement'); } });
    expect(() => prove()).toThrow(/unavailable/); expect(db.health().healthy).toBe(false); expect(db.coverage.status().gaps).toEqual([]);
  });
  it('healthy and closed adapters refuse unhealthy selection exception', () => {
    expect(() => prove()).toThrow(/unavailable/); db.close(); expect(() => prove()).toThrow(/unavailable/); expect(db.coverage.status().gaps).toEqual([]);
  });
  it('failed new fsync denies even after a previous successful independently persisted selection', () => {
    poison(); expect(prove().connection.id).toBe('first'); vi.spyOn(fs, 'fsyncSync').mockImplementation(() => { throw new Error('new durability failure'); });
    expect(() => prove()).toThrow(/unavailable/); expect(db.health().healthy).toBe(false); expect(db.coverage.status().gaps).toEqual([]);
  });
});
