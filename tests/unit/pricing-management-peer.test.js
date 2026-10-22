import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import http from 'node:http';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ session: vi.fn(), settings: vi.fn() }));
vi.mock('@/lib/auth/dashboardSession.js', () => ({ getDashboardAuthSession: mocks.session }));
vi.mock('@/lib/db/index.js', () => ({ getSettings: mocks.settings }));
import { authorizeManagement } from '@/lib/auth/managementGuard.js';
const require = createRequire(import.meta.url);
let server, base, originalCreate, originalToken;
beforeAll(async () => {
  mocks.session.mockResolvedValue(null); mocks.settings.mockResolvedValue({ requireLogin: false });
  originalCreate = http.createServer; originalToken = process.env.NINEROUTER_PEER_TOKEN;
  delete require.cache[require.resolve('../../custom-server.js')]; require('../../custom-server.js');
  server = http.createServer(async (incoming, response) => {
    try {
      const headers = { ...incoming.headers };
      // Simulate only Next's generated forwarding after the actual wrapper has
      // stamped what was present on the original wire request.
      if (incoming.url === '/framework') { headers['x-forwarded-host'] = headers.host; headers['x-forwarded-proto'] = 'http'; }
      if (incoming.url === '/deleted') { delete headers['x-forwarded-host']; delete headers['x-forwarded-proto']; }
      const request = new NextRequest(`http://${incoming.headers.host}/api/pricing/sync`, { method: incoming.method, headers });
      const auth = await authorizeManagement(request, { mutation: incoming.method === 'POST' });
      response.writeHead(auth.response?.status || 200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ actor: auth.actor, host: incoming.headers.host,
        forwarded: incoming.headers['x-9r-authority-forwarded'], protocol: incoming.headers['x-9r-socket-proto'] }));
    } catch { response.writeHead(500); response.end('fixture failure'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  server?.closeAllConnections(); if (server) await new Promise(resolve => server.close(resolve));
  http.createServer = originalCreate;
  if (originalToken === undefined) delete process.env.NINEROUTER_PEER_TOKEN; else process.env.NINEROUTER_PEER_TOKEN = originalToken;
});
function raw(host, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: '/', headers: { host, ...headers } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.once('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.setTimeout(2000, () => req.destroy(new Error('fixture request timeout'))); req.once('error', reject); req.end();
  });
}
describe('actual TCP socket wrapper to pricing management guard', () => {
  it('overwrites forged stamps; direct same-origin POST permitted, different Origin denied', async () => {
    const response = await fetch(base, { method: 'POST', headers: { origin: base, 'x-9r-peer-token': 'forged', 'x-9r-real-ip': '203.0.113.1', 'x-9r-socket-proto': 'https:', 'x-9r-authority-forwarded': '1' } });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ actor: 'local-management', forwarded: '0', protocol: 'http:' });
    expect((await fetch(base, { method: 'POST', headers: { origin: `http://localhost:${server.address().port}` } })).status).toBe(403);
  });
  it('permits authenticated framework-populated exact authority only when original forwarding was absent', async () => {
    expect((await fetch(`${base}/framework`, { method: 'POST', headers: { origin: base } })).status).toBe(200);
    for (const endpoint of ['framework', 'deleted']) {
      const result = await fetch(`${base}/${endpoint}`, { method: 'POST', headers: { origin: base, 'x-forwarded-host': `127.0.0.1:${server.address().port}`, 'x-forwarded-proto': 'http', 'x-9r-authority-forwarded': '0' } });
      expect(result.status).toBe(403); expect((await result.json()).forwarded).toBe('1');
    }
  });
  it('reverse-proxy hop never grants anonymous local management', async () => {
    mocks.settings.mockClear();
    for (const ip of ['127.0.0.1', '203.0.113.3']) {
      const response = await fetch(base, { headers: { 'x-forwarded-for': ip, 'x-9r-via-proxy': '' } });
      // Literal loopback normalization can fail authority first; neither result
      // grants anonymous access or reaches persisted settings.
      expect([401, 403]).toContain(response.status);
    }
    expect(mocks.settings).not.toHaveBeenCalled();
  });
  it('transmits exact Host and rejects DNS rebinding and URL parser aliases', async () => {
    const host = `127.0.0.1:${server.address().port}`;
    expect(await raw(host)).toMatchObject({ status: 200, body: { host, forwarded: '0', protocol: 'http:' } });
    expect(await raw('attacker.example')).toMatchObject({ status: 401, body: { host: 'attacker.example' } });
    expect(await raw(`127.1:${server.address().port}`)).toMatchObject({ status: 403 });
  });
});
