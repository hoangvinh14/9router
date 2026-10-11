import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createSqlJsAdapter } from '@/lib/db/adapters/sqljsAdapter.js';
import { createNodeSqliteAdapter } from '@/lib/db/adapters/nodeSqliteAdapter.js';
import { acquireWriterOwnership } from '@/lib/db/writerOwnership.js';
import { runMigrationOnce } from '@/lib/db/migrate.js';
import { openAccountingCoverage } from '@/lib/db/accountingCoverage.js';
import { retainKeyBindings } from '@/lib/db/helpers/apiKeyBindings.js';
import { initializeExplicitPoliciesSync } from '../fixtures/legacy-policy-initialization.mjs';
const fixture = vi.hoisted(() => ({ url: null }));
vi.mock('@/lib/db/driver.js', () => ({ getAdapter: async () => globalThis.__unhealthyNativeEmbeddingFixture }));
// Owned loopback requires BOTH fixed candidate and registry test replacements.
// This does not grant production URL overrides; native fetch/transport stay real.
vi.mock('../../open-sse/config/accountedEmbeddingsCandidate.js', () => ({ get ACCOUNTED_EMBEDDINGS_URL() { return fixture.url; } }));
vi.mock('../../open-sse/providers/index.js', async original => {
  const actual = await original(); return { ...actual, PROVIDER_MEDIA: { ...actual.PROVIDER_MEDIA,
    get openai() { return { ...actual.PROVIDER_MEDIA.openai, embeddingConfig: { ...actual.PROVIDER_MEDIA.openai.embeddingConfig, baseUrl: fixture.url } }; } } };
});
// Module transformation only, no DB/network/inference warm-up.
await import('../../open-sse/handlers/embeddingsCore.js');
for (const engine of ['node:sqlite', 'sql.js']) describe(`unhealthy embeddings native owned HTTP ${engine}, not live provider/TLS/power loss`, { timeout: 20000 }, () => {
  let dir, file, owner, db, server, received, serverFailure, serverWork, responseGate;
  beforeEach(async () => {
    vi.resetModules(); dir = fs.mkdtempSync(path.join(os.tmpdir(), '9router-unhealthy-native-embedding-')); file = path.join(dir, 'data.sqlite');
    owner = acquireWriterOwnership(dir); db = await (engine === 'sql.js' ? createSqlJsAdapter : createNodeSqliteAdapter)(file, owner);
    await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner); db.ownerInstanceId = owner.instanceId;
    globalThis.__unhealthyNativeEmbeddingFixture = db;
    db.durableTransaction(() => {
      db.run("INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES('key-a','fixture-gateway',1,'2026-10-03T00:00:00.000Z')");
      retainKeyBindings(db, db.coverage, [{ id: 'key-a', key: 'fixture-gateway' }]);
      db.run('INSERT INTO settings(id,data) VALUES(1,?)', [JSON.stringify({ requireApiKey: true, outboundProxyEnabled: false })]);
      db.run('INSERT INTO providerConnections(id,provider,authType,priority,isActive,data,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)',
        ['fixture-connection', 'openai', 'apikey', 1, 1, JSON.stringify({ apiKey: 'fixture-upstream', providerSpecificData: {} }), '2026-10-03T00:00:00.000Z', '2026-10-03T00:00:00.000Z']);
    }); initializeExplicitPoliciesSync(db); db.durableTransaction(() => db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')"));
    received = []; serverFailure = null; serverWork = []; responseGate = async () => {};
    server = http.createServer((request, response) => {
      const work = (async () => {
        try {
          const chunks = []; for await (const chunk of request) chunks.push(chunk);
          received.push({ method: request.method, authorization: request.headers.authorization, url: request.url,
            body: JSON.parse(Buffer.concat(chunks).toString()), gaps: db.coverage.status('key-a').gaps });
          await responseGate(); response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ object: 'list', model: 'fixture-embedding', data: [{ object: 'embedding', index: 0, embedding: [0.25, 0.75] }], usage: { prompt_tokens: 10, total_tokens: 10 } }));
        } catch (error) { serverFailure = error; response.writeHead(500); response.end(); }
      })(); serverWork.push(work);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    fixture.url = `http://127.0.0.1:${server.address().port}/v1/embeddings`;
    if (engine === 'sql.js') {
      const rename = fs.renameSync; vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (to === file) throw new Error('Fixture native embedding poison'); return rename(from, to); });
    } else {
      const exec = DatabaseSync.prototype.exec; let injected = false;
      vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (sql) { if (!injected && sql.startsWith('RELEASE')) { injected = true; throw new Error('Fixture native embedding poison'); } return exec.call(this, sql); });
    }
    expect(() => db.durableTransaction(() => db.run("UPDATE apiKeys SET name='not-persisted'"))).toThrow('Fixture native embedding poison'); vi.restoreAllMocks();
  });
  afterEach(async () => {
    for (let index = 0; index < serverWork.length; index++) await serverWork[index];
    server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve));
    vi.restoreAllMocks(); db?.close(); owner?.release(); delete globalThis.__unhealthyNativeEmbeddingFixture; fs.rmSync(dir, { recursive: true, force: true });
  });
  it.each(['delivered', 'lost-terminal', 'lost-admission', 'cancel-after-receipt'])('own ACK and single native POST boundary: %s', async mode => {
    const original = { model: 'openai/fixture-embedding', input: ['fixture native original'] };
    const controller = new AbortController(), request = new Request('http://localhost/v1/embeddings', { method: 'POST', headers: { Authorization: 'Bearer fixture-gateway' }, body: JSON.stringify(original), signal: controller.signal });
    const get = vi.spyOn(db, 'get'), all = vi.spyOn(db, 'all'), lost = new Error('Fixture lost native embedding own ACK');
    let enter, release, attempt, returned = false;
    const entered = new Promise(r => { enter = r; }), held = new Promise(r => { release = r; }), completions = [];
    if (mode === 'cancel-after-receipt') responseGate = () => { enter(); return held; };
    const { handleUnhealthyEmbeddingsEntry } = await import('@/lib/apiKeyBudget/unhealthyChatEntry.js');
    const { handleEmbeddingsCore } = await import('../../open-sse/handlers/embeddingsCore.js');
    const observed = handleUnhealthyEmbeddingsEntry(request, original, options => handleEmbeddingsCore({ ...options, accounting: {
      ...options.accounting,
      async beforeAttempt(...args) {
        attempt = await options.accounting.beforeAttempt(...args);
        if (mode === 'lost-admission') { enter(); await held; throw lost; } return attempt;
      },
      async completeAttempt(handle, completion) {
        const terminal = await options.accounting.completeAttempt(handle, completion); completions.push({ handle, completion, terminal });
        if (mode !== 'cancel-after-receipt') { enter(); await held; if (mode === 'lost-terminal') throw lost; } return terminal;
      },
    } })).then(value => ({ value }), error => ({ error })).then(result => { returned = true; return result; });
    try {
      expect(await Promise.race([entered.then(() => null), observed])).toBeNull(); expect(returned).toBe(false);
      expect(attempt).toBeTruthy(); expect(db.coverage.status('key-a').gaps).toHaveLength(1);
      expect(received).toHaveLength(mode === 'lost-admission' ? 0 : 1);
      if (mode !== 'lost-admission') {
        expect(received[0]).toMatchObject({ method: 'POST', authorization: 'Bearer fixture-upstream', url: '/v1/embeddings', body: { ...original, model: 'fixture-embedding', encoding_format: 'float' } });
        expect(received[0].gaps).toHaveLength(1);
      }
      if (mode === 'cancel-after-receipt') {
        expect(completions).toHaveLength(0); controller.abort(false);
        const result = await observed; expect(result.error).toBe(false); expect(result.value).toBeUndefined();
        expect(completions).toHaveLength(1); expect(completions[0].completion).toMatchObject({ usage: null, outcome: 'aborted' });
      } else {
        release(); const result = await observed;
        if (mode === 'delivered') {
          expect(result.error).toBeUndefined(); expect(result.value.status).toBe(200); expect((await result.value.json()).data[0].embedding).toEqual([0.25, 0.75]);
          expect(completions[0].completion).toMatchObject({ usage: { input: 10, output: 0 }, outcome: 'success' });
        } else expect(result.error).toBe(lost);
      }
      expect(completions).toHaveLength(mode === 'lost-admission' ? 0 : 1);
      if (completions.length) expect(completions[0].handle).toBe(attempt);
      const winner = completions[0]?.terminal; release();
      for (let index = 0; index < serverWork.length; index++) await serverWork[index];
      expect(completions).toHaveLength(mode === 'lost-admission' ? 0 : 1); expect(completions[0]?.terminal).toBe(winner);
      expect(received).toHaveLength(mode === 'lost-admission' ? 0 : 1); expect(serverFailure).toBeNull();
      expect(get).not.toHaveBeenCalled(); expect(all).not.toHaveBeenCalled(); expect(db.health().healthy).toBe(false);
    } finally { release(); await observed; for (let index = 0; index < serverWork.length; index++) await serverWork[index]; }
  });
});
