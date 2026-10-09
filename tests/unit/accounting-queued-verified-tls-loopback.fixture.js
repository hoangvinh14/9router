import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import { X509Certificate } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const registryFixture = vi.hoisted(() => ({ baseUrl: null }));
vi.mock('../../open-sse/config/providers.js', async importOriginal => ({ ...(await importOriginal()),
  PROVIDERS: { ...(await importOriginal()).PROVIDERS, get openai() { return { baseUrl: registryFixture.baseUrl }; } } }));
let directory, db, upstream, proxy, sockets, posts, tunnels, context, BaseExecutor, targetUrl, proxyUrl, failure;
const previousData = process.env.DATA_DIR;
const certificateDirectory = process.env.ACCOUNTING_TLS_FIXTURE_DIR;
const listen = server => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
beforeEach(async () => {
  // The finite runner starts Node with this owned CA via NODE_EXTRA_CA_CERTS.
  // Fail setup rather than skip or weaken verification when it is unavailable.
  expect(certificateDirectory).toBeTruthy();
  expect(process.env.NODE_EXTRA_CA_CERTS).toBe(path.join(certificateDirectory, 'ca.pem'));
  expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).not.toBe('0');
  directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-verified-tls-')); process.env.DATA_DIR = directory;
  delete global._dbAdapter; vi.resetModules(); sockets = new Set(); posts = 0; tunnels = 0; failure = null;
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
  upstream = proxy = null; vi.restoreAllMocks(); db?.close(); delete global._dbAdapter;
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
  if (previousData === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previousData;
});
async function startFixture(identity) {
  const cert = fs.readFileSync(path.join(certificateDirectory, `${identity}.pem`));
  const ca = new X509Certificate(fs.readFileSync(path.join(certificateDirectory, 'ca.pem')));
  const leaf = new X509Certificate(cert);
  expect(leaf.verify(ca.publicKey)).toBe(true);
  if (identity === 'matching') expect(leaf.checkIP('127.0.0.1')).toBe('127.0.0.1');
  else expect(leaf.checkIP('127.0.0.1')).toBeUndefined();
  const track = socket => { sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket)); };
  upstream = https.createServer({ cert, key: fs.readFileSync(path.join(certificateDirectory, `${identity}.key`)) }, async (request, response) => {
    posts++;
    try {
      for await (const chunk of request) { void chunk; }
      expect(request.method).toBe('POST'); expect(request.headers.authorization).toBe('Bearer dummy-provider');
      expect(db.get('SELECT state FROM apiKeyAccounting')?.state).toBe('pending');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'fixture' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }));
    } catch (error) { failure = error; response.writeHead(500, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: 'fixture assertion failed' })); }
  });
  upstream.on('connection', track); await listen(upstream);
  const target = `127.0.0.1:${upstream.address().port}`; targetUrl = `https://${target}/chat`; registryFixture.baseUrl = targetUrl;
  proxy = http.createServer((_request, response) => { failure = new Error('Unexpected non-CONNECT proxy request'); response.writeHead(405); response.end(); });
  proxy.on('connection', track); proxy.on('connect', (request, socket, head) => {
    if (request.url !== target) { failure = new Error('Unexpected proxy target'); socket.destroy(); return; }
    tunnels++;
    const remote = net.connect(upstream.address().port, '127.0.0.1'); track(remote);
    remote.once('connect', () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) remote.write(head); socket.pipe(remote); remote.pipe(socket); });
    socket.once('close', () => remote.destroy()); remote.once('close', () => socket.destroy());
  });
  await listen(proxy); proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
}
describe('queued verified native HTTPS owned CA/hostname boundary (requires isolated CA runner, not all TLS authority)', { timeout: 20000 }, () => {
  it.each([['direct', 'matching'], ['proxy', 'matching'], ['direct', 'mismatch'], ['proxy', 'mismatch']])('%s %s certificate preserves TLS and own accounting ACKs', async (mode, identity) => {
    await startFixture(identity);
    const noProxy = mode === 'direct' ? '127.0.0.1' : '';
    db.durableTransaction(() => db.run('UPDATE settings SET data=? WHERE id=1', [JSON.stringify({ requireApiKey: true,
      outboundProxyEnabled: true, outboundProxyUrl: proxyUrl, outboundNoProxy: noProxy })]));
    const work = new BaseExecutor('openai', { baseUrl: targetUrl, timeoutMs: 3000, retry: { 502: { attempts: 0, delayMs: 0 } } }).execute({
      accounting: context, connectionId: 'c', model: 'fixture-chat', stream: false, credentials: { apiKey: 'dummy-provider' },
      proxyOptions: { persistedGlobalProxy: { url: proxyUrl, noProxy } }, body: { messages: [{ role: 'user', content: 'fixture' }] } });
    if (identity === 'matching') {
      let result; try { result = await work; } finally { expect(failure).toBeNull(); }
      expect(result.response.ok).toBe(true); expect(posts).toBe(1);
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 200000 }]);
    } else {
      await expect(work).rejects.toMatchObject({ cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID' } });
      expect(posts).toBe(0); expect(failure).toBeNull();
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', costNanoUsd: null }]);
    }
    if (mode === 'direct') expect(tunnels).toBe(0); else expect(tunnels).toBeGreaterThan(0);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
});
