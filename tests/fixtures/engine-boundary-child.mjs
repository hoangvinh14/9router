// Actual owned driver startup in a disposable DATA_DIR, not a mocked factory.
process.env.DATA_DIR = process.argv[2];
const { createServer } = await import('../node_modules/vite/dist/node/index.js');
const { resolve } = await import('node:path');
const server = await createServer({ configFile: false, root: resolve(import.meta.dirname, '../..'), server: { middlewareMode: true, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, resolve: { alias: { '@': resolve(import.meta.dirname, '../../src'), 'open-sse': resolve(import.meta.dirname, '../../open-sse') } } });
const emit = process.emit;
let db;
try {
  const { getAdapter } = await server.ssrLoadModule('/src/lib/db/driver.js');
  db = await getAdapter();
  const marker = db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'");
  console.log('RESULT:' + JSON.stringify({ opened: true, driver: db.driver, enforcementActive: !!marker?.value, emitPreserved: process.emit === emit }));
} catch {
  console.log('RESULT:' + JSON.stringify({ opened: false, emitPreserved: process.emit === emit }));
} finally { db?.close(); await server.close(); }
