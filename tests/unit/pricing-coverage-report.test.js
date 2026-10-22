import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { createNodeSqliteAdapter } from '@/lib/db/adapters/nodeSqliteAdapter.js';
import { createSqlJsAdapter } from '@/lib/db/adapters/sqljsAdapter.js';
import { installPricingRevision } from '@/lib/db/pricingRevision.js';
import { validateCatalog } from '@/lib/pricing/catalogSync.js';
const state = vi.hoisted(() => ({ db: null }));
vi.mock('@/lib/db/driver.js', () => ({ getAdapter: async () => state.db }));
import { getPricingCoverage, pricingCoverageQuery } from '@/lib/pricing/coverageReport.js';
import REGISTRY from '../../open-sse/providers/registry/index.js';
import { modelKind } from '../../open-sse/providers/models/schema.js';
let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-view-')); });
afterEach(() => { vi.restoreAllMocks(); state.db?.close(); state.db = null; fs.rmSync(root, { recursive: true, force: true }); });
async function boot(sqljs) {
  const file = path.join(root, 'fixture.sqlite');
  state.db = sqljs ? await createSqlJsAdapter(file) : await createNodeSqliteAdapter(file);
  state.db.durableTransaction(() => state.db.exec('CREATE TABLE kv(scope TEXT,key TEXT,value TEXT,PRIMARY KEY(scope,key)); CREATE TABLE _meta(key TEXT PRIMARY KEY,value TEXT)'));
  installPricingRevision(state.db);
  expect(state.db.driver).toBe(sqljs ? 'sql.js' : 'node:sqlite');
}
for (const sqljs of [false, true]) describe(`${sqljs ? 'SQL.js' : 'Node'} guarded coverage view`, () => {
  it('covers exact current registry endpoints and paginates a stable revision without certifying usage', async () => {
    await boot(sqljs);
    const expected = REGISTRY.flatMap(p => (p.models || []).filter(m => ['llm', 'embedding'].includes(modelKind(m))).map(m => `${p.id}/${m.id}/${modelKind(m) === 'embedding' ? 'embeddings' : 'chat'}`)).sort();
    const first = await getPricingCoverage({ limit: 200 });
    const rows = [...first.rows]; let offset = first.nextOffset;
    while (offset !== null) { const page = await getPricingCoverage({ offset, limit: 200, revision: first.revision }); rows.push(...page.rows); offset = page.nextOffset; }
    expect(rows.map(row => `${row.provider}/${row.model}/${row.endpoint}`).sort()).toEqual(expected);
    expect(first.counts.total).toBe(expected.length); expect(first.counts.priced + first.counts.unavailable).toBe(expected.length);
    expect(first.usageCertified).toBe(false); expect(first.virtualReference).toBe(true);
    expect(first.counts.byEndpoint.embeddings.total).toBe(expected.filter(id => id.endsWith('/embeddings')).length);
  });
  it('flushes dirty state, returns exact zero rates, conflicts after raw revision drift and preserves old rows', async () => {
    await boot(sqljs); const old = await getPricingCoverage({ limit: 200 });
    state.db.run("INSERT INTO kv VALUES('pricing','openai',?)", [JSON.stringify({ 'gpt-5': { input: '0.000000001', output: '0', cached: '0' } })]);
    await expect(getPricingCoverage({ revision: old.revision })).rejects.toMatchObject({ status: 409, code: 'pricing_coverage_revision_changed' });
    expect(state.db.canMemoizePricing()).toBe(true);
    const current = await getPricingCoverage({ limit: 200 });
    const find = async () => {
      for (let offset = 0; offset < current.counts.total; offset += 200) {
        const page = await getPricingCoverage({ offset, limit: 200, revision: current.revision });
        const row = page.rows.find(row => row.provider === 'openai' && row.model === 'gpt-5'); if (row) return row;
      }
    };
    expect(await find()).toMatchObject({ status: 'priced', source: 'manual', rates: { input: '0.000000001', output: '0', cached: '0' } });
    expect(current.revision).not.toBe(old.revision);
    state.db.close(); state.db = sqljs ? await createSqlJsAdapter(path.join(root, 'fixture.sqlite')) : await createNodeSqliteAdapter(path.join(root, 'fixture.sqlite'));
    expect((await getPricingCoverage()).revision).toBe(current.revision);
  });
  it('rejects corrupt revision/catalog and unhealthy storage rather than serving stale data', async () => {
    await boot(sqljs); await getPricingCoverage();
    state.db.run("UPDATE _meta SET value='bad' WHERE key='referencePricingRevision'");
    await expect(getPricingCoverage()).rejects.toThrow('revision unavailable');
    state.db.run("UPDATE _meta SET value='0' WHERE key='referencePricingRevision'");
    state.db.run("INSERT INTO kv VALUES('referencePricing','catalog','{}')");
    await expect(getPricingCoverage()).rejects.toMatchObject({ status: 503 });
    state.db.close(); await expect(getPricingCoverage()).rejects.toThrow();
  });
  it('reads and validates a staged catalog once per synchronous view, invalid manual blocks fallback', async () => {
    await boot(sqljs);
    const catalog = { ...validateCatalog(fs.readFileSync(new URL('../fixtures/pricing/models-dev-minimal.json', import.meta.url), 'utf8')), syncedAt: '2026-10-19T00:00:00.000Z' };
    state.db.durableTransaction(() => {
      state.db.run("INSERT INTO kv VALUES('referencePricing','catalog',?)", [JSON.stringify(catalog)]);
      state.db.run("INSERT INTO kv VALUES('pricing','openai',?)", [JSON.stringify({ 'gpt-5': { input: '1' } })]);
    });
    const spy = vi.spyOn(state.db, 'get');
    const report = await getPricingCoverage({ limit: 200 });
    const catalogReads = spy.mock.calls.filter(([sql, params]) => sql === 'SELECT value FROM kv WHERE scope=? AND key=?' && params[0] === 'referencePricing' && params[1] === 'catalog');
    expect(catalogReads).toHaveLength(1);
    const expected = REGISTRY.flatMap(p => (p.models || []).filter(m => ['llm', 'embedding'].includes(modelKind(m))).map(m => ({ provider: p.id, model: m.id, endpoint: modelKind(m) === 'embedding' ? 'embeddings' : 'chat' })))
      .sort((a, b) => JSON.stringify([a.provider, a.model, a.endpoint]).localeCompare(JSON.stringify([b.provider, b.model, b.endpoint]), 'en'));
    const index = expected.findIndex(row => row.provider === 'openai' && row.model === 'gpt-5'); expect(index).toBeGreaterThanOrEqual(0);
    const page = await getPricingCoverage({ offset: index, limit: 1, revision: report.revision });
    expect(page.rows[0]).toMatchObject({ status: 'unavailable', reason: 'invalid_complete_reference_rates' });
  });
});
describe('coverage query bounds', () => {
  it('accepts only canonical unique pagination fields and validates ranges before DB access', async () => {
    for (const query of ['limit=01', 'limit=-1', 'offset=1.5', 'limit=1&limit=2', 'url=http://private', 'revision=']) {
      await expect(async () => getPricingCoverage(pricingCoverageQuery(new Request(`http://localhost/api/pricing/coverage?${query}`)))).rejects.toThrow();
    }
    await expect(getPricingCoverage({ limit: 201 })).rejects.toMatchObject({ status: 400 });
    expect(pricingCoverageQuery(new Request('http://localhost/api/pricing/coverage?limit=20&offset=0'))).toEqual({ limit: 20, offset: 0, revision: null });
  });
});
