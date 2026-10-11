import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ headers: null, create: vi.fn() }));
vi.mock('../../open-sse/config/providers.js', async importOriginal => {
  const original = await importOriginal();
  return { ...original, PROVIDERS: { ...original.PROVIDERS, get codex() { return { ...original.PROVIDERS.codex, headers: fixture.headers }; } } };
});
vi.mock('undici', () => ({ ProxyAgent: class { constructor(options) { fixture.create(options); } }, Agent: class { constructor(options) { fixture.create(options); } } }));
let nativeFetch, fetchProxy, evidence;
const url = 'https://chatgpt.com/backend-api/codex/responses';
const options = () => ({ method: 'POST', redirect: 'error', body: evidence.serializedBody,
  headers: { ...evidence.baseTransport.headers, 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: 'Bearer dummy-oauth', session_id: 'dummy-session', 'ChatGPT-Account-ID': 'dummy-account' } });
const saved = () => ({ persistedGlobalProxy: { url: 'http://dummy-proxy.invalid:3210', noProxy: '' } });
beforeEach(async () => {
  vi.resetModules(); fixture.create.mockReset();
  const original = await vi.importActual('../../open-sse/config/providers.js'); fixture.headers = { ...original.PROVIDERS.codex.headers };
  nativeFetch = vi.fn(async () => Response.json({ fixture: true })); vi.stubGlobal('fetch', nativeFetch);
  ({ proxyAwareFetch: fetchProxy } = await import('../../open-sse/utils/proxyFetch.js'));
  const { captureAccountingBaseTransport } = await import('../../open-sse/config/accountedBaseTransport.js');
  const { PROVIDERS } = await import('../../open-sse/config/providers.js');
  evidence = { model: 'gpt-5.5', mode: 'native-codex-responses-sse', baseTransport: captureAccountingBaseTransport(PROVIDERS.codex),
    serializedBody: JSON.stringify({ model: 'gpt-5.5', stream: true, store: false, instructions: 'fixture', input: 'fixture' }) };
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('fixed Codex OAuth dispatch (mock fetch/dispatcher, not socket/refresh acceptance)', () => {
  it('unchanged native full SSE evidence reaches one strict POST', async () => {
    expect((await fetchProxy(url, options(), saved(), { singlePost: true, codexTransport: evidence })).ok).toBe(true);
    expect(nativeFetch).toHaveBeenCalledTimes(1); expect(fixture.create).toHaveBeenCalledTimes(1);
  });
  it.each(['url', 'body', 'mode', 'tools', 'store', 'model', 'account', 'session', 'token', 'header', 'version', 'registry'])('invalid %s entry refuses before dispatcher/POST', async kind => {
    const input = options(); let target = url;
    if (kind === 'url') target = 'https://dummy-upstream.invalid/responses';
    if (kind === 'body') input.body = 'changed';
    if (kind === 'mode') evidence.mode = 'native-responses-sse';
    if (['tools', 'store', 'model'].includes(kind)) {
      const body = JSON.parse(evidence.serializedBody);
      if (kind === 'tools') body.tools = [{ type: 'web_search' }];
      if (kind === 'store') body.store = true;
      if (kind === 'model') { body.model = 'unregistered-fixture'; evidence.model = body.model; }
      input.body = evidence.serializedBody = JSON.stringify(body);
    }
    if (kind === 'account') delete input.headers['ChatGPT-Account-ID'];
    if (kind === 'session') input.headers.session_id = '';
    if (kind === 'token') input.headers.Authorization = 'Bearer ';
    if (kind === 'header') input.headers['OpenAI-Beta'] = 'fixture';
    if (kind === 'version') input.headers.version = 'wrong';
    if (kind === 'registry') fixture.headers = { ...fixture.headers, version: 'changed' };
    await expect(fetchProxy(target, input, saved(), { singlePost: true, codexTransport: evidence })).rejects.toThrow('Accounting Codex transport unavailable');
    expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
  });
  it('registry drift through dispatcher yield refuses native POST', async () => {
    fixture.create.mockImplementation(() => { fixture.headers = { ...fixture.headers, version: 'changed' }; });
    await expect(fetchProxy(url, options(), saved(), { singlePost: true, codexTransport: evidence })).rejects.toThrow('Accounting Codex transport unavailable');
    expect(fixture.create).toHaveBeenCalledTimes(1); expect(nativeFetch).not.toHaveBeenCalled();
  });
  it('actual body drift through dispatcher yield refuses despite detached evidence', async () => {
    const input = options(); fixture.create.mockImplementation(() => { evidence.serializedBody = 'changed'; input.body = 'changed'; });
    await expect(fetchProxy(url, input, saved(), { singlePost: true, codexTransport: evidence })).rejects.toThrow('Accounting Codex transport unavailable');
    expect(nativeFetch).not.toHaveBeenCalled();
  });
});
