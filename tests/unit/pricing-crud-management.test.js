import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ session: vi.fn(), settings: vi.fn(), get: vi.fn(), editor: vi.fn(), update: vi.fn(), reset: vi.fn(), resetAll: vi.fn() }));
vi.mock('@/lib/auth/dashboardSession.js', () => ({ getDashboardAuthSession: mocks.session }));
vi.mock('@/lib/db/index.js', () => ({ getSettings: mocks.settings, getPricing: mocks.get, getEditorPricing: mocks.editor, updatePricing: mocks.update, resetPricing: mocks.reset, resetAllPricing: mocks.resetAll }));
import { GET, PATCH, DELETE, GET_DEFAULTS } from '@/app/api/pricing/route.js';
function request(method = 'GET', { body, query = '', origin = 'http://localhost:20128', headers = {} } = {}) {
  return new NextRequest(`http://localhost:20128/api/pricing${query}`, { method,
    headers: { host: 'localhost:20128', ...(origin === null ? {} : { origin }), ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('NINEROUTER_PEER_TOKEN', 'fixture-only-stamp'); vi.stubEnv('NINEROUTER_MANAGEMENT_ORIGIN', '');
  mocks.session.mockResolvedValue(null); mocks.settings.mockResolvedValue({ requireLogin: false });
  mocks.get.mockResolvedValue({ openai: { fixture: { input: 1, output: 2 } } }); mocks.update.mockResolvedValue({});
});
afterEach(() => vi.unstubAllEnvs());
describe('pricing CRUD management guard and validation', () => {
  it.each([GET, PATCH, DELETE, GET_DEFAULTS])('denies anonymous and gateway credentials before pricing/body access', async handler => {
    for (const headers of [{}, { authorization: 'Bearer fixture-gateway' }, { 'x-9r-cli-token': 'fixture-cli' }]) {
      const req = request('PATCH', { body: 'not JSON', headers }); const read = vi.spyOn(req.body, 'getReader');
      const response = await handler(req); expect(response.status).toBe(401); expect(response.headers.get('cache-control')).toBe('no-store');
      expect(read).not.toHaveBeenCalled();
    }
    expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.reset).not.toHaveBeenCalled(); expect(mocks.resetAll).not.toHaveBeenCalled();
  });
  it('editor view is opt-in and authenticated before exact pricing access', async () => {
    expect((await GET(request('GET', { query: '?view=editor' }))).status).toBe(401);
    expect(mocks.editor).not.toHaveBeenCalled(); expect(mocks.get).not.toHaveBeenCalled();
    mocks.session.mockResolvedValue({ authenticated: true });
    mocks.editor.mockResolvedValue({ exact: { custom: { fixture: { input: '1234567.123456789', output: '0' } } } });
    const response = await GET(request('GET', { query: '?view=editor' }));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await response.json()).exact.custom.fixture.input).toBe('1234567.123456789');
    expect(mocks.get).not.toHaveBeenCalled(); mocks.editor.mockClear();
    for (const query of ['?view=bad', '?view=editor&view=editor', '?view=editor&url=secret']) expect((await GET(request('GET', { query }))).status).toBe(400);
    expect(mocks.editor).not.toHaveBeenCalled();
    expect((await GET(request())).status).toBe(200); expect(mocks.get).toHaveBeenCalledOnce();
  });
  it('session mutation requires exact Origin before reading body or pricing', async () => {
    mocks.session.mockResolvedValue({ authenticated: true });
    for (const origin of [null, 'https://evil.example', 'http://localhost:20129']) {
      const req = request('PATCH', { origin, body: '{}' }); const read = vi.spyOn(req.body, 'getReader');
      expect((await PATCH(req)).status).toBe(403); expect(read).not.toHaveBeenCalled();
      expect((await DELETE(request('DELETE', { origin }))).status).toBe(403);
    }
    expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.resetAll).not.toHaveBeenCalled();
  });
  it('valid session passes complete exact decimal/zero values, never sparse or overprecision batches', async () => {
    mocks.session.mockResolvedValue({ authenticated: true });
    const body = { openai: { fixture: { input: '0.000000001', output: '2', cached: '0' } } };
    expect((await PATCH(request('PATCH', { body }))).status).toBe(200); expect(mocks.update).toHaveBeenCalledWith(body);
    mocks.update.mockClear();
    for (const bad of [{ openai: { fixture: { input: '1' } } }, { openai: { fixture: { input: '0.0000000001', output: '2' } } }, { openai: { fixture: { input: '1', output: '2', unknown: '0' } } }, 'bad-json']) {
      expect((await PATCH(request('PATCH', { body: bad }))).status).toBe(400);
    }
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('reset rejects empty/duplicate/unknown/orphan targets without mutation, distinguishes all/provider/model', async () => {
    mocks.session.mockResolvedValue({ authenticated: true });
    for (const query of ['?model=fixture', '?provider=', '?provider=openai&model=', '?provider=openai&provider=other', '?provider=openai&url=http://private', '?provider=__proto__']) {
      expect((await DELETE(request('DELETE', { query }))).status).toBe(400);
    }
    expect(mocks.reset).not.toHaveBeenCalled(); expect(mocks.resetAll).not.toHaveBeenCalled(); expect(mocks.get).not.toHaveBeenCalled();
    expect((await DELETE(request('DELETE', { query: '?provider=openai&model=fixture' }))).status).toBe(200); expect(mocks.reset).toHaveBeenLastCalledWith('openai', 'fixture');
    expect((await DELETE(request('DELETE', { query: '?provider=openai' }))).status).toBe(200); expect(mocks.reset).toHaveBeenLastCalledWith('openai');
    expect((await DELETE(request('DELETE'))).status).toBe(200); expect(mocks.resetAll).toHaveBeenCalledOnce();
  });
  it('redacts pricing storage failures with no-store and never leaks credentials', async () => {
    mocks.session.mockResolvedValue({ authenticated: true }); mocks.get.mockRejectedValue(new Error('SECRET storage text'));
    const response = await GET(request()); expect(response.status).toBe(503); expect(response.headers.get('cache-control')).toBe('no-store'); expect(JSON.stringify(await response.json())).not.toContain('SECRET');
    mocks.update.mockRejectedValue(new Error('SECRET write text'));
    const saved = await PATCH(request('PATCH', { body: { custom: { fixture: { input: '1', output: '2' } } } }));
    expect(saved.status).toBe(503); expect(JSON.stringify(await saved.json())).not.toContain('SECRET');
  });
});
