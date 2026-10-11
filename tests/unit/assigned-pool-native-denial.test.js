import http from 'node:http';
import net from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pool = vi.hoisted(() => vi.fn());
vi.mock('@/models', () => ({ getProxyPoolById: (...args) => pool(...args) }));
const { resolveConnectionProxyConfig } = await import('@/lib/network/connectionProxy.js');
const { proxyAwareFetch } = await import('../../open-sse/utils/proxyFetch.js');
const { ProxyPoolUnavailableError } = await import('../../open-sse/utils/proxyPolicyError.js');
const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
});
let upstream, proxy, trap, targetUrl, proxyUrl, trapUrl, sockets, owners, failure, counts;
const observe = work => { owners.push(work); work.catch(error => { failure ??= error; }); return work; };
async function drain() {
  let index = 0;
  while (index < owners.length) { const end = owners.length; await Promise.allSettled(owners.slice(index, end)); index = end; }
}
beforeEach(async () => {
  pool.mockReset(); sockets = new Set(); owners = []; failure = null;
  counts = { upstreamConnections: 0, posts: 0, proxyConnections: 0, tunnels: 0, trapConnections: 0 };
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']) vi.stubEnv(key, '');
  const track = socket => { sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket)); };
  upstream = http.createServer((request, response) => {
    observe((async () => {
      try {
        let body = ''; for await (const chunk of request) body += chunk.toString();
        expect(request.method).toBe('POST'); expect(request.url).toBe('/fixture'); expect(body).toBe('{}');
        counts.posts++; response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"fixture":true}');
      } catch (error) { failure ??= error; response.writeHead(500); response.end('Fixture assertion failed'); }
    })());
  });
  upstream.on('connection', socket => { counts.upstreamConnections++; track(socket); }); await listen(upstream);
  const target = `127.0.0.1:${upstream.address().port}`; targetUrl = `http://${target}/fixture`;
  proxy = http.createServer((_request, response) => { failure ??= new Error('Unexpected non-CONNECT fixture request'); response.writeHead(405); response.end(); });
  proxy.on('connection', socket => { counts.proxyConnections++; track(socket); });
  proxy.on('connect', (request, socket, head) => {
    if (request.url !== target) { failure ??= new Error('Unexpected fixture CONNECT target'); socket.destroy(); return; }
    counts.tunnels++;
    const remote = net.connect(upstream.address().port, '127.0.0.1'); track(remote);
    observe(new Promise(resolve => {
      remote.once('connect', () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) remote.write(head);
        socket.pipe(remote); remote.pipe(socket); resolve();
      });
      remote.once('error', error => { failure ??= error; socket.destroy(); resolve(); });
    }));
    socket.once('close', () => remote.destroy()); remote.once('close', () => socket.destroy());
  });
  await listen(proxy); proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
  trap = http.createServer((_request, response) => { response.writeHead(502); response.end(); });
  trap.on('connection', socket => { counts.trapConnections++; track(socket); });
  trap.on('connect', (_request, socket) => socket.end('HTTP/1.1 502 Fixture Trap\r\n\r\n'));
  await listen(trap); trapUrl = `http://127.0.0.1:${trap.address().port}`;
});
afterEach(async () => {
  await drain();
  for (const socket of sockets || []) socket.destroy();
  for (const server of [proxy, trap, upstream]) {
    server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve));
  }
  vi.restoreAllMocks(); vi.unstubAllEnvs();
});
const project = policy => ({ ...policy, proxyPoolId: policy.proxyPoolId });
describe('selected pool absence: real resolver and native socket denial, not ledger/SOCKS/relay support', () => {
  it.each(['normal', 'singlePost'].flatMap(mode => ['missing', 'lookup-error'].map(fault => ({ mode, fault }))))('$mode $fault refuses before alternate socket after accepted CONNECT positive', async ({ mode, fault }) => {
    pool.mockResolvedValue({ id: 'fixture-pool', type: 'http', isActive: true, strictProxy: true, proxyUrl, noProxy: '' });
    const selected = await resolveConnectionProxyConfig({ proxyPoolId: 'fixture-pool' });
    expect(selected).toMatchObject({ source: 'pool', proxyPoolId: 'fixture-pool', strictProxy: true });
    const options = { method: 'POST', redirect: 'error', body: '{}' };
    const contract = mode === 'singlePost' ? { singlePost: true } : null;
    const response = await observe(proxyAwareFetch(targetUrl, options, project(selected), contract));
    expect(await observe(response.json())).toEqual({ fixture: true }); await drain();
    expect(failure).toBeNull(); expect(counts.posts).toBe(1); expect(counts.tunnels).toBe(1);
    const positiveCounts = { ...counts };
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
    if (fault === 'missing') pool.mockResolvedValue(null);
    else pool.mockRejectedValue(new Error('Fixture private lookup error'));
    const denied = await resolveConnectionProxyConfig({ proxyPoolId: 'fixture-pool', connectionProxyEnabled: true, connectionProxyUrl: trapUrl, connectionNoProxy: '*' });
    expect(denied).toMatchObject({ proxyPoolId: 'fixture-pool', strictProxy: true, proxyPoolUnavailable: true, connectionProxyEnabled: false, connectionProxyUrl: '' });
    vi.stubEnv('HTTP_PROXY', trapUrl); vi.stubEnv('HTTPS_PROXY', trapUrl); vi.stubEnv('ALL_PROXY', trapUrl); vi.stubEnv('NO_PROXY', '*');
    // Competing routes cannot override the fresh denial. These are intentionally
    // hostile options, not evidence granting relay or saved/global eligibility.
    const policy = { ...project(denied), connectionProxyEnabled: true, connectionProxyUrl: trapUrl,
      vercelRelayUrl: trapUrl, persistedGlobalProxy: { url: trapUrl, noProxy: '*' } };
    const before = structuredClone(policy);
    const work = proxyAwareFetch(targetUrl, options, policy, contract);
    owners.push(work); work.catch(() => {}); // Expected denial, not a server fault.
    await expect(work).rejects.toBeInstanceOf(ProxyPoolUnavailableError); await drain();
    expect(counts).toEqual(positiveCounts); expect(counts.trapConnections).toBe(0);
    expect(policy).toEqual(before); expect(failure).toBeNull(); logger.mockRestore();
  });
});
