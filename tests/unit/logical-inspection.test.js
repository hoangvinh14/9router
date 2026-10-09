import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import initSqlJs from 'sql.js';
import { atomicDurableWrite } from '@/lib/db/durableFile.js';
import { acquireWriterOwnership, withOwnershipInspection } from '@/lib/db/writerOwnership.js';
import { inspectExistingLogicalSnapshot } from '@/lib/db/logicalInspection.js';
const cleanups = [];
afterEach(() => { vi.restoreAllMocks(); while (cleanups.length) cleanups.pop()(); });
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logical-inspection-')); fs.mkdirSync(path.join(dir, 'db'));
  const owner = acquireWriterOwnership(dir), file = path.join(dir, 'db', 'data.sqlite');
  cleanups.push(() => { try { owner.release(); } finally { fs.rmSync(dir, { recursive: true, force: true }); } });
  return { owner, file, dir };
}
function nativeFixture(wal = false) {
  const fixtureData = fixture(); const db = new DatabaseSync(fixtureData.file);
  if (wal) db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;');
  db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY,v TEXT); INSERT INTO t VALUES(1,\'fixture\');');
  cleanups.push(() => db.close()); return { ...fixtureData, db };
}
describe('unused ownership-bound snapshot inspection', () => {
  it('inspects committed native WAL without checkpoint and leaves DB/WAL bytes unchanged', async () => {
    const { owner, file } = nativeFixture(true); const before = fs.readFileSync(file), wal = fs.readFileSync(file + '-wal');
    const result = await inspectExistingLogicalSnapshot(file, { owner }); expect(result.guarantee).toBe('logical-inspection-only'); expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.readFileSync(file)).toEqual(before); expect(fs.readFileSync(file + '-wal')).toEqual(wal);
  });
  it('native rollback image inspection does not introduce sidecars', async () => {
    const { owner, file, db, dir } = nativeFixture(); db.close(); cleanups.pop();
    const before = fs.readdirSync(path.join(dir, 'db')); await inspectExistingLogicalSnapshot(file, { owner }); expect(fs.readdirSync(path.join(dir, 'db'))).toEqual(before);
  });
  it('SQL.js standalone image agrees with native fingerprint and remains unchanged', async () => {
    const { owner, file } = fixture(); const SQL = await initSqlJs(); const db = new SQL.Database();
    try { db.run('CREATE TABLE t(id INTEGER PRIMARY KEY,v); INSERT INTO t VALUES(1,9007199254740993);'); atomicDurableWrite(file, Buffer.from(db.export())); } finally { db.close(); }
    const bytes = fs.readFileSync(file); const native = await inspectExistingLogicalSnapshot(file, { owner }); const fallback = await inspectExistingLogicalSnapshot(file, { owner, engine: 'sql.js' });
    expect(fallback.sha256).toBe(native.sha256); expect(fs.readFileSync(file)).toEqual(bytes);
  });
  it('rejects forged owner, released owner, missing files, path aliases and symlinks', async () => {
    const { owner, file, dir } = nativeFixture();
    await expect(inspectExistingLogicalSnapshot(file, { owner: { ...owner } })).rejects.toThrow('Ownership inspection unavailable');
    await expect(inspectExistingLogicalSnapshot(path.join(dir, 'missing'), { owner })).rejects.toThrow();
    const alias = path.join(dir, 'alias'); fs.symlinkSync(file, alias); await expect(inspectExistingLogicalSnapshot(alias, { owner })).rejects.toThrow();
    const linkData = fs.readFileSync(file); fs.unlinkSync(file); fs.writeFileSync(path.join(dir, 'image'), linkData); fs.symlinkSync(path.join(dir, 'image'), file); await expect(inspectExistingLogicalSnapshot(file, { owner })).rejects.toThrow();
    owner.release(); await expect(inspectExistingLogicalSnapshot(file, { owner })).rejects.toThrow('ownership lost');
  });
  it('private directory/assertion and lease survive mutated public fields; release/nesting/async callbacks refuse', () => {
    const { owner, dir } = fixture(); const originalRelease = owner.release; owner.directory = '/untrusted'; owner.assertOwned = () => {};
    expect(withOwnershipInspection(owner, canonical => { expect(canonical).toBe(dir); expect(() => originalRelease()).toThrow('release during inspection'); expect(() => withOwnershipInspection(owner, () => 1)).toThrow(); return 'value'; })).toBe('value');
    expect(() => withOwnershipInspection(owner, () => { throw Error('fixture'); })).toThrow('fixture');
    expect(withOwnershipInspection(owner, () => 'after failure')).toBe('after failure');
    expect(() => withOwnershipInspection(owner, async () => 1)).toThrow(); expect(() => withOwnershipInspection(owner, () => Promise.resolve(1))).toThrow('must be synchronous');
  });
  it.each(['-journal', '-wal', '-shm'])('SQL.js rejects sidecar %s even if empty', async suffix => {
    const { owner, file } = nativeFixture(); fs.writeFileSync(file + suffix, ''); await expect(inspectExistingLogicalSnapshot(file, { owner, engine: 'sql.js' })).rejects.toThrow('Logical inspection unavailable');
  });
  it('native refuses WAL with missing SHM before opening a SQLite reader', async () => {
    const { owner, file } = nativeFixture(); fs.writeFileSync(file + '-wal', ''); await expect(inspectExistingLogicalSnapshot(file, { owner })).rejects.toThrow('Logical inspection unavailable'); expect(fs.existsSync(file + '-shm')).toBe(false);
  });
  it('rejects ownership loss at final return using private assertion', async () => {
    const { owner, file } = nativeFixture(); const original = fs.lstatSync; const lockBytes = fs.readFileSync(owner.lockPath); let changed = false;
    vi.spyOn(fs, 'lstatSync').mockImplementation((...args) => { if (!changed && args[0] === file) { changed = true; const record = JSON.parse(lockBytes); record.instanceId = 'changed-owner'; fs.writeFileSync(owner.lockPath, JSON.stringify(record)); } return original(...args); });
    try { await expect(inspectExistingLogicalSnapshot(file, { owner })).rejects.toThrow('ownership lost'); } finally { fs.writeFileSync(owner.lockPath, lockBytes); }
  });
  it('rejects truncation or replacement during SQL.js read; inspection lease resets', async () => {
    for (const action of ['truncate', 'replace']) {
      const { owner, file } = nativeFixture(); const original = fs.readSync, bytes = fs.readFileSync(file); let changed = false;
      const spy = vi.spyOn(fs, 'readSync').mockImplementation((...args) => { const count = original(...args); if (!changed) { changed = true; if (action === 'truncate') fs.truncateSync(file, 0); else { fs.renameSync(file, file + '.old'); fs.writeFileSync(file, bytes); } } return count; });
      await expect(inspectExistingLogicalSnapshot(file, { owner, engine: 'sql.js' })).rejects.toThrow(); spy.mockRestore(); expect(withOwnershipInspection(owner, () => true)).toBe(true);
    }
  });
  it.each(['rollback', 'close'])('native %s failure returns no hash and still resets inspection lease', async phase => {
    const { owner, file } = nativeFixture();
    const originalExec = DatabaseSync.prototype.exec, originalClose = DatabaseSync.prototype.close;
    let failed = false, closes = 0;
    const execSpy = vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (sql) {
      if (phase === 'rollback' && sql === 'ROLLBACK' && !failed) { failed = true; throw Error('rollback cleanup failed'); }
      return originalExec.call(this, sql);
    });
    const closeSpy = vi.spyOn(DatabaseSync.prototype, 'close').mockImplementation(function () {
      closes++;
      if (phase === 'close' && !failed) { failed = true; throw Error('connection cleanup failed'); }
      return originalClose.call(this);
    });
    try { await expect(inspectExistingLogicalSnapshot(file, { owner })).rejects.toThrow('cleanup failed'); expect(closes).toBeGreaterThan(0); }
    finally { execSpy.mockRestore(); closeSpy.mockRestore(); }
    expect(withOwnershipInspection(owner, () => true)).toBe(true);
    expect((await inspectExistingLogicalSnapshot(file, { owner })).guarantee).toBe('logical-inspection-only');
  });
  it('detects installed native path replacement during reader inspection', async () => {
    const { owner, file } = nativeFixture(); const original = DatabaseSync.prototype.prepare; const bytes = fs.readFileSync(file); let replaced = false;
    const spy = vi.spyOn(DatabaseSync.prototype, 'prepare').mockImplementation(function (sql) {
      if (!replaced && sql.includes('FROM main.sqlite_schema')) { replaced = true; fs.renameSync(file, file + '.original'); fs.writeFileSync(file, bytes); }
      return original.call(this, sql);
    });
    try { await expect(inspectExistingLogicalSnapshot(file, { owner })).rejects.toThrow('Logical inspection unavailable'); expect(replaced).toBe(true); }
    finally { spy.mockRestore(); }
    expect(withOwnershipInspection(owner, () => true)).toBe(true);
  });
  it('final ownership assertion runs after native reader cleanup', async () => {
    const { owner, file } = nativeFixture(); const original = DatabaseSync.prototype.close; const lock = fs.readFileSync(owner.lockPath); let changed = false;
    const spy = vi.spyOn(DatabaseSync.prototype, 'close').mockImplementation(function () {
      original.call(this);
      if (!changed) { changed = true; const record = JSON.parse(lock); record.instanceId = 'lost-after-close'; fs.writeFileSync(owner.lockPath, JSON.stringify(record)); }
    });
    try { await expect(inspectExistingLogicalSnapshot(file, { owner })).rejects.toThrow('ownership lost'); expect(changed).toBe(true); }
    finally { spy.mockRestore(); fs.writeFileSync(owner.lockPath, lock); }
    expect(withOwnershipInspection(owner, () => true)).toBe(true);
  });
  it('rejects missing canonical image and oversize image without creating or reading them', async () => {
    const { owner, file } = fixture(); await expect(inspectExistingLogicalSnapshot(file, { owner })).rejects.toThrow(); expect(fs.existsSync(file)).toBe(false);
    const fd = fs.openSync(file, 'w'); fs.ftruncateSync(fd, 64 * 1024 * 1024 + 1); fs.closeSync(fd);
    await expect(inspectExistingLogicalSnapshot(file, { owner, engine: 'sql.js' })).rejects.toThrow('Logical inspection unavailable');
  });
  it('failed descriptor cleanup prevents hash return but resets lease', async () => {
    const { owner, file } = nativeFixture(); const original = fs.closeSync; const spy = vi.spyOn(fs, 'closeSync').mockImplementation(fd => { original(fd); throw Error('cleanup failed'); });
    await expect(inspectExistingLogicalSnapshot(file, { owner })).rejects.toThrow('cleanup failed'); spy.mockRestore(); expect(withOwnershipInspection(owner, () => true)).toBe(true);
  });
});
