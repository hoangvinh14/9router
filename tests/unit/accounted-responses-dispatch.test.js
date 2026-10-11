import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ headers: null, create: vi.fn() }));
vi.mock('../../open-sse/config/providers.js', async importOriginal => ({ ...(await importOriginal()),
  PROVIDERS: { ...(await importOriginal()).PROVIDERS, get openai() { return { format: 'openai', baseUrl: 'https://api.openai.com/v1/chat/completions', headers: fixture.headers }; } } }));
vi.mock('undici', () => ({ ProxyAgent: class { constructor(options) { fixture.create(options); } }, Agent: class { constructor(options) { fixture.create(options); } } }));
let nativeFetch, fetchProxy, evidence;
const url = 'https://api.openai.com/v1/responses';
const options = () => ({ method: 'POST', redirect: 'error', body: evidence.serializedBody,
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer dummy-provider' } });
const saved = () => ({ persistedGlobalProxy: { url: 'http://dummy-proxy.invalid:3210', noProxy: '' } });
beforeEach(async () => {
  vi.resetModules(); fixture.headers = null; fixture.create.mockReset();
  nativeFetch = vi.fn(async () => Response.json({ fixture: true })); vi.stubGlobal('fetch', nativeFetch);
  ({ proxyAwareFetch: fetchProxy } = await import('../../open-sse/utils/proxyFetch.js'));
  const { captureAccountingBaseTransport } = await import('../../open-sse/config/accountedBaseTransport.js');
  const { PROVIDERS } = await import('../../open-sse/config/providers.js');
  evidence = { model: 'fixture-responses', mode: 'native-responses-json', baseTransport: captureAccountingBaseTransport(PROVIDERS.openai),
    serializedBody: JSON.stringify({ model: 'fixture-responses', stream: false, input: 'fixture', store: false }) };
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('fixed native Responses dispatch authority (mock dispatcher/fetch, no socket/OAuth acceptance)', () => {
  it('unchanged original evidence reaches one strict POST', async () => {
    expect((await fetchProxy(url, options(), saved(), { singlePost: true, responsesTransport: evidence })).ok).toBe(true);
    expect(nativeFetch).toHaveBeenCalledTimes(1); expect(fixture.create).toHaveBeenCalledTimes(1);
  });
  it.each(['url', 'body', 'mode', 'tools', 'header', 'registry'])('invalid %s at entry refuses before dispatcher/native POST', async kind => {
    const input = options(); let target = url;
    if (kind === 'url') target = 'https://dummy-upstream.invalid/responses';
    if (kind === 'body') input.body = JSON.stringify({ model: 'different', stream: false, input: 'fixture' });
    if (kind === 'mode') evidence.mode = 'native-codex-sse';
    if (kind === 'tools') { evidence.serializedBody = JSON.stringify({ model: 'fixture-responses', stream: false, input: 'fixture', tools: [{ type: 'web_search' }] }); input.body = evidence.serializedBody; }
    if (kind === 'header') input.headers['OpenAI-Beta'] = 'fixture';
    if (kind === 'registry') fixture.headers = { 'OpenAI-Beta': 'fixture' };
    await expect(fetchProxy(target, input, saved(), { singlePost: true, responsesTransport: evidence })).rejects.toThrow('Accounting Responses transport unavailable');
    expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
  });
  it('registry drift during dispatcher acquisition refuses native POST/replay', async () => {
    fixture.create.mockImplementation(() => { fixture.headers = { 'OpenAI-Beta': 'fixture' }; });
    await expect(fetchProxy(url, options(), saved(), { singlePost: true, responsesTransport: evidence })).rejects.toThrow('Accounting Responses transport unavailable');
    expect(fixture.create).toHaveBeenCalledTimes(1); expect(nativeFetch).not.toHaveBeenCalled();
  });
  it('detached evidence survives caller mutation but actual built body drift is refused after yield', async () => {
    const input = options();
    fixture.create.mockImplementation(() => { evidence.serializedBody = 'mutated'; input.body = 'mutated'; });
    await expect(fetchProxy(url, input, saved(), { singlePost: true, responsesTransport: evidence })).rejects.toThrow('Accounting Responses transport unavailable');
    expect(nativeFetch).not.toHaveBeenCalled();
  });
});
