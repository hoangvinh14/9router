import { expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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

for (const fault of ['fsyncSync', 'renameSync']) {
  it(`retains the previous SQL.js image when ${fault} fails`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-sqljs-publish-'));
    const file = path.join(dir, 'data.sqlite');
    const { createSqlJsAdapter } = await import('../../src/lib/db/adapters/sqljsAdapter.js');
    try {
      const seed = await createSqlJsAdapter(file);
      seed.exec('CREATE TABLE fixture (id INTEGER); INSERT INTO fixture VALUES (1)');
      seed.close();
      const before = fs.readFileSync(file);
      const db = await createSqlJsAdapter(file);
      db.run('INSERT INTO fixture VALUES (2)');
      const inject = vi.spyOn(fs, fault).mockImplementation(() => {
        throw Object.assign(new Error('fixture storage failure'), { code: 'ENOSPC' });
      });
      try {
        expect(() => db.close()).toThrow('fixture storage failure');
        expect(fs.readFileSync(file)).toEqual(before);
        expect(fs.readdirSync(dir).sort()).toEqual(['data.sqlite', 'data.sqlite.sqljs-writer']);
      } finally {
        inject.mockRestore();
        db.close();
      }
      const reopened = await createSqlJsAdapter(file);
      try { expect(reopened.all('SELECT id FROM fixture ORDER BY id')).toEqual([{ id: 1 }, { id: 2 }]); }
      finally { reopened.close(); }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

it('excludes a second process and the native opener until the image writer closes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-sqljs-owner-'));
  const file = path.join(dir, 'data.sqlite');
  const sqlJsUrl = new URL('../../src/lib/db/adapters/sqljsAdapter.js', import.meta.url).href;
  const nativeUrl = new URL('../../src/lib/db/adapters/nodeSqliteAdapter.js', import.meta.url).href;
  const { createSqlJsAdapter } = await import('../../src/lib/db/adapters/sqljsAdapter.js');
  const first = await createSqlJsAdapter(file);
  try {
    first.exec('CREATE TABLE fixture (id INTEGER); INSERT INTO fixture VALUES (1)');
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', `
      import assert from 'node:assert/strict';
      import { createSqlJsAdapter } from ${JSON.stringify(sqlJsUrl)};
      import { openInstalledNodeSqliteAttempt } from ${JSON.stringify(nativeUrl)};
      const file = process.argv[1];
      await assert.rejects(createSqlJsAdapter(file), /already active or ownership is ambiguous/);
      const native = await openInstalledNodeSqliteAttempt(file);
      assert.equal(native.error.startupReason, 'sqljs_image_owned');
    `, file], { encoding: 'utf8', timeout: 10000 });
    expect(child.status, child.stderr).toBe(0);
    first.close();
    const reopened = await createSqlJsAdapter(file);
    try { expect(reopened.get('SELECT id FROM fixture')).toEqual({ id: 1 }); }
    finally { reopened.close(); }
  } finally {
    first.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
