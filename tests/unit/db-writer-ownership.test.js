import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { acquireWriterOwnership, claimWriter } from '../../src/lib/db/writerOwnership.js';
import { createSqlJsAdapter } from '../../src/lib/db/adapters/sqljsAdapter.js';
import { createNodeSqliteAdapter } from '../../src/lib/db/adapters/nodeSqliteAdapter.js';

let dir, file; const children = new Set(); const owners = [];
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), '9router-owner-')); file = path.join(dir, 'data.sqlite'); });
afterEach(async () => {
  vi.restoreAllMocks();
  for (const child of children) { if (child.exitCode === null && child.signalCode === null) { const ended = once(child, 'exit'); child.kill('SIGKILL'); await ended; } }
  children.clear();
  for (const owner of owners.splice(0)) { try { owner.release(); } catch { /* deliberately corrupt fixture */ } }
  fs.rmSync(dir, { recursive: true, force: true });
});
async function launch() {
  const child = fork(fileURLToPath(new URL('../fixtures/db-safety/owner-process.mjs', import.meta.url)), [file], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  children.add(child);
  const [message] = await once(child, 'message'); return { child, message };
}
describe('writer ownership before database open', () => {
  it('same-parent files and realpath aliases share exclusion, forged or reused leases fail', () => {
    const owner = acquireWriterOwnership(file); owners.push(owner);
    expect(() => acquireWriterOwnership(path.join(dir, 'other.sqlite'))).toThrow();
    const alias = path.join(dir, 'alias'); fs.symlinkSync(dir, alias, 'dir');
    expect(() => acquireWriterOwnership(path.join(alias, 'data.sqlite'))).toThrow();
    expect(() => claimWriter(file, { assertOwned() {} })).toThrow(/lease/);
    const { owner: lease } = claimWriter(file, owner);
    expect(() => owner.release()).toThrow(/adapter close/);
    expect(() => claimWriter(file, owner)).toThrow(/lease/);
    expect(fs.existsSync(file)).toBe(false);
    lease.release();
  });
  it('actual Node and SQL.js factories reject a second image before application-file mutation', async () => {
    const first = await createSqlJsAdapter(file);
    try {
      await expect(createSqlJsAdapter(file)).rejects.toThrow();
      await expect(createNodeSqliteAdapter(file)).rejects.toThrow();
      expect(fs.existsSync(file)).toBe(false);
    } finally { first.close(); }
    const next = await createNodeSqliteAdapter(file); next.close();
  });
  it('retained pre-open token cannot unlock actual live adapters', async () => {
    for (const create of [createSqlJsAdapter, createNodeSqliteAdapter]) {
      const owner = acquireWriterOwnership(file);
      const adapter = await create(file, owner);
      try {
        expect(() => owner.release()).toThrow(/adapter close/);
        await expect(create(file)).rejects.toThrow();
        expect(adapter.health().healthy).toBe(true);
      } finally { adapter.close(); }
    }
  });
  it('nonregular, symlink and hardlinked application file are not writable', async () => {
    const actual = path.join(dir, 'actual.sqlite'); fs.writeFileSync(actual, 'fixture');
    fs.symlinkSync(actual, file);
    await expect(createSqlJsAdapter(file)).rejects.toThrow(/regular/);
    fs.unlinkSync(file); fs.linkSync(actual, file);
    await expect(createSqlJsAdapter(file)).rejects.toThrow(/single-link/);
  });
  for (const [engine, create] of [['node', createNodeSqliteAdapter], ['sqljs', createSqlJsAdapter]]) {
    it(`${engine}: dangling symlink and nonregular path reject before target creation and release lease`, async () => {
      const targetDir = path.join(dir, 'target'); fs.mkdirSync(targetDir);
      const target = path.join(targetDir, 'absent.sqlite');
      fs.symlinkSync(target, file);
      await expect(create(file)).rejects.toThrow(/regular/);
      expect(fs.existsSync(target)).toBe(false);
      expect(fs.lstatSync(file).isSymbolicLink()).toBe(true);
      expect(fs.existsSync(path.join(dir, '.gateway-writer.lock'))).toBe(false);
      fs.unlinkSync(file); fs.mkdirSync(file);
      await expect(create(file)).rejects.toThrow(/regular/);
      expect(fs.existsSync(path.join(dir, '.gateway-writer.lock'))).toBe(false);
      fs.rmdirSync(file);
      const next = await create(file); next.close();
    });
  }
  it('non-ENOENT database path inspection errors fail closed and release unclaimed lease', () => {
    const lstat = fs.lstatSync;
    const failure = Object.assign(new Error('inspection denied'), { code: 'EACCES' });
    vi.spyOn(fs, 'lstatSync').mockImplementation((target, ...args) => {
      if (target === file) throw failure;
      return lstat(target, ...args);
    });
    expect(() => claimWriter(file)).toThrow(failure);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(path.join(dir, '.gateway-writer.lock'))).toBe(false);
  });
  it('malformed owner and interrupted arbitration fail closed', () => {
    fs.writeFileSync(path.join(dir, '.gateway-writer.lock'), '{}');
    expect(() => acquireWriterOwnership(file)).toThrow(/invalid/);
    fs.unlinkSync(path.join(dir, '.gateway-writer.lock'));
    fs.mkdirSync(path.join(dir, '.gateway-writer-acquisition'));
    expect(() => acquireWriterOwnership(file)).toThrow(/interrupted/);
  });
  it('PID-incarnation mismatch is ambiguous, not automatic stale recovery', () => {
    const owner = acquireWriterOwnership(file); owners.push(owner);
    const lock = path.join(dir, '.gateway-writer.lock');
    const row = JSON.parse(fs.readFileSync(lock)); row.startTime = 'different';
    fs.writeFileSync(lock, JSON.stringify(row));
    expect(() => acquireWriterOwnership(file)).toThrow(/ambiguous/);
  });
  it('real child excludes another process; proven-dead owner can be acquired by only one simultaneous reclaimer', async () => {
    const first = await launch(); expect(first.message.ready).toBe(true);
    expect(() => acquireWriterOwnership(file)).toThrow(/active/);
    const ended = once(first.child, 'exit'); first.child.kill('SIGKILL'); await ended;
    const candidates = await Promise.all([launch(), launch()]);
    expect(candidates.filter(({ message }) => message.ready)).toHaveLength(1);
    const winner = candidates.find(({ message }) => message.ready);
    const closed = once(winner.child, 'exit'); winner.child.send('close'); await closed;
    const owner = acquireWriterOwnership(file); owners.push(owner);
  });
});
