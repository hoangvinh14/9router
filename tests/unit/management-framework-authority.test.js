import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import http from 'node:http';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ session: vi.fn(), settings: vi.fn(), write: vi.fn() }));
vi.mock('@/lib/auth/dashboardSession.js', () => ({ getDashboardAuthSession: mocks.session }));
vi.mock('@/lib/db/index.js', () => ({ getSettings: mocks.settings }));
import { authorizeManagement } from '@/lib/auth/managementGuard.js';
const require = createRequire(import.meta.url);
let server, port;
const priorToken = process.env.NINEROUTER_PEER_TOKEN;
beforeAll(async () => {
  require('../../custom-server.js');
  server = http.createServer(async (incoming, response) => {
    const headers = { ...incoming.headers };
    // Model Next's population AFTER the actual socket wrapper; never send peer
    // tokens from the client. This is not the real rebuilt Next runtime gate.
    if (incoming.url === '/removed') { delete headers['x-forwarded-host']; delete headers['x-forwarded-proto']; }
    else { headers['x-forwarded-host'] ??= headers.host; headers['x-forwarded-proto'] ??= 'http'; }
    const protocol = incoming.url === '/scheme' ? 'https:' : 'http:';
    const authorityPort = incoming.url === '/port' ? port + 1 : port;
    const url = `${protocol}//localhost:${authorityPort}/api/pricing/sync`;
    const request = new NextRequest(url, { method: incoming.method, headers });
    const authorization = await authorizeManagement(request, { mutation: incoming.method === 'POST' });
    if (!authorization.response && incoming.method === 'POST') mocks.write();
    response.writeHead(authorization.response?.status || 200, { 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(authorization.response ? await authorization.response.json() : { actor: authorization.actor }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); port = server.address().port;
});
afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
  if (priorToken === undefined) delete process.env.NINEROUTER_PEER_TOKEN; else process.env.NINEROUTER_PEER_TOKEN = priorToken;
});
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ authenticated: true }); mocks.settings.mockResolvedValue({ requireLogin: false }); });
async function wire({ method = 'GET', path = '/', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path, method, headers: { Host: `127.0.0.1:${port}`, ...headers } }, response => {
      const chunks = []; response.on('data', row => chunks.push(row)); response.on('end', () => resolve({ status: response.statusCode, cache: response.headers['cache-control'], body: JSON.parse(Buffer.concat(chunks).toString()) }));
    }); request.on('error', reject); request.end();
  });
}
async function denied(options) { const result = await wire(options); expect(result.status).toBe(403); expect(result.body.code).toBe('management_authority_invalid'); expect(result.cache).toBe('no-store'); expect(mocks.write).not.toHaveBeenCalled(); }
describe('transport-bound Next framework authority normalization', () => {
  it('permits the proven direct literal Host with Next-populated headers and valid session', async () => { expect((await wire()).body).toEqual({ actor: 'dashboard-session' }); });
  it('permits exact Origin mutation only, rejecting absent/foreign/cross-site Origin without writes', async () => {
    expect((await wire({ method: 'POST', headers: { Origin: `http://127.0.0.1:${port}` } })).status).toBe(200); expect(mocks.write).toHaveBeenCalledTimes(1); mocks.write.mockClear();
    for (const headers of [{}, { Origin: `http://localhost:${port}` }, { Origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'cross-site' }]) { const result = await wire({ method: 'POST', headers }); expect(result.status).toBe(403); expect(result.body.code).toBe('management_csrf_rejected'); expect(mocks.write).not.toHaveBeenCalled(); }
  });
  it('requires explicit login-disabled policy for sessionless direct peer', async () => { mocks.session.mockResolvedValue(null); expect((await wire()).body).toEqual({ actor: 'local-management' }); mocks.settings.mockResolvedValue({ requireLogin: true }); expect((await wire()).status).toBe(401); });
  it.each(['x-forwarded-host', 'x-forwarded-proto'])('blocks original wire %s including empty/equal/duplicate even when removed downstream', async name => {
    for (const value of ['', name === 'x-forwarded-host' ? `127.0.0.1:${port}` : 'http', ['http', 'https'], 'attacker.invalid']) await denied({ method: 'POST', headers: { [name]: value, Origin: `http://127.0.0.1:${port}` } });
    await denied({ path: '/removed', headers: { [name]: 'http' } });
  });
  it('overwrites forged transport stamps but never lets them erase original forwarding provenance', async () => {
    const forged = { 'x-9r-peer-token': 'forged', 'x-9r-real-ip': '203.0.113.1', 'x-9r-socket-proto': 'https:', 'x-9r-authority-forwarded': '1' };
    expect((await wire({ headers: forged })).status).toBe(200);
    await denied({ headers: { ...forged, 'x-9r-authority-forwarded': '', 'x-forwarded-host': `127.0.0.1:${port}` } });
  });
  it('new framework-header permission rejects missing, forged and malformed transport evidence', async () => {
    const headers = { host: `127.0.0.1:${port}`, 'x-9r-real-ip': '127.0.0.1', 'x-9r-peer-token': process.env.NINEROUTER_PEER_TOKEN, 'x-forwarded-host': `127.0.0.1:${port}`, 'x-forwarded-proto': 'http', 'x-9r-socket-proto': 'http:', 'x-9r-authority-forwarded': '0' };
    for (const changes of [
      { 'x-9r-peer-token': 'forged' }, { 'x-9r-socket-proto': undefined }, { 'x-9r-authority-forwarded': undefined },
      { 'x-9r-authority-forwarded': '' }, { 'x-9r-authority-forwarded': '0, 1' }, { 'x-9r-socket-proto': 'https:' },
      { 'x-forwarded-host': '' }, { 'x-forwarded-host': `127.0.0.1:${port}, evil.invalid` }, { 'x-forwarded-proto': '' }, { 'x-forwarded-proto': 'http, https' },
    ]) {
      const modified = { ...headers, ...changes }; for (const name of Object.keys(modified)) if (modified[name] === undefined) delete modified[name];
      const request = new NextRequest(`http://localhost:${port}/api/pricing/sync`, { headers: modified });
      const result = await authorizeManagement(request); expect(result.response.status).toBe(403); expect((await result.response.json()).code).toBe('management_authority_invalid');
    }
    expect(mocks.settings).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it('canonical authority retains session/CSRF checks without using wire forwarding to rewrite authority', async () => {
    // No normalization exception is needed when canonical Host and URL match.
    const make = (forwarded, method = 'GET', origin = undefined) => new NextRequest(`http://localhost:${port}/api/pricing/sync`, { method, headers: { host: `localhost:${port}`, ...forwarded, ...(origin ? { origin } : {}) } });
    mocks.session.mockResolvedValue(null);
    for (const forwarded of [{ 'x-forwarded-host': 'evil.invalid' }, { 'x-forwarded-proto': '' }, {}]) expect((await authorizeManagement(make(forwarded))).response.status).toBe(401);
    mocks.session.mockResolvedValue({ authenticated: true });
    for (const forwarded of [{ 'x-forwarded-host': 'evil.invalid' }, { 'x-forwarded-proto': 'https' }, { 'x-forwarded-host': 'localhost, evil.invalid' }]) expect((await authorizeManagement(make(forwarded, 'POST', `http://localhost:${port}`), { mutation: true })).response.status).toBe(403);
    // Removed wire fields still do not manufacture transport proof for a local bypass.
    mocks.session.mockResolvedValue(null); expect((await authorizeManagement(make({ 'x-9r-authority-forwarded': '1' }))).response.status).toBe(401);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('denies proxy, scheme, port and noncanonical Host mismatches even with valid session', async () => {
    for (const options of [{ headers: { 'x-forwarded-for': '127.0.0.1' } }, { path: '/scheme' }, { path: '/port' }, { headers: { Host: `127.1:${port}` } }, { headers: { Host: `attacker.invalid:${port}` } }]) await denied(options);
  });
});
