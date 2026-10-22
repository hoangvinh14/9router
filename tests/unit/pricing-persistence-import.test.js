import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDataDir = process.env.DATA_DIR;
const fixture = fs.readFileSync(new URL('../fixtures/pricing/models-dev-minimal.json', import.meta.url), 'utf8');
let root, api, db, sync, schedule, scheduler, resolver;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pricing-import-'));
  process.env.DATA_DIR = root; delete global._dbAdapter; vi.resetModules();
});
afterEach(() => {
  scheduler?.configureCatalogScheduler(false);
  vi.restoreAllMocks(); db?.close(); db = null; delete global._dbAdapter;
  vi.doUnmock('@/lib/db/engineAcquisition.js'); vi.resetModules();
  fs.rmSync(root, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = originalDataDir;
});
async function boot(sqljs) {
  if (sqljs) vi.doMock('@/lib/db/engineAcquisition.js', () => ({ initializeAvailableAdapter: async () => null }));
  api = await import('@/lib/db/index.js'); await api.initDb(); db = global._dbAdapter.instance;
  expect(db.driver).toBe(sqljs ? 'sql.js' : 'node:sqlite');
  sync = await import('@/lib/pricing/catalogSync.js'); schedule = await import('@/lib/pricing/catalogSchedule.js');
  scheduler = await import('@/lib/pricing/catalogScheduler.js'); scheduler.configureCatalogScheduler(false);
  resolver = await import('@/lib/pricing/referenceResolver.js');
}
const rev = () => db.get("SELECT value FROM _meta WHERE key='referencePricingRevision'").value;
for (const sqljs of [false, true]) {
  describe(`${sqljs ? 'SQL.js' : 'Node'} actual pricing persistence and config integration`, () => {
    it('acknowledges complete exact overrides durably, preserves numeric map and zero, and avoids no-op revision writes', async () => {
      await boot(sqljs);
      await sync.syncCatalog({ fetchImpl: async () => new Response(fixture) });
      await api.updatePricing({ openai: { fixture: { input: '0.000000001', output: '0', cached: '0' } } });
      const first = resolver.resolveReferencePriceSync(db, 'openai', 'fixture');
      expect(first.snapshot.rates).toEqual({ input: '0.000000001', output: '0', cached: '0' });
      const revision = rev();
      await api.updatePricing({}); await api.updatePricing({ openai: { fixture: { input: '0.000000001', output: '0', cached: '0' } } });
      expect(rev()).toBe(revision);
      expect((await api.getPricing()).openai.fixture).toEqual({ input: 0.000000001, output: 0, cached: 0 });
      expect((await api.getPricing()).openai['gpt-5'].input).toBe(1.25);
      db.close(); db = await (await import('@/lib/db/driver.js')).getAdapter();
      expect(resolver.resolveReferencePriceSync(db, 'openai', 'fixture').snapshot.revision).toBe(first.snapshot.revision);
      const { latestVersion } = await import('@/lib/db/migrations/index.js');
      const { SCHEMA_VERSION } = await import('@/lib/db/schema.js');
      expect(db.get("SELECT value FROM _meta WHERE key='schemaVersion'").value).toBe(String(latestVersion()));
      expect(db.get("SELECT value FROM _meta WHERE key='backupSchemaVersion'").value).toBe(String(SCHEMA_VERSION));
      expect(db.all('PRAGMA table_info(apiKeys)').map(row => row.name)).toEqual(expect.arrayContaining(['accessRestricted', 'accessAllow']));
      expect(db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined();
    }, 10_000); // Explicit user-approved cold-start budget; no prewarming or assertion changes.
    it('replaces complete model sources, merges unrelated concurrent models, and resets to synced not stale cache', async () => {
      await boot(sqljs); await sync.syncCatalog({ fetchImpl: async () => new Response(fixture) });
      await api.updatePricing({ codex: { 'gpt-5': { input: '0', output: '4' } } });
      expect(await api.getPricingForModel('cx', 'gpt-5')).toEqual({ input: 0, output: 4 });
      await api.updatePricing({ cx: { 'gpt-5': { input: '2', output: '3', cached: '0' } } });
      await api.updatePricing({ cx: { 'gpt-5': { input: '5', output: '6' } } });
      expect((await api.getPricing()).cx['gpt-5']).toEqual({ input: 5, output: 6 });
      const first = resolver.resolveReferencePriceSync(db, 'cx', 'gpt-5');
      await Promise.all(Array.from({ length: 20 }, (_, index) => api.updatePricing({ custom: { [`m${index}`]: { input: index, output: index * 2 } } })));
      expect(Object.keys((await api.getPricing()).custom)).toHaveLength(20);
      await api.resetPricing('cx', 'gpt-5');
      expect(await api.getPricingForModel('cx', 'gpt-5')).toEqual({ input: 0, output: 4 });
      await api.resetAllPricing();
      expect((await api.getPricing()).openai['gpt-5'].input).toBe(1.25);
      expect(first.snapshot.rates.input).toBe('5');
    });
    it('legacy configuration omission preserves catalog/schedule while explicit projection roundtrips ACL and snapshots invalidate', async () => {
      await boot(sqljs); await sync.syncCatalog({ fetchImpl: async () => new Response(fixture) });
      await schedule.setCatalogSchedule(true);
      const config = await api.exportDb();
      expect(config.referencePricing.version).toBe(1); expect(config.referencePricing.schedule.enabled).toBe(true);
      config.apiKeys = [{ id: 'fixture-key', key: 'dummy-fixture-key', access: { restricted: true, allow: ['openai/gpt-5'] } }];
      config.pricing = { openai: { 'gpt-5': { input: '0', output: '2' } } };
      await api.importDb(config);
      const exported = await api.exportDb();
      expect(exported.apiKeys[0].access).toEqual(config.apiKeys[0].access);
      const first = resolver.resolveReferencePriceSync(db, 'openai', 'gpt-5');
      delete config.referencePricing; config.pricing.openai['gpt-5'] = { input: '3', output: '4' };
      await api.importDb(config);
      expect((await sync.getStoredCatalog()).revision).toBe(exported.referencePricing.catalog.revision);
      expect(schedule.readCatalogScheduleSync(db)).toBe(true);
      expect(resolver.resolveReferencePriceSync(db, 'openai', 'gpt-5').snapshot.rates.input).toBe('3');
      expect(first.snapshot.rates.input).toBe('0');
      expect(db.all('PRAGMA table_info(apiKeys)').map(row => row.name)).toEqual(expect.arrayContaining(['accessRestricted', 'accessAllow']));
    });
    it('invalid sparse overrides or forged catalog projection reject before any destructive config change', async () => {
      await boot(sqljs); await sync.syncCatalog({ fetchImpl: async () => new Response(fixture) });
      await api.updatePricing({ openai: { fixture: { input: '1', output: '2' } } });
      const before = await api.exportDb(), revision = rev();
      const sparse = structuredClone(before); sparse.pricing = { openai: { fixture: { input: '9' } } }; sparse.settings = { destructive: true };
      await expect(api.importDb(sparse)).rejects.toThrow();
      expect(await api.exportDb()).toEqual(before); expect(rev()).toBe(revision);
      const forged = structuredClone(before); forged.referencePricing.catalog.source = 'http://127.0.0.1/';
      await expect(api.importDb(forged)).rejects.toThrow();
      expect(await api.exportDb()).toEqual(before);
    });
    it('malformed or schema-invalid stored rows fail closed and invalid reset identifiers never become no-ops', async () => {
      await boot(sqljs);
      for (const bad of ['{', '{"fixture":{"input":"1"}}']) {
        db.durableTransaction(() => db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','corrupt',?) ON CONFLICT(scope,key) DO UPDATE SET value=excluded.value", [bad]));
        await expect(api.getPricing()).rejects.toThrow();
        await expect(api.updatePricing({ corrupt: { fixture: { input: '2', output: '3' } } })).rejects.toThrow();
        expect(db.get("SELECT value FROM kv WHERE scope='pricing' AND key='corrupt'").value).toBe(bad);
      }
      await api.resetAllPricing();
      for (const provider of ['', 0, false]) await expect(api.resetPricing(provider)).rejects.toThrow();
      await expect(api.resetPricing('openai', '')).rejects.toThrow();
    });
    it('invalid ACL rolls back destructive import and postcommit runtime failure reports saved config then disables timer', async () => {
      await boot(sqljs);
      await api.updatePricing({ openai: { fixture: { input: '1', output: '2' } } });
      const before = await api.exportDb(), invalid = structuredClone(before);
      invalid.apiKeys = [{ id: 'invalid', key: 'dummy', access: { restricted: 'not-boolean' } }];
      await expect(api.importDb(invalid)).rejects.toThrow();
      expect(await api.exportDb()).toEqual(before);
      const config = structuredClone(before); config.referencePricing.schedule.enabled = true;
      const actual = scheduler.configureCatalogScheduler;
      vi.spyOn(scheduler, 'configureCatalogScheduler').mockImplementation(enabled => {
        if (enabled) throw new Error('timer injected');
        return actual(false);
      });
      await expect(api.importDb(config)).rejects.toMatchObject({ configurationSaved: true });
      expect(schedule.readCatalogScheduleSync(db)).toBe(true);
      expect(scheduler.isCatalogSchedulerEnabled()).toBe(false);
    });
    it('paused fetch may publish after import/disable without restoring old schedule or overwriting imported overrides', async () => {
      await boot(sqljs); await schedule.setCatalogSchedule(true);
      let finish, started;
      const gate = new Promise(resolve => { finish = resolve; });
      const admitted = new Promise(resolve => { started = resolve; });
      const flight = sync.syncCatalog({ fetchImpl: async () => { started(); await gate; return new Response(fixture); } });
      await admitted;
      const config = await api.exportDb(); config.referencePricing.schedule.enabled = false;
      config.pricing = { openai: { 'gpt-5': { input: '0', output: '7' } } };
      await api.importDb(config); finish(); await flight;
      expect(schedule.readCatalogScheduleSync(db)).toBe(false); expect(scheduler.isCatalogSchedulerEnabled()).toBe(false);
      expect((await sync.getStoredCatalog()).entries['openai/gpt-5'].rates.input).toBe('1.25');
      expect(resolver.resolveReferencePriceSync(db, 'openai', 'gpt-5').snapshot.rates).toEqual({ input: '0', output: '7' });
    });
    it('editor projection preserves custom exact values and untouched fields across complete model edits without numeric roundtrip', async () => {
      await boot(sqljs); await sync.syncCatalog({ fetchImpl: async () => new Response(fixture) });
      const rates = { input: '8999999.999999999', output: '0', cached: '0', input_image: '8765432.123456789' };
      await api.updatePricing({ custom: { 'outside-registry': rates }, codex: { 'gpt-5': { input: '0', output: '4' } } });
      const before = rev(), original = resolver.resolveReferencePriceSync(db, 'custom', 'outside-registry').snapshot;
      const { exact } = await api.getEditorPricing();
      expect(exact.custom['outside-registry']).toEqual(rates);
      expect(exact.openai['gpt-5'].input).toBe('1.25'); expect(exact.cx['gpt-5']).toEqual({ input: '0', output: '4' });
      expect(exact.custom['outside-registry']).not.toHaveProperty('reasoning'); expect(rev()).toBe(before);
      const numeric = (await api.getPricing()).custom['outside-registry'];
      expect(typeof numeric.input).toBe('number'); expect(String(numeric.input)).not.toBe(rates.input);
      await api.updatePricing({ custom: { 'outside-registry': { ...exact.custom['outside-registry'], output: '3' } } });
      expect((await api.getEditorPricing()).exact.custom['outside-registry']).toEqual({ ...rates, output: '3' });
      expect(original.rates).toEqual(rates);
      db.close(); db = await (await import('@/lib/db/driver.js')).getAdapter();
      expect((await api.getEditorPricing()).exact.custom['outside-registry'].input_image).toBe(rates.input_image);
      await api.resetPricing('codex', 'gpt-5'); expect((await api.getEditorPricing()).exact.cx['gpt-5'].input).not.toBe('0');
      await api.resetPricing('custom', 'outside-registry'); expect((await api.getEditorPricing()).exact.custom).toBeUndefined();
      expect(db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined();
    });
    it('invalid legacy sparse migration retains JSON, creates no import marker or partial pricing rows', async () => {
      const legacy = { pricing: { openai: { fixture: { input: 9 } } }, settings: { marker: 'must-not-import' } };
      const file = path.join(root, 'db.json'); fs.writeFileSync(file, JSON.stringify(legacy));
      if (sqljs) vi.doMock('@/lib/db/engineAcquisition.js', () => ({ initializeAvailableAdapter: async () => null }));
      const driver = await import('@/lib/db/driver.js');
      await expect(driver.getAdapter()).rejects.toThrow();
      expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(legacy);
      expect(fs.existsSync(path.join(root, 'db', '.migrated-from-json'))).toBe(false);
      // Failed initialization closes its successfully opened engine; direct factory
      // can inspect the disposable file without relying on a rejected singleton.
      const factory = sqljs ? (await import('@/lib/db/adapters/sqljsAdapter.js')).createSqlJsAdapter
        : (await import('@/lib/db/adapters/nodeSqliteAdapter.js')).createNodeSqliteAdapter;
      db = await factory(path.join(root, 'db', 'data.sqlite'));
      expect(db.all("SELECT value FROM kv WHERE scope='pricing'")).toHaveLength(0);
    });
  });
}
