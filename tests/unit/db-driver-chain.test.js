// Availability is proven before application-file open, never inferred from a
// factory/open error. Actual engine-specific lanes are tested separately.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { acquireSqliteEngine, initializeAvailableAdapter } from '../../src/lib/db/engineAcquisition.js';

let tempDir;
const originalDataDir = process.env.DATA_DIR;
beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '9router-chain-'));
  process.env.DATA_DIR = tempDir; delete global._dbAdapter; vi.resetModules();
});
afterEach(() => {
  global._dbAdapter?.instance?.close(); delete global._dbAdapter;
  vi.doUnmock('@/lib/db/adapters/nodeSqliteAdapter.js');
  vi.doUnmock('@/lib/db/engineAcquisition.js'); vi.resetModules();
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = originalDataDir;
});
describe('Driver fallback chain', () => {
  it('default selects an available real engine and initializes durable health', async () => {
    const db = await (await import('@/lib/db/driver.js')).getAdapter();
    expect(['better-sqlite3', 'node:sqlite', 'sql.js']).toContain(db.driver);
    expect(db.health().healthy).toBe(true);
  });
  it('recognized missing engine permits selection to continue before opening app file', async () => {
    const missing = Object.assign(new Error('No such built-in module: node:sqlite'), { code: 'ERR_UNKNOWN_BUILTIN_MODULE' });
    const factory = vi.fn();
    expect(await initializeAvailableAdapter('node:sqlite', async () => { throw missing; }, factory, () => {})).toBeNull();
    expect(factory).not.toHaveBeenCalled();
    expect(fs.readdirSync(tempDir)).toEqual([]);
  });
  it('better binding probe is memory-only and missing binding permits fallback', async () => {
    const calls = [];
    class MissingBinding {
      constructor(file) { calls.push(file); throw Object.assign(new Error('Could not locate the bindings file. Tried:\n'), { tries: ['/fixture/build/better_sqlite3.node'] }); }
    }
    expect(await acquireSqliteEngine('better-sqlite3', async () => ({ default: MissingBinding }))).toBeNull();
    expect(calls).toEqual([':memory:']);
  });
  it('unknown imports, failed probes and project factory errors remain fatal', async () => {
    const failure = new Error('unexpected');
    await expect(acquireSqliteEngine('node:sqlite', async () => { throw failure; })).rejects.toBe(failure);
    await expect(initializeAvailableAdapter('node:sqlite', async () => ({}), async () => { throw failure; }, () => {})).rejects.toBe(failure);
    await expect(initializeAvailableAdapter('node:sqlite', async () => ({}), async () => ({}), () => { throw failure; })).rejects.toBe(failure);
  });
  it('actual driver selects real SQL.js after pre-open native-unavailable decision and migrates ACL schema', async () => {
    // Fake only engine availability, not adapter/publication/migration behavior.
    vi.doMock('@/lib/db/engineAcquisition.js', () => ({ initializeAvailableAdapter: async () => null }));
    const { getAdapter } = await import('@/lib/db/driver.js');
    const db = await getAdapter();
    expect(db.driver).toBe('sql.js');
    expect(db.health().healthy).toBe(true);
    expect(db.all('PRAGMA table_info(apiKeys)').map(row => row.name)).toContain('accessRestricted');
    expect(fs.statSync(path.join(tempDir, 'db', 'data.sqlite')).size).toBeGreaterThan(0);
    db.durableTransaction(() => db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','fixture','{}')"));
    db.close();
    const reopened = await getAdapter();
    expect(reopened.get("SELECT value FROM kv WHERE scope='pricing' AND key='fixture'").value).toBe('{}');
  });
  for (const sqljs of [false, true]) {
    it(`actual driver ${sqljs ? 'SQL.js' : 'default'} rejects dangling DB symlink without migration or target creation`, async () => {
      if (sqljs) vi.doMock('@/lib/db/engineAcquisition.js', () => ({ initializeAvailableAdapter: async () => null }));
      const directory = path.join(tempDir, 'db'); fs.mkdirSync(directory);
      const target = path.join(tempDir, 'absent.sqlite');
      fs.symlinkSync(target, path.join(directory, 'data.sqlite'));
      const { getAdapter } = await import('@/lib/db/driver.js');
      await expect(getAdapter()).rejects.toThrow(/regular/);
      expect(global._dbAdapter.instance).toBeNull();
      expect(fs.existsSync(target)).toBe(false);
      expect(fs.existsSync(path.join(directory, '.gateway-writer.lock'))).toBe(false);
    });
    it(`actual driver ${sqljs ? 'SQL.js' : 'default'} retains singleton on blocked close then clears it on release retry`, async () => {
      if (sqljs) vi.doMock('@/lib/db/engineAcquisition.js', () => ({ initializeAvailableAdapter: async () => null }));
      const { getAdapter } = await import('@/lib/db/driver.js');
      const adapter = await getAdapter();
      const directory = path.join(tempDir, 'db');
      const gate = path.join(directory, '.gateway-writer-acquisition'); fs.mkdirSync(gate);
      try {
        expect(() => adapter.close()).toThrow(/acquisition/);
        expect(() => adapter.close()).toThrow(/acquisition/);
        expect(global._dbAdapter.instance).toBe(adapter);
        await expect(getAdapter()).rejects.toThrow(/unavailable/);
      } finally { fs.rmdirSync(gate); }
      adapter.close();
      expect(global._dbAdapter.instance).toBeNull();
      expect(fs.existsSync(path.join(directory, '.gateway-writer.lock'))).toBe(false);
      const reopened = await getAdapter();
      expect(reopened).not.toBe(adapter);
      expect(reopened.health().healthy).toBe(true);
    });
  }
  it('actual driver propagates factory failure without SQL.js fallback or migration', async () => {
    vi.doMock('@/lib/db/adapters/nodeSqliteAdapter.js', () => ({ createNodeSqliteAdapter: () => { throw new Error('application open failed'); } }));
    const { getAdapter } = await import('@/lib/db/driver.js');
    await expect(getAdapter()).rejects.toThrow('application open failed');
    expect(fs.existsSync(path.join(tempDir, 'db', 'data.sqlite'))).toBe(false);
    // Driver cannot prove an arbitrary factory closed its handle: retain lock.
    expect(fs.existsSync(path.join(tempDir, 'db', '.gateway-writer.lock'))).toBe(true);
  });
});
