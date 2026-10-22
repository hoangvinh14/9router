import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
let root, db, api, route, coverage, session;
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pricing-issued-session-'));
  vi.stubEnv('DATA_DIR', root); vi.stubEnv('JWT_SECRET', 'fixture-management-integration-not-production');
  vi.stubEnv('NINEROUTER_PEER_TOKEN', 'fixture-peer-stamp'); vi.stubEnv('NINEROUTER_MANAGEMENT_ORIGIN', '');
  delete global._dbAdapter; vi.resetModules();
  api = await import('@/lib/db/index.js'); await api.initDb(); db = global._dbAdapter.instance;
  expect(db.driver).toBe('node:sqlite');
  route = await import('@/app/api/pricing/route.js'); coverage = await import('@/app/api/pricing/coverage/route.js');
  session = await import('@/lib/auth/dashboardSession.js');
});
afterEach(() => {
  vi.restoreAllMocks(); db?.close(); db = null; delete global._dbAdapter; vi.unstubAllEnvs(); vi.resetModules();
  fs.rmSync(root, { recursive: true, force: true });
});
function request(method, { token, body, origin = 'http://localhost:20128', query = '', local = false } = {}) {
  return new NextRequest(`http://localhost:20128/api/pricing${query}`, { method,
    headers: { host: 'localhost:20128', ...(token ? { cookie: `auth_token=${token}` } : {}), ...(origin === null ? {} : { origin }),
      ...(local ? { 'x-9r-peer-token': 'fixture-peer-stamp', 'x-9r-real-ip': '127.0.0.1' } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
describe('issued dashboard JWT with actual Node pricing database', () => {
  it('refuses missing/invalid/non-authenticated JWT before pricing queries/body', async () => {
    const token = await session.createDashboardAuthToken({ authenticated: false });
    const get = vi.spyOn(db, 'get'), run = vi.spyOn(db, 'run');
    for (const credential of [undefined, 'invalid', token]) {
      const req = request('PATCH', { token: credential, body: {} }); const read = vi.spyOn(req.body, 'getReader');
      expect((await route.PATCH(req)).status).toBe(401); expect(read).not.toHaveBeenCalled();
      expect((await coverage.GET(request('GET', { token: credential }))).status).toBe(401);
    }
    expect(get).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
  });
  it('issued JWT retains exact zero snapshots across drift/reset and yields coverage409 without activation', async () => {
    const token = await session.createDashboardAuthToken();
    const fixture = fs.readFileSync(new URL('../fixtures/pricing/models-dev-minimal.json', import.meta.url), 'utf8');
    await (await import('@/lib/pricing/catalogSync.js')).syncCatalog({ fetchImpl: async () => new Response(fixture) });
    const rates = { input: '0.000000001', output: '2', cached: '0' };
    const saved = await route.PATCH(request('PATCH', { token, body: { openai: { 'gpt-5': rates } } }));
    expect(saved.status).toBe(200); expect((await saved.json()).openai['gpt-5']).toEqual({ input: 0.000000001, output: 2, cached: 0 });
    expect(JSON.parse(db.get("SELECT value FROM kv WHERE scope='pricing' AND key='openai'").value)['gpt-5']).toEqual(rates);
    const { resolveReferencePriceSync } = await import('@/lib/pricing/referenceResolver.js');
    const original = resolveReferencePriceSync(db, 'openai', 'gpt-5').snapshot;
    const firstResponse = await coverage.GET(request('GET', { token })); expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json(); expect(first.usageCertified).toBe(false);
    expect((await route.PATCH(request('PATCH', { token, body: { openai: { 'gpt-5': { input: '3', output: '4' } } } }))).status).toBe(200);
    const stale = await coverage.GET(request('GET', { token, query: `?revision=${first.revision}` }));
    expect(stale.status).toBe(409); expect((await stale.json()).code).toBe('pricing_coverage_revision_changed');
    expect(original.rates).toEqual(rates); expect(Object.isFrozen(original.rates)).toBe(true);
    const reset = await route.DELETE(request('DELETE', { token, query: '?provider=openai&model=gpt-5' }));
    expect(reset.status).toBe(200); expect((await reset.json()).openai['gpt-5'].input).toBe(1.25);
    expect(db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined();
  });
  it('issued JWT editor view retains custom exact untouched values through PATCH while default GET stays numeric', async () => {
    const token = await session.createDashboardAuthToken();
    const rates = { input: '8999999.999999999', output: '0', cached: '0', input_image: '8765432.123456789' };
    expect((await route.PATCH(request('PATCH', { token, body: { custom: { fixture: rates } } }))).status).toBe(200);
    const editor = await route.GET(request('GET', { token, query: '?view=editor' })); expect(editor.status).toBe(200);
    const baseline = (await editor.json()).exact.custom.fixture; expect(baseline).toEqual(rates);
    const legacy = await route.GET(request('GET', { token })); expect(typeof (await legacy.json()).custom.fixture.input).toBe('number');
    expect((await route.PATCH(request('PATCH', { token, body: { custom: { fixture: { ...baseline, output: '2' } } } }))).status).toBe(200);
    expect((await (await route.GET(request('GET', { token, query: '?view=editor' }))).json()).exact.custom.fixture).toEqual({ ...rates, output: '2' });
    expect((await route.GET(request('GET', { query: '?view=editor' }))).status).toBe(401);
  });
  it('requires exact Origin for real JWT and explicit persisted login-disabled local allowance', async () => {
    const token = await session.createDashboardAuthToken(); const revision = db.get("SELECT value FROM _meta WHERE key='referencePricingRevision'").value;
    expect((await route.PATCH(request('PATCH', { token, origin: null, body: {} }))).status).toBe(403);
    expect((await route.DELETE(request('DELETE', { token, origin: 'https://evil.example' }))).status).toBe(403);
    expect(db.get("SELECT value FROM _meta WHERE key='referencePricingRevision'").value).toBe(revision);
    await api.updateSettings({ requireLogin: false });
    expect((await route.GET(request('GET'))).status).toBe(401);
    expect((await route.GET(request('GET', { local: true }))).status).toBe(200);
    await api.updateSettings({ requireLogin: true });
    expect((await route.GET(request('GET', { local: true }))).status).toBe(401);
  });
});
