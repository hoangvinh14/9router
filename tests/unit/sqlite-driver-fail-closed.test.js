import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
let dir;
const original = process.env.DATA_DIR;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'driver-failclosed-')); process.env.DATA_DIR = dir; delete global._dbAdapter; vi.resetModules(); });
afterEach(() => {
  vi.doUnmock('@/lib/db/adapters/nodeSqliteAdapter.js'); vi.doUnmock('@/lib/db/adapters/sqljsAdapter.js'); vi.doUnmock('@/lib/db/migrate.js');
  global._dbAdapter?.instance?.close(); delete global._dbAdapter; vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true });
  if (original === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = original;
});
describe('driver stops after selected engine application lifecycle begins', () => {
  it.each(['ownership', 'target open', 'artifact validation', 'PRAGMA', 'durability', 'misleading availability'])('%s error cannot invoke SQL.js fallback or migration', async stage => {
    const error = Object.assign(Error(stage), stage === 'misleading availability' ? { code: 'ERR_UNKNOWN_BUILTIN_MODULE' } : {});
    const native = vi.fn(async () => { throw error; }), fallback = vi.fn(), migrate = vi.fn();
    vi.doMock('@/lib/db/adapters/nodeSqliteAdapter.js', () => ({ createNodeSqliteAdapter: native }));
    vi.doMock('@/lib/db/adapters/sqljsAdapter.js', () => ({ createSqlJsAdapter: fallback }));
    vi.doMock('@/lib/db/migrate.js', () => ({ runMigrationOnce: migrate }));
    const { getAdapter } = await import('@/lib/db/driver.js');
    await expect(getAdapter()).rejects.toBe(error); expect(native).toHaveBeenCalledOnce(); expect(fallback).not.toHaveBeenCalled(); expect(migrate).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(dir, '.gateway-writer.lock'))).toBe(false);
  });
  it('migration error closes already selected adapter and never selects another engine', async () => {
    const error = Error('migration failure'), close = vi.fn(), fallback = vi.fn();
    vi.doMock('@/lib/db/adapters/nodeSqliteAdapter.js', () => ({ createNodeSqliteAdapter: async () => ({ driver: 'fixture', close }) }));
    vi.doMock('@/lib/db/adapters/sqljsAdapter.js', () => ({ createSqlJsAdapter: fallback }));
    vi.doMock('@/lib/db/migrate.js', () => ({ runMigrationOnce: async () => { throw error; } }));
    const { getAdapter } = await import('@/lib/db/driver.js'); await expect(getAdapter()).rejects.toBe(error); expect(close).toHaveBeenCalledOnce(); expect(fallback).not.toHaveBeenCalled();
  });
  it('real Node factory rejects invalid installed bytes without fallback/migration or global emit substitution', async () => {
    fs.mkdirSync(path.join(dir, 'db')); const file = path.join(dir, 'db', 'data.sqlite'); const bytes = Buffer.from('invalid sqlite fixture'); fs.writeFileSync(file, bytes);
    const fallback = vi.fn(), migrate = vi.fn(), emit = process.emit;
    vi.doMock('@/lib/db/adapters/sqljsAdapter.js', () => ({ createSqlJsAdapter: fallback })); vi.doMock('@/lib/db/migrate.js', () => ({ runMigrationOnce: migrate }));
    const { getAdapter } = await import('@/lib/db/driver.js'); await expect(getAdapter()).rejects.toThrow(); expect(fallback).not.toHaveBeenCalled(); expect(migrate).not.toHaveBeenCalled(); expect(process.emit).toBe(emit); expect(fs.readFileSync(file)).toEqual(bytes);
  });
});
