import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ config: null, create: vi.fn() }));
vi.mock('../../open-sse/config/providers.js', async importOriginal => {
  const original = await importOriginal(); return { ...original, PROVIDERS: { ...original.PROVIDERS, get github() { return fixture.config; } } };
});
vi.mock('undici', () => ({ ProxyAgent: class { constructor(options) { fixture.create(options); } }, Agent: class { constructor(options) { fixture.create(options); } } }));
let nativeFetch, fetchProxy, evidence, buildHeaders;
const url = 'https://api.githubcopilot.com/v1/messages';
const options = () => ({ method: 'POST', redirect: 'error', body: evidence.serializedBody, headers: buildHeaders({ copilotToken: 'dummy-copilot-token' }, evidence.requestId) });
const saved = () => ({ persistedGlobalProxy: { url: 'http://dummy-proxy.invalid:3210', noProxy: '' } });
beforeEach(async () => {
  vi.resetModules(); fixture.create.mockReset(); const original = await vi.importActual('../../open-sse/config/providers.js'); fixture.config = structuredClone(original.PROVIDERS.github);
  nativeFetch = vi.fn(async () => Response.json({ fixture: true })); vi.stubGlobal('fetch', nativeFetch);
  ({ proxyAwareFetch: fetchProxy } = await import('../../open-sse/utils/proxyFetch.js'));
  const { captureAccountingGithubMessagesConfig } = await import('../../open-sse/config/accountedGithubMessagesDispatch.js');
  ({ githubMessagesHeaders: buildHeaders } = await import('../../open-sse/config/accountedGithubMessagesCandidate.js'));
  const body = { model: 'claude-sonnet-4.6', stream: false, max_tokens: 100, messages: [{ role: 'user', content: 'fixture' }] };
  evidence = { model: body.model, mode: 'native-github-messages-sse', githubConfig: captureAccountingGithubMessagesConfig(fixture.config), requestId: 'fixture-request',
    serializedBody: JSON.stringify({ ...body, stream: true }), originalSerializedBody: JSON.stringify(body) };
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('GitHub native Messages strict dispatch (mock dispatcher/fetch, not socket/refresh acceptance)', () => {
  it('unchanged native evidence reaches exactly one strict POST', async () => {
    expect((await fetchProxy(url, options(), saved(), { singlePost: true, githubMessagesTransport: evidence })).ok).toBe(true);
    expect(nativeFetch).toHaveBeenCalledTimes(1); expect(fixture.create).toHaveBeenCalledTimes(1);
  });
  it.each(['url', 'body', 'mode', 'tools', 'originalMetadata', 'actualMismatch', 'model', 'request', 'token', 'header', 'client', 'version', 'registry', 'missingAccept'])('%s refuses before dispatcher/POST', async kind => {
    const input = options(); let target = url;
    if (kind === 'url') target = 'https://fixture.invalid/messages';
    if (kind === 'body') input.body = 'changed';
    if (kind === 'mode') evidence.mode = 'native-github-responses-sse';
    if (['tools', 'originalMetadata', 'actualMismatch', 'model'].includes(kind)) {
      const value = JSON.parse(evidence.serializedBody), original = JSON.parse(evidence.originalSerializedBody);
      if (kind === 'tools') value.tools = original.tools = [];
      if (kind === 'originalMetadata') original.metadata = {};
      if (kind === 'actualMismatch') value.messages[0].content = 'changed';
      if (kind === 'model') evidence.model = original.model = value.model = 'gpt-5.2-codex';
      input.body = evidence.serializedBody = JSON.stringify(value); evidence.originalSerializedBody = JSON.stringify(original);
    }
    if (kind === 'request') input.headers['x-request-id'] = 'changed';
    if (kind === 'token') input.headers.Authorization = 'Bearer ';
    if (kind === 'header') input.headers['anthropic-beta'] = 'fixture';
    if (kind === 'client') input.headers['editor-version'] = 'changed';
    if (kind === 'version') input.headers['anthropic-version'] = 'changed';
    if (kind === 'missingAccept') delete input.headers.Accept;
    if (kind === 'registry') fixture.config.messagesUrl = 'https://fixture.invalid/messages';
    await expect(fetchProxy(target, input, saved(), { singlePost: true, githubMessagesTransport: evidence })).rejects.toThrow('Accounting GitHub Messages transport unavailable');
    expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
  });
  it('registry route drift through dispatcher yield refuses POST', async () => {
    fixture.create.mockImplementation(() => { fixture.config.messagesUrl = 'https://fixture.invalid/messages'; });
    await expect(fetchProxy(url, options(), saved(), { singlePost: true, githubMessagesTransport: evidence })).rejects.toThrow('Accounting GitHub Messages transport unavailable');
    expect(fixture.create).toHaveBeenCalledTimes(1); expect(nativeFetch).not.toHaveBeenCalled();
  });
  it('actual body drift through dispatcher yield refuses POST', async () => {
    const input = options(); fixture.create.mockImplementation(() => { input.body = 'changed'; });
    await expect(fetchProxy(url, input, saved(), { singlePost: true, githubMessagesTransport: evidence })).rejects.toThrow('Accounting GitHub Messages transport unavailable');
    expect(fixture.create).toHaveBeenCalledTimes(1); expect(nativeFetch).not.toHaveBeenCalled();
  });
});
