import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = fs.readFileSync(new URL('../fixtures/pricing/models-dev-minimal.json', import.meta.url), 'utf8');
describe('committed immutable pricing snapshot memo', () => {
  let db, dir, pricing, resolver, sync;
  const previous = process.env.DATA_DIR;
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), '9router-price-memo-'));
    process.env.DATA_DIR = dir; delete global._dbAdapter; vi.resetModules();
    db = await (await import('@/lib/db/driver.js')).getAdapter();
    pricing = await import('@/lib/db/repos/pricingRepo.js');
    resolver = await import('@/lib/pricing/referenceResolver.js');
    sync = await import('@/lib/pricing/catalogSync.js');
  });
  afterEach(() => {
    vi.restoreAllMocks(); db?.close(); delete global._dbAdapter;
    fs.rmSync(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous;
  });
  const resolve = (provider = 'openai', model = 'gpt-5', endpoint = 'chat') => resolver.resolveReferencePriceSync(db, provider, model, endpoint);
  it('warm resolution reads fresh health/revision but does not reload or parse catalog/overrides', async () => {
    await sync.syncCatalog({ fetchImpl: async () => new Response(fixture) });
    const get = vi.spyOn(db, 'get');
    const first = resolve();
    get.mockClear();
    expect(resolve()).toBe(first);
    expect(get.mock.calls.some(([sql]) => /FROM kv/.test(sql))).toBe(false);
    expect(get.mock.calls.length).toBeGreaterThan(0);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.snapshot.rates)).toBe(true);
    expect(Object.isFrozen(first.snapshot.mapping)).toBe(true);
  });
  it('successful writes/reset invalidate without repricing retained snapshots; aliases/endpoints stay distinct', async () => {
    await pricing.updatePricing({ codex: { 'gpt-5': { input: '0', output: '2' } } });
    const alias = resolve('cx'), canonical = resolve('codex'), embedding = resolve('codex', 'gpt-5', 'embeddings');
    expect(alias).not.toBe(canonical); expect(embedding).not.toBe(canonical);
    await pricing.updatePricing({ cx: { 'gpt-5': { input: '3', output: '4', cached: '0' } } });
    expect(resolve('cx').snapshot.rates).toEqual({ input: '3', output: '4', cached: '0' });
    expect(resolve('codex').snapshot.rates.input).toBe('0');
    expect(alias.snapshot.rates.input).toBe('0');
    await pricing.resetPricing('cx', 'gpt-5');
    expect(resolve('cx').snapshot.rates).toEqual({ input: '0', output: '2' });
    await pricing.resetAllPricing(); expect(resolve('codex')).not.toBe(canonical);
  });
  it('raw kv mutations invalidate, unrelated status writes do not', async () => {
    const first = resolve();
    db.durableTransaction(() => db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','openai',?)", [JSON.stringify({ 'gpt-5': { input: '7', output: '8' } })]));
    const changed = resolve(); expect(changed.snapshot.rates.input).toBe('7'); expect(changed).not.toBe(first);
    db.durableTransaction(() => db.run("INSERT INTO kv(scope,key,value) VALUES('referencePricing','status','{}')"));
    expect(resolve()).toBe(changed);
    db.durableTransaction(() => db.run("DELETE FROM kv WHERE scope='pricing'"));
    expect(resolve().snapshot.rates.input).toBe(first.snapshot.rates.input);
  });
  it('rollback never publishes uncommitted cached state or reuses a collided revision', async () => {
    await pricing.updatePricing({ openai: { 'gpt-5': { input: '1', output: '2' } } });
    const first = resolve();
    expect(() => db.durableTransaction(() => {
      db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='openai'", [JSON.stringify({ 'gpt-5': { input: '9', output: '9' } })]);
      expect(resolve().snapshot.rates.input).toBe('9');
      throw new Error('rollback');
    })).toThrow('rollback');
    expect(resolve().snapshot.rates.input).toBe('1');
    await pricing.updatePricing({ openai: { 'gpt-5': { input: '3', output: '4' } } });
    expect(resolve().snapshot.rates.input).toBe('3'); expect(first.snapshot.rates.input).toBe('1');
  });
  it('sync status/failure retains last-good memo; new publication invalidates', async () => {
    await sync.syncCatalog({ fetchImpl: async () => new Response(fixture) });
    const first = resolve();
    await expect(sync.syncCatalog({ fetchImpl: async () => new Response('{') })).rejects.toThrow();
    expect(resolve()).toBe(first);
    await sync.syncCatalog({ fetchImpl: async () => new Response(fixture.replace('"input": 1.25', '"input": 2.25')) });
    expect(resolve().snapshot.rates.input).toBe('2.25'); expect(first.snapshot.rates.input).toBe('1.25');
  });
  it('health loss refuses warm memo and a reopen uses a new adapter read view', async () => {
    const first = resolve();
    const health = vi.spyOn(db, 'health').mockReturnValue({ healthy: false, poisoned: true, closed: false });
    expect(() => resolve()).toThrow(); health.mockRestore();
    expect(resolve()).not.toBe(first);
    db.close(); db = await (await import('@/lib/db/driver.js')).getAdapter();
    expect(resolve()).not.toBe(first);
  });
  it('actual configuration import invalidates the memo without changing a retained snapshot', async () => {
    const first = resolve();
    const { exportDb, importDb } = await import('@/lib/db/index.js');
    const config = await exportDb();
    config.pricing = { openai: { 'gpt-5': { input: '6', output: '8' } } };
    await importDb(config);
    expect(resolve().snapshot.rates.input).toBe('6');
    expect(first.snapshot.rates.input).toBe('1.25');
  });
  it('missing/corrupt revision cannot grant cached authority', () => {
    resolve();
    db.durableTransaction(() => db.run("UPDATE _meta SET value='broken' WHERE key='referencePricingRevision'"));
    expect(() => resolve()).toThrow(/revision/);
  });
  it('bounded exact identity memo evicts old rows without fuzzy model fallback', () => {
    const first = resolve();
    for (let i = 0; i < 1100; i++) expect(resolve('custom', `unknown-${i}`).status).toBe('unavailable');
    expect(resolve()).not.toBe(first);
    expect(resolve('custom', 'gpt-5')).toMatchObject({ status: 'unavailable' });
  });
});
