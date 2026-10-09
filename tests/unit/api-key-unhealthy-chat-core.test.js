import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSqlJsAdapter } from '@/lib/db/adapters/sqljsAdapter.js';
import { createNodeSqliteAdapter } from '@/lib/db/adapters/nodeSqliteAdapter.js';
import { acquireWriterOwnership } from '@/lib/db/writerOwnership.js';
import { runMigrationOnce } from '@/lib/db/migrate.js';
import { openAccountingCoverage } from '@/lib/db/accountingCoverage.js';
import { retainKeyBindings } from '@/lib/db/helpers/apiKeyBindings.js';
import { initializeExplicitPoliciesSync } from '../fixtures/legacy-policy-initialization.mjs';
const seams = vi.hoisted(() => ({ network: vi.fn(), legacy: vi.fn(), settings: vi.fn(), auth: vi.fn(), select: vi.fn(), model: vi.fn(), refresh: vi.fn(), cooldown: vi.fn() }));
vi.mock('@/lib/db/driver.js', () => ({ getAdapter: async () => globalThis.__unhealthyChatFixture }));
vi.mock('@/lib/localDb', () => ({ getSettings: (...args) => seams.settings(...args) }));
vi.mock('open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => seams.network(...args) }));
vi.mock('@/lib/usageDb.js', () => ({ trackPendingRequest() {}, appendRequestLog: async () => {}, saveRequestDetail: async () => {}, saveRequestUsage: (...args) => seams.legacy(...args) }));
vi.mock('../../src/sse/services/model.js', () => ({ getModelInfo: (...args) => seams.model(...args), getComboModels: (...args) => seams.model(...args) }));
vi.mock('../../src/sse/services/auth.js', () => ({ extractApiKey: r => r.headers.get('Authorization')?.slice(7), isValidApiKey: (...args) => seams.auth(...args), getProviderCredentials: (...args) => seams.select(...args), markAccountUnavailable: (...args) => seams.cooldown(...args), clearAccountError: (...args) => seams.cooldown(...args) }));
vi.mock('../../src/sse/services/tokenRefresh.js', () => ({ checkAndRefreshToken: (...args) => seams.refresh(...args), updateProviderCredentials: (...args) => seams.refresh(...args) }));
vi.mock('../../src/sse/utils/logger.js', async original => ({ ...(await original()), debug() {}, info() {}, warn() {}, error() {} }));

// Actual route function + real core/POST owner + real poisoned storage. Network
// is mocked: this is not socket/actualHTTP/live-provider certification.
for (const engine of ['node:sqlite', 'sql.js']) describe(`unhealthy real-core Responses ${engine}`, { timeout: 20000 }, () => {
  let dir, owner, db, file;
  const message = () => ({ id: 'resp_fixture', object: 'response', model: 'fixture-model', status: 'completed', service_tier: 'default', error: null, incomplete_details: null, output: [{ id: 'msg_fixture', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'fixture', annotations: [] }] }], usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 10 } } });
  const wire = () => {
    const final = message(), item = final.output[0], part = item.content[0];
    const events = [
      { type: 'response.created', response: { ...final, status: 'in_progress', output: [], usage: null } },
      { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
      { type: 'response.content_part.added', output_index: 0, item_id: item.id, content_index: 0, part: { ...part, text: '' } },
      { type: 'response.output_text.delta', output_index: 0, item_id: item.id, content_index: 0, delta: part.text },
      { type: 'response.output_text.done', output_index: 0, item_id: item.id, content_index: 0, text: part.text },
      { type: 'response.content_part.done', output_index: 0, item_id: item.id, content_index: 0, part },
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response: final },
    ];
    return events.map((event, sequence_number) => `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join('');
  };
  const body = () => ({ model: 'openai/fixture-model', input: 'fixture', stream: false });
  const request = (value = body(), url = '/v1/responses', credential = 'entry-dummy') => new Request('http://localhost' + url, { method: 'POST', headers: { Authorization: 'Bearer ' + credential }, body: JSON.stringify(value) });
  const handle = async req => (await import('../../src/sse/handlers/chat.js')).handleChat(req);
  beforeEach(async () => {
    vi.resetModules(); for (const fn of Object.values(seams)) { fn.mockReset(); fn.mockImplementation(() => { throw new Error('ordinary repo/core seam forbidden'); }); }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unhealthy-chat-core-')); file = path.join(dir, 'data.sqlite'); owner = acquireWriterOwnership(dir);
    db = await (engine === 'sql.js' ? createSqlJsAdapter : createNodeSqliteAdapter)(file, owner); await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner); db.ownerInstanceId = owner.instanceId; globalThis.__unhealthyChatFixture = db;
    db.durableTransaction(() => {
      db.run("INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES('key-a','entry-dummy',1,'2026-10-03T00:00:00.000Z')"); retainKeyBindings(db, db.coverage, [{ id: 'key-a', key: 'entry-dummy' }]);
      db.run('INSERT INTO settings(id,data) VALUES(1,?)', [JSON.stringify({ requireApiKey: true, fallbackStrategy: 'fill-first' })]);
      db.run('INSERT INTO providerConnections(id,provider,authType,priority,isActive,data,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)', ['entry-connection', 'openai', 'apikey', 1, 1, JSON.stringify({ apiKey: 'upstream-dummy', providerSpecificData: {} }), '2026-10-03T00:00:00.000Z', '2026-10-03T00:00:00.000Z']);
    }); initializeExplicitPoliciesSync(db); db.durableTransaction(() => db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')"));
  });
  afterEach(() => { vi.restoreAllMocks(); db?.close(); owner?.release(); delete globalThis.__unhealthyChatFixture; fs.rmSync(dir, { recursive: true, force: true }); });
  function poison() {
    if (engine === 'sql.js') { const rename = fs.renameSync; vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (to === file) throw new Error('entry poison'); return rename(from, to); }); }
    else { const exec = DatabaseSync.prototype.exec; let injected = false; vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (sql) { if (!injected && sql.startsWith('RELEASE')) { injected = true; throw new Error('entry poison'); } return exec.call(this, sql); }); }
    expect(() => db.durableTransaction(() => db.run("UPDATE apiKeys SET name='not-persisted'"))).toThrow('entry poison'); vi.restoreAllMocks();
  }
  function untouched() { for (const key of ['settings', 'auth', 'select', 'model', 'refresh', 'cooldown', 'legacy']) expect(seams[key]).not.toHaveBeenCalled(); }
  it.each(['json', 'sse'])('%s real sole POST owner ACKs gap before strict dispatch then genuine native terminal without RAM reads', async kind => {
    poison(); const get = vi.spyOn(db, 'get'), all = vi.spyOn(db, 'all'); const latch = vi.spyOn(db.coverage, 'latchGap');
    seams.network.mockImplementation((url, init, _proxy, contract) => {
      expect(db.coverage.status().gaps).toHaveLength(1); expect(latch).toHaveBeenCalledWith('key-a', 'unhealthy_unlimited_admission');
      expect(url).toBe('https://api.openai.com/v1/responses'); expect(init.method).toBe('POST'); expect(init.redirect).toBe('error'); expect(contract).toEqual({ singlePost: true });
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer upstream-dummy'); expect(JSON.parse(init.body)).toEqual({ ...body(), model: 'fixture-model', stream: kind === 'sse' });
      return kind === 'sse' ? new Response(wire(), { headers: { 'content-type': 'text/event-stream' } }) : Response.json(message());
    });
    const response = await handle(request({ ...body(), stream: kind === 'sse' })); expect(response.status).toBe(200);
    if (kind === 'sse') expect(await response.text()).toBe(wire()); else expect(await response.json()).toEqual(message());
    expect(latch).toHaveBeenCalledWith('key-a', 'unrecorded_attempt_terminal'); expect(seams.network).toHaveBeenCalledTimes(1); expect(get).not.toHaveBeenCalled(); expect(all).not.toHaveBeenCalled(); untouched(); expect(db.health().healthy).toBe(false);
  });
  it('held EOF withholds completed while gap exists and forwards only genuine deltas', async () => {
    poison(); let upstream;
    seams.network.mockImplementation(() => new Response(new ReadableStream({ start(c) { upstream = c; c.enqueue(new TextEncoder().encode(wire())); } }), { headers: { 'content-type': 'text/event-stream' } }));
    const response = await handle(request({ ...body(), stream: true })), reader = response.body.getReader(); let captured = '';
    while (!captured.includes('response.output_text.delta')) { const chunk = await reader.read(); expect(chunk.done).toBe(false); captured += new TextDecoder().decode(chunk.value); }
    expect(captured).not.toContain('event: response.completed'); expect(db.coverage.status().gaps).toHaveLength(1);
    upstream.close(); while (true) { const chunk = await reader.read(); if (chunk.done) break; captured += new TextDecoder().decode(chunk.value); }
    expect(captured).toBe(wire()); expect(seams.network).toHaveBeenCalledTimes(1); untouched();
  });
  it('missing completed is a downstream stream failure not synthetic success or retry', async () => {
    poison(); seams.network.mockResolvedValue(new Response(wire().split('event: response.completed')[0], { headers: { 'content-type': 'text/event-stream' } }));
    const response = await handle(request({ ...body(), stream: true })); await expect(response.text()).rejects.toThrow('Gateway accounting stream unavailable');
    expect(seams.network).toHaveBeenCalledTimes(1); expect(db.coverage.status().gaps).toHaveLength(1); untouched();
  });
  it.each(['admission', 'terminal'])('%s lost gap ACK never releases successful response', async kind => {
    poison(); const latch = db.coverage.latchGap.bind(db.coverage);
    vi.spyOn(db.coverage, 'latchGap').mockImplementation((key, reason) => { latch(key, reason); if (kind === 'admission' || reason === 'unrecorded_attempt_terminal') throw new Error('lost gap ACK'); });
    seams.network.mockResolvedValue(Response.json(message())); const response = await handle(request()); expect(response.status).toBe(503);
    expect(seams.network).toHaveBeenCalledTimes(kind === 'admission' ? 0 : 1); expect(db.coverage.status().gaps).toHaveLength(1); untouched();
  });
  it('failed upstream has no implicit successor or poisoned cooldown update', async () => {
    poison(); seams.network.mockResolvedValue(new Response('fixture denied', { status: 429 })); const response = await handle(request()); expect(response.status).toBe(429);
    expect(seams.network).toHaveBeenCalledTimes(1); expect(db.coverage.status().gaps).toHaveLength(1); untouched();
  });
  it.each(['json401', 'json403', 'sse401', 'sse429'])('%s keeps failed native status without OAuth refresh or second POST', async kind => {
    poison(); const status = Number(kind.match(/\d+$/)[0]); seams.network.mockResolvedValue(new Response('fixture denied', { status }));
    const response = await handle(request({ ...body(), stream: kind.startsWith('sse') })); expect(response.status).toBe(status);
    expect(seams.network).toHaveBeenCalledTimes(1); expect(db.coverage.status().gaps).toHaveLength(1); untouched();
  });
  it.each(['before', 'after'])('%s dispatch cancellation preserves exact false reason and ACKed gap only when admitted', async when => {
    poison(); const controller = new AbortController();
    seams.network.mockImplementation(() => { controller.abort(false); return Response.json(message()); });
    if (when === 'before') controller.abort(false);
    const req = new Request(request(), { signal: controller.signal }); let rejected = false;
    try { await handle(req); } catch (error) { rejected = true; expect(error).toBe(false); }
    expect(rejected).toBe(true); expect(seams.network).toHaveBeenCalledTimes(when === 'before' ? 0 : 1);
    expect(db.coverage.status().gaps).toHaveLength(when === 'before' ? 0 : 1); untouched();
  });
  it('persisted global proxy is independently resolved and pinned, not environment cache or direct egress', async () => {
    db.durableTransaction(() => db.run('UPDATE settings SET data=?', [JSON.stringify({ outboundProxyEnabled: true, outboundProxyUrl: 'http://persisted-proxy.invalid:1234', outboundNoProxy: 'localhost' })]));
    poison(); seams.network.mockImplementation((_url, _init, proxy, contract) => {
      expect(proxy.persistedGlobalProxy).toEqual({ url: 'http://persisted-proxy.invalid:1234/', noProxy: 'localhost' }); expect(contract).toEqual({ singlePost: true }); return Response.json(message());
    }); const response = await handle(request()); expect(response.status).toBe(200); expect(await response.json()).toEqual(message());
    expect(seams.network).toHaveBeenCalledTimes(1); expect(db.coverage.status().gaps).toHaveLength(1); untouched();
  });
  it.each(['', 'socks5://proxy.invalid:1234', 'http://proxy.invalid/path', 'https://proxy.invalid/#fragment'])('malformed or unsupported persisted saved proxy %s cannot downgrade to direct', async url => {
    db.durableTransaction(() => db.run('UPDATE settings SET data=?', [JSON.stringify({ outboundProxyEnabled: true, outboundProxyUrl: url })]));
    poison(); const response = await handle(request()); expect(response.status).toBe(503); expect(seams.network).not.toHaveBeenCalled(); expect(db.coverage.status().gaps).toEqual([]); untouched();
  });
  it('saved proxy mutation after usage refuses terminal authorization of the old pinned transport', async () => {
    db.durableTransaction(() => db.run('UPDATE settings SET data=?', [JSON.stringify({ outboundProxyEnabled: true, outboundProxyUrl: 'http://persisted-proxy.invalid:1234' })]));
    poison(); const original = db.provePersistedSelection.bind(db); let changed = false;
    vi.spyOn(db, 'provePersistedSelection').mockImplementation((...args) => { const proof = original(...args); return changed ? { ...proof, settings: { ...proof.settings, outboundProxyUrl: 'http://foreign-proxy.invalid:5678' } } : proof; });
    seams.network.mockImplementation(() => { changed = true; return Response.json(message()); });
    const response = await handle(request()); expect(response.status).toBe(503); expect(seams.network).toHaveBeenCalledTimes(1); expect(db.coverage.status().gaps).toHaveLength(1); untouched();
  });
  it.each(['http://proxy.invalid/private/..', 'http://proxy.invalid/?', 'http://proxy.invalid/#'])('ambiguous saved origin %s denies before gap instead of normalization into eligibility', async url => {
    db.durableTransaction(() => db.run('UPDATE settings SET data=?', [JSON.stringify({ outboundProxyEnabled: true, outboundProxyUrl: url })]));
    poison(); const response = await handle(request()); expect(response.status).toBe(503); expect(seams.network).not.toHaveBeenCalled(); expect(db.coverage.status().gaps).toEqual([]); untouched();
  });
  it('fresh saved proxy proof failure before admission cannot reuse the successful pinned snapshot', async () => {
    db.durableTransaction(() => db.run('UPDATE settings SET data=?', [JSON.stringify({ outboundProxyEnabled: true, outboundProxyUrl: 'http://persisted-proxy.invalid:1234' })]));
    poison(); const original = db.provePersistedSelection.bind(db); let n = 0;
    vi.spyOn(db, 'provePersistedSelection').mockImplementation((...args) => { if (n++ > 0) throw new Error('new snapshot failed'); return original(...args); });
    const response = await handle(request()); expect(response.status).toBe(503); expect(seams.network).not.toHaveBeenCalled(); expect(db.coverage.status().gaps).toEqual([]); untouched();
  });
  it('saved proxy terminal cancellation preserves false without second POST or lost gap', async () => {
    db.durableTransaction(() => db.run('UPDATE settings SET data=?', [JSON.stringify({ outboundProxyEnabled: true, outboundProxyUrl: 'http://persisted-proxy.invalid:1234' })]));
    poison(); const caller = new AbortController(); seams.network.mockImplementation(() => { caller.abort(false); return Response.json(message()); });
    let rejected = false; try { await handle(new Request(request(), { signal: caller.signal })); } catch (reason) { rejected = true; expect(reason).toBe(false); }
    expect(rejected).toBe(true); expect(seams.network).toHaveBeenCalledTimes(1); expect(db.coverage.status().gaps).toHaveLength(1); untouched();
  });
  it('credential-bearing saved proxy does not replace upstream authorization', async () => {
    db.durableTransaction(() => db.run('UPDATE settings SET data=?', [JSON.stringify({ outboundProxyEnabled: true, outboundProxyUrl: 'http://proxy-user:proxy-pass@proxy.invalid:1234' })]));
    poison(); seams.network.mockImplementation((_url, init, proxy) => {
      expect(proxy.persistedGlobalProxy.url).toBe('http://proxy-user:proxy-pass@proxy.invalid:1234/');
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer upstream-dummy'); expect(new Headers(init.headers).has('proxy-authorization')).toBe(false); return Response.json(message());
    }); const response = await handle(request()); expect(response.status).toBe(200); expect(seams.network).toHaveBeenCalledTimes(1); untouched();
  });
  it('healthy settings read error remains an error without unhealthy selection or gap exception', async () => {
    const error = new Error('healthy config read failed'); seams.settings.mockImplementation(() => { throw error; });
    const proof = vi.spyOn(db, 'provePersistedSelection'); await expect(handle(request())).rejects.toBe(error);
    expect(proof).not.toHaveBeenCalled(); expect(seams.network).not.toHaveBeenCalled(); expect(db.coverage.status().gaps).toEqual([]); expect(db.health().healthy).toBe(true);
  });
  it('config mutation during fresh selection before admission denies zero POST rather than authorizing old credentials', async () => {
    poison(); const original = db.provePersistedSelection.bind(db); let n = 0;
    vi.spyOn(db, 'provePersistedSelection').mockImplementation((...args) => { const proof = original(...args); return n++ === 0 ? proof : { ...proof, connection: { ...proof.connection, apiKey: 'foreign' } }; });
    const response = await handle(request()); expect(response.status).toBe(503); expect(seams.network).not.toHaveBeenCalled(); expect(db.coverage.status().gaps).toEqual([]); untouched();
  });
  it('persisted legacy connection proxy remains pinned in strict owner preparation', async () => {
    db.durableTransaction(() => db.run('UPDATE providerConnections SET data=?', [JSON.stringify({ apiKey: 'upstream-dummy', providerSpecificData: { connectionProxyEnabled: true, connectionProxyUrl: 'http://fixture-proxy.invalid:1234', connectionNoProxy: 'localhost' } })]));
    poison(); seams.network.mockImplementation((_url, _init, proxy, contract) => {
      expect(proxy).toMatchObject({ connectionProxyEnabled: true, connectionProxyUrl: 'http://fixture-proxy.invalid:1234', connectionNoProxy: 'localhost' }); expect(contract).toEqual({ singlePost: true }); return Response.json(message());
    });
    const response = await handle(request()); expect(response.status).toBe(200); expect(await response.json()).toEqual(message()); expect(seams.network).toHaveBeenCalledTimes(1); untouched();
  });
  function seedPool(data = {}, active = 1) {
    db.durableTransaction(() => {
      db.run('INSERT INTO proxyPools(id,isActive,testStatus,data,createdAt,updatedAt) VALUES(?,?,?,?,?,?)', ['entry-pool', active, 'active', JSON.stringify({ type: 'http', proxyUrl: 'http://pool.invalid:1234', noProxy: 'localhost', strictProxy: true, ...data }), '2026-10-03T00:00:00.000Z', '2026-10-03T00:00:00.000Z']);
      db.run('UPDATE providerConnections SET data=?', [JSON.stringify({ apiKey: 'upstream-dummy', providerSpecificData: { proxyPoolId: 'entry-pool', connectionProxyEnabled: true, connectionProxyUrl: 'http://legacy.invalid:5678' } })]);
      db.run('UPDATE settings SET data=?', [JSON.stringify({ outboundProxyEnabled: true, outboundProxyUrl: 'http://global.invalid:9012' })]);
    });
  }
  it.each(['no-global', 'global-bypass'])('strict pool bypass with %s denies before admission/gap, not just inside transport', async kind => {
    seedPool({ noProxy: 'api.openai.com' }); db.durableTransaction(() => db.run('UPDATE settings SET data=?', [JSON.stringify(kind === 'no-global' ? { outboundProxyEnabled: false } : { outboundProxyEnabled: true, outboundProxyUrl: 'http://global.invalid:9012', outboundNoProxy: '*' })]));
    poison(); seams.network.mockResolvedValue(Response.json(message())); const response = await handle(request()); expect(response.status).toBe(503); expect(seams.network).not.toHaveBeenCalled(); expect(db.coverage.status().gaps).toEqual([]); untouched();
  });
  it('strict pool bypass with independent saved global remains supported', async () => {
    seedPool({ noProxy: 'api.openai.com' }); poison(); seams.network.mockImplementation((_url, _init, proxy) => {
      expect(proxy.persistedPoolProxy).toMatchObject({ strictProxy: true, noProxy: 'api.openai.com' }); expect(proxy.persistedGlobalProxy.url).toBe('http://global.invalid:9012/'); return Response.json(message());
    }); const response = await handle(request()); expect(response.status).toBe(200); expect(seams.network).toHaveBeenCalledTimes(1); untouched();
  });
  it('non-strict pool deliberate bypass without saved global remains supported, not environment authority', async () => {
    seedPool({ strictProxy: false, noProxy: '*' }); db.durableTransaction(() => db.run('UPDATE settings SET data=?', [JSON.stringify({ outboundProxyEnabled: false })])); poison();
    seams.network.mockImplementation((_url, _init, proxy) => { expect(proxy.persistedPoolProxy).toMatchObject({ strictProxy: false, noProxy: '*' }); expect(proxy.persistedGlobalProxy).toBeUndefined(); return Response.json(message()); });
    const response = await handle(request()); expect(response.status).toBe(200); expect(seams.network).toHaveBeenCalledTimes(1); untouched();
  });
  it.each([true, false])('active HTTP pool strict=%s retains precedence and carries independently pinned transport intent', async strict => {
    seedPool({ strictProxy: strict }); poison(); seams.network.mockImplementation((_url, init, proxy, contract) => {
      expect(proxy).toMatchObject({ connectionProxyEnabled: true, connectionProxyUrl: 'http://pool.invalid:1234/', connectionNoProxy: 'localhost', strictProxy: strict, proxyPoolId: 'entry-pool' });
      expect(proxy.persistedGlobalProxy).toEqual({ url: 'http://global.invalid:9012/', noProxy: '' }); expect(contract).toEqual({ singlePost: true }); expect(new Headers(init.headers).get('authorization')).toBe('Bearer upstream-dummy'); return Response.json(message());
    }); const response = await handle(request()); expect(response.status).toBe(200); expect(await response.json()).toEqual(message()); expect(seams.network).toHaveBeenCalledTimes(1); expect(db.coverage.status().gaps).toHaveLength(1); untouched();
  });
  it('active HTTPS pool transfers genuine SSE ownership without normal proxy repo or duplicate terminal', async () => {
    seedPool({ type: 'https', proxyUrl: 'https://pool.invalid:1234' }); poison(); seams.network.mockImplementation((_url, _init, proxy) => {
      expect(proxy.connectionProxyUrl).toBe('https://pool.invalid:1234/'); expect(proxy.strictProxy).toBe(true); return new Response(wire(), { headers: { 'content-type': 'text/event-stream' } });
    }); const response = await handle(request({ ...body(), stream: true })); expect(response.status).toBe(200); expect(await response.text()).toBe(wire()); expect(seams.network).toHaveBeenCalledTimes(1); untouched();
  });
  it.each(['inactive-strict', 'inactive-nonstrict', 'empty-strict', 'empty-nonstrict', 'vercel', 'cloudflare', 'deno', 'socks', 'dotpath'])('%s pool cannot downgrade into legacy/global/direct or relay eligibility', async kind => {
    seedPool({ strictProxy: !kind.endsWith('nonstrict'), ...(kind.startsWith('empty') ? { proxyUrl: '' } : ['vercel', 'cloudflare', 'deno'].includes(kind) ? { type: kind } : kind === 'socks' ? { type: 'socks5', proxyUrl: 'socks5://pool.invalid:1234' } : kind === 'dotpath' ? { proxyUrl: 'http://pool.invalid/private/..' } : {}) }, kind.startsWith('inactive') ? 0 : 1);
    poison(); const response = await handle(request()); expect(response.status).toBe(503); expect(seams.network).not.toHaveBeenCalled(); expect(db.coverage.status().gaps).toEqual([]); untouched();
  });
  it.each(['url', 'strict', 'active'])('pool %s mutation after usage denies old terminal authority without retry', async kind => {
    seedPool(); poison(); const original = db.provePersistedSelection.bind(db); let changed = false;
    vi.spyOn(db, 'provePersistedSelection').mockImplementation((...args) => { const proof = original(...args); return changed ? { ...proof, proxyPool: { ...proof.proxyPool, ...(kind === 'url' ? { proxyUrl: 'http://foreign.invalid:5678' } : kind === 'strict' ? { strictProxy: false } : { isActive: false }) } } : proof; });
    seams.network.mockImplementation(() => { changed = true; return Response.json(message()); }); const response = await handle(request()); expect(response.status).toBe(503); expect(seams.network).toHaveBeenCalledTimes(1); expect(db.coverage.status().gaps).toHaveLength(1); untouched();
  });
  it('required pool disappears before admission: no legacy/global fallback or gap', async () => {
    seedPool(); poison(); const original = db.provePersistedSelection.bind(db); let n = 0;
    vi.spyOn(db, 'provePersistedSelection').mockImplementation((...args) => { const proof = original(...args); return n++ === 0 ? proof : { ...proof, proxyPool: null }; });
    const response = await handle(request()); expect(response.status).toBe(503); expect(seams.network).not.toHaveBeenCalled(); expect(db.coverage.status().gaps).toEqual([]); untouched();
  });
  it('loss of fresh config after observed JSON usage refuses terminal authorization', async () => {
    poison(); seams.network.mockImplementation(() => { vi.spyOn(db, 'provePersistedSelection').mockImplementation(() => { throw new Error('terminal selection unavailable'); }); return Response.json(message()); });
    const response = await handle(request()); expect(response.status).toBe(503); expect(seams.network).toHaveBeenCalledTimes(1); expect(db.coverage.status().gaps).toHaveLength(1); untouched();
  });
  it.each(['header-override', 'relay', 'headroom', 'pxpipe'])('%s unsupported persisted config cannot reach real POST', async kind => {
    db.durableTransaction(() => {
      if (kind === 'relay') db.run('UPDATE providerConnections SET data=?', [JSON.stringify({ apiKey: 'upstream-dummy', providerSpecificData: { vercelRelayUrl: 'https://relay.invalid' } })]);
      else db.run('UPDATE settings SET data=?', [JSON.stringify(kind === 'header-override' ? { providerOverrides: { openai: { headers: { 'OpenAI-Beta': 'fixture' } } } } : { [kind === 'headroom' ? 'headroomEnabled' : 'pxpipeEnabled']: true })]);
    }); poison(); const response = await handle(request()); expect(response.status).toBe(503); expect(seams.network).not.toHaveBeenCalled(); expect(db.coverage.status().gaps).toEqual([]); untouched();
  });
});
