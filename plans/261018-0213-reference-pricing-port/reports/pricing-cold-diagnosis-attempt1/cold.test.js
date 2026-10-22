import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { it } from 'vitest';
const output = new URL('./spans.jsonl', import.meta.url);
function emit(value) { fs.appendFileSync(output, JSON.stringify(value) + '\n'); }
it('cold Node operation timing diagnostic, not acceptance assertions', async () => {
  const start = performance.now();
  let api, db, sync, resolver, first;
  const span = async (name, work) => {
    const before = performance.now();
    try { const value = await work(); emit({ name, ms: performance.now() - before, elapsedMs: performance.now() - start, status: 'returned' }); return value; }
    catch (error) { emit({ name, ms: performance.now() - before, status: 'threw', error: { name: error.name, message: error.message } }); throw error; }
  };
  try {
    await span('boot', async () => {
      api = await import('/home/gmo/projects/9router/src/lib/db/index.js'); await api.initDb(); db = global._dbAdapter.instance;
      sync = await import('/home/gmo/projects/9router/src/lib/pricing/catalogSync.js');
      resolver = await import('/home/gmo/projects/9router/src/lib/pricing/referenceResolver.js');
      emit({ driver: db.driver });
    });
    await span('sync', () => sync.syncCatalog({ fetchImpl: async () => new Response(fs.readFileSync('/home/gmo/projects/9router/tests/fixtures/pricing/models-dev-minimal.json', 'utf8')) }));
    await span('override', () => api.updatePricing({ openai: { fixture: { input: '0.000000001', output: '0', cached: '0' } } }));
    await span('resolve', () => { first = resolver.resolveReferencePriceSync(db, 'openai', 'fixture'); });
    await span('noops', async () => { await api.updatePricing({}); await api.updatePricing({ openai: { fixture: { input: '0.000000001', output: '0', cached: '0' } } }); });
    await span('getPricing1', () => api.getPricing());
    await span('getPricing2', () => api.getPricing());
    await span('reopen', async () => { db.close(); db = await (await import('/home/gmo/projects/9router/src/lib/db/driver.js')).getAdapter(); });
    await span('schemaReads', async () => {
      const { latestVersion } = await import('/home/gmo/projects/9router/src/lib/db/migrations/index.js');
      const { SCHEMA_VERSION } = await import('/home/gmo/projects/9router/src/lib/db/schema.js');
      emit({ revisionMatches: resolver.resolveReferencePriceSync(db, 'openai', 'fixture').snapshot.revision === first.snapshot.revision,
        registry: latestVersion(), schema: SCHEMA_VERSION, schemaVersion: db.get("SELECT value FROM _meta WHERE key='schemaVersion'").value,
        backupSchemaVersion: db.get("SELECT value FROM _meta WHERE key='backupSchemaVersion'").value,
        columns: db.all('PRAGMA table_info(apiKeys)').map(row => row.name) });
    });
  } finally { db?.close(); emit({ event: 'total', ms: performance.now() - start }); delete global._dbAdapter; }
});
