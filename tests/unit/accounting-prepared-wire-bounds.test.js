import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { captureAccountingProxyEnvironment } from '../../open-sse/config/accountedProxyEnvironment.js';
import { captureAccountingBaseTransport } from '../../open-sse/config/accountedBaseTransport.js';
import { PROVIDERS } from '../../open-sse/config/providers.js';

let db, directory, createAccounting;
const old = process.env.DATA_DIR;
const meta = { provider: 'openai', model: 'fixture-chat', endpoint: 'chat', connectionId: 'c' };
const wire = size => ({ url: PROVIDERS.openai.baseUrl, stream: false, credentials: { apiKey: 'dummy-provider', accessToken: null },
  providerOverrides: { headers: { 'x-fixture': 'x'.repeat(size) } },
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer dummy-provider', 'x-fixture': 'x'.repeat(size) }, proxyEnvironment: captureAccountingProxyEnvironment(), runtimeTransport: null, baseTransport: captureAccountingBaseTransport(PROVIDERS.openai), urlIndex: 0 });
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-prepared-wire-bounds-')); process.env.DATA_DIR = directory; delete global._dbAdapter; vi.resetModules();
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key' }], settings: { requireApiKey: true },
    providerConnections: [{ id: 'c', provider: 'openai', authType: 'apikey', apiKey: 'dummy-provider' }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','openai',?)", [JSON.stringify({ 'fixture-chat': { input: '1', output: '2' } })]);
  });
  createAccounting = async () => (await import('@/lib/apiKeyBudget/requestAccounting.js')).createRequestAccounting(new Request('http://localhost/v1/chat/completions', {
    headers: { Authorization: 'Bearer dummy-key' } }), { adapter: async () => db, queued: true });
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true }); if (old === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = old; });
function saveHeaders(size) {
  db.durableTransaction(() => db.run('UPDATE settings SET data=? WHERE id=1', [JSON.stringify({ requireApiKey: true,
    providerOverrides: { openai: { headers: { 'x-fixture': 'x'.repeat(size) } } } })]));
}
describe('prepared wire retained data ceilings (not heap or throughput benchmarks)', () => {
  it('oversize original wire is refused before intent or independent gap permission', async () => {
    saveHeaders(300000);
    const context = await createAccounting();
    await expect(context.beforeAttempt(meta, true, wire(300000))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('queue byte ceiling includes retained wire rather than only request/operation identifiers', async () => {
    // Matching persisted override appears in original settings, override and
    // built header evidence; 60k each charges about 180k per retained command.
    saveHeaders(60000);
    const context = await createAccounting(), input = wire(60000);
    const work = Array.from({ length: 6 }, () => context.beforeAttempt(meta, true, input));
    expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
    const results = await Promise.allSettled(work);
    expect(results.slice(0, 5).every(result => result.status === 'fulfilled')).toBe(true);
    expect(results[5]).toMatchObject({ status: 'rejected', reason: { code: 'api_key_accounting_unavailable' } });
    expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(5); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('detached prepared evidence is not changed by original header mutation during wait', async () => {
    saveHeaders(0);
    const context = await createAccounting(), input = wire(0), work = context.beforeAttempt(meta, true, input);
    input.headers.Authorization = 'Bearer changed'; input.credentials.apiKey = 'changed';
    const attempt = await work;
    expect(attempt).toMatchObject({ apiKeyId: 'a', state: 'pending' });
    const row = db.get('SELECT * FROM apiKeyAccounting');
    expect(JSON.stringify(row)).not.toContain('dummy-provider'); expect(JSON.stringify(row)).not.toContain('Bearer');
  });
});
