import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createSqlJsAdapter } from '@/lib/db/adapters/sqljsAdapter.js';
import { createNodeSqliteAdapter } from '@/lib/db/adapters/nodeSqliteAdapter.js';
import { acquireWriterOwnership } from '@/lib/db/writerOwnership.js';
import { runMigrationOnce } from '@/lib/db/migrate.js';
import { openAccountingCoverage } from '@/lib/db/accountingCoverage.js';
import { retainKeyBindings } from '@/lib/db/helpers/apiKeyBindings.js';
import { initializeExplicitPoliciesSync } from '../fixtures/legacy-policy-initialization.mjs';
const seams = vi.hoisted(() => ({ ordinary: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/db/driver.js', () => ({ getAdapter: async () => globalThis.__unhealthyEmbeddingFixture }));
vi.mock('@/lib/localDb', () => ({ getSettings: (...args) => seams.ordinary(...args) }));
vi.mock('../../src/sse/services/auth.js', () => ({ extractApiKey: request => request.headers.get('authorization')?.slice(7),
  isValidApiKey: (...args) => seams.ordinary(...args), getProviderCredentials: (...args) => seams.ordinary(...args),
  markAccountUnavailable: (...args) => seams.ordinary(...args), clearAccountError: (...args) => seams.ordinary(...args) }));
vi.mock('../../src/sse/services/model.js', () => ({ getModelInfo: (...args) => seams.ordinary(...args) }));
vi.mock('../../src/sse/services/tokenRefresh.js', () => ({ updateProviderCredentials: (...args) => seams.ordinary(...args), checkAndRefreshToken: (...args) => seams.ordinary(...args) }));
vi.mock('@/lib/usageDb.js', () => ({ saveRequestUsage: (...args) => seams.ordinary(...args) }));
vi.mock('open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => seams.post(...args) }));
for (const engine of ['node:sqlite', 'sql.js']) describe(`unhealthy embeddings independently owned entry ${engine}, mocked POST`, { timeout: 20000 }, () => {
  let db, owner, dir, file;
  beforeEach(async () => {
    vi.resetModules(); seams.ordinary.mockReset().mockImplementation(() => { throw new Error('Fixture ordinary embeddings seam forbidden'); }); seams.post.mockReset();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), '9router-unhealthy-embedding-')); file = path.join(dir, 'data.sqlite'); owner = acquireWriterOwnership(dir);
    db = await (engine === 'sql.js' ? createSqlJsAdapter : createNodeSqliteAdapter)(file, owner);
    await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner); db.ownerInstanceId = owner.instanceId; globalThis.__unhealthyEmbeddingFixture = db;
    db.durableTransaction(() => {
      db.run("INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES('key-a','fixture-gateway',1,'2026-10-03T00:00:00.000Z')"); retainKeyBindings(db, db.coverage, [{ id: 'key-a', key: 'fixture-gateway' }]);
      db.run('INSERT INTO settings(id,data) VALUES(1,?)', [JSON.stringify({ requireApiKey: true, outboundProxyEnabled: false })]);
      db.run('INSERT INTO providerConnections(id,provider,authType,priority,isActive,data,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)',
        ['fixture-connection', 'openai', 'apikey', 1, 1, JSON.stringify({ apiKey: 'fixture-upstream', providerSpecificData: {} }), '2026-10-03T00:00:00.000Z', '2026-10-03T00:00:00.000Z']);
    }); initializeExplicitPoliciesSync(db); db.durableTransaction(() => db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')"));
  });
  function poison() {
    if (engine === 'sql.js') { const rename = fs.renameSync; vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (to === file) throw new Error('Fixture embedding poison'); return rename(from, to); }); }
    else { const exec = DatabaseSync.prototype.exec; let injected = false; vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (sql) { if (!injected && sql.startsWith('RELEASE')) { injected = true; throw new Error('Fixture embedding poison'); } return exec.call(this, sql); }); }
    expect(() => db.durableTransaction(() => db.run("UPDATE apiKeys SET name='not-persisted'"))).toThrow('Fixture embedding poison'); vi.restoreAllMocks();
  }
  afterEach(() => { vi.restoreAllMocks(); db?.close(); owner?.release(); delete globalThis.__unhealthyEmbeddingFixture; fs.rmSync(dir, { recursive: true, force: true }); });
  it.each(['/v1/embeddings', '/api/v1/embeddings'])('canonical text float %s requires independently proved own admission/terminal gap ACK', async route => {
    poison(); const get = vi.spyOn(db, 'get'), all = vi.spyOn(db, 'all'), latch = vi.spyOn(db.coverage, 'latchGap');
    const original = { model: 'openai/fixture-embedding', input: ['fixture original'], encoding_format: 'float' };
    seams.post.mockImplementation((url, init, proxy, contract) => {
      expect(latch).toHaveBeenCalledWith('key-a', 'unhealthy_unlimited_admission'); expect(db.coverage.status('key-a').gaps).toHaveLength(1);
      expect(url).toBe('https://api.openai.com/v1/embeddings'); expect(init.method).toBe('POST'); expect(init.redirect).toBe('error'); expect(contract.singlePost).toBe(true);
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer fixture-upstream'); expect(JSON.parse(init.body)).toEqual({ ...original, model: 'fixture-embedding' });
      expect(proxy.persistedGlobalProxy).toBeNull();
      return Response.json({ object: 'list', model: 'fixture-embedding', data: [{ object: 'embedding', index: 0, embedding: [0.25, 0.75] }], usage: { prompt_tokens: 10, total_tokens: 10 } });
    });
    const { handleEmbeddings } = await import('../../src/sse/handlers/embeddings.js');
    const response = await handleEmbeddings(new Request('http://localhost' + route, { method: 'POST', headers: { authorization: 'Bearer fixture-gateway' }, body: JSON.stringify(original) }));
    expect(response.status).toBe(200); expect((await response.json()).data[0].embedding).toEqual([0.25, 0.75]);
    expect(latch).toHaveBeenCalledWith('key-a', 'unrecorded_attempt_terminal'); expect(seams.post).toHaveBeenCalledTimes(1); expect(seams.ordinary).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled(); expect(all).not.toHaveBeenCalled(); expect(db.health().healthy).toBe(false);
  });
  it.each(['extra-field', 'credential-url', 'saved-proxy', 'lost-admission', 'lost-terminal', 'post-admission-drift'])('app entry %s refuses without RAM fallback/successor; installed gap is not own delivered ACK', async mode => {
    const original = { model: 'openai/fixture-embedding', input: ['fixture original'], encoding_format: 'float' };
    if (mode === 'credential-url') db.durableTransaction(() => db.run('UPDATE providerConnections SET data=? WHERE id=?',
      [JSON.stringify({ apiKey: 'fixture-upstream', providerSpecificData: { baseUrl: 'https://fixture.invalid' } }), 'fixture-connection']));
    if (mode === 'saved-proxy') db.durableTransaction(() => db.run('UPDATE settings SET data=?',
      [JSON.stringify({ requireApiKey: true, outboundProxyEnabled: true, outboundProxyUrl: 'socks5://fixture.invalid:3210' })]));
    poison(); const get = vi.spyOn(db, 'get'), all = vi.spyOn(db, 'all');
    if (mode === 'extra-field') original.user = 'unsupported';
    const latch = db.coverage.latchGap.bind(db.coverage); let changed = false;
    if (mode === 'post-admission-drift') {
      const prove = db.provePersistedSelection.bind(db);
      vi.spyOn(db, 'provePersistedSelection').mockImplementation((...args) => {
        const proof = prove(...args); return changed ? { ...proof, settings: { ...proof.settings, fallbackStrategy: 'round-robin' } } : proof;
      });
    }
    vi.spyOn(db.coverage, 'latchGap').mockImplementation((key, reason) => {
      const result = latch(key, reason);
      if (mode === 'post-admission-drift' && reason === 'unhealthy_unlimited_admission') changed = true;
      if (mode === 'lost-admission' || mode === 'lost-terminal' && reason === 'unrecorded_attempt_terminal') throw new Error('Fixture lost own app embedding gap ACK');
      return result;
    });
    seams.post.mockResolvedValue(Response.json({ object: 'list', model: 'fixture-embedding', data: [], usage: { prompt_tokens: 10, total_tokens: 10 } }));
    const { handleEmbeddings } = await import('../../src/sse/handlers/embeddings.js');
    const response = await handleEmbeddings(new Request('http://localhost/v1/embeddings', { method: 'POST', headers: { authorization: 'Bearer fixture-gateway' }, body: JSON.stringify(original) }));
    expect(response.status).toBe(503); expect(seams.post).toHaveBeenCalledTimes(mode === 'lost-terminal' ? 1 : 0);
    expect(db.coverage.status().gaps).toHaveLength(['lost-admission', 'lost-terminal', 'post-admission-drift'].includes(mode) ? 1 : 0);
    expect(get).not.toHaveBeenCalled(); expect(all).not.toHaveBeenCalled(); expect(seams.ordinary).not.toHaveBeenCalled(); expect(db.health().healthy).toBe(false);
  });
});
