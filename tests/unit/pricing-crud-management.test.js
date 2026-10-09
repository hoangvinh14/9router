import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dir, db, route, session;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), '9router-pricing-crud-'));
  vi.stubEnv('DATA_DIR', dir); vi.stubEnv('JWT_SECRET', 'private-pricing-crud-fixture-secret');
  vi.stubEnv('NINEROUTER_PEER_TOKEN', 'private-pricing-peer');
  delete global._dbAdapter; vi.resetModules();
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  route = await import('@/app/api/pricing/route.js');
  session = await import('@/lib/auth/dashboardSession.js');
});
afterEach(() => {
  vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});
function request(method = 'GET', { token, origin, local = false, gateway = false, body, query = '' } = {}) {
  return new NextRequest(`http://localhost:20128/api/pricing${query}`, { method,
    headers: { host: 'localhost:20128', ...(token ? { cookie: `auth_token=${token}` } : {}),
      ...(origin ? { origin } : {}), ...(gateway ? { authorization: 'Bearer fixture-gateway-key' } : {}),
      ...(local ? { 'x-9r-peer-token': 'private-pricing-peer', 'x-9r-real-ip': '127.0.0.1' } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const body = { openai: { 'gpt-5': { input: '0.000000001', output: '2', cached: '0' } } };
describe('pricing CRUD route-authoritative management boundary', () => {
  it('anonymous/gateway/invalid sessions cannot read/write/reset/defaults before storage/body', async () => {
    const get = vi.spyOn(db, 'get'), run = vi.spyOn(db, 'run'), all = vi.spyOn(db, 'all');
    for (const credentials of [{}, { gateway: true }, { token: 'invalid' }]) {
      for (const method of ['GET', 'PATCH', 'DELETE']) {
        get.mockClear(); run.mockClear(); all.mockClear();
        const req = request(method, { ...credentials, ...(method === 'PATCH' ? { body } : {}) });
        const read = vi.spyOn(req, 'json'), stream = vi.spyOn(req, 'body', 'get');
        const response = await route[method](req);
        expect(response.status).toBe(401); expect(response.headers.get('cache-control')).toBe('no-store');
        expect(get).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled(); expect(all).not.toHaveBeenCalled();
        expect(read).not.toHaveBeenCalled(); expect(stream).not.toHaveBeenCalled();
      }
      expect((await route.GET_DEFAULTS(request('GET', credentials))).status).toBe(401);
    }
  });
  it('JWT mutations require exact Origin; no read/write on CSRF refusal', async () => {
    const token = await session.createDashboardAuthToken();
    const get = vi.spyOn(db, 'get'), run = vi.spyOn(db, 'run'), all = vi.spyOn(db, 'all');
    for (const method of ['PATCH', 'DELETE']) {
      for (const origin of [undefined, 'https://evil.example', 'http://localhost:20129']) {
        get.mockClear(); run.mockClear(); all.mockClear();
        const response = await route[method](request(method, { token, origin, ...(method === 'PATCH' ? { body } : {}) }));
        expect(response.status).toBe(403); expect(response.headers.get('cache-control')).toBe('no-store');
        expect(get).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled(); expect(all).not.toHaveBeenCalled();
      }
    }
  });
  it('issued session saves exact decimal/zero, returns numeric map and effective inherit; no activation', async () => {
    const catalog = fs.readFileSync(new URL('../fixtures/pricing/models-dev-minimal.json', import.meta.url), 'utf8');
    await (await import('@/lib/pricing/catalogSync.js')).syncCatalog({ fetchImpl: async () => new Response(catalog) });
    const token = await session.createDashboardAuthToken(), origin = 'http://localhost:20128';
    const saved = await route.PATCH(request('PATCH', { token, origin, body }));
    expect(saved.status).toBe(200); expect(saved.headers.get('cache-control')).toBe('no-store');
    expect((await saved.json()).openai['gpt-5']).toEqual({ input: 0.000000001, output: 2, cached: 0 });
    expect(JSON.parse(db.get("SELECT value FROM kv WHERE scope='pricing' AND key='openai'").value)['gpt-5']).toEqual(body.openai['gpt-5']);
    const resolver = await import('@/lib/pricing/referenceResolver.js');
    const original = resolver.resolveReferencePriceSync(db, 'openai', 'gpt-5').snapshot;
    const reset = await route.DELETE(request('DELETE', { token, origin, query: '?provider=openai&model=gpt-5' }));
    expect(reset.status).toBe(200); expect((await reset.json()).openai['gpt-5'].input).toBe(1.25);
    expect(original.rates.input).toBe('0.000000001');
    expect((await route.GET(request('GET', { token }))).status).toBe(200);
    expect((await route.GET_DEFAULTS(request('GET', { token }))).status).toBe(200);
    expect(db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined();
  });
  it('login-disabled remote remains denied; only verified direct loopback can manage', async () => {
    await (await import('@/lib/db/repos/settingsRepo.js')).updateSettings({ requireLogin: false });
    expect((await route.GET(request())).status).toBe(401);
    expect((await route.GET(request('GET', { local: true }))).status).toBe(200);
    expect((await route.PATCH(request('PATCH', { local: true, origin: 'http://localhost:20128', body }))).status).toBe(200);
    await (await import('@/lib/db/repos/settingsRepo.js')).updateSettings({ requireLogin: true });
    expect((await route.GET(request('GET', { local: true }))).status).toBe(401);
  });
});
