import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const registryFixture = vi.hoisted(() => ({ baseUrl: null }));
vi.mock('../../open-sse/config/providers.js', async importOriginal => ({ ...(await importOriginal()),
  PROVIDERS: { ...(await importOriginal()).PROVIDERS, get openai() { return { baseUrl: registryFixture.baseUrl }; } } }));
let directory, db, upstream, proxy, sockets, posts, tunnels, context, BaseExecutor, targetUrl, proxyUrl, failure;
const previousData = process.env.DATA_DIR;
const listen = server => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-queued-tls-')); process.env.DATA_DIR = directory;
  delete global._dbAdapter; vi.resetModules(); sockets = new Set(); posts = 0; tunnels = 0; failure = null;
  // Owned short-lived self-signed fixture only, no machine CA or trust mutation.
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', path.join(directory, 'key.pem'), '-out', path.join(directory, 'cert.pem')],
  { stdio: 'ignore', timeout: 10000 });
  const track = socket => { sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket)); };
  upstream = https.createServer({ key: fs.readFileSync(path.join(directory, 'key.pem')), cert: fs.readFileSync(path.join(directory, 'cert.pem')) },
    (_request, response) => { posts++; response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } })); });
  upstream.on('connection', track); await listen(upstream);
  const target = `127.0.0.1:${upstream.address().port}`; targetUrl = `https://${target}/chat`; registryFixture.baseUrl = targetUrl;
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
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key' }], settings: { requireApiKey: true },
    providerConnections: [{ id: 'c', provider: 'openai', authType: 'apikey', apiKey: 'dummy-provider' }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','openai',?)", [JSON.stringify({ 'fixture-chat': { input: '1', output: '2' } })]);
  });
  ({ BaseExecutor } = await import('../../open-sse/executors/base.js'));
  context = await (await import('@/lib/apiKeyBudget/requestAccounting.js')).createRequestAccounting(new Request('http://localhost/v1/chat/completions', {
    headers: { Authorization: 'Bearer dummy-key' } }), { adapter: async () => db, queued: true });
});
afterEach(async () => {
  for (const socket of sockets || []) socket.destroy();
  for (const server of [proxy, upstream]) { server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve)); }
  vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true });
  if (previousData === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previousData;
});
describe('queued native TLS failure must not downgrade or replay (owned untrusted TLS fixture, not general TLS certification)', { timeout: 20000 }, () => {
  it.each(['direct', 'proxy'])('%s self-signed TLS fails with own unresolved ACK and zero upstream POST', async mode => {
    const noProxy = mode === 'direct' ? '127.0.0.1' : '';
    db.durableTransaction(() => db.run('UPDATE settings SET data=? WHERE id=1', [JSON.stringify({ requireApiKey: true,
      outboundProxyEnabled: true, outboundProxyUrl: proxyUrl, outboundNoProxy: noProxy })]));
    const ex = new BaseExecutor('openai', { baseUrl: targetUrl, timeoutMs: 3000, retry: { 502: { attempts: 0, delayMs: 0 } } });
    const result = ex.execute({ accounting: context, connectionId: 'c', model: 'fixture-chat', stream: false,
      credentials: { apiKey: 'dummy-provider' }, proxyOptions: { persistedGlobalProxy: { url: proxyUrl, noProxy } },
      body: { messages: [{ role: 'user', content: 'fixture' }] } });
    await expect(result).rejects.toBeDefined();
    expect(failure).toBeNull(); expect(posts).toBe(0);
    if (mode === 'direct') expect(tunnels).toBe(0); else expect(tunnels).toBeGreaterThan(0);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', costNanoUsd: null }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
});
