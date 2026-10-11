import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('undici', () => ({ ProxyAgent: class { constructor(value) { fixture.create(value); } }, Agent: class { constructor(value) { fixture.create(value); } } }));
let fetchProxy, nativeFetch, evidence;
const model = 'deepseek/deepseek-v4-pro', url = 'https://api.commandcode.ai/alpha/generate';
const proxy = () => ({ persistedGlobalProxy: { url: 'http://dummy-proxy.invalid:3210', noProxy: '' } });
const options = () => ({ method: 'POST', redirect: 'error', body: evidence.nativeTransport.serializedBody,
  headers: { ...evidence.capture.original.config.headers, 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: 'Bearer dummy-api-key', 'x-session-id': evidence.nativeTransport.sessionId } });
beforeEach(async () => {
  vi.resetModules(); fixture.create.mockReset(); nativeFetch = vi.fn(async () => Response.json({ fixture: true })); vi.stubGlobal('fetch', nativeFetch);
  ({ proxyAwareFetch: fetchProxy } = await import('open-sse/utils/proxyFetch.js'));
  const { PROVIDERS } = await import('open-sse/config/providers.js');
  const { captureCommandCodeChatConversion } = await import('open-sse/config/accountedCommandCodeChatCapture.js');
  const { captureAccountingCommandCodeConfig } = await import('open-sse/config/accountedCommandCodeDispatch.js');
  const runtime = { workingDir: '/fixture/work', date: '2026-10-10', environment: 'linux' };
  const input = { body: { model, stream: true, max_tokens: 100, temperature: 0.3, messages: [{ role: 'user', content: 'fixture prompt' }] }, model, stream: true,
    credentials: { apiKey: 'dummy-api-key', connectionId: 'c', providerSpecificData: {} }, config: structuredClone(PROVIDERS.commandcode), runtime, providerOverrides: null, proxyOptions: proxy() };
  const capture = captureCommandCodeChatConversion(input, () => ({ threadId: '11111111-1111-4111-8111-111111111111', memory: '',
    config: { ...runtime, structure: [], isGitRepo: false, currentBranch: '', mainBranch: '', gitStatus: '', recentCommits: [] },
    params: { model, stream: true, max_tokens: 100, temperature: 0.3, messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture prompt' }] }] } }));
  evidence = { capture, nativeTransport: { model, mode: 'native-commandcode-ndjson', commandCodeConfig: captureAccountingCommandCodeConfig(PROVIDERS.commandcode),
    sessionId: '22222222-2222-4222-8222-222222222222', serializedBody: JSON.stringify(capture.actual) } };
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('chat CommandCode proxyFetch entry and post-dispatcher equality (mock native fetch)', () => {
  it('valid captured evidence reaches exactly one strict native fetch', async () => {
    const result = await fetchProxy(url, options(), proxy(), { singlePost: true, commandCodeChatTransport: evidence });
    expect(result.ok).toBe(true); expect(nativeFetch).toHaveBeenCalledTimes(1); expect(fixture.create).toHaveBeenCalledTimes(1);
  });
  it('owner AbortSignal is excluded from guarded plain POST data and retained on fetch', async () => {
    const input = options(), controller = new AbortController(); input.signal = controller.signal;
    expect((await fetchProxy(url, input, proxy(), { singlePost: true, commandCodeChatTransport: evidence })).ok).toBe(true);
    expect(nativeFetch).toHaveBeenCalledTimes(1); expect(nativeFetch.mock.calls[0][1].signal).toBe(controller.signal);
  });
  it.each(['entry', 'post-await'])('accessor POST body at %s refuses without executing getter', async stage => {
    const input = options(); let reads = 0;
    const mutate = () => Object.defineProperty(input, 'body', { enumerable: true, get() { reads++; throw new Error('fixture getter must not execute'); } });
    if (stage === 'entry') mutate(); else fixture.create.mockImplementation(mutate);
    await expect(fetchProxy(url, input, proxy(), { singlePost: true, commandCodeChatTransport: evidence })).rejects.toThrow();
    expect(reads).toBe(0); expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).toHaveBeenCalledTimes(stage === 'entry' ? 0 : 1);
  });
  it('Proxy POST options refuses before any property traps', async () => {
    let traps = 0; const input = new Proxy(options(), { get() { traps++; throw new Error('fixture trap'); }, ownKeys() { traps++; throw new Error('fixture trap'); }, getPrototypeOf() { traps++; throw new Error('fixture trap'); } });
    await expect(fetchProxy(url, input, proxy(), { singlePost: true, commandCodeChatTransport: evidence })).rejects.toThrow();
    expect(traps).toBe(0); expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
  });
  it.each(['entry', 'post-await'])('captured proxy authority drift at %s refuses native fetch', async stage => {
    const selected = proxy(), mutate = () => { selected.persistedGlobalProxy.url = 'http://different-proxy.invalid:3211'; };
    if (stage === 'entry') mutate(); else fixture.create.mockImplementation(mutate);
    await expect(fetchProxy(url, options(), selected, { singlePost: true, commandCodeChatTransport: evidence })).rejects.toThrow();
    expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).toHaveBeenCalledTimes(stage === 'entry' ? 0 : 1);
  });
  it('proxy options getter refuses before any programmable read', async () => {
    const selected = proxy(); let reads = 0;
    Object.defineProperty(selected, 'strictProxy', { enumerable: true, get() { reads++; throw new Error('fixture proxy getter'); } });
    await expect(fetchProxy(url, options(), selected, { singlePost: true, commandCodeChatTransport: evidence })).rejects.toThrow();
    expect(reads).toBe(0); expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
  });
  it('Proxy proxy options refuses before any programmable traps', async () => {
    let traps = 0; const selected = new Proxy(proxy(), { get() { traps++; throw new Error('fixture proxy trap'); }, ownKeys() { traps++; throw new Error('fixture proxy trap'); } });
    await expect(fetchProxy(url, options(), selected, { singlePost: true, commandCodeChatTransport: evidence })).rejects.toThrow();
    expect(traps).toBe(0); expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
  });
  it('original token mismatch at entry refuses before dispatcher/native fetch', async () => {
    const input = options(); input.headers.Authorization = 'Bearer dummy-different';
    await expect(fetchProxy(url, input, proxy(), { singlePost: true, commandCodeChatTransport: evidence })).rejects.toThrow();
    expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
  });
  it('token mismatch after dispatcher await refuses native fetch', async () => {
    const input = options(); fixture.create.mockImplementation(() => { input.headers.Authorization = 'Bearer dummy-different'; });
    await expect(fetchProxy(url, input, proxy(), { singlePost: true, commandCodeChatTransport: evidence })).rejects.toThrow();
    expect(fixture.create).toHaveBeenCalledTimes(1); expect(nativeFetch).not.toHaveBeenCalled();
  });
});
