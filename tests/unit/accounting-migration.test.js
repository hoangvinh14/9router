import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNodeSqliteAdapter } from '../../src/lib/db/adapters/nodeSqliteAdapter.js';
import { createSqlJsAdapter } from '../../src/lib/db/adapters/sqljsAdapter.js';

let root, db; const original = process.env.DATA_DIR;
afterEach(() => {
  vi.restoreAllMocks(); db?.close(); db = null; vi.resetModules();
  if (original === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = original;
  if (root) fs.rmSync(root, { recursive: true, force: true });
});
for (const engine of ['node', 'sqljs']) describe(`${engine} required migration backup`, () => {
  it.each([true, false])('refuses schema mutation on backup failure with metadata=%s', async metadata => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'accounting-migration-')); process.env.DATA_DIR = root; vi.resetModules();
    fs.mkdirSync(path.join(root, 'db'));
    db = await (engine === 'node' ? createNodeSqliteAdapter : createSqlJsAdapter)(path.join(root, 'db/data.sqlite'));
    db.durableTransaction(() => {
      if (metadata) {
        db.exec('CREATE TABLE _meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
        db.run("INSERT INTO _meta VALUES('schemaVersion','1'),('backupSchemaVersion','2')");
      }
      db.exec('CREATE TABLE apiKeys(id TEXT PRIMARY KEY,key TEXT UNIQUE NOT NULL,accessRestricted INTEGER,accessAllow TEXT,createdAt TEXT NOT NULL)');
      db.run("INSERT INTO apiKeys VALUES('key-one','fixture-secret',1,'[\"openai/fixture\"]','2026-10-22T00:00:00.000Z')");
      db.exec('CREATE TABLE kv(scope TEXT,key TEXT,value TEXT)');
      db.run("INSERT INTO kv VALUES('pricing','openai','{\"fixture\":{\"input\":\"1\",\"output\":\"2\"}}')");
    });
    const schema = db.all('SELECT * FROM sqlite_master ORDER BY name'), keys = db.all('SELECT * FROM apiKeys'), prices = db.all('SELECT * FROM kv');
    const backups = await import('@/lib/db/backup.js');
    const backup = vi.spyOn(backups, 'backupDbLite').mockImplementation(() => { throw new Error('fixture backup failure'); });
    const { runMigrationOnce } = await import('@/lib/db/migrate.js');
    await expect(runMigrationOnce(db)).rejects.toThrow(/Required pre-schema backup failed/);
    // A failed adapter must not be cached as successfully migrated.
    await expect(runMigrationOnce(db)).rejects.toThrow(/Required pre-schema backup failed/);
    expect(backup).toHaveBeenCalledTimes(2);
    expect(db.all('SELECT * FROM sqlite_master ORDER BY name')).toEqual(schema);
    expect(db.all('SELECT * FROM apiKeys')).toEqual(keys); expect(db.all('SELECT * FROM kv')).toEqual(prices);
    expect(fs.existsSync(path.join(root, 'db/.accounting-coverage.json'))).toBe(false);
  });
});
