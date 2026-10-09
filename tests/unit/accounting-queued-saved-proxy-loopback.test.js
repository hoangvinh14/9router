import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const registryFixture = vi.hoisted(() => ({ baseUrl: null }));
vi.mock('../../open-sse/config/providers.js', async importOriginal => ({ ...(await importOriginal()),
  PROVIDERS: { ...(await importOriginal()).PROVIDERS, get openai() { return { baseUrl: registryFixture.baseUrl }; } } }));
let db, directory, upstream, proxy, trapProxy, trapHits, trapUrl, targetUrl, proxyUrl, target, BaseExecutor, context, sockets, tunnels, posts, failure, redirectResponse, onPost;
const previousData = process.env.DATA_DIR;
const listen = server => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-saved-proxy-socket-')); process.env.DATA_DIR = directory; delete global._dbAdapter; vi.resetModules();
  sockets = new Set(); tunnels = 0; posts = 0; trapHits = 0; failure = null; redirectResponse = false; onPost = null;
  const track = socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); socket.on('error', () => {}); };
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key' }], settings: { requireApiKey: true },
    providerConnections: [{ id: 'c', provider: 'openai', authType: 'apikey', apiKey: 'dummy-provider' }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','openai',?)", [JSON.stringify({ 'fixture-chat': { input: '1', output: '2' } })]);
  });
  upstream = http.createServer(async (request, response) => {
    try {
      for await (const chunk of request) { void chunk; }
      expect(request.method).toBe('POST'); expect(request.headers.authorization).toBe('Bearer dummy-provider');
      expect(db.get("SELECT state FROM apiKeyAccounting WHERE apiKeyId='a'")?.state).toBe('pending'); posts++;
      if (onPost) { onPost(); return; } // Test-owned hung response; cancellation must still ACK unknown.
      if (redirectResponse) { response.writeHead(307, { location: '/redirect-target' }); response.end(); return; }
      response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'fixture' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }));
    } catch (error) { failure = error; response.writeHead(500, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: 'fixture assertion failed' })); }
  });
  upstream.on('connection', track); await listen(upstream);
  target = `127.0.0.1:${upstream.address().port}`; targetUrl = `http://${target}/chat`;
  registryFixture.baseUrl = targetUrl; // Test-only registry, never production URL permission.
  proxy = http.createServer((_request, response) => { failure = new Error('Unexpected non-CONNECT proxy request'); response.writeHead(405); response.end(); });
  proxy.on('connection', track);
  proxy.on('connect', (request, socket, head) => {
    if (request.url !== target) { failure = new Error('Unexpected proxy target'); socket.destroy(); return; }
    tunnels++;
    const remote = net.connect(upstream.address().port, '127.0.0.1'); track(remote);
    remote.once('connect', () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) remote.write(head); socket.pipe(remote); remote.pipe(socket); });
    socket.once('close', () => remote.destroy()); remote.once('close', () => socket.destroy());
  });
  await listen(proxy); proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
  // Owned non-forwarding endpoint detects forbidden precedence escapes. Never
  // tunnel even the owned target through this competing environment/global route.
  trapProxy = http.createServer((_request, response) => { trapHits++; response.writeHead(502); response.end(); });
  trapProxy.on('connection', track);
  trapProxy.on('connect', (_request, socket) => { trapHits++; socket.end('HTTP/1.1 502 Fixture Trap\r\n\r\n'); });
  await listen(trapProxy); trapUrl = `http://127.0.0.1:${trapProxy.address().port}`;
  ({ BaseExecutor } = await import('../../open-sse/executors/base.js'));
  context = await (await import('@/lib/apiKeyBudget/requestAccounting.js')).createRequestAccounting(new Request('http://localhost/v1/chat/completions', {
    headers: { Authorization: 'Bearer dummy-key' } }), { adapter: async () => db, queued: true });
});
afterEach(async () => {
  for (const socket of sockets || []) socket.destroy();
  for (const server of [proxy, trapProxy, upstream]) { server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve)); }
  vi.restoreAllMocks(); vi.unstubAllEnvs(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true });
  if (previousData === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previousData;
});
function save(mode, url, noProxy = '') {
  db.durableTransaction(() => {
    if (mode === 'global') db.run("UPDATE settings SET data=? WHERE id=1", [JSON.stringify({ requireApiKey: true, outboundProxyEnabled: true, outboundProxyUrl: url, outboundNoProxy: noProxy })]);
    else db.run("UPDATE providerConnections SET data=? WHERE id='c'", [JSON.stringify({ apiKey: 'dummy-provider', providerSpecificData: { connectionProxyEnabled: true, connectionProxyUrl: url, connectionNoProxy: noProxy } })]);
  });
}
const options = (mode, noProxy = '') => mode === 'global' ? { persistedGlobalProxy: { url: proxyUrl, noProxy } }
  : { connectionProxyEnabled: true, connectionProxyUrl: proxyUrl, connectionNoProxy: noProxy, strictProxy: false, proxyPoolId: null };
const execute = (accounting, proxyOptions, signal = undefined) => new BaseExecutor('openai', { baseUrl: targetUrl, timeoutMs: 3000, retry: { 502: { attempts: 0, delayMs: 0 } } }).execute({
  accounting, proxyOptions, signal, connectionId: 'c', model: 'fixture-chat', stream: false, credentials: { apiKey: 'dummy-provider' }, body: { messages: [{ role: 'user', content: 'fixture' }] }
});
describe('queued saved global/legacy native HTTP proxy loopback (bounded env precedence only, not TLS/OAuth/provider)', { timeout: 20000 }, () => {
  it.each(['global', 'legacy'])('matching saved %s policy uses actual fixture proxy and ACKs terminal', async mode => {
    save(mode, proxyUrl);
    const result = await execute(context, options(mode));
    expect(failure).toBeNull(); expect(tunnels).toBeGreaterThan(0); expect(posts).toBe(1); expect(result.response.ok).toBe(true);
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: 200000 });
  });
  it.each(['before-enqueue', 'during-wait'])('saved global policy change %s prevents tunnel/POST', async phase => {
    save('global', proxyUrl);
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      if (phase === 'before-enqueue') save('global', 'http://127.0.0.1:1');
      const work = context.beforeAttempt(meta, supported, wire);
      if (phase === 'during-wait') save('global', 'http://127.0.0.1:1');
      return work;
    } };
    await expect(execute(accounting, options('global'))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(tunnels).toBe(0); expect(posts).toBe(0); expect(failure).toBeNull();
    expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['before-enqueue', 'during-wait'])('saved legacy route change %s prevents tunnel/POST', async phase => {
    save('legacy', proxyUrl);
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      if (phase === 'before-enqueue') save('legacy', 'http://127.0.0.1:1');
      const work = context.beforeAttempt(meta, supported, wire);
      if (phase === 'during-wait') save('legacy', 'http://127.0.0.1:1');
      return work;
    } };
    await expect(execute(accounting, options('legacy'))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(tunnels).toBe(0); expect(posts).toBe(0); expect(failure).toBeNull();
    expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['global', 'legacy'])('failed matching saved %s proxy cannot replay directly to upstream', async mode => {
    save(mode, proxyUrl);
    const prepared = options(mode);
    // Refuse the owned proxy endpoint while retaining a reachable upstream. A
    // hidden direct fallback would reach the upstream fixture and falsely bill.
    for (const socket of sockets) socket.destroy();
    proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve));
    await expect(execute(context, prepared)).rejects.toBeDefined();
    expect(failure).toBeNull(); expect(tunnels).toBe(0); expect(posts).toBe(0);
    const rows = db.all('SELECT state,costNanoUsd FROM apiKeyAccounting');
    expect(rows).toEqual([{ state: 'unresolved', costNanoUsd: null }]);
  });
  it.each(['HTTP_PROXY', 'NO_PROXY'])('original %s changes after own intent ACK cannot tunnel or POST', async variable => {
    save('global', proxyUrl);
    const accounting = { ...context, async beforeAttempt(meta, supported, wire) {
      const attempt = await context.beforeAttempt(meta, supported, wire);
      expect(db.get('SELECT state FROM apiKeyAccounting').state).toBe('pending');
      vi.stubEnv(variable, variable === 'HTTP_PROXY' ? 'http://dummy-changed.invalid:1234' : 'dummy-changed.invalid');
      return attempt;
    } };
    await expect(execute(accounting, options('global'))).rejects.toBeDefined();
    expect(failure).toBeNull(); expect(tunnels).toBe(0); expect(posts).toBe(0);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', costNanoUsd: null }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('original registry URL changes after own intent ACK cannot use previously admitted route', async () => {
    save('global', proxyUrl);
    const accounting = { ...context, async beforeAttempt(meta, supported, wire) {
      const attempt = await context.beforeAttempt(meta, supported, wire);
      expect(db.get('SELECT state FROM apiKeyAccounting').state).toBe('pending');
      // Only the test-local registry replacement changes, never real registry.
      registryFixture.baseUrl = 'http://dummy-changed.invalid/chat';
      return attempt;
    } };
    await expect(execute(accounting, options('global'))).rejects.toBeDefined();
    expect(failure).toBeNull(); expect(tunnels).toBe(0); expect(posts).toBe(0);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', costNanoUsd: null }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('native POST retains original headers when exposed prepared wire is mutated during wait', async () => {
    save('global', proxyUrl);
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      const work = context.beforeAttempt(meta, supported, wire);
      try { wire.headers.Authorization = 'Bearer dummy-changed'; } catch { /* immutable original acceptable */ }
      return work;
    } };
    let result;
    try { result = await execute(accounting, options('global')); }
    finally { expect(failure).toBeNull(); }
    expect(result.response.ok).toBe(true); expect(tunnels).toBeGreaterThan(0); expect(posts).toBe(1);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 200000 }]);
  });
  it('native redirect refuses a second POST and ACKs one unresolved attempt', async () => {
    save('global', proxyUrl); redirectResponse = true;
    await expect(execute(context, options('global'))).rejects.toBeDefined();
    expect(failure).toBeNull(); expect(tunnels).toBeGreaterThan(0); expect(posts).toBe(1);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', costNanoUsd: null }]);
  });
  it.each(['after-intent-before-dispatch', 'after-upstream-POST'])('native false abort %s preserves the right own terminal without replay', async phase => {
    save('global', proxyUrl);
    const controller = new AbortController();
    const owner = await (await import('@/lib/apiKeyBudget/requestAccounting.js')).createRequestAccounting(new Request('http://localhost/v1/chat/completions', {
      signal: controller.signal, headers: { Authorization: 'Bearer dummy-key' } }), { adapter: async () => db, queued: true });
    let accounting = owner;
    if (phase === 'after-intent-before-dispatch') accounting = { ...owner, async beforeAttempt(meta, supported, wire) {
      const attempt = await owner.beforeAttempt(meta, supported, wire);
      expect(db.get('SELECT state FROM apiKeyAccounting').state).toBe('pending');
      controller.abort(false); return attempt;
    } };
    else onPost = () => controller.abort(false);
    await expect(execute(accounting, options('global'), controller.signal)).rejects.toBe(false);
    expect(failure).toBeNull(); expect(trapHits).toBe(0);
    if (phase === 'after-intent-before-dispatch') {
      expect(posts).toBe(0); expect(tunnels).toBe(0);
      expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'not_dispatched', outcome: 'aborted', costNanoUsd: null }]);
    } else {
      expect(posts).toBe(1); expect(tunnels).toBeGreaterThan(0);
      expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', outcome: 'aborted', costNanoUsd: null }]);
    }
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['saved-global-proxy', 'saved-global-direct', 'legacy-over-global'])('%s takes precedence over competing owned environment proxy/bypass', async mode => {
    for (const name of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']) vi.stubEnv(name, trapUrl);
    // These are original, unchanged environment values, not post-ACK mutation.
    // A global proxy ignores env bypass; saved direct ignores env proxy; legacy
    // still precedes the saved global, which must remain independently valid.
    const noProxy = mode === 'saved-global-proxy' ? '' : '127.0.0.1';
    for (const name of ['NO_PROXY', 'no_proxy']) vi.stubEnv(name, mode === 'saved-global-proxy' ? '127.0.0.1' : '');
    let prepared;
    if (mode === 'legacy-over-global') {
      save('global', trapUrl); save('legacy', proxyUrl);
      prepared = { ...options('legacy'), persistedGlobalProxy: { url: trapUrl, noProxy: '' } };
    } else { save('global', proxyUrl, noProxy); prepared = options('global', noProxy); }
    let result;
    try { result = await execute(context, prepared); } finally { expect(failure).toBeNull(); }
    expect(result.response.ok).toBe(true); expect(posts).toBe(1); expect(trapHits).toBe(0);
    if (mode === 'saved-global-direct') expect(tunnels).toBe(0); else expect(tunnels).toBeGreaterThan(0);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 200000 }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('matching saved global NO_PROXY permits native direct fixture without inventing tunnel authority', async () => {
    save('global', proxyUrl, '127.0.0.1');
    expect((await execute(context, options('global', '127.0.0.1'))).response.ok).toBe(true);
    expect(failure).toBeNull(); expect(tunnels).toBe(0); expect(posts).toBe(1);
    expect(db.get('SELECT state FROM apiKeyAccounting').state).toBe('settled');
  });
});
