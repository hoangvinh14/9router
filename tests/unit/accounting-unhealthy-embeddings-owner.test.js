import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ post: vi.fn(), refresh: vi.fn() }));
vi.mock('../../open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => fixture.post(...args) }));
vi.mock('../../open-sse/executors/index.js', () => ({ getExecutor: () => ({ refreshCredentials: fixture.refresh }) }));
function latch() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
let owner, config, url;
beforeEach(async () => {
  vi.resetModules(); fixture.post.mockReset(); fixture.refresh.mockReset(); vi.stubGlobal('fetch', vi.fn(async () => response()));
  ({ handleAccountedEmbedding: owner } = await import('../../open-sse/handlers/embeddingProviders/accountedRequest.js'));
  config = (await import('../../open-sse/config/accountedEmbeddingsDispatch.js')).captureAccountingEmbeddingsConfig();
  url = (await import('../../open-sse/config/accountedEmbeddingsCandidate.js')).ACCOUNTED_EMBEDDINGS_URL;
  fixture.post.mockImplementation(async () => response()); fixture.refresh.mockResolvedValue(null);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function response(status = 200) { return Response.json({ data: [], usage: { prompt_tokens: 10, total_tokens: 10 } }, { status }); }
function input() {
  const attempt = Object.freeze({ fixture: 'own-attempt' }), terminal = Object.freeze({ fixture: 'own-terminal' });
  const accounting = { requiresUnhealthyEmbeddingsWire: true, assertSupported: vi.fn(ok => { if (!ok) throw new Error('Fixture unsupported embedding'); }),
    gate: vi.fn(), beforeAttempt: vi.fn(async () => attempt), completeAttempt: vi.fn(async () => terminal), assertSuccessfulTerminal: vi.fn() };
  return { provider: 'openai', model: 'fixture-embedding', originalBody: { model: 'fixture-embedding', input: ['fixture original'] },
    requestBody: { model: 'fixture-embedding', input: ['fixture original'], encoding_format: 'float' },
    credentials: { apiKey: 'fixture-upstream', accessToken: null }, ctx: {}, url, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-upstream' },
    proxyOptions: { persistedGlobalProxy: null }, accounting,
    adapter: { accountingSchema: 'openai', normalize: vi.fn(value => value) }, mediaConfig: config };
}
async function positive() {
  const p = input(); expect((await owner(p)).success).toBe(true); return p;
}
describe('internal nonqueued unhealthy embeddings own strict owner, no persisted credential/ACK approval', () => {
  it('waits for own admission then strict original float POST and own terminal authorization', async () => {
    const p = input(), admission = latch(); p.accounting.beforeAttempt.mockImplementation(async () => admission.promise);
    const work = owner(p); const observed = work.then(value => ({ value }), error => ({ error }));
    await vi.waitFor(() => expect(p.accounting.beforeAttempt).toHaveBeenCalledTimes(1)); expect(fixture.post).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    admission.resolve({ fixture: 'admitted' }); const result = await observed; if (result.error) throw result.error;
    expect(result.value.success).toBe(true); expect(fixture.post).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
    const [target, options, proxy, contract] = fixture.post.mock.calls[0]; expect(target).toBe(url); expect(options.redirect).toBe('error');
    expect(JSON.parse(options.body)).toEqual(p.requestBody); expect(proxy.persistedGlobalProxy).toBeNull(); expect(contract.singlePost).toBe(true);
    expect(contract.unhealthyEmbeddingsTransport.body).toEqual(p.originalBody); expect(typeof contract.routingGate).toBe('function');
    expect(p.accounting.assertSuccessfulTerminal).toHaveBeenCalledWith(await p.accounting.completeAttempt.mock.results[0].value);
  });
  it.each(['original', 'credentials'])('refuses unsupported %s before own intent after positive without projecting away', async mode => {
    await positive(); fixture.post.mockClear(); fetch.mockClear(); const p = input();
    if (mode === 'original') p.originalBody.user = 'unsupported'; else p.credentials.providerSpecificData = { customUrl: 'https://fixture.invalid/embeddings' };
    await expect(owner(p)).rejects.toThrow(); expect(p.accounting.beforeAttempt).not.toHaveBeenCalled(); expect(p.accounting.completeAttempt).not.toHaveBeenCalled(); expect(fixture.post).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('fresh authority lost after admission owns one not-dispatched refusal completion and no POST', async () => {
    const p = input(), failure = new Error('Fixture fresh embedding proof unavailable');
    p.accounting.beforeAttempt.mockImplementation(async () => { p.accounting.gate.mockImplementation(() => { throw failure; }); return { fixture: 'admitted' }; });
    await expect(owner(p)).rejects.toBe(failure); expect(p.accounting.completeAttempt).toHaveBeenCalledTimes(1);
    expect(p.accounting.completeAttempt.mock.calls[0][1]).toMatchObject({ notDispatched: true, outcome: 'routing_refused' }); expect(fixture.post).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['held', 'lost'])('own completion ACK %s cannot authorize response/normalization or cause retry', async mode => {
    const p = input(), completion = latch(), failure = new Error('Fixture lost embedding own completion ACK');
    p.accounting.completeAttempt.mockImplementation(async () => { await completion.promise; if (mode === 'lost') throw failure; return { fixture: 'terminal' }; });
    const observed = owner(p).then(value => ({ value }), error => ({ error }));
    await vi.waitFor(() => expect(p.accounting.completeAttempt).toHaveBeenCalledTimes(1)); expect(p.adapter.normalize).not.toHaveBeenCalled(); expect(p.accounting.assertSuccessfulTerminal).not.toHaveBeenCalled();
    completion.resolve(); const result = await observed;
    if (mode === 'lost') expect(result.error).toBe(failure); else expect(result.value.success).toBe(true);
    expect(fixture.post).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled(); expect(fixture.refresh).not.toHaveBeenCalled(); expect(p.accounting.completeAttempt).toHaveBeenCalledTimes(1);
  });
  it('exact-usage HTTP401 remains owned/billable with no OAuth refresh or successor POST', async () => {
    fixture.post.mockImplementation(async () => response(401)); fetch.mockImplementation(async () => response(401)); const p = input();
    expect((await owner(p)).success).toBe(false); expect(p.accounting.completeAttempt).toHaveBeenCalledTimes(1);
    expect(p.accounting.completeAttempt.mock.calls[0][1]).toMatchObject({ usage: { input: 10, output: 0 }, outcome: 'failed' });
    expect(fixture.post).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled(); expect(fixture.refresh).not.toHaveBeenCalled(); expect(p.accounting.beforeAttempt).toHaveBeenCalledTimes(1);
  });
});
