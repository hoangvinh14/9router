import { describe, expect, it, vi } from 'vitest';
import { acquireSqliteEngine, initializeAvailableAdapter } from '@/lib/db/engineAcquisition.js';
const missingPackage = () => Object.assign(Error("Cannot find package 'better-sqlite3' imported from /fixture/module.js"), { code: 'ERR_MODULE_NOT_FOUND' });
const loadThrow = error => async () => { throw error; };
describe('pre-application-file engine availability boundary', () => {
  it('accepts only exact missing optional package/builtin at acquisition', async () => {
    expect(await acquireSqliteEngine('better-sqlite3', loadThrow(missingPackage()))).toBeNull();
    expect(await acquireSqliteEngine('node:sqlite', loadThrow(Object.assign(Error('No such built-in module: node:sqlite'), { code: 'ERR_UNKNOWN_BUILTIN_MODULE' })))).toBeNull();
    const unrelated = Object.assign(Error("Cannot find package 'transitive' imported from /fixture/module.js"), { code: 'ERR_MODULE_NOT_FOUND' });
    await expect(acquireSqliteEngine('better-sqlite3', loadThrow(unrelated))).rejects.toBe(unrelated);
    await expect(acquireSqliteEngine('bun:sqlite', loadThrow(unrelated))).rejects.toBe(unrelated);
  });
  it.each(['missing binding', 'ABI'])('unavailable better binding %s probe occurs only in memory', async kind => {
    const error = kind === 'ABI' ? Object.assign(Error('ABI mismatch'), { code: 'ERR_DLOPEN_FAILED' }) : Object.assign(Error('Could not locate the bindings file. Tried:\nfixture'), { tries: ['/fixture/build/better_sqlite3.node'] });
    const locations = []; class Database { constructor(file) { locations.push(file); throw error; } }
    expect(await acquireSqliteEngine('better-sqlite3', async () => ({ default: Database }))).toBeNull(); expect(locations).toEqual([':memory:']);
  });
  it('unknown/malformed binding probe errors and probe cleanup failure are fatal', async () => {
    for (const error of [Error('unknown'), Object.assign(Error('Could not locate the bindings file. Tried:\nfixture'), { tries: ['/fixture/other.node'] })]) {
      class Database { constructor() { throw error; } }
      await expect(acquireSqliteEngine('better-sqlite3', async () => ({ default: Database }))).rejects.toBe(error);
    }
    const error = Error('probe close failure'); class Database { close() { throw error; } }
    await expect(acquireSqliteEngine('better-sqlite3', async () => ({ default: Database }))).rejects.toBe(error);
  });
  it('available probe closes before project factory/target open; target loader-like error stays fatal', async () => {
    const sequence = []; class Database { constructor(file) { sequence.push(file); } close() { sequence.push('close'); } }
    const error = Object.assign(Error('ABI-like target failure'), { code: 'ERR_DLOPEN_FAILED' });
    await expect(initializeAvailableAdapter('better-sqlite3', async () => ({ default: Database }), async () => { sequence.push('project module'); return {}; }, () => { sequence.push('target'); throw error; })).rejects.toBe(error);
    expect(sequence).toEqual([':memory:', 'close', 'project module', 'target']);
  });
  it('only engine absence skips project factory; project module errors stay fatal', async () => {
    const load = vi.fn(); const create = vi.fn(); const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await initializeAvailableAdapter('better-sqlite3', loadThrow(missingPackage()), load, create)).toBeNull(); expect(load).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled(); expect(warn).toHaveBeenCalledWith('[DB] better-sqlite3 engine unavailable before database open');
      const error = missingPackage(); await expect(initializeAvailableAdapter('node:sqlite', async () => ({}), loadThrow(error), create)).rejects.toBe(error);
    } finally { warn.mockRestore(); }
  });
});
