import { retainKeyBindings } from '../../../src/lib/db/helpers/apiKeyBindings.js';

// Test-only fresh database fixture; avoids unrelated DB barrel exports/transform.
// Does not test configuration import/export. Keep real durable writes and key
// identity bindings; no mocked accounting repo, adapter or terminal coordinator.
export function seedGeminiAccountingFixture(db, loopback = false) {
  const timestamp = '2026-10-03T00:00:00.000Z';
  const keys = [{ id: 'a', key: 'dummy-key-a', createdAt: timestamp }];
  const settings = { requireApiKey: true, ...(loopback ? { outboundProxyEnabled: true, outboundProxyUrl: 'http://127.0.0.1:1', outboundNoProxy: '127.0.0.1' } : {}) };
  db.durableTransaction(() => {
    if (db.get('SELECT id FROM apiKeys') || db.get('SELECT id FROM providerConnections') || db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")) throw new Error('Gemini fixture requires fresh disposable DB');
    db.run('INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES(?,?,1,?)', [keys[0].id, keys[0].key, timestamp]);
    retainKeyBindings(db, db.coverage, keys);
    db.run('INSERT INTO settings(id,data) VALUES(1,?)', [JSON.stringify(settings)]);
    db.run('INSERT INTO providerConnections(id,provider,authType,isActive,data,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)', ['c', 'gemini', 'apikey', 1, JSON.stringify({ apiKey: 'dummy-provider' }), timestamp, timestamp]);
    // Explicit disposable fixture activation only, not a production API.
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt',?)", [timestamp]);
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','gemini',?)", [JSON.stringify({ 'fixture-gemini': { input: '1', output: '2', cached: '0.1' } })]);
  });
}
