import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSqlJsAdapter } from '../../src/lib/db/adapters/sqljsAdapter.js';

let dir, file, db;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), '9router-db-sqljs-')); file = path.join(dir, 'data.sqlite');
  db = await createSqlJsAdapter(file);
  db.exec('CREATE TABLE prices(id TEXT PRIMARY KEY, value TEXT)');
  db.durableTransaction(() => db.run("INSERT INTO prices VALUES ('a','1')"));
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); db?.close(); fs.rmSync(dir, { recursive: true, force: true }); });
describe('actual SQL.js publication and health', () => {
  it('durable ACK flushes earlier dirty writes, cancels timer, and reopens committed state', async () => {
    vi.useFakeTimers();
    db.run("INSERT INTO prices VALUES ('b','2')");
    expect(db.canMemoizePricing()).toBe(false);
    db.durableTransaction(() => db.run("UPDATE prices SET value='3' WHERE id='a'"));
    expect(db.canMemoizePricing()).toBe(true);
    const bytes = fs.readFileSync(file);
    vi.advanceTimersByTime(500);
    expect(fs.readFileSync(file).equals(bytes)).toBe(true);
    db.close(); db = await createSqlJsAdapter(file);
    expect(db.all('SELECT value FROM prices ORDER BY id')).toEqual([{ value: '3' }, { value: '2' }]);
    expect(db.raw).toBeUndefined();
  });
  it('closed engine retries ownership release only and can reopen after acquisition gate clears', async () => {
    const gate = path.join(dir, '.gateway-writer-acquisition'); fs.mkdirSync(gate);
    try {
      expect(() => db.close()).toThrow(/acquisition/);
      expect(db.health()).toMatchObject({ closed: true, healthy: false, owned: true });
      expect(() => db.close()).toThrow(/acquisition/);
      expect(() => db.get('SELECT 1')).toThrow();
    } finally { fs.rmdirSync(gate); }
    db.close(); db.close();
    expect(fs.existsSync(path.join(dir, '.gateway-writer.lock'))).toBe(false);
    db = await createSqlJsAdapter(file);
    expect(db.get('SELECT value FROM prices').value).toBe('1');
  });
  it('uncertain publication during close retains exclusion on repeated close, not release retry', () => {
    const before = fs.readFileSync(file);
    db.run("UPDATE prices SET value='9'");
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('close publication uncertain'); });
    const closing = db;
    try {
      expect(() => closing.close()).toThrow('close publication uncertain');
      vi.restoreAllMocks();
      expect(closing.health()).toMatchObject({ closed: true, poisoned: true, owned: true, healthy: false });
      expect(() => closing.close()).toThrow('close publication uncertain');
      expect(fs.existsSync(path.join(dir, '.gateway-writer.lock'))).toBe(true);
      expect(fs.readFileSync(file).equals(before)).toBe(true);
    } finally {
      // Engine is closed but the uncertain-publication fixture lease is retained.
      // afterEach removes only this disposable directory, not through a false ACK.
      db = null;
    }
  });
  it('rollback preserves earlier dirty work, not aborted changes', () => {
    db.run("INSERT INTO prices VALUES ('b','2')");
    expect(() => db.transaction(() => { db.run("UPDATE prices SET value='9'"); throw new Error('rollback'); })).toThrow('rollback');
    expect(db.canMemoizePricing()).toBe(false);
    db.durableTransaction(() => {});
    expect(db.all('SELECT value FROM prices ORDER BY id')).toEqual([{ value: '1' }, { value: '2' }]);
    db.transaction(() => expect(() => db.durableTransaction(() => {})).toThrow(/outermost/));
  });
  it('partial exec failure stays dirty outside transactions but rolls back inside clean or dirty transactions', async () => {
    expect(() => db.exec("UPDATE prices SET value='3'; INVALID SQL")).toThrow();
    expect(db.canMemoizePricing()).toBe(false);
    db.durableTransaction(() => {});
    db.close(); db = await createSqlJsAdapter(file);
    expect(db.get('SELECT value FROM prices').value).toBe('3');
    for (const previousDirty of [false, true]) {
      if (previousDirty) db.run("UPDATE prices SET value='4'");
      expect(() => db.transaction(() => db.exec("UPDATE prices SET value='9'; INVALID SQL"))).toThrow();
      expect(db.health().dirty).toBe(previousDirty);
      db.durableTransaction(() => {});
      expect(db.get('SELECT value FROM prices').value).toBe(previousDirty ? '4' : '3');
    }
  });
  it('close inside callback cannot publish or release ownership, caught or uncaught', () => {
    db.transaction(() => {
      expect(() => db.close()).toThrow(/inside transaction/);
      expect(fs.existsSync(path.join(dir, '.gateway-writer.lock'))).toBe(true);
      db.run("UPDATE prices SET value='2'");
    });
    expect(() => db.transaction(() => { db.run("UPDATE prices SET value='9'"); db.close(); })).toThrow(/inside transaction/);
    expect(db.health().healthy).toBe(true);
    expect(db.get('SELECT value FROM prices').value).toBe('2');
    db.durableTransaction(() => {});
  });
  for (const fault of ['file-write', 'file-fsync', 'before-rename', 'after-rename']) {
    it(`${fault}: failure is not ACK, poisoned reads/timer/close never republish`, async () => {
      vi.useFakeTimers();
      const before = fs.readFileSync(file);
      if (fault === 'file-write') vi.spyOn(fs, 'writeFileSync').mockImplementation(() => { throw new Error('file write failed'); });
      else if (fault === 'file-fsync') vi.spyOn(fs, 'fsyncSync').mockImplementation(() => { throw new Error('file fsync failed'); });
      else if (fault === 'before-rename') vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('rename failed'); });
      else {
        const sync = fs.fsyncSync; let count = 0;
        vi.spyOn(fs, 'fsyncSync').mockImplementation(fd => { if (++count === 2) throw new Error('directory fsync failed'); return sync(fd); });
      }
      expect(() => db.durableTransaction(() => db.run("UPDATE prices SET value='9'"))).toThrow();
      expect(db.health().poisoned).toBe(true);
      expect(() => db.get('SELECT * FROM prices')).toThrow();
      expect(() => db.run("UPDATE prices SET value='7'")).toThrow();
      expect(() => db.canMemoizePricing()).toThrow();
      if (fault !== 'after-rename') expect(fs.readFileSync(file).equals(before)).toBe(true);
      vi.restoreAllMocks();
      const installed = fs.readFileSync(file);
      vi.advanceTimersByTime(500); db.close();
      expect(fs.readFileSync(file).equals(installed)).toBe(true);
      db = await createSqlJsAdapter(file);
      expect(db.get('SELECT value FROM prices').value).toBe(fault === 'after-rename' ? '9' : '1');
    });
  }
  it('read surfaces reject writes and valid revision-style triggers publish and reopen', async () => {
    for (const method of ['get', 'all']) {
      for (const sql of ["UPDATE prices SET value='8' RETURNING value", 'PRAGMA user_version=9', 'PRAGMA journal_mode(OFF)', 'SELECT 1; DELETE FROM prices', 'WITH t AS (SELECT 1) DELETE FROM prices RETURNING value']) expect(() => db[method](sql)).toThrow(/read-only|introspection/);
    }
    db.exec(`CREATE TRIGGER price_rewrite AFTER INSERT ON prices BEGIN
      UPDATE prices SET value=CASE WHEN NEW.value='END' THEN '2' ELSE NEW.value END WHERE id=NEW.id;
    END;`);
    expect(() => db.exec('CREATE TRIGGER bad AFTER INSERT ON prices BEGIN SELECT 1; END; COMMIT')).toThrow(/managed/);
    db.durableTransaction(() => db.run("INSERT INTO prices VALUES ('b','END')"));
    db.close(); db = await createSqlJsAdapter(file);
    expect(db.get("SELECT value FROM prices WHERE id='b'").value).toBe('2');
  });
  it('timer publication failure poisons without throwing a background callback', () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('rename'); });
    db.run("UPDATE prices SET value='4'"); vi.advanceTimersByTime(100);
    expect(db.health().poisoned).toBe(true); expect(log).toHaveBeenCalled();
  });
  it('rejects async callbacks, returned thenables and raw transaction control', async () => {
    let called = false;
    expect(() => db.transaction(async () => { called = true; })).toThrow(/synchronous/);
    expect(called).toBe(false);
    for (const method of ['run', 'get', 'all', 'exec']) expect(() => db[method]('SELECT 1; BEGIN')).toThrow(/managed/);
    expect(() => db.transaction(() => Promise.resolve())).toThrow(/synchronous/);
    await Promise.resolve(); expect(db.health().poisoned).toBe(true);
  });
  it('real host backup preserves price and excludes observability, cannot overwrite live DB or alias', async () => {
    const backupDir = path.join(dir, 'backups'); fs.mkdirSync(backupDir);
    db.exec('CREATE TABLE requestDetails(id TEXT)');
    const backup = path.join(backupDir, 'backup.sqlite');
    expect(() => db.transaction(() => db.backupTo(backup))).toThrow(/outside transaction/);
    db.run("UPDATE prices SET value='6'");
    db.backupTo(backup, ['requestDetails']);
    expect(db.canMemoizePricing()).toBe(true);
    expect(fs.statSync(backup).size).toBeGreaterThan(0);
    const copy = await createSqlJsAdapter(backup);
    try {
      expect(copy.get('SELECT value FROM prices').value).toBe('6');
      expect(copy.get("SELECT name FROM sqlite_master WHERE name='requestDetails'")).toBeUndefined();
    } finally { copy.close(); }
    expect(() => db.backupTo(file)).toThrow(/destination/);
    const alias = path.join(backupDir, 'alias.sqlite'); fs.symlinkSync(file, alias);
    expect(() => db.backupTo(alias)).toThrow(/destination/);
  });
});
