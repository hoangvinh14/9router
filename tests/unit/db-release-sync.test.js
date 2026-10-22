import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { acquireWriterOwnership } from '../../src/lib/db/writerOwnership.js';
import { createNodeSqliteAdapter } from '../../src/lib/db/adapters/nodeSqliteAdapter.js';
import { createSqlJsAdapter } from '../../src/lib/db/adapters/sqljsAdapter.js';
import { wrapNativeAdapter } from '../../src/lib/db/adapters/nativeAdapter.js';

let dir;
const originalDataDir = process.env.DATA_DIR;
const adapters = [];
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), '9router-release-sync-')); });
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of adapters.splice(0)) db.close();
  delete global._dbAdapter; vi.resetModules();
  fs.rmSync(dir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = originalDataDir;
});
function inject(directory, phase) {
  const lock = path.join(directory, '.gateway-writer.lock'), gate = path.join(directory, '.gateway-writer-acquisition');
  const original = { open: fs.openSync, close: fs.closeSync, sync: fs.fsyncSync, unlink: fs.unlinkSync, mkdir: fs.mkdirSync, rmdir: fs.rmdirSync };
  const directories = new Set();
  const state = { enabled: true, removed: false, gateRemoved: false, syncs: 0, failures: 0, unlinks: 0, failRmdir: false };
  vi.spyOn(fs, 'openSync').mockImplementation((target, ...args) => {
    const fd = original.open(target, ...args); if (target === directory) directories.add(fd); return fd;
  });
  vi.spyOn(fs, 'closeSync').mockImplementation(fd => { directories.delete(fd); return original.close(fd); });
  vi.spyOn(fs, 'mkdirSync').mockImplementation((target, ...args) => {
    const value = original.mkdir(target, ...args); if (target === gate) state.gateRemoved = false; return value;
  });
  vi.spyOn(fs, 'unlinkSync').mockImplementation((target, ...args) => {
    const value = original.unlink(target, ...args); if (target === lock) { state.removed = true; state.unlinks++; } return value;
  });
  vi.spyOn(fs, 'rmdirSync').mockImplementation((target, ...args) => {
    if (target === gate && state.failRmdir) throw new Error('gate removal failed');
    const value = original.rmdir(target, ...args); if (target === gate) state.gateRemoved = true; return value;
  });
  vi.spyOn(fs, 'fsyncSync').mockImplementation(fd => {
    if (directories.has(fd) && state.removed) {
      state.syncs++;
      if (state.enabled && (phase === 'after-unlink' ? !state.gateRemoved : state.gateRemoved)) {
        state.failures++; throw new Error(`directory sync ${phase}`);
      }
    }
    return original.sync(fd);
  });
  return state;
}
for (const phase of ['after-unlink', 'after-gate-cleanup']) {
  describe(`release synchronization ${phase}`, () => {
    it('owner keeps repeated failures observable then sync-only retries without touching replacement', () => {
      const file = path.join(dir, 'data.sqlite'), lock = path.join(dir, '.gateway-writer.lock'), gate = path.join(dir, '.gateway-writer-acquisition');
      const owner = acquireWriterOwnership(file);
      const fault = inject(dir, phase);
      expect(() => owner.release()).toThrow(/directory sync/);
      expect(fault.unlinks).toBe(1);
      expect(() => owner.assertOwned()).toThrow(/lost/);
      expect(() => owner.release()).toThrow(/directory sync/);
      expect(fault.failures).toBe(2);
      fault.enabled = false;
      const replacement = acquireWriterOwnership(file);
      const bytes = fs.readFileSync(lock);
      fs.mkdirSync(gate);
      expect(() => owner.release()).toThrow(/acquisition/);
      fs.rmdirSync(gate);
      const before = fault.syncs;
      owner.release();
      expect(fault.syncs - before).toBe(2);
      expect(fault.unlinks).toBe(1);
      expect(fs.readFileSync(lock).equals(bytes)).toBe(true);
      replacement.assertOwned();
      const complete = fault.syncs; owner.release(); expect(fault.syncs).toBe(complete);
      replacement.release();
    });
    for (const [engine, create] of [['node', createNodeSqliteAdapter], ['sqljs', createSqlJsAdapter]]) {
      it(`${engine} closed adapter finishes release sync without changing replacement image`, async () => {
        const file = path.join(dir, 'data.sqlite'), lock = path.join(dir, '.gateway-writer.lock');
        const db = await create(file); adapters.push(db);
        db.durableTransaction(() => db.exec('CREATE TABLE fixture(id INTEGER)'));
        const fault = inject(dir, phase);
        expect(() => db.close()).toThrow(/directory sync/);
        expect(db.health()).toMatchObject({ closed: true, healthy: false, owned: false });
        expect(() => db.get('SELECT 1')).toThrow();
        fault.enabled = false;
        const replacement = await create(file); adapters.push(replacement);
        const bytes = fs.readFileSync(lock);
        const writes = vi.spyOn(fs, 'writeFileSync');
        const before = fault.syncs;
        db.close();
        expect(fault.syncs - before).toBe(2);
        expect(writes).not.toHaveBeenCalled();
        expect(fs.readFileSync(lock).equals(bytes)).toBe(true);
        expect(replacement.get('SELECT COUNT(*) AS n FROM fixture').n).toBe(0);
        expect(fault.unlinks).toBe(1);
      });
    }
    it('driver singleton clears only after complete release synchronization', async () => {
      process.env.DATA_DIR = dir; delete global._dbAdapter; vi.resetModules();
      const { getAdapter } = await import('@/lib/db/driver.js');
      const db = await getAdapter(); adapters.push(db);
      const fault = inject(path.join(dir, 'db'), phase);
      expect(() => db.close()).toThrow(/directory sync/);
      expect(global._dbAdapter.instance).toBe(db);
      await expect(getAdapter()).rejects.toThrow(/unavailable/);
      fault.enabled = false; db.close();
      expect(global._dbAdapter.instance).toBeNull();
      const reopened = await getAdapter(); adapters.push(reopened);
      expect(reopened.health().healthy).toBe(true);
    });
    it('successful native close policy runs once even after repeated release errors', () => {
      const file = path.join(dir, 'data.sqlite'); let closes = 0;
      const engine = {
        exec() {}, prepare(sql) { return { get: () => sql.includes('journal_mode') ? { journal_mode: 'wal' } : { synchronous: 2 } }; },
      };
      const db = wrapNativeAdapter(engine, acquireWriterOwnership(file), 'fault-engine', () => { closes++; }); adapters.push(db);
      const fault = inject(dir, phase);
      expect(() => db.close()).toThrow(/directory sync/);
      expect(() => db.close()).toThrow(/directory sync/);
      fault.enabled = false; db.close(); db.close();
      expect(closes).toBe(1);
    });
  });
}
it('arbitrary missing owner is not treated as proof of a successful own unlink', () => {
  const owner = acquireWriterOwnership(path.join(dir, 'data.sqlite'));
  fs.unlinkSync(path.join(dir, '.gateway-writer.lock'));
  expect(() => owner.release()).toThrow();
  expect(() => owner.release()).toThrow();
});
it('failed arbitration gate removal stays fail-closed until fixture operator intervention', () => {
  const owner = acquireWriterOwnership(path.join(dir, 'data.sqlite'));
  const fault = inject(dir, 'after-unlink'); fault.enabled = false; fault.failRmdir = true;
  expect(() => owner.release()).toThrow('gate removal failed');
  expect(() => owner.release()).toThrow(/acquisition/);
  fault.failRmdir = false;
  fs.rmdirSync(path.join(dir, '.gateway-writer-acquisition')); // explicitly owned fixture gate, not automatic recovery
  owner.release();
});
