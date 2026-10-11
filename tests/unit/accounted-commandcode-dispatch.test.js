import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ config: null, create: vi.fn() }));
vi.mock('../../open-sse/config/providers.js', async importOriginal => {
  const original = await importOriginal(); return { ...original, PROVIDERS: { ...original.PROVIDERS, get commandcode() { return fixture.config; } } };
});
vi.mock('undici', () => ({ ProxyAgent: class { constructor(options) { fixture.create(options); } }, Agent: class { constructor(options) { fixture.create(options); } } }));
let nativeFetch, fetchProxy, evidence;
const url = 'https://api.commandcode.ai/alpha/generate';
const options = () => ({ method: 'POST', redirect: 'error', body: evidence.serializedBody,
  headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: 'Bearer dummy-api-key',
    'x-session-id': evidence.sessionId, 'x-command-code-version': '0.25.7', 'x-cli-environment': 'cli' } });
const saved = () => ({ persistedGlobalProxy: { url: 'http://dummy-proxy.invalid:3210', noProxy: '' } });
beforeEach(async () => {
  vi.resetModules(); fixture.create.mockReset(); const original = await vi.importActual('../../open-sse/config/providers.js'); fixture.config = structuredClone(original.PROVIDERS.commandcode);
  nativeFetch = vi.fn(async () => Response.json({ fixture: true })); vi.stubGlobal('fetch', nativeFetch);
  ({ proxyAwareFetch: fetchProxy } = await import('../../open-sse/utils/proxyFetch.js'));
  const { captureAccountingCommandCodeConfig } = await import('../../open-sse/config/accountedCommandCodeDispatch.js');
  const body = { threadId: '11111111-1111-4111-8111-111111111111', memory: '',
    config: { workingDir: '/fixture/workspace', date: '2026-10-10', environment: 'linux', structure: [], isGitRepo: false, currentBranch: '', mainBranch: '', gitStatus: '', recentCommits: [] },
    params: { model: 'deepseek/deepseek-v4-pro', stream: true, max_tokens: 64, temperature: 0.3, messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture prompt' }] }] } };
  evidence = { model: body.params.model, mode: 'native-commandcode-ndjson', commandCodeConfig: captureAccountingCommandCodeConfig(fixture.config),
    sessionId: '22222222-2222-4222-8222-222222222222', serializedBody: JSON.stringify(body) };
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('CommandCode strict native dispatch (mock fetch/dispatcher, not socket/generation/retry approval)', () => {
  it('unchanged native evidence reaches one strict POST without transformed body', async () => {
    expect((await fetchProxy(url, options(), saved(), { singlePost: true, commandCodeTransport: evidence })).ok).toBe(true);
    expect(nativeFetch).toHaveBeenCalledTimes(1); expect(fixture.create).toHaveBeenCalledTimes(1);
    expect(nativeFetch.mock.calls[0][1].body).toBe(evidence.serializedBody);
  });
  it.each(['url', 'body', 'mode', 'tools', 'metadata', 'model', 'session', 'token', 'header', 'version', 'environment', 'registry', 'missingAccept'])('%s refuses before dispatcher/POST', async kind => {
    const input = options(); let target = url;
    if (kind === 'url') target = 'https://fixture.invalid/generate';
    if (kind === 'body') input.body = 'changed';
    if (kind === 'mode') evidence.mode = 'legacy-commandcode';
    if (['tools', 'metadata', 'model'].includes(kind)) {
      const value = JSON.parse(evidence.serializedBody);
      if (kind === 'tools') value.params.tools = [];
      if (kind === 'metadata') value.metadata = {};
      if (kind === 'model') evidence.model = value.params.model = 'unknown';
      input.body = evidence.serializedBody = JSON.stringify(value);
    }
    if (kind === 'session') input.headers['x-session-id'] = '33333333-3333-4333-8333-333333333333';
    if (kind === 'token') input.headers.Authorization = 'Bearer ';
    if (kind === 'header') input.headers['x-billing-tier'] = 'auto';
    if (kind === 'version') input.headers['x-command-code-version'] = 'changed';
    if (kind === 'environment') input.headers['x-cli-environment'] = 'other';
    if (kind === 'missingAccept') delete input.headers.Accept;
    if (kind === 'registry') fixture.config.baseUrl = 'https://fixture.invalid/generate';
    await expect(fetchProxy(target, input, saved(), { singlePost: true, commandCodeTransport: evidence })).rejects.toThrow('Accounting CommandCode transport unavailable');
    expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
  });
  it.each(['route', 'body'])('%s drift after dispatcher yield refuses POST', async kind => {
    const input = options(); fixture.create.mockImplementation(() => {
      if (kind === 'route') fixture.config.baseUrl = 'https://fixture.invalid/generate';
      else input.body = 'changed';
    });
    await expect(fetchProxy(url, input, saved(), { singlePost: true, commandCodeTransport: evidence })).rejects.toThrow('Accounting CommandCode transport unavailable');
    expect(fixture.create).toHaveBeenCalledTimes(1); expect(nativeFetch).not.toHaveBeenCalled();
  });
});
