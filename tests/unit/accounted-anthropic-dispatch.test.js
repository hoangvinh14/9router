import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ headers: null, create: vi.fn() }));
vi.mock('../../open-sse/config/providers.js', async importOriginal => ({ ...(await importOriginal()),
  PROVIDERS: { ...(await importOriginal()).PROVIDERS, get anthropic() { return { format: 'claude', baseUrl: 'https://api.anthropic.com/v1/messages', headers: fixture.headers }; } } }));
vi.mock('undici', () => ({ ProxyAgent: class { constructor(options) { fixture.create(options); } }, Agent: class { constructor(options) { fixture.create(options); } } }));
let nativeFetch, fetchProxy, evidence;
const url = 'https://api.anthropic.com/v1/messages';
const options = () => ({ method: 'POST', redirect: 'error', body: evidence.serializedBody,
  headers: { 'Content-Type': 'application/json', 'x-api-key': 'dummy-provider', 'anthropic-version': '2023-06-01', Accept: 'text/event-stream' } });
const saved = () => ({ persistedGlobalProxy: { url: 'http://dummy-proxy.invalid:3210', noProxy: '' } });
beforeEach(async () => {
  vi.resetModules(); fixture.headers = { 'anthropic-version': '2023-06-01' }; fixture.create.mockReset();
  nativeFetch = vi.fn(async () => Response.json({ fixture: true })); vi.stubGlobal('fetch', nativeFetch);
  ({ proxyAwareFetch: fetchProxy } = await import('../../open-sse/utils/proxyFetch.js'));
  const { captureAccountingBaseTransport } = await import('../../open-sse/config/accountedBaseTransport.js');
  const { PROVIDERS } = await import('../../open-sse/config/providers.js');
  const body = { model: 'fixture-native', stream: false, max_tokens: 100, messages: [{ role: 'user', content: 'fixture' }] };
  evidence = { model: 'fixture-native', mode: 'buffered-claude-sse', baseTransport: captureAccountingBaseTransport(PROVIDERS.anthropic),
    originalSerializedBody: JSON.stringify(body), serializedBody: JSON.stringify({ ...body, stream: true }) };
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('standard Messages dispatch (mock/modulefixture not production beta/OAuth/socket approval)', () => {
  it('unchanged original and forcedstream wire reaches one strict POST', async () => {
    expect((await fetchProxy(url, options(), saved(), { singlePost: true, anthropicTransport: evidence })).ok).toBe(true);
    expect(nativeFetch).toHaveBeenCalledTimes(1); expect(fixture.create).toHaveBeenCalledTimes(1);
  });
  it.each(['url', 'body', 'mode', 'tools', 'beta', 'registry', 'model', 'original', 'transform', 'version'])('invalid %s refuses before dispatcher/POST', async kind => {
    const input = options(); let target = url;
    if (kind === 'url') target = 'https://dummy-upstream.invalid/messages';
    if (kind === 'body') input.body = '{}';
    if (kind === 'mode') evidence.mode = 'native-gemini-sse';
    if (kind === 'beta') input.headers['anthropic-beta'] = 'fixture-beta';
    if (kind === 'version') input.headers['anthropic-version'] = 'foreign';
    if (kind === 'registry') fixture.headers = { ...fixture.headers, 'anthropic-beta': 'fixture-beta' };
    if (kind === 'model') evidence.model = 'foreign-model';
    if (['tools', 'original', 'transform'].includes(kind)) {
      const body = JSON.parse(evidence.originalSerializedBody);
      if (kind === 'tools') body.tools = [{ name: 'fixture', input_schema: {} }];
      if (kind === 'original') body.metadata = { user_id: 'fixture' };
      if (kind === 'transform') body.messages[0].content = 'different';
      evidence.originalSerializedBody = JSON.stringify(body);
    }
    await expect(fetchProxy(target, input, saved(), { singlePost: true, anthropicTransport: evidence })).rejects.toThrow('Accounting Anthropic transport unavailable');
    expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
  });
  it('registry drift after dispatcher acquisition refuses POST/replay', async () => {
    fixture.create.mockImplementation(() => { fixture.headers = { ...fixture.headers, 'anthropic-beta': 'fixture-beta' }; });
    await expect(fetchProxy(url, options(), saved(), { singlePost: true, anthropicTransport: evidence })).rejects.toThrow('Accounting Anthropic transport unavailable');
    expect(fixture.create).toHaveBeenCalledTimes(1); expect(nativeFetch).not.toHaveBeenCalled();
  });
  it('postyield actual body drift refuses despite original detached evidence', async () => {
    const input = options(); fixture.create.mockImplementation(() => { evidence.serializedBody = 'changed'; input.body = 'changed'; });
    await expect(fetchProxy(url, input, saved(), { singlePost: true, anthropicTransport: evidence })).rejects.toThrow('Accounting Anthropic transport unavailable');
    expect(nativeFetch).not.toHaveBeenCalled();
  });
});
