import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
const file = new URL('./spans.jsonl', import.meta.url), origin = performance.now();
function emit(value) {
  const fd = fs.openSync(file, 'a', 0o600);
  try { fs.writeSync(fd, JSON.stringify({ ms: performance.now() - origin, ...value }) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}
async function span(name, work) {
  emit({ event: 'start', name });
  try { const result = await work(); emit({ event: 'end', name }); return result; }
  catch (error) { emit({ event: 'error', name, error: { name: error.name, message: error.message, stack: error.stack } }); throw error; }
}
let db;
emit({ event: 'process', node: process.version, abi: process.versions.modules });
try {
  const api = await span('import-db-index', () => import('/home/gmo/projects/9router/src/lib/db/index.js'));
  await span('init-db', () => api.initDb()); db = global._dbAdapter.instance; emit({ event: 'driver', value: db.driver });
  const sync = await span('import-sync', () => import('/home/gmo/projects/9router/src/lib/pricing/catalogSync.js'));
  const resolver = await span('import-resolver', () => import('/home/gmo/projects/9router/src/lib/pricing/referenceResolver.js'));
  await span('sync-fixture', () => sync.syncCatalog({ fetchImpl: async () => new Response(fs.readFileSync('/home/gmo/projects/9router/tests/fixtures/pricing/models-dev-minimal.json', 'utf8')) }));
  await span('override', () => api.updatePricing({ openai: { fixture: { input: '0.000000001', output: '0', cached: '0' } } }));
  const first = await span('resolve', () => resolver.resolveReferencePriceSync(db, 'openai', 'fixture'));
  await span('noops', async () => { await api.updatePricing({}); await api.updatePricing({ openai: { fixture: { input: '0.000000001', output: '0', cached: '0' } } }); });
  await span('map1', () => api.getPricing()); await span('map2', () => api.getPricing());
  await span('reopen', async () => { db.close(); db = await (await import('/home/gmo/projects/9router/src/lib/db/driver.js')).getAdapter(); });
  emit({ event: 'observations', retainedRevision: first.snapshot.revision,
    reopenedRevision: resolver.resolveReferencePriceSync(db, 'openai', 'fixture').snapshot.revision,
    schemaVersion: db.get("SELECT value FROM _meta WHERE key='schemaVersion'").value,
    backupSchemaVersion: db.get("SELECT value FROM _meta WHERE key='backupSchemaVersion'").value });
} catch { process.exitCode = 1; }
finally { if (db) await span('close', () => db.close()); emit({ event: 'finished' }); }
