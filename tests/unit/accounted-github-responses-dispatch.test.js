import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ config: null, create: vi.fn() }));
vi.mock('../../open-sse/config/providers.js', async importOriginal => {
  const original = await importOriginal(); return { ...original, PROVIDERS: { ...original.PROVIDERS, get github() { return fixture.config; } } };
});
vi.mock('undici', () => ({ ProxyAgent: class { constructor(options) { fixture.create(options); } }, Agent: class { constructor(options) { fixture.create(options); } } }));
let nativeFetch, fetchProxy, evidence, buildHeaders;
const url = 'https://api.githubcopilot.com/responses';
const options = () => ({ method: 'POST', redirect: 'error', body: evidence.serializedBody, headers: buildHeaders({ copilotToken: 'dummy-copilot-token' }, evidence.requestId) });
const saved = () => ({ persistedGlobalProxy: { url: 'http://dummy-proxy.invalid:3210', noProxy: '' } });
beforeEach(async () => {
  vi.resetModules(); fixture.create.mockReset(); const original = await vi.importActual('../../open-sse/config/providers.js'); fixture.config = structuredClone(original.PROVIDERS.github);
  nativeFetch = vi.fn(async () => Response.json({ fixture: true })); vi.stubGlobal('fetch', nativeFetch);
  ({ proxyAwareFetch: fetchProxy } = await import('../../open-sse/utils/proxyFetch.js'));
  const { captureAccountingGithubResponsesConfig } = await import('../../open-sse/config/accountedGithubResponsesDispatch.js');
  ({ githubResponsesHeaders: buildHeaders } = await import('../../open-sse/config/accountedGithubResponsesCandidate.js'));
  evidence = { model: 'gpt-5.2-codex', mode: 'native-github-responses-sse', githubConfig: captureAccountingGithubResponsesConfig(fixture.config), requestId: 'fixture-request',
    serializedBody: JSON.stringify({ model: 'gpt-5.2-codex', stream: true, store: false, instructions: 'fixture', input: 'fixture' }) };
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('GitHub native Responses strict dispatch (mock dispatcher/fetch, not socket/refresh acceptance)', () => {
  it('unchanged native evidence reaches exactly one strict POST', async () => {
    expect((await fetchProxy(url, options(), saved(), { singlePost: true, githubResponsesTransport: evidence })).ok).toBe(true);
    expect(nativeFetch).toHaveBeenCalledTimes(1); expect(fixture.create).toHaveBeenCalledTimes(1);
  });
  it.each(['url', 'body', 'mode', 'tools', 'store', 'model', 'request', 'token', 'header', 'client', 'version', 'registry'])('%s refuses before dispatcher/POST', async kind => {
    const input = options(); let target = url;
    if (kind === 'url') target = 'https://fixture.invalid/responses';
    if (kind === 'body') input.body = 'changed';
    if (kind === 'mode') evidence.mode = 'native-responses-sse';
    if (['tools', 'store', 'model'].includes(kind)) {
      const value = JSON.parse(evidence.serializedBody);
      if (kind === 'tools') value.tools = [];
      if (kind === 'store') value.store = true;
      if (kind === 'model') evidence.model = value.model = 'claude-sonnet-4.6';
      input.body = evidence.serializedBody = JSON.stringify(value);
    }
    if (kind === 'request') input.headers['x-request-id'] = 'changed';
    if (kind === 'token') input.headers.Authorization = 'Bearer ';
    if (kind === 'header') input.headers['OpenAI-Beta'] = 'fixture';
    if (kind === 'client') input.headers['editor-version'] = 'changed';
    if (kind === 'version') input.headers['anthropic-version'] = 'changed';
    if (kind === 'registry') fixture.config.responsesUrl = 'https://fixture.invalid/responses';
    await expect(fetchProxy(target, input, saved(), { singlePost: true, githubResponsesTransport: evidence })).rejects.toThrow('Accounting GitHub Responses transport unavailable');
    expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
  });
  it('registry route drift through dispatcher yield refuses POST', async () => {
    fixture.create.mockImplementation(() => { fixture.config.responsesUrl = 'https://fixture.invalid/responses'; });
    await expect(fetchProxy(url, options(), saved(), { singlePost: true, githubResponsesTransport: evidence })).rejects.toThrow('Accounting GitHub Responses transport unavailable');
    expect(fixture.create).toHaveBeenCalledTimes(1); expect(nativeFetch).not.toHaveBeenCalled();
  });
  it('actual body drift through dispatcher yield refuses POST', async () => {
    const input = options(); fixture.create.mockImplementation(() => { input.body = 'changed'; });
    await expect(fetchProxy(url, input, saved(), { singlePost: true, githubResponsesTransport: evidence })).rejects.toThrow('Accounting GitHub Responses transport unavailable');
    expect(fixture.create).toHaveBeenCalledTimes(1); expect(nativeFetch).not.toHaveBeenCalled();
  });
});
