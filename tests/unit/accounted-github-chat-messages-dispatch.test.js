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
  const { expectedGithubChatMessagesBody } = await import('../../open-sse/config/accountedGithubChatMessagesCandidate.js');
  ({ githubMessagesHeaders: buildHeaders } = await import('../../open-sse/config/accountedGithubMessagesCandidate.js'));
  const body = { model: 'claude-sonnet-4.6', stream: true, max_tokens: 100, messages: [{ role: 'user', content: 'fixture' }] };
  evidence = { model: body.model, mode: 'chat-github-messages-sse', githubConfig: captureAccountingGithubMessagesConfig(fixture.config), requestId: 'fixture-request',
    serializedBody: JSON.stringify(expectedGithubChatMessagesBody(body, body.model)), originalSerializedBody: JSON.stringify(body) };
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('GitHub Chat converted Messages strict dispatch (mock, not socket/general conversion approval)', () => {
  it('unchanged original+converted evidence reaches one strict POST', async () => {
    expect((await fetchProxy(url, options(), saved(), { singlePost: true, githubChatMessagesTransport: evidence })).ok).toBe(true);
    expect(nativeFetch).toHaveBeenCalledTimes(1); expect(fixture.create).toHaveBeenCalledTimes(1);
  });
  it.each(['url', 'body', 'mode', 'tools', 'metadata', 'actualText', 'systemPrompt', 'cacheTTL', 'model', 'request', 'token', 'beta', 'client', 'version', 'registry', 'missingAccept'])('%s refuses before dispatcher/POST', async kind => {
    const input = options(); let target = url;
    if (kind === 'url') target = 'https://fixture.invalid/messages';
    if (kind === 'body') input.body = 'changed';
    if (kind === 'mode') evidence.mode = 'native-github-messages-sse';
    if (['tools', 'metadata', 'actualText', 'systemPrompt', 'cacheTTL', 'model'].includes(kind)) {
      const value = JSON.parse(evidence.serializedBody), original = JSON.parse(evidence.originalSerializedBody);
      if (kind === 'tools') original.tools = [];
      if (kind === 'metadata') original.metadata = {};
      if (kind === 'actualText') value.messages[0].content[0].text = 'changed';
      if (kind === 'systemPrompt') value.system[0].text = 'changed';
      if (kind === 'cacheTTL') value.system[0].cache_control.ttl = '5m';
      if (kind === 'model') evidence.model = original.model = value.model = 'gpt-5.2-codex';
      input.body = evidence.serializedBody = JSON.stringify(value); evidence.originalSerializedBody = JSON.stringify(original);
    }
    if (kind === 'request') input.headers['x-request-id'] = 'changed';
    if (kind === 'token') input.headers.Authorization = 'Bearer ';
    if (kind === 'beta') input.headers['anthropic-beta'] = 'fixture';
    if (kind === 'client') input.headers['editor-version'] = 'changed';
    if (kind === 'version') input.headers['anthropic-version'] = 'changed';
    if (kind === 'missingAccept') delete input.headers.Accept;
    if (kind === 'registry') fixture.config.messagesUrl = 'https://fixture.invalid/messages';
    await expect(fetchProxy(target, input, saved(), { singlePost: true, githubChatMessagesTransport: evidence })).rejects.toThrow('Accounting GitHub Chat Messages transport unavailable');
    expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
  });
  it('registry route drift through dispatcher yield refuses POST', async () => {
    fixture.create.mockImplementation(() => { fixture.config.messagesUrl = 'https://fixture.invalid/messages'; });
    await expect(fetchProxy(url, options(), saved(), { singlePost: true, githubChatMessagesTransport: evidence })).rejects.toThrow('Accounting GitHub Chat Messages transport unavailable');
    expect(fixture.create).toHaveBeenCalledTimes(1); expect(nativeFetch).not.toHaveBeenCalled();
  });
  it('converted body drift through dispatcher yield refuses POST', async () => {
    const input = options(); fixture.create.mockImplementation(() => { input.body = 'changed'; });
    await expect(fetchProxy(url, input, saved(), { singlePost: true, githubChatMessagesTransport: evidence })).rejects.toThrow('Accounting GitHub Chat Messages transport unavailable');
    expect(fixture.create).toHaveBeenCalledTimes(1); expect(nativeFetch).not.toHaveBeenCalled();
  });
});
