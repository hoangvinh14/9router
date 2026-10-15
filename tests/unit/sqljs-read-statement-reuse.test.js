import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createSqlJsAdapter } from '@/lib/db/adapters/sqljsAdapter.js';
import { acquireWriterOwnership } from '@/lib/db/writerOwnership.js';

const runtime = vi.hoisted(() => ({ SQL: null }));
vi.mock('sql.js', async original => {
  const actual = await original();
  return { ...actual, default: async (...args) => { const SQL = await actual.default(...args); runtime.SQL = SQL; return SQL; } };
});
let directory, owner, db, prepared;
const query = 'SELECT value FROM fixture WHERE id=?';
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-sqljs-read-reuse-'));
  owner = acquireWriterOwnership(directory);
  db = await createSqlJsAdapter(path.join(directory, 'data.sqlite'), owner);
  expect(db.driver).toBe('sql.js');
  db.exec('CREATE TABLE fixture(id TEXT PRIMARY KEY,value TEXT)');
  db.durableTransaction(() => { db.run('INSERT INTO fixture VALUES(?,?)', ['a', 'one']); db.run('INSERT INTO fixture VALUES(?,?)', ['b', 'two']); });
  prepared = vi.spyOn(runtime.SQL.Database.prototype, 'prepare');
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); owner?.release(); fs.rmSync(directory, { recursive: true, force: true }); });
const calls = () => prepared.mock.calls.filter(([sql]) => sql === query).length;
describe('bounded SQL.js compiled read reuse, never row or authority caching', () => {
  it('reuses compilation but binds each parameter and reads current results including missing rows', () => {
    expect(db.get(query, ['a'])).toEqual({ value: 'one' });
    expect(db.get(query, ['b'])).toEqual({ value: 'two' });
    expect(db.get(query, ['absent'])).toBeUndefined();
    expect(db.get(query, ['a'])).toEqual({ value: 'one' }); expect(calls()).toBe(1);
  });
  it('invalidates before mutation and sees both changed rows and rolled-back state', () => {
    expect(db.get(query, ['a'])).toEqual({ value: 'one' });
    db.run('UPDATE fixture SET value=? WHERE id=?', ['changed', 'a']);
    expect(db.get(query, ['a'])).toEqual({ value: 'changed' });
    expect(() => db.transaction(() => { db.run('UPDATE fixture SET value=? WHERE id=?', ['rollback', 'a']); expect(db.get(query, ['a'])).toEqual({ value: 'rollback' }); throw new Error('fixture rollback'); })).toThrow('fixture rollback');
    expect(db.get(query, ['a'])).toEqual({ value: 'changed' }); expect(calls()).toBeGreaterThan(1);
  });
  it('does not retain caller-modified rows or parameter bindings after errors', () => {
    const row = db.get(query, ['a']); row.value = 'caller mutation';
    expect(() => db.get(query, [Symbol('invalid')])).toThrow();
    expect(db.get(query, ['b'])).toEqual({ value: 'two' }); expect(db.get(query, ['a'])).toEqual({ value: 'one' });
  });
  it('bounds compiled statements and recompiles an evicted query', () => {
    db.get(query, ['a']);
    for (let n = 0; n < 40; n++) expect(db.get(`SELECT value FROM fixture WHERE id=? /* fixture ${n} */`, ['b'])).toEqual({ value: 'two' });
    expect(db.get(query, ['a'])).toEqual({ value: 'one' }); expect(calls()).toBe(2);
  });
  it('invalidates around schema changes and durable export; reopen observes actual durable values', async () => {
    db.get(query, ['a']);
    db.exec('ALTER TABLE fixture ADD COLUMN extra TEXT'); expect(db.get(query, ['b'])).toEqual({ value: 'two' });
    db.durableTransaction(() => { db.run('UPDATE fixture SET value=? WHERE id=?', ['durable', 'a']); expect(db.get(query, ['a'])).toEqual({ value: 'durable' }); });
    expect(db.get(query, ['a'])).toEqual({ value: 'durable' }); db.close();
    db = await createSqlJsAdapter(path.join(directory, 'data.sqlite'), owner);
    expect(db.get(query, ['a'])).toEqual({ value: 'durable' });
  });
  it('leases statements across nested parameter reads instead of reusing the active cursor', () => {
    db.get(query, ['a']); let nested = 0;
    const params = []; Object.defineProperty(params, 0, { enumerable: true, get() { nested++; expect(db.get(query, ['b'])).toEqual({ value: 'two' }); return 'a'; } });
    expect(db.get(query, params)).toEqual({ value: 'one' }); expect(nested).toBeGreaterThan(0);
    expect(db.get(query, ['b'])).toEqual({ value: 'two' });
  });
  it('frees cached statements before backup export without changing current or backed-up values', async () => {
    db.get(query, ['a']); const backup = path.join(directory, 'backup.sqlite'); db.backupTo(backup);
    expect(db.get(query, ['b'])).toEqual({ value: 'two' });
    const copy = await createSqlJsAdapter(backup); try { expect(copy.get(query, ['a'])).toEqual({ value: 'one' }); } finally { copy.close(); }
  });
  it('poisoned persistence still refuses a read cache hit rather than trusting prior rows', () => {
    db.get(query, ['a']); vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('fixture uncertain persistence'); });
    expect(() => db.durableTransaction(() => db.run('UPDATE fixture SET value=? WHERE id=?', ['uncertain', 'a']))).toThrow('fixture uncertain persistence');
    expect(db.health().healthy).toBe(false); expect(() => db.get(query, ['a'])).toThrow('unhealthy');
  });
  it('checks current writer ownership on every cache hit and refuses reads after close', () => {
    db.get(query, ['a']); owner.release(); expect(() => db.get(query, ['a'])).toThrow('ownership lost');
    // No dirty writes exist, so closing does not attempt to persist after release.
    db.close(); expect(() => db.get(query, ['a'])).toThrow();
  });
});
