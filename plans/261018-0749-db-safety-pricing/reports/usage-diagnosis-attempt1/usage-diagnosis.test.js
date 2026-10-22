import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from '/home/gmo/projects/9router/tests/node_modules/vitest/dist/index.js';

vi.mock('/home/gmo/projects/9router/src/lib/db/engineAcquisition.js', async (importOriginal) => {
  if (process.env.DIAG_FORCE_SQLJS === '1') return { initializeAvailableAdapter: async () => null };
  return importOriginal();
});
const root = process.env.DIAG_ROOT;
const lane = process.env.DIAG_FORCE_SQLJS === '1' ? 'sqljs' : 'node';
const receipt = { lane, node: process.version, cases: [], purpose: 'diagnosis-only; original concurrency assertions remain unchanged/red' };
const source = '/home/gmo/projects/9router/src/lib/db/repos/usageRepo.js';
receipt.usageSourceSha256 = createHash('sha256').update(fs.readFileSync(source)).digest('hex');

describe('usage dedup causal diagnosis, not original regression replacement', () => {
  for (const scenario of [
    { name: 'identical-fixed-50', n: 50, stamp: 'same', provider: 'google', expected: 1 },
    { name: 'unique-fixed-100', n: 100, stamp: 'unique', provider: 'openai', expected: 100 },
    { name: 'automatic-100', n: 100, stamp: 'auto', provider: 'openai' },
    { name: 'automatic-50', n: 50, stamp: 'auto', provider: 'google' },
  ]) {
    it(scenario.name, async () => {
      const dir = path.join(root, lane, scenario.name);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      process.env.DATA_DIR = dir;
      delete global._dbAdapter;
      vi.resetModules();
      let adapter;
      const errors = [];
      const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.map(String)));
      try {
        const api = await import('/home/gmo/projects/9router/src/lib/db/index.js');
        await api.initDb();
        adapter = global._dbAdapter.instance;
        expect(adapter.driver).toBe(lane === 'sqljs' ? 'sql.js' : 'node:sqlite');
        const base = Date.now();
        const entries = Array.from({ length: scenario.n }, (_, i) => ({
          provider: scenario.provider, model: 'diagnostic-model', connectionId: 'diagnostic-connection',
          tokens: { prompt_tokens: 100, completion_tokens: 50 }, status: 'ok',
          ...(scenario.stamp === 'auto' ? {} : { timestamp: new Date(base + (scenario.stamp === 'unique' ? i : 0)).toISOString() }),
        }));
        await Promise.all(entries.map(entry => api.saveRequestUsage(entry)));
        const uniqueTimestamps = new Set(entries.map(entry => entry.timestamp)).size;
        const history = await api.getUsageHistory({ provider: scenario.provider });
        const stats = await api.getUsageStats('7d');
        const providerStats = stats.byProvider[scenario.provider];
        const rawRows = adapter.get('SELECT COUNT(*) AS n FROM usageHistory').n;
        const counters = { requests: providerStats?.requests, promptTokens: providerStats?.promptTokens, completionTokens: providerStats?.completionTokens };
        receipt.cases.push({ name: scenario.name, requested: scenario.n, uniqueTimestamps, history: history.length, rawRows, counters, errors });
        // Tests the dedup prediction explicitly; does not redefine the product's no-count-loss contract.
        expect(errors).toEqual([]);
        expect(history.length).toBe(uniqueTimestamps);
        expect(rawRows).toBe(uniqueTimestamps);
        expect(counters).toEqual({ requests: uniqueTimestamps, promptTokens: uniqueTimestamps * 100, completionTokens: uniqueTimestamps * 50 });
        if (scenario.expected !== undefined) expect(history.length).toBe(scenario.expected);
      } finally {
        errorSpy.mockRestore();
        adapter?.close();
        delete global._dbAdapter;
        fs.mkdirSync(path.join(root, 'evidence'), { recursive: true });
        fs.writeFileSync(path.join(root, 'evidence', `${lane}-diagnosis.json`), JSON.stringify(receipt, null, 2));
      }
    });
  }
});
