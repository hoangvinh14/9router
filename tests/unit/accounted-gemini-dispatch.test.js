import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ headers: null, create: vi.fn() }));
vi.mock('../../open-sse/config/providers.js', async importOriginal => ({ ...(await importOriginal()),
  PROVIDERS: { ...(await importOriginal()).PROVIDERS, get gemini() { return { format: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models', headers: fixture.headers }; } } }));
vi.mock('undici', () => ({ ProxyAgent: class { constructor(options) { fixture.create(options); } }, Agent: class { constructor(options) { fixture.create(options); } } }));
let nativeFetch, fetchProxy, evidence;
const url = 'https://generativelanguage.googleapis.com/v1beta/models/fixture-gemini:generateContent';
const options = () => ({ method: 'POST', redirect: 'error', body: evidence.serializedBody,
  headers: { 'Content-Type': 'application/json', 'x-goog-api-key': 'dummy-provider' } });
const saved = () => ({ persistedGlobalProxy: { url: 'http://dummy-proxy.invalid:3210', noProxy: '' } });
beforeEach(async () => {
  vi.resetModules(); fixture.headers = null; fixture.create.mockReset();
  nativeFetch = vi.fn(async () => Response.json({ fixture: true })); vi.stubGlobal('fetch', nativeFetch);
  ({ proxyAwareFetch: fetchProxy } = await import('../../open-sse/utils/proxyFetch.js'));
  const { captureAccountingBaseTransport } = await import('../../open-sse/config/accountedBaseTransport.js');
  const { PROVIDERS } = await import('../../open-sse/config/providers.js');
  evidence = { model: 'fixture-gemini', mode: 'native-gemini-json', baseTransport: captureAccountingBaseTransport(PROVIDERS.gemini),
    serializedBody: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'fixture' }] }] }) };
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('native Gemini original dispatch authority (mock dispatcher/fetch, not socket/OAuth/envelopes)', () => {
  it('unchanged original native request reaches one strict POST', async () => {
    expect((await fetchProxy(url, options(), saved(), { singlePost: true, geminiTransport: evidence })).ok).toBe(true);
    expect(nativeFetch).toHaveBeenCalledTimes(1); expect(fixture.create).toHaveBeenCalledTimes(1);
  });
  it.each(['url', 'body', 'mode', 'tools', 'header', 'registry', 'model', 'action'])('invalid %s refuses before dispatcher and POST', async kind => {
    const input = options(); let target = url;
    if (kind === 'url') target = 'https://dummy-upstream.invalid/generateContent';
    if (kind === 'body') input.body = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'different' }] }] });
    if (kind === 'mode') evidence.mode = 'native-responses-sse';
    if (kind === 'tools') { evidence.serializedBody = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'fixture' }] }], tools: [{}] }); input.body = evidence.serializedBody; }
    if (kind === 'header') input.headers.Authorization = 'Bearer dummy-foreign';
    if (kind === 'registry') fixture.headers = { 'Authorization': 'Bearer dummy-foreign' };
    if (kind === 'model') evidence.model = '../foreign';
    if (kind === 'action') target = url.replace(':generateContent', ':streamGenerateContent?alt=sse');
    await expect(fetchProxy(target, input, saved(), { singlePost: true, geminiTransport: evidence })).rejects.toThrow('Accounting Gemini transport unavailable');
    expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
  });
  it('registry drift while acquiring dispatcher refuses POST without route reselection', async () => {
    fixture.create.mockImplementation(() => { fixture.headers = { 'Accept': 'application/json' }; });
    await expect(fetchProxy(url, options(), saved(), { singlePost: true, geminiTransport: evidence })).rejects.toThrow('Accounting Gemini transport unavailable');
    expect(fixture.create).toHaveBeenCalledTimes(1); expect(nativeFetch).not.toHaveBeenCalled();
  });
  it('postyield actual body drift refuses despite detached original evidence', async () => {
    const input = options();
    fixture.create.mockImplementation(() => { evidence.serializedBody = 'mutated'; input.body = 'mutated'; });
    await expect(fetchProxy(url, input, saved(), { singlePost: true, geminiTransport: evidence })).rejects.toThrow('Accounting Gemini transport unavailable');
    expect(nativeFetch).not.toHaveBeenCalled();
  });
});
