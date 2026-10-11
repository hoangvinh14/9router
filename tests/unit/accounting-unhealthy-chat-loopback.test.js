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
vi.mock('@/lib/db/driver.js', () => ({ getAdapter: async () => globalThis.__unhealthyNativeFixture }));
vi.mock('../../open-sse/config/providers.js', async original => {
  const actual = await original(); return { ...actual, PROVIDERS: { ...actual.PROVIDERS,
    get openai() { return { ...actual.PROVIDERS.openai, baseUrl: fixture.url }; } } };
});
// Module transformation is setup only, no database/network/inference warm-up.
await import('../../open-sse/handlers/chatCore.js');
for (const engine of ['node:sqlite', 'sql.js']) describe(`unhealthy Chat native owned HTTP ${engine}, not live provider/TLS/power loss`, { timeout: 20000 }, () => {
  let dir, file, owner, db, server, received, serverFailure, serverWork, responseGate;
  beforeEach(async () => {
    vi.resetModules(); dir = fs.mkdtempSync(path.join(os.tmpdir(), '9router-unhealthy-native-')); file = path.join(dir, 'data.sqlite');
    owner = acquireWriterOwnership(dir);
    db = await (engine === 'sql.js' ? createSqlJsAdapter : createNodeSqliteAdapter)(file, owner);
    await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner); db.ownerInstanceId = owner.instanceId;
    globalThis.__unhealthyNativeFixture = db;
    db.durableTransaction(() => {
      db.run("INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES('key-a','fixture-gateway',1,'2026-10-03T00:00:00.000Z')");
      retainKeyBindings(db, db.coverage, [{ id: 'key-a', key: 'fixture-gateway' }]);
      db.run('INSERT INTO settings(id,data) VALUES(1,?)', [JSON.stringify({ requireApiKey: true, outboundProxyEnabled: false })]);
      db.run('INSERT INTO providerConnections(id,provider,authType,priority,isActive,data,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)',
        ['fixture-connection', 'openai', 'apikey', 1, 1, JSON.stringify({ apiKey: 'fixture-upstream', providerSpecificData: {} }), '2026-10-03T00:00:00.000Z', '2026-10-03T00:00:00.000Z']);
    }); initializeExplicitPoliciesSync(db);
    db.durableTransaction(() => db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')"));
    received = []; serverFailure = null; serverWork = []; responseGate = async () => {};
    server = http.createServer((request, response) => {
      const work = (async () => {
        try {
          const chunks = []; for await (const chunk of request) chunks.push(chunk);
          received.push({ method: request.method, authorization: request.headers.authorization,
            body: JSON.parse(Buffer.concat(chunks).toString()), gaps: db.coverage.status('key-a').gaps });
          await responseGate();
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ id: 'fixture-native', object: 'chat.completion', model: 'fixture-model',
            choices: [{ message: { role: 'assistant', content: 'fixture native Chat' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }));
        } catch (error) { serverFailure = error; response.writeHead(500); response.end(); }
      })(); serverWork.push(work);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    fixture.url = `http://127.0.0.1:${server.address().port}/chat/completions`;
    if (engine === 'sql.js') {
      const rename = fs.renameSync; vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (to === file) throw new Error('Fixture native poison'); return rename(from, to); });
    } else {
      const exec = DatabaseSync.prototype.exec; let injected = false;
      vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (sql) { if (!injected && sql.startsWith('RELEASE')) { injected = true; throw new Error('Fixture native poison'); } return exec.call(this, sql); });
    }
    expect(() => db.durableTransaction(() => db.run("UPDATE apiKeys SET name='not-persisted'"))).toThrow('Fixture native poison'); vi.restoreAllMocks();
  });
  afterEach(async () => {
    for (let index = 0; index < serverWork.length; index++) await serverWork[index];
    server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve));
    vi.restoreAllMocks(); db?.close(); owner?.release(); delete globalThis.__unhealthyNativeFixture;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it('cancellation after received native POST retains own unknown completion and drains late foreign response', async () => {
    const original = { model: 'openai/fixture-model', stream: false, messages: [{ role: 'user', content: 'fixture cancel original' }] };
    const controller = new AbortController();
    const request = new Request('http://localhost/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer fixture-gateway' }, body: JSON.stringify(original), signal: controller.signal });
    let enter, release, attempt; const entered = new Promise(r => { enter = r; }), held = new Promise(r => { release = r; });
    responseGate = () => { enter(); return held; };
    const get = vi.spyOn(db, 'get'), all = vi.spyOn(db, 'all'), completions = [];
    const { handleUnhealthyChatEntry } = await import('@/lib/apiKeyBudget/unhealthyChatEntry.js');
    const { handleChatCore } = await import('../../open-sse/handlers/chatCore.js');
    const observed = handleUnhealthyChatEntry(request, original, options => handleChatCore({ ...options, accounting: {
      ...options.accounting,
      async beforeAttempt(...args) { attempt = await options.accounting.beforeAttempt(...args); return attempt; },
      async completeAttempt(handle, completion) { const terminal = await options.accounting.completeAttempt(handle, completion); completions.push({ handle, completion, terminal }); return terminal; },
    } })).then(value => ({ value }), error => ({ error }));
    try {
      expect(await Promise.race([entered.then(() => null), observed])).toBeNull();
      expect(received).toHaveLength(1); expect(attempt).toBeTruthy(); expect(completions).toHaveLength(0);
      controller.abort(false); const result = await observed;
      expect(result.error).toBe(false); expect(result.value).toBeUndefined(); expect(completions).toHaveLength(1);
      expect(completions[0].handle).toBe(attempt); expect(completions[0].completion).toMatchObject({ usage: null, outcome: 'aborted' });
      const winner = completions[0].terminal; expect(db.coverage.status('key-a').gaps).toHaveLength(1);
      release(); for (let index = 0; index < serverWork.length; index++) await serverWork[index];
      expect(completions).toHaveLength(1); expect(completions[0].terminal).toBe(winner); expect(received).toHaveLength(1); expect(serverFailure).toBeNull();
      expect(get).not.toHaveBeenCalled(); expect(all).not.toHaveBeenCalled(); expect(db.health().healthy).toBe(false);
    } finally { release(); await observed; for (let index = 0; index < serverWork.length; index++) await serverWork[index]; }
  });
  it.each(['delivered', 'lost-terminal', 'lost-admission'])('own delivered ACK authorizes exactly one native POST/terminal: %s', async mode => {
    const original = { model: 'openai/fixture-model', stream: false, messages: [{ role: 'user', content: 'fixture native original' }] };
    const request = new Request('http://localhost/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer fixture-gateway' }, body: JSON.stringify(original) });
    const get = vi.spyOn(db, 'get'), all = vi.spyOn(db, 'all'), lost = new Error('Fixture lost native Chat own ACK');
    let enter, release, attempt, terminal; const entered = new Promise(r => { enter = r; }), held = new Promise(r => { release = r; });
    const completions = []; let returned = false;
    const { handleUnhealthyChatEntry } = await import('@/lib/apiKeyBudget/unhealthyChatEntry.js');
    const { handleChatCore } = await import('../../open-sse/handlers/chatCore.js');
    const observed = handleUnhealthyChatEntry(request, original, options => handleChatCore({ ...options, accounting: {
      ...options.accounting,
      async beforeAttempt(...args) { attempt = await options.accounting.beforeAttempt(...args); if (mode === 'lost-admission') { enter(); await held; throw lost; } return attempt; },
      async completeAttempt(handle, completion) { completions.push({ handle, completion }); terminal = await options.accounting.completeAttempt(handle, completion); enter(); await held; if (mode === 'lost-terminal') throw lost; return terminal; },
    } })).then(value => ({ value }), error => ({ error })).then(result => { returned = true; return result; });
    try {
      expect(await Promise.race([entered.then(() => null), observed])).toBeNull(); expect(returned).toBe(false);
      expect(attempt).toBeTruthy(); expect(db.coverage.status('key-a').gaps).toHaveLength(1);
      expect(received).toHaveLength(mode === 'lost-admission' ? 0 : 1);
      if (mode !== 'lost-admission') {
        expect(received[0]).toMatchObject({ method: 'POST', authorization: 'Bearer fixture-upstream', body: { ...original, model: 'fixture-model' } });
        expect(received[0].gaps).toHaveLength(1); expect(completions).toHaveLength(1); expect(completions[0].handle).toBe(attempt); expect(terminal).toBeTruthy();
      }
      release(); const result = await observed;
      if (mode === 'delivered') { expect(result.error).toBeUndefined(); expect(result.value.status).toBe(200); expect((await result.value.json()).choices[0].message.content).toBe('fixture native Chat'); }
      else expect(result.error).toBe(lost);
      expect(serverFailure).toBeNull(); expect(received).toHaveLength(mode === 'lost-admission' ? 0 : 1);
      expect(completions).toHaveLength(mode === 'lost-admission' ? 0 : 1);
      expect(get).not.toHaveBeenCalled(); expect(all).not.toHaveBeenCalled(); expect(db.health().healthy).toBe(false);
    } finally { release(); await observed; for (let index = 0; index < serverWork.length; index++) await serverWork[index]; }
  });
});
