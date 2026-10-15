import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createSqlJsAdapter } from '@/lib/db/adapters/sqljsAdapter.js';
import { acquireWriterOwnership } from '@/lib/db/writerOwnership.js';
import { openAccountingCoverage } from '@/lib/db/accountingCoverage.js';
import { runMigrationOnce } from '@/lib/db/migrate.js';
import { captureQueuedRequestAuthoritySync } from '@/lib/apiKeyBudget/queuedRequestAuthority.js';
import { seedGeminiAccountingFixture } from './fixtures/accounting-gemini-db.js';
let dir, owner, db;
const input = { credential: 'dummy-key-a', apiKeyId: 'a', provider: 'gemini', model: 'fixture-gemini', connectionId: 'c' };
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), '9router-authority-read-batch-'));
  owner = acquireWriterOwnership(dir);
  db = await createSqlJsAdapter(path.join(dir, 'data.sqlite'), owner);
  expect(db.driver).toBe('sql.js');
  await runMigrationOnce(db);
  db.coverage = openAccountingCoverage(db, owner);
  seedGeminiAccountingFixture(db);
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); owner?.release(); fs.rmSync(dir, { recursive: true, force: true }); });
const capture = () => captureQueuedRequestAuthoritySync(db, input);
// Coverage retains all current sidecar/owner checks; this count deliberately
// excludes only its existing _meta marker reads, not any authority SQL table.
const authorityReads = spy => spy.mock.calls.filter(([sql]) => !/^SELECT value FROM _meta WHERE key=\?$/.test(sql));
describe('fresh queued authority SQL read batching, no row or authorization cache', () => {
  it('reads the exact full current equality rows with at most three authority SELECTs', () => {
    const expected = {
      ...input,
      key: db.get('SELECT * FROM apiKeys WHERE key=?', [input.credential]),
      binding: db.get('SELECT * FROM apiKeyBindings WHERE apiKeyId=?', [input.apiKeyId]),
      settings: db.get('SELECT data FROM settings WHERE id=1').data,
      ledgerStartedAt: db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'").value,
      coverageId: db.coverage.status('a').id,
      connection: db.get('SELECT * FROM providerConnections WHERE id=?', ['c']),
      proxyPool: null,
    };
    const get = vi.spyOn(db, 'get'), run = vi.spyOn(db, 'run');
    const actual = capture();
    expect(actual).toEqual(expected);
    expect(Object.isFrozen(actual)).toBe(true);
    expect(Object.isFrozen(actual.key)).toBe(true);
    expect(authorityReads(get).length).toBeLessThanOrEqual(3);
    expect(run).not.toHaveBeenCalled();
  });
  it('keeps optional pool lookup current and exact without normalizing detached JSON', () => {
    const timestamp = '2026-10-03T00:00:00.000Z';
    db.durableTransaction(() => {
      db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ apiKey: 'dummy-provider', providerSpecificData: { proxyPoolId: '\t p \n' } }), 'c']);
      db.run('INSERT INTO proxyPools(id,isActive,data,createdAt,updatedAt) VALUES(?,?,?,?,?)', ['p', 0, '{ "proxyUrl": "http://dummy.invalid" }', timestamp, timestamp]);
    });
    const pool = db.get('SELECT * FROM proxyPools WHERE id=?', ['p']);
    const get = vi.spyOn(db, 'get');
    expect(capture().proxyPool).toEqual(pool);
    expect(authorityReads(get).length).toBeLessThanOrEqual(4);
    get.mockRestore();
    db.durableTransaction(() => db.run('UPDATE proxyPools SET data=? WHERE id=?', ['{"proxyUrl":"http://changed.invalid"}', 'p']));
    expect(capture().proxyPool).not.toEqual(pool);
  });
  it('does not retain settings/credential rows or silently accept invalid current bindings', () => {
    const previous = capture();
    db.durableTransaction(() => {
      db.run('UPDATE settings SET data=? WHERE id=1', ['{ "requireApiKey": true, "changed": 1 }']);
      db.run('UPDATE providerConnections SET data=? WHERE id=?', ['{"apiKey":"rotated-dummy"}', 'c']);
    });
    const next = capture();
    expect(next).not.toEqual(previous);
    expect(next.settings).toBe('{ "requireApiKey": true, "changed": 1 }');
    expect(next.connection.data).toBe('{"apiKey":"rotated-dummy"}');
    expect(previous.connection.data).toBe('{"apiKey":"dummy-provider"}');
    db.durableTransaction(() => db.run('UPDATE apiKeyBindings SET retiredAt=? WHERE apiKeyId=?', ['2026-10-03T00:00:00.000Z', 'a']));
    expect(capture).toThrow();
  });
  it.each(['inactive-key', 'missing-binding', 'foreign-provider', 'missing-connection', 'invalid-settings', 'missing-ledger'])('batched view refuses current %s without manufacturing omitted rows', change => {
    db.durableTransaction(() => {
      if (change === 'inactive-key') db.run('UPDATE apiKeys SET isActive=0 WHERE id=?', ['a']);
      if (change === 'missing-binding') db.run('DELETE FROM apiKeyBindings WHERE apiKeyId=?', ['a']);
      if (change === 'foreign-provider') db.run('UPDATE providerConnections SET provider=? WHERE id=?', ['foreign', 'c']);
      if (change === 'missing-connection') db.run('DELETE FROM providerConnections WHERE id=?', ['c']);
      if (change === 'invalid-settings') db.run('UPDATE settings SET data=? WHERE id=1', ['[]']);
      if (change === 'missing-ledger') db.run("DELETE FROM _meta WHERE key='ledgerStartedAt'");
    });
    expect(capture).toThrow();
  });
  it('keeps connectionless capture distinct and rechecks externally retired key history', () => {
    const result = captureQueuedRequestAuthoritySync(db, { ...input, connectionId: null });
    expect(result.connection).toBeNull(); expect(result.proxyPool).toBeNull();
    const fingerprint = db.coverage.fingerprint(input.credential);
    db.coverage.retainRetiredBinding('a', fingerprint);
    expect(capture).toThrow();
  });
  it.each(['retirement', 'fingerprint'])('preserves helper fresh prior-ID guards after coverage inspection changes %s', change => {
    const retired = db.coverage.retiredBindings.bind(db.coverage);
    const inspected = vi.spyOn(db.coverage, 'retiredBindings').mockImplementation(() => {
      const result = retired();
      if (change === 'retirement') db.run('UPDATE apiKeyBindings SET retiredAt=? WHERE apiKeyId=?', ['2026-10-03T00:00:00.000Z', 'a']);
      else db.run('UPDATE apiKeyBindings SET fingerprint=? WHERE apiKeyId=?', ['changed-dummy-fingerprint', 'a']);
      return result;
    });
    expect(capture).toThrow(); expect(inspected).toHaveBeenCalledOnce();
  });
  it('withholds capture when sidecar state changes after the SQL read and refuses unhealthy storage before any read', () => {
    const status = db.coverage.status.bind(db.coverage); let calls = 0;
    vi.spyOn(db.coverage, 'status').mockImplementation(id => { const state = status(id); return ++calls === 2 ? { ...state, generation: state.generation + 1 } : state; });
    expect(capture).toThrow();
    vi.restoreAllMocks();
    vi.spyOn(db, 'health').mockReturnValue({ healthy: false });
    const get = vi.spyOn(db, 'get');
    expect(capture).toThrow(); expect(get).not.toHaveBeenCalled();
  });
});
