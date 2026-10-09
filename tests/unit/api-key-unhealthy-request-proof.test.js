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
import { extractGatewayCredential } from '@/lib/apiKeyBudget/identity.js';

// Adapter-owned fresh snapshot prerequisite only. This is NOT app dispatch,
// recovery/healing, a gap ACK or permission to bypass provider owner policy.
for (const engine of ['node:sqlite', 'sql.js']) describe(`unhealthy caller+upstream persisted request proof ${engine}`, { timeout: 20000 }, () => {
  let dir, file, owner, db;
  const options = () => ({ credential: 'request-proof-dummy', provider: 'openai', model: 'fixture-model', connectionId: 'fixture-connection' });
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unhealthy-request-proof-')); file = path.join(dir, 'data.sqlite'); owner = acquireWriterOwnership(dir);
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
  it('fresh persisted caller, explicit unlimited, settings and exact active connection; no RAM or implicit gap', () => {
    poison(); const get = vi.spyOn(db, 'get');
    expect(prove()).toMatchObject({ apiKeyId: 'key-a', policyVersion: 0, ledgerStartedAt: '2026-10-03T00:00:00.000Z', settings: { requireApiKey: true, fallbackStrategy: 'fill-first' }, connection: { id: 'fixture-connection', provider: 'openai', authType: 'apikey', apiKey: 'dummy-upstream' } });
    expect(get).not.toHaveBeenCalled(); expect(db.coverage.status().gaps).toEqual([]); expect(db.health().healthy).toBe(false); expect(() => db.get('SELECT * FROM apiKeys')).toThrow(/unhealthy/);
  });
  it.each(['unknown', 'absent', 'wrong-provider', 'wrong-connection'])('%s never grants authority or creates gap', kind => {
    poison(); const input = options(); if (kind === 'unknown') input.credential = 'unknown'; if (kind === 'absent') input.credential = null; if (kind === 'wrong-provider') input.provider = 'codex'; if (kind === 'wrong-connection') input.connectionId = 'foreign';
    expect(() => prove(input)).toThrow(/unavailable/); expect(db.coverage.status().gaps).toEqual([]);
  });
  it.each(['disabled-key', 'budgeted-key', 'disabled-connection', 'malformed-settings', 'malformed-connection'])('persisted %s denies without cached policy/config', kind => {
    db.durableTransaction(() => {
      if (kind === 'disabled-key') db.run("UPDATE apiKeys SET isActive=0 WHERE id='key-a'");
      if (kind === 'budgeted-key') db.run("UPDATE apiKeyBudgetPolicies SET weeklyLimitNanoUsd=1 WHERE apiKeyId='key-a'");
      if (kind === 'disabled-connection') db.run("UPDATE providerConnections SET isActive=0 WHERE id='fixture-connection'");
      if (kind === 'malformed-settings') db.run("UPDATE settings SET data='not-json' WHERE id=1");
      if (kind === 'malformed-connection') db.run("UPDATE providerConnections SET data='[]' WHERE id='fixture-connection'");
    }); poison(); expect(() => prove()).toThrow(/unavailable/); expect(db.coverage.status().gaps).toEqual([]);
  });
  it('higher-precedence unknown Bearer cannot authenticate lower valid gateway key', () => {
    poison(); const request = new Request('http://localhost/v1/chat/completions?key=request-proof-dummy', { headers: { Authorization: 'Bearer unknown', 'x-api-key': 'request-proof-dummy' } });
    expect(() => prove({ ...options(), credential: extractGatewayCredential(request) })).toThrow(/unavailable/);
  });
  it('cleanup/fsync failure cannot return request authority or heal poisoned writer', () => {
    poison(); vi.spyOn(fs, 'fsyncSync').mockImplementation(() => { throw new Error('fixture request proof fsync unavailable'); }); expect(() => prove()).toThrow(/unavailable/); expect(db.health().healthy).toBe(false);
  });
  it('maintenance denies even valid caller/upstream before independent proof', () => {
    poison(); db.coverage.enterMaintenance('fixture request proof maintenance'); expect(() => prove()).toThrow(/unavailable/); expect(db.coverage.status().gaps).toEqual([]);
  });
  it.each(['retired', 'rebound', 'missing-policy', 'missing-settings'])('persisted %s is not healed or admitted', kind => {
    db.durableTransaction(() => {
      if (kind === 'retired') db.run("UPDATE apiKeyBindings SET retiredAt='2026-10-03T01:00:00.000Z' WHERE apiKeyId='key-a'");
      if (kind === 'rebound') db.run("UPDATE apiKeys SET key='different-secret' WHERE id='key-a'");
      if (kind === 'missing-policy') db.run("DELETE FROM apiKeyBudgetPolicies WHERE apiKeyId='key-a'");
      if (kind === 'missing-settings') db.run('DELETE FROM settings');
    }); poison(); expect(() => prove()).toThrow(/unavailable/); expect(db.coverage.status().gaps).toEqual([]);
  });
  it('poisoned pending settings/credential changes never replace persisted authority', () => {
    poison(() => { db.run('UPDATE settings SET data=? WHERE id=1', [JSON.stringify({ requireApiKey: false, fallbackStrategy: 'round-robin' })]); db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ apiKey: 'poisoned-token' }), 'fixture-connection']); });
    const result = prove(); expect(result.settings).toMatchObject({ requireApiKey: true, fallbackStrategy: 'fill-first' }); expect(result.connection.apiKey).toBe('dummy-upstream'); expect(db.health().healthy).toBe(false);
  });
  it('persisted row columns dominate shadow connection JSON and returned objects are deeply frozen', () => {
    db.durableTransaction(() => db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ apiKey: 'dummy-upstream', id: 'foreign', provider: 'codex', isActive: false, providerSpecificData: { enabledModels: ['fixture-model'] } }), 'fixture-connection']));
    poison(); const result = prove(); expect(result.connection).toMatchObject({ id: 'fixture-connection', provider: 'openai', isActive: true });
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.settings)).toBe(true); expect(Object.isFrozen(result.connection.providerSpecificData.enabledModels)).toBe(true);
    expect(() => { result.connection.apiKey = 'foreign'; }).toThrow(); expect(prove().connection.apiKey).toBe('dummy-upstream');
  });
  it('coverage generation changes during validation reject proof without implicit admission latch', () => {
    poison(); const status = db.coverage.status.bind(db.coverage); let n = 0;
    vi.spyOn(db.coverage, 'status').mockImplementation(id => { const value = status(id); return { ...value, generation: value.generation + (n++ > 1 ? 1 : 0) }; });
    expect(() => prove()).toThrow(/unavailable/); expect(db.coverage.status().gaps).toEqual([]);
  });
  it('installed file identity replacement after fsync denies and closes original pinned reader', () => {
    poison(); const replacement = path.join(dir, 'replacement.sqlite'), original = path.join(dir, 'original.sqlite'); fs.copyFileSync(file, replacement);
    const fsync = fs.fsyncSync; let swapped = false;
    vi.spyOn(fs, 'fsyncSync').mockImplementation(fd => { fsync(fd); if (!swapped) { swapped = true; fs.renameSync(file, original); fs.renameSync(replacement, file); } });
    try { expect(() => prove()).toThrow(/unavailable/); }
    finally { vi.restoreAllMocks(); fs.unlinkSync(file); fs.renameSync(original, file); }
    expect(db.health().healthy).toBe(false); expect(db.coverage.status().gaps).toEqual([]);
  });
  it('file close acknowledgement failure refuses successful proof and leaves writer poisoned', () => {
    poison(); const close = fs.closeSync; let failed = false;
    vi.spyOn(fs, 'closeSync').mockImplementation(fd => { close(fd); if (!failed) { failed = true; throw new Error('fixture close acknowledgement unavailable'); } });
    expect(() => prove()).toThrow(/unavailable/); expect(db.health().healthy).toBe(false); expect(db.coverage.status().gaps).toEqual([]);
  });
  it('healthy and closed adapters cannot silently enter unhealthy request exception', () => {
    expect(() => prove()).toThrow(/unavailable/); db.close(); expect(() => prove()).toThrow(/unavailable/); expect(db.coverage.status().gaps).toEqual([]);
  });
});
