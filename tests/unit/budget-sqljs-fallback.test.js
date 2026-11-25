import { expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Exercise the optional-driver boundary while retaining the real WASM engine.
vi.mock('../../src/lib/db/adapters/betterSqliteAdapter.js', () => { throw new Error('optional native addon unavailable'); });
vi.mock('node:sqlite', () => { throw new Error('native SQLite unavailable'); });

it('SQL.js fallback keeps ordinary data and refuses accounting authority', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-sqljs-'));
  vi.stubEnv('DATA_DIR', dir);
  try {
    const { getAccountingAdapter, getAdapter } = await import('../../src/lib/db/driver.js');
    const { DATA_FILE } = await import('../../src/lib/db/paths.js');
    const ordinary = await getAdapter();
    try {
      expect(ordinary.driver).toBe('sql.js');
      expect(ordinary.get("SELECT name FROM sqlite_schema WHERE name='apiKeys'").name).toBe('apiKeys');
      await expect(getAccountingAdapter()).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
      ordinary.run('INSERT INTO kv VALUES(?,?,?)', ['fixture','ordinary','saved']);
    } finally { ordinary.close(); }
    const { createSqlJsAdapter } = await import('../../src/lib/db/adapters/sqljsAdapter.js');
    const reopened = await createSqlJsAdapter(DATA_FILE);
    try {
      expect(reopened.get("SELECT value FROM kv WHERE scope='fixture' AND key='ordinary'").value).toBe('saved');
      expect(reopened.get("SELECT count(*) AS n FROM sqlite_schema WHERE name='accounting_attempts_v1'").n).toBe(0);
    } finally { reopened.close(); }
  } finally {
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it('refuses a native WAL database whose current schema is only in the WAL', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-sqljs-wal-'));
  const file = path.join(dir, 'data.sqlite');
  const { DatabaseSync } = await vi.importActual('node:sqlite');
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA journal_mode = WAL; CREATE TABLE ordinary (id INTEGER); PRAGMA wal_checkpoint(TRUNCATE)');
    const before = fs.readFileSync(file);
    db.exec('CREATE TABLE accounting_key_policy_v1 (key_id TEXT PRIMARY KEY)');
    expect(fs.readFileSync(file)).toEqual(before);
    const wal = fs.readFileSync(file + '-wal');
    expect(wal.length).toBeGreaterThan(0);
    const { createSqlJsAdapter } = await import('../../src/lib/db/adapters/sqljsAdapter.js');
    await expect(createSqlJsAdapter(file)).rejects.toThrow('SQL.js cannot open a native SQLite WAL database');
    expect(fs.readFileSync(file)).toEqual(before);
    expect(fs.readFileSync(file + '-wal')).toEqual(wal);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
