import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { verifyAccountingSchema } from '../../src/lib/db/migrations/002-accounting-foundation.js';

let root, api, db; const original = process.env.DATA_DIR;
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; vi.doUnmock('@/lib/db/engineAcquisition.js'); vi.resetModules(); if (original === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = original; if (root) fs.rmSync(root, { recursive: true, force: true }); });
for (const engine of ['node', 'sqljs']) describe(`${engine} configuration identity safety`, () => {
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'accounting-import-')); process.env.DATA_DIR = root; delete global._dbAdapter; vi.resetModules();
    if (engine === 'sqljs') vi.doMock('@/lib/db/engineAcquisition.js', () => ({ initializeAvailableAdapter: async () => null }));
    api = await import('@/lib/db/index.js'); await api.initDb(); db = global._dbAdapter.instance;
  });
  it('preserves ACL/pricing round trips and refuses collisions or deleted-key resurrection atomically', async () => {
    expect(db.driver).toBe(engine === 'node' ? 'node:sqlite' : 'sql.js');
    const payload = await api.exportDb();
    payload.apiKeys = [{ id: 'key-one', key: 'fixture-secret', access: { restricted: true, allow: ['openai/fixture'] } }];
    payload.pricing = { openai: { fixture: { input: '1', output: '2' } } }; await api.importDb(payload);
    const before = await api.exportDb();
    const material = fs.readFileSync(path.join(root, 'db/.accounting-coverage.json'));
    for (const keys of [[{ ...payload.apiKeys[0], key: 'different' }], [{ ...payload.apiKeys[0], id: 'different' }], [payload.apiKeys[0], payload.apiKeys[0]]]) {
      await expect(api.importDb({ ...before, apiKeys: keys })).rejects.toThrow(/conflict|Duplicate/);
      expect(await api.exportDb()).toEqual(before);
      expect(fs.readFileSync(path.join(root, 'db/.accounting-coverage.json')).equals(material)).toBe(true);
    }
    await api.importDb(before); expect((await api.exportDb()).apiKeys).toEqual(before.apiKeys);
    const backups = await import('@/lib/db/backup.js');
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-22T00:00:00.000Z'));
    const first = backups.makeBackupDir('same-second'); backups.backupDbLite(db, first);
    const originalBackup = fs.readFileSync(path.join(first, 'data.sqlite'));
    const second = backups.makeBackupDir('same-second'); backups.backupDbLite(db, second);
    expect(first).not.toBe(second); expect(fs.readFileSync(path.join(first, 'data.sqlite')).equals(originalBackup)).toBe(true);
    const copy = new DatabaseSync(path.join(second, 'data.sqlite'));
    try { verifyAccountingSchema({ get: (sql, params) => copy.prepare(sql).get(...params) }); }
    finally { copy.close(); }
    expect(fs.existsSync(path.join(second, '.accounting-coverage.json'))).toBe(true);
    vi.useRealTimers();
    const state = await api.exportDb(), sidecar = fs.readFileSync(path.join(root, 'db/.accounting-coverage.json'));
    vi.spyOn(backups, 'backupDbLite').mockImplementationOnce(() => { throw new Error('backup unavailable'); });
    await expect(api.importDb({ ...before, apiKeys: [] })).rejects.toThrow('backup unavailable');
    expect(await api.exportDb()).toEqual(state); expect(fs.readFileSync(path.join(root, 'db/.accounting-coverage.json')).equals(sidecar)).toBe(true);
    await api.updateApiKey('key-one', { isActive: false });
    expect((await api.getApiKeyById('key-one')).access).toEqual(payload.apiKeys[0].access);
    await expect(api.updateApiKey('key-one', { key: 'different' })).rejects.toThrow(/conflict/);
    const binding = db.get("SELECT * FROM apiKeyBindings WHERE apiKeyId='key-one'");
    db.durableTransaction(() => db.run("DELETE FROM apiKeyBindings WHERE apiKeyId='key-one'"));
    await expect(api.updateApiKey('key-one', { name: 'renamed' })).rejects.toThrow(/binding missing/);
    await expect(api.importDb(before)).rejects.toThrow(/binding missing/);
    db.durableTransaction(() => db.run('INSERT INTO apiKeyBindings(apiKeyId,fingerprint,createdAt) VALUES(?,?,?)', [binding.apiKeyId, binding.fingerprint, binding.createdAt]));
    await api.deleteApiKey('key-one');
    await expect(api.importDb(before)).rejects.toThrow(/conflict/);
    expect(await api.getApiKeys()).toEqual([]);
    expect(db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined();
  });
});
