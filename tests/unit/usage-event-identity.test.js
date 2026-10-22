import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const originalDataDir = process.env.DATA_DIR;
let dir, api, adapter;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), '9router-usage-identity-'));
  process.env.DATA_DIR = dir;
  delete global._dbAdapter;
  vi.resetModules();
});
afterEach(() => {
  vi.restoreAllMocks();
  adapter?.close(); adapter = null;
  delete global._dbAdapter;
  vi.doUnmock('@/lib/db/engineAcquisition.js'); vi.resetModules();
  fs.rmSync(dir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});
async function boot(sqljs) {
  if (sqljs) vi.doMock('@/lib/db/engineAcquisition.js', () => ({ initializeAvailableAdapter: async () => null }));
  api = await import('@/lib/db/index.js');
  await api.initDb();
  adapter = global._dbAdapter.instance;
  expect(adapter.driver).toBe(sqljs ? 'sql.js' : 'node:sqlite');
}
function event(timestamp) {
  return {
    timestamp, provider: 'identity-provider', model: 'identity-model', connectionId: 'identity-connection',
    tokens: { prompt_tokens: 10, completion_tokens: 5 }, status: 'ok', endpoint: '/v1/chat',
  };
}
for (const sqljs of [false, true]) {
  describe(`${sqljs ? 'SQL.js' : 'Node SQLite'} usage event identity`, () => {
    it('distinct calls with identical timestamps/fields count all events and survive orderly reopen', async () => {
      await boot(sqljs);
      const timestamp = new Date().toISOString();
      const entries = Array.from({ length: 100 }, () => event(timestamp));
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      await Promise.all(entries.map(entry => api.saveRequestUsage(entry)));
      expect(errors).not.toHaveBeenCalled();
      expect(entries.every(entry => entry.timestamp === timestamp)).toBe(true);
      expect(adapter.get('SELECT COUNT(*) AS n FROM usageHistory').n).toBe(100);
      expect(adapter.get("SELECT value FROM _meta WHERE key='totalRequestsLifetime'").value).toBe('100');
      const day = JSON.parse(adapter.get('SELECT data FROM usageDaily').data);
      expect(day).toMatchObject({ requests: 100, promptTokens: 1000, completionTokens: 500 });
      const stats = await api.getUsageStats('7d');
      expect(stats.byProvider['identity-provider']).toMatchObject({ requests: 100, promptTokens: 1000, completionTokens: 500 });
      expect(await api.getUsageHistory({ provider: 'identity-provider' })).toHaveLength(100);
      adapter.close();
      adapter = await (await import('@/lib/db/driver.js')).getAdapter();
      expect(adapter.get('SELECT COUNT(*) AS n FROM usageHistory').n).toBe(100);
    });
    it('reused input object and different endpoints do not become implicit idempotency or enrichment', async () => {
      await boot(sqljs);
      const entry = event(new Date().toISOString());
      entry.endpoint = null;
      await api.saveRequestUsage(entry);
      entry.endpoint = '/second';
      await api.saveRequestUsage(entry);
      await api.saveRequestUsage({ ...entry, endpoint: '/third' });
      expect(adapter.all('SELECT endpoint FROM usageHistory ORDER BY id')).toEqual([
        { endpoint: null }, { endpoint: '/second' }, { endpoint: '/third' },
      ]);
      expect(adapter.get("SELECT value FROM _meta WHERE key='totalRequestsLifetime'").value).toBe('3');
    });
    it('automatic timestamps at a fixed millisecond do not drop independent calls', async () => {
      await boot(sqljs);
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const timestamp = new Date().toISOString();
        const entries = Array.from({ length: 50 }, () => event(undefined));
        await Promise.all(entries.map(entry => api.saveRequestUsage(entry)));
        expect(entries.every(entry => entry.timestamp === timestamp)).toBe(true);
        expect(adapter.get('SELECT COUNT(*) AS n FROM usageHistory').n).toBe(50);
        const stats = await api.getUsageStats('7d');
        expect(stats.byProvider['identity-provider']).toMatchObject({ requests: 50, promptTokens: 500, completionTokens: 250 });
      } finally { vi.useRealTimers(); }
    });
  });
}
