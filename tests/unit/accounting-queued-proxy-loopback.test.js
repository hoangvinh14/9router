import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const registryFixture = vi.hoisted(() => ({ baseUrl: null }));
vi.mock('../../open-sse/config/providers.js', async importOriginal => ({ ...(await importOriginal()),
  PROVIDERS: { ...(await importOriginal()).PROVIDERS, get openai() { return { baseUrl: registryFixture.baseUrl }; } } }));
let db, directory, upstream, proxy, targetUrl, proxyUrl, authority, BaseExecutor, createAccounting;
let tunnels, posts, failure, sockets;
const previousData = process.env.DATA_DIR;
const listen = server => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const json = { choices: [{ message: { role: 'assistant', content: 'fixture' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } };
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-queued-proxy-socket-')); process.env.DATA_DIR = directory; delete global._dbAdapter; vi.resetModules();
  tunnels = 0; posts = []; failure = null; sockets = new Set();
  const track = socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); socket.on('error', () => {}); };
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-a' }, { id: 'b', key: 'dummy-b' }], settings: { requireApiKey: true },
    providerConnections: [{ id: 'c', provider: 'openai', authType: 'apikey', apiKey: 'dummy-provider', providerSpecificData: { proxyPoolId: 'p' } }] });
  upstream = http.createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString()), key = body.messages[0].content;
      expect(request.method).toBe('POST'); expect(request.headers.authorization).toBe('Bearer dummy-provider');
      expect(db.get("SELECT state FROM apiKeyAccounting WHERE apiKeyId=?", [key])?.state).toBe('pending');
      posts.push(key); response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(json));
    } catch (error) { failure = error; response.writeHead(500); response.end(); }
  });
  upstream.on('connection', track); await listen(upstream);
  const target = `127.0.0.1:${upstream.address().port}`; targetUrl = `http://${target}/chat`;
  registryFixture.baseUrl = targetUrl; // Test-only registry; no production URL exception.
  // Only a CONNECT tunnel to this exact owned fixture is allowed. Never becomes
  // an arbitrary public relay or uses a host supplied by external request data.
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
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','openai',?)", [JSON.stringify({ 'fixture-chat': { input: '1', output: '2' } })]);
    db.run("INSERT INTO proxyPools(id,isActive,data,createdAt,updatedAt) VALUES('p',1,?,'2026-10-03T00:00:00.000Z','2026-10-03T00:00:00.000Z')", [JSON.stringify({ proxyUrl, noProxy: '', strictProxy: true, type: 'http' })]);
  });
  authority = { connectionProxyEnabled: true, connectionProxyUrl: proxyUrl, connectionNoProxy: '', strictProxy: true, proxyPoolId: 'p',
    persistedPoolProxy: { id: 'p', url: proxyUrl, noProxy: '', strictProxy: true, type: 'http', isActive: true } };
  ({ BaseExecutor } = await import('../../open-sse/executors/base.js'));
  createAccounting = async (key = 'a') => (await import('@/lib/apiKeyBudget/requestAccounting.js')).createRequestAccounting(new Request('http://localhost/v1/chat/completions', {
    headers: { Authorization: `Bearer dummy-${key}` } }), { adapter: async () => db, queued: true });
});
afterEach(async () => {
  for (const socket of sockets || []) socket.destroy();
  for (const server of [proxy, upstream]) { server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve)); }
  vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true });
  if (previousData === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previousData;
});
const executor = () => new BaseExecutor('openai', { baseUrl: targetUrl, timeoutMs: 3000, retry: { 502: { attempts: 0, delayMs: 0 } } });
const args = (accounting, key) => ({ accounting, connectionId: 'c', model: 'fixture-chat', stream: false, credentials: { apiKey: 'dummy-provider' }, proxyOptions: authority,
  body: { messages: [{ role: 'user', content: key }] } });
describe('queued selected HTTP pool native proxy loopback (not global/env/TLS/provider certificate)', { timeout: 20000 }, () => {
  it('two keys use actual selected proxy tunnels and ACK exact debit before success', async () => {
    const a = await createAccounting('a'), b = await createAccounting('b'), ex = executor();
    const results = await Promise.all([ex.execute(args(a, 'a')), ex.execute(args(b, 'b'))]);
    expect(failure).toBeNull(); expect(tunnels).toBeGreaterThan(0); expect(posts.sort()).toEqual(['a', 'b']);
    expect(results.every(result => result.response.ok && result.accountingOwned)).toBe(true);
    expect(db.all('SELECT apiKeyId,state,costNanoUsd FROM apiKeyAccounting ORDER BY apiKeyId')).toEqual([
      { apiKeyId: 'a', state: 'settled', costNanoUsd: 200000 }, { apiKeyId: 'b', state: 'settled', costNanoUsd: 200000 }
    ]);
  });
  it.each(['before-enqueue', 'during-wait'])('pool change %s must prevent actual proxy tunnel and upstream POST', async phase => {
    const context = await createAccounting();
    const change = () => db.durableTransaction(() => db.run("UPDATE proxyPools SET data=? WHERE id='p'", [JSON.stringify({ proxyUrl: 'http://127.0.0.1:1', noProxy: '', strictProxy: true, type: 'http' })]));
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      if (phase === 'before-enqueue') change();
      const work = context.beforeAttempt(meta, supported, wire);
      if (phase === 'during-wait') change();
      return work;
    } };
    await expect(executor().execute(args(accounting, 'a'))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(failure).toBeNull(); expect(tunnels).toBe(0); expect(posts).toHaveLength(0);
    expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
});
