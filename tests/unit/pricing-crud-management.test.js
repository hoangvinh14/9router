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
  it('issued session retains explicit embedded-use rate/unit snapshot through drift and inherit without activation', async () => {
    const token = await session.createDashboardAuthToken(), origin = 'http://localhost:20128';
    const rates = { input: '1.000000001', output: '2', web_search_per_1000: '0.000000001' };
    const payload = value => ({ anthropic: { 'fixture-search-rate': value } });
    const saved = await route.PATCH(request('PATCH', { token, origin, body: payload(rates) }));
    expect(saved.status).toBe(200);
    expect((await saved.json()).anthropic['fixture-search-rate']).toEqual({ input: 1.000000001, output: 2, web_search_per_1000: 0.000000001 });
    expect(JSON.parse(db.get("SELECT value FROM kv WHERE scope='pricing' AND key='anthropic'").value)['fixture-search-rate']).toEqual(rates);
    const { resolveReferencePriceSync } = await import('@/lib/pricing/referenceResolver.js');
    const original = resolveReferencePriceSync(db, 'anthropic', 'fixture-search-rate').snapshot;
    expect(original.rateUnits).toEqual({ web_search_per_1000: 'USD/1000 uses' });
    expect(Object.isFrozen(original.rateUnits)).toBe(true);
    const drift = await route.PATCH(request('PATCH', { token, origin, body: payload({ ...rates, web_search_per_1000: '10' }) }));
    expect(drift.status).toBe(200);
    expect(resolveReferencePriceSync(db, 'anthropic', 'fixture-search-rate').snapshot.revision).not.toBe(original.revision);
    expect(original.rates.web_search_per_1000).toBe('0.000000001');
    const effective = await (await route.GET(request('GET', { token }))).json();
    expect(effective.anthropic['fixture-search-rate'].web_search_per_1000).toBe(10);
    const before = db.get("SELECT value FROM kv WHERE scope='pricing' AND key='anthropic'").value;
    const bad = await route.PATCH(request('PATCH', { token, origin, body: payload({ ...rates, web_search_per_1000: '0.0000000001' }) }));
    expect(bad.status).toBe(400); expect(db.get("SELECT value FROM kv WHERE scope='pricing' AND key='anthropic'").value).toBe(before);
    const flat = { input: rates.input, output: rates.output };
    expect((await route.PATCH(request('PATCH', { token, origin, body: payload(flat) }))).status).toBe(200);
    expect(resolveReferencePriceSync(db, 'anthropic', 'fixture-search-rate').snapshot).not.toHaveProperty('rateUnits');
    expect(JSON.parse(db.get("SELECT value FROM kv WHERE scope='pricing' AND key='anthropic'").value)['fixture-search-rate']).toEqual(flat);
    expect((await route.DELETE(request('DELETE', { token, origin, query: '?provider=anthropic&model=fixture-search-rate' }))).status).toBe(200);
    expect(resolveReferencePriceSync(db, 'anthropic', 'fixture-search-rate').status).toBe('unavailable');
    expect(original.rates).toEqual(rates);
    expect(db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined();
  });
  it('issued session stores explicit image/document token rates and units; drift/reset/no mutation do not enable usage support', async () => {
    const token = await session.createDashboardAuthToken(), origin = 'http://localhost:20128';
    const rates = { input: '1', output: '2', cached: '0.1', input_image: '0.000000001', cached_image: '0', input_document: '3', cached_document: '0.2' };
    const payload = value => ({ gemini: { 'fixture-modality-rate': value } });
    const saved = await route.PATCH(request('PATCH', { token, origin, body: payload(rates) })); expect(saved.status).toBe(200);
    expect((await saved.json()).gemini['fixture-modality-rate'].input_image).toBe(0.000000001);
    expect(JSON.parse(db.get("SELECT value FROM kv WHERE scope='pricing' AND key='gemini'").value)['fixture-modality-rate']).toEqual(rates);
    const { resolveReferencePriceSync } = await import('@/lib/pricing/referenceResolver.js');
    const original = resolveReferencePriceSync(db, 'gemini', 'fixture-modality-rate').snapshot;
    expect(original.rateUnits.input_image).toBe('USD/1M tokens'); expect(original.rateUnits.cached_document).toBe('USD/1M tokens'); expect(original).not.toHaveProperty('usageSemantics');
    expect((await route.PATCH(request('PATCH', { token, origin, body: payload({ ...rates, input_image: '30' }) }))).status).toBe(200);
    expect(resolveReferencePriceSync(db, 'gemini', 'fixture-modality-rate').snapshot.revision).not.toBe(original.revision); expect(original.rates).toEqual(rates);
    const before = db.get("SELECT value FROM kv WHERE scope='pricing' AND key='gemini'").value;
    const bad = { gemini: { 'fixture-modality-rate': { ...rates, input_image: '0.0000000001' }, 'other-row': { input: '1', output: '2' } } };
    expect((await route.PATCH(request('PATCH', { token, origin, body: bad }))).status).toBe(400);
    expect(db.get("SELECT value FROM kv WHERE scope='pricing' AND key='gemini'").value).toBe(before);
    expect((await route.DELETE(request('DELETE', { token, origin, query: '?provider=gemini&model=fixture-modality-rate' }))).status).toBe(200);
    expect(resolveReferencePriceSync(db, 'gemini', 'fixture-modality-rate').status).toBe('unavailable');
    expect(db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined();
  });
  it('issued session stores exact AUDIO reference rate units through drift and missing-cache replacement without enabling usage support', async () => {
    const token = await session.createDashboardAuthToken(), origin = 'http://localhost:20128';
    const rates = { input: '1', output: '2', cached: '0.1', input_audio: '0.000000001', cached_audio: '0' }, payload = value => ({ gemini: { 'fixture-audio-rate': value } });
    const saved = await route.PATCH(request('PATCH', { token, origin, body: payload(rates) })); expect(saved.status).toBe(200); expect((await saved.json()).gemini['fixture-audio-rate'].input_audio).toBe(0.000000001);
    expect(JSON.parse(db.get("SELECT value FROM kv WHERE scope='pricing' AND key='gemini'").value)['fixture-audio-rate']).toEqual(rates);
    const { resolveReferencePriceSync } = await import('@/lib/pricing/referenceResolver.js'); const original = resolveReferencePriceSync(db, 'gemini', 'fixture-audio-rate').snapshot;
    expect(original.rateUnits.input_audio).toBe('USD/1M tokens'); expect(original.rateUnits.cached_audio).toBe('USD/1M tokens'); expect(original).not.toHaveProperty('usageSemantics');
    const before = db.get("SELECT value FROM kv WHERE scope='pricing' AND key='gemini'").value;
    expect((await route.PATCH(request('PATCH', { token, origin, body: payload({ ...rates, cached_audio: '0.0000000001' }) }))).status).toBe(400);
    expect(db.get("SELECT value FROM kv WHERE scope='pricing' AND key='gemini'").value).toBe(before);
    expect((await route.PATCH(request('PATCH', { token, origin, body: payload({ input: '1', output: '2', input_audio: '7' }) }))).status).toBe(200);
    const changed = resolveReferencePriceSync(db, 'gemini', 'fixture-audio-rate').snapshot; expect(changed.rates).not.toHaveProperty('cached_audio'); expect(changed.revision).not.toBe(original.revision); expect(original.rates).toEqual(rates);
    expect((await route.DELETE(request('DELETE', { token, origin, query: '?provider=gemini&model=fixture-audio-rate' }))).status).toBe(200); expect(resolveReferencePriceSync(db, 'gemini', 'fixture-audio-rate').status).toBe('unavailable');
    expect(db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined();
  });
  it('issued session retains lexical VIDEO token references through replacement/delete without manufacturing usage or activation', async () => {
    const token = await session.createDashboardAuthToken(), origin = 'http://localhost:20128';
    const rates = { input: '1', output: '2', cached: '0.1', input_video: '0.000000001', cached_video: '0' }, payload = value => ({ gemini: { 'fixture-video-rate': value } });
    const saved = await route.PATCH(request('PATCH', { token, origin, body: payload(rates) })); expect(saved.status).toBe(200); expect((await saved.json()).gemini['fixture-video-rate'].input_video).toBe(0.000000001);
    expect(JSON.parse(db.get("SELECT value FROM kv WHERE scope='pricing' AND key='gemini'").value)['fixture-video-rate']).toEqual(rates);
    const { resolveReferencePriceSync } = await import('@/lib/pricing/referenceResolver.js'); const original = resolveReferencePriceSync(db, 'gemini', 'fixture-video-rate').snapshot;
    expect(original.rateUnits.input_video).toBe('USD/1M tokens'); expect(original.rateUnits.cached_video).toBe('USD/1M tokens'); expect(original).not.toHaveProperty('usageSemantics');
    const before = db.get("SELECT value FROM kv WHERE scope='pricing' AND key='gemini'").value;
    expect((await route.PATCH(request('PATCH', { token, origin, body: payload({ ...rates, input_video: '0.0000000001' }) }))).status).toBe(400);
    expect(db.get("SELECT value FROM kv WHERE scope='pricing' AND key='gemini'").value).toBe(before);
    expect((await route.PATCH(request('PATCH', { token, origin, body: payload({ input: '1', output: '2', input_video: '11' }) }))).status).toBe(200);
    const changed = resolveReferencePriceSync(db, 'gemini', 'fixture-video-rate').snapshot; expect(changed.rates).not.toHaveProperty('cached_video'); expect(changed.revision).not.toBe(original.revision); expect(original.rates).toEqual(rates);
    expect((await route.DELETE(request('DELETE', { token, origin, query: '?provider=gemini&model=fixture-video-rate' }))).status).toBe(200); expect(resolveReferencePriceSync(db, 'gemini', 'fixture-video-rate').status).toBe('unavailable');
    expect(db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined();
  });
  it('issued session retains processing tool-prompt reference fields through lexical drift/zero/replacement/delete without enabling usage or accounting', async () => {
    const token = await session.createDashboardAuthToken(), origin = 'http://localhost:20128';
    const rates = { input: '1', output: '2', processing_tool_text: '0.000000001', processing_tool_image: '17', processing_tool_document: '29', processing_tool_audio: '19', processing_tool_video: '0' }, payload = value => ({ gemini: { 'fixture-processing-rate': value } });
    const saved = await route.PATCH(request('PATCH', { token, origin, body: payload(rates) })); expect(saved.status).toBe(200); expect((await saved.json()).gemini['fixture-processing-rate'].processing_tool_text).toBe(0.000000001);
    expect(JSON.parse(db.get("SELECT value FROM kv WHERE scope='pricing' AND key='gemini'").value)['fixture-processing-rate']).toEqual(rates);
    const { resolveReferencePriceSync } = await import('@/lib/pricing/referenceResolver.js'); const original = resolveReferencePriceSync(db, 'gemini', 'fixture-processing-rate').snapshot;
    for (const field of Object.keys(rates).filter(key => key.startsWith('processing_tool_'))) expect(original.rateUnits[field]).toBe('USD/1M tokens'); expect(original).not.toHaveProperty('usageSemantics');
    const before = db.get("SELECT value FROM kv WHERE scope='pricing' AND key='gemini'").value;
    expect((await route.PATCH(request('PATCH', { token, origin, body: payload({ ...rates, processing_tool_image: '0.0000000001' }) }))).status).toBe(400); expect(db.get("SELECT value FROM kv WHERE scope='pricing' AND key='gemini'").value).toBe(before);
    expect((await route.PATCH(request('PATCH', { token, origin, body: payload({ input: '1', output: '2', processing_tool_image: '18' }) }))).status).toBe(200);
    const changed = resolveReferencePriceSync(db, 'gemini', 'fixture-processing-rate').snapshot; expect(changed.rates).not.toHaveProperty('processing_tool_video'); expect(changed.revision).not.toBe(original.revision); expect(original.rates).toEqual(rates);
    expect((await route.DELETE(request('DELETE', { token, origin, query: '?provider=gemini&model=fixture-processing-rate' }))).status).toBe(200); expect(resolveReferencePriceSync(db, 'gemini', 'fixture-processing-rate').status).toBe('unavailable');
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
