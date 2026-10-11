import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../../open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => fixture.post(...args) }));
let owner, adapter, config;
function latch() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const raw = () => ({ embedding: { values: [0.1, 0.2, 0.3] }, usageMetadata: { promptTokenCount: 10 } });
const response = (status = 200) => Response.json(raw(), { status });
beforeEach(async () => {
  vi.resetModules(); fixture.post.mockReset(); vi.stubGlobal('fetch', vi.fn(async () => response()));
  ({ handleAccountedGeminiEmbedding: owner } = await import('../../open-sse/handlers/embeddingProviders/accountedGeminiRequest.js'));
  adapter = (await import('../../open-sse/handlers/embeddingProviders/gemini.js')).default;
  config = (await import('../../open-sse/providers/index.js')).PROVIDER_MEDIA.gemini.embeddingConfig;
  fixture.post.mockImplementation(async () => response());
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function input() {
  const model = 'gemini-embedding-001', original = { model, input: 'fixture input', dimensions: 3 };
  const credentials = { apiKey: 'fixture-private-key' }, actual = adapter.buildBody(model, original);
  const evidence = { model, original, actual, mediaConfig: config, credentials, headers: adapter.buildHeaders(credentials),
    url: adapter.buildUrl(model, credentials, { input: original.input }), serialized: JSON.stringify(actual),
    proxyOptions: { persistedGlobalProxy: { url: 'http://fixture-proxy.invalid:3210', noProxy: '' } } };
  return { evidence, accounting: { assertSupported: vi.fn(ok => { if (!ok) throw new Error('Fixture unsupported'); }),
    gate: vi.fn(), beforeAttempt: vi.fn(async () => ({ fixture: 'own-intent' })),
    completeAttempt: vi.fn(async () => ({ fixture: 'own-terminal' })), assertSuccessfulTerminal: vi.fn() },
    signal: new AbortController().signal };
}
async function positive() { expect((await owner(input())).success).toBe(true); }
describe('standalone Gemini embedding generation own ACK, no app/persisted/native authority proof', () => {
  it('own intent ACK precedes strict captured POST and own completion precedes success authorization', async () => {
    const p = input(), admission = latch(); p.accounting.beforeAttempt.mockImplementation(() => admission.promise);
    const observed = owner(p).then(value => ({ value }), error => ({ error }));
    try {
      await vi.waitFor(() => expect(p.accounting.beforeAttempt).toHaveBeenCalledTimes(1));
      expect(fixture.post).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    } finally { admission.resolve({ fixture: 'own-intent' }); }
    const result = await observed; if (result.error) throw result.error;
    expect(result.value.success).toBe(true); expect(fixture.post).toHaveBeenCalledTimes(1);
    const [, options, , contract] = fixture.post.mock.calls[0]; expect(options.redirect).toBe('error');
    expect(contract.geminiEmbeddingTransport.original).toEqual(p.evidence.original); expect(typeof contract.routingGate).toBe('function');
    expect(p.accounting.completeAttempt.mock.calls[0][1]).toMatchObject({ usage: { input: 10, output: 0 }, outcome: 'success' });
    expect(p.accounting.assertSuccessfulTerminal).toHaveBeenCalledWith(await p.accounting.completeAttempt.mock.results[0].value);
  });
  it.each(['original', 'credentials'])('invalid %s refuses before own intent after positive', async fault => {
    await positive(); fixture.post.mockClear(); const p = input();
    if (fault === 'original') p.evidence.original.user = 'unsupported'; else p.evidence.credentials.accessToken = 'fixture-oauth';
    await expect(owner(p)).rejects.toThrow(); expect(p.accounting.beforeAttempt).not.toHaveBeenCalled();
    expect(p.accounting.completeAttempt).not.toHaveBeenCalled(); expect(fixture.post).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('fresh gate lost after own admission owns one routing-refused completion, no POST', async () => {
    const p = input(), failure = new Error('Fixture fresh authority unavailable');
    p.accounting.beforeAttempt.mockImplementation(async () => { p.accounting.gate.mockImplementation(() => { throw failure; }); return { fixture: 'own-intent' }; });
    await expect(owner(p)).rejects.toBe(failure); expect(fixture.post).not.toHaveBeenCalled();
    expect(p.accounting.completeAttempt).toHaveBeenCalledTimes(1);
    expect(p.accounting.completeAttempt.mock.calls[0][1]).toMatchObject({ notDispatched: true, outcome: 'routing_refused' });
  });
  it.each(['held', 'lost'])('own completion ACK %s cannot authorize success or cause a successor', async mode => {
    const p = input(), ack = latch(), failure = new Error('Fixture completion delivery lost');
    p.accounting.completeAttempt.mockImplementation(async () => { await ack.promise; if (mode === 'lost') throw failure; return { fixture: 'own-terminal' }; });
    let returned = false; const observed = owner(p).then(value => { returned = true; return { value }; }, error => ({ error }));
    try { await vi.waitFor(() => expect(p.accounting.completeAttempt).toHaveBeenCalledTimes(1));
      expect(returned).toBe(false); expect(p.accounting.assertSuccessfulTerminal).not.toHaveBeenCalled();
    } finally { ack.resolve(); }
    const result = await observed;
    if (mode === 'lost') expect(result.error).toBe(failure); else expect(result.value.success).toBe(true);
    expect(fixture.post).toHaveBeenCalledTimes(1); expect(p.accounting.beforeAttempt).toHaveBeenCalledTimes(1);
    expect(p.accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
  });
  it('full exact usage on failed HTTP is settled as failed, not success or free retry', async () => {
    fixture.post.mockImplementation(async () => response(401)); const p = input();
    expect((await owner(p)).success).toBe(false);
    expect(p.accounting.completeAttempt.mock.calls[0][1]).toMatchObject({ usage: { input: 10, output: 0 }, outcome: 'failed' });
    expect(p.accounting.assertSuccessfulTerminal).not.toHaveBeenCalled(); expect(fixture.post).toHaveBeenCalledTimes(1);
    expect(p.accounting.beforeAttempt).toHaveBeenCalledTimes(1); expect(p.accounting.completeAttempt).toHaveBeenCalledTimes(1);
  });
  it('lost own intent ACK escapes without POST or fabricated completion', async () => {
    await positive(); fixture.post.mockClear(); const p = input(), failure = new Error('Fixture intent delivery lost');
    p.accounting.beforeAttempt.mockRejectedValue(failure);
    await expect(owner(p)).rejects.toBe(failure);
    expect(fixture.post).not.toHaveBeenCalled(); expect(p.accounting.completeAttempt).not.toHaveBeenCalled();
  });
  it('abort reason false after own admission owns only not-dispatched terminal', async () => {
    await positive(); fixture.post.mockClear(); const p = input(), controller = new AbortController(); p.signal = controller.signal;
    p.accounting.beforeAttempt.mockImplementation(async () => { controller.abort(false); return { fixture: 'own-intent' }; });
    const result = await owner(p).then(value => ({ value }), error => ({ error }));
    expect(result.error).toBe(false); expect(fixture.post).not.toHaveBeenCalled();
    expect(p.accounting.completeAttempt).toHaveBeenCalledTimes(1);
    expect(p.accounting.completeAttempt.mock.calls[0][1]).toEqual({ notDispatched: true, outcome: 'aborted' });
  });
  it('abort false during foreign POST observes and disposes late response without terminal rewrite', async () => {
    await positive(); fixture.post.mockClear(); const p = input(), controller = new AbortController(), late = latch(), disposed = latch(); p.signal = controller.signal;
    fixture.post.mockImplementation(() => late.promise);
    const observed = owner(p).then(value => ({ value }), error => ({ error }));
    const lateResponse = response(); const cancel = vi.spyOn(lateResponse.body, 'cancel').mockImplementation(async () => { disposed.resolve(); });
    try {
      await vi.waitFor(() => expect(fixture.post).toHaveBeenCalledTimes(1));
      controller.abort(false); const result = await observed; expect(result.error).toBe(false);
      expect(p.accounting.completeAttempt).toHaveBeenCalledTimes(1);
      expect(p.accounting.completeAttempt.mock.calls[0][1]).toEqual({ usage: null, outcome: 'aborted' });
    } finally { controller.abort(false); late.resolve(lateResponse); await observed; await late.promise; await disposed.promise; }
    expect(cancel).toHaveBeenCalledTimes(1); expect(p.accounting.completeAttempt).toHaveBeenCalledTimes(1);
    expect(p.accounting.assertSuccessfulTerminal).not.toHaveBeenCalled();
  });
  it('mock dispatcher post-await fresh refusal owns sole not-dispatched completion', async () => {
    await positive(); fixture.post.mockClear(); const p = input(), failure = new Error('Fixture dispatcher fresh refusal');
    fixture.post.mockImplementation(async (...args) => {
      const contract = args[3];
      p.accounting.gate.mockImplementation(() => { throw failure; }); contract.routingGate();
    });
    await expect(owner(p)).rejects.toBe(failure); expect(fixture.post).toHaveBeenCalledTimes(1);
    expect(p.accounting.completeAttempt).toHaveBeenCalledTimes(1);
    expect(p.accounting.completeAttempt.mock.calls[0][1]).toEqual({ notDispatched: true, outcome: 'routing_refused' });
    expect(p.accounting.assertSuccessfulTerminal).not.toHaveBeenCalled();
  });
  it('routing refusal completion delivery error escapes instead of duplicated terminal', async () => {
    await positive(); fixture.post.mockClear(); const p = input(), refusal = new Error('Fixture fresh refusal'), delivery = new Error('Fixture refusal delivery lost');
    p.accounting.beforeAttempt.mockImplementation(async () => { p.accounting.gate.mockImplementation(() => { throw refusal; }); return { fixture: 'own-intent' }; });
    p.accounting.completeAttempt.mockRejectedValue(delivery);
    await expect(owner(p)).rejects.toBe(delivery); expect(p.accounting.completeAttempt).toHaveBeenCalledTimes(1);
    expect(fixture.post).not.toHaveBeenCalled();
  });
  it('caller mutation during own intent wait cannot replace captured original, credentials or query URL', async () => {
    await positive(); fixture.post.mockClear(); const p = input(), admission = latch(), originalUrl = p.evidence.url;
    p.accounting.beforeAttempt.mockImplementation(() => admission.promise);
    const observed = owner(p).then(value => ({ value }), error => ({ error }));
    try { await vi.waitFor(() => expect(p.accounting.beforeAttempt).toHaveBeenCalledTimes(1));
      p.evidence.original.input = 'changed'; p.evidence.credentials.apiKey = 'changed'; p.evidence.url = 'https://fixture.invalid';
    } finally { admission.resolve({ fixture: 'own-intent' }); }
    const result = await observed; if (result.error) throw result.error;
    expect(result.value.success).toBe(true); expect(fixture.post.mock.calls[0][0]).toBe(originalUrl);
    expect(fixture.post.mock.calls[0][3].geminiEmbeddingTransport.original.input).toBe('fixture input');
    expect(fixture.post.mock.calls[0][3].geminiEmbeddingTransport.credentials.apiKey).toBe('fixture-private-key');
  });
  it('queued prepared-wire demand refuses before intent rather than silently skipping adapter', async () => {
    await positive(); fixture.post.mockClear(); const p = input(); p.accounting.requiresPreparedBaseWire = true;
    await expect(owner(p)).rejects.toThrow('Fixture unsupported'); expect(p.accounting.beforeAttempt).not.toHaveBeenCalled();
    expect(p.accounting.completeAttempt).not.toHaveBeenCalled(); expect(fixture.post).not.toHaveBeenCalled();
  });
  it('unknown error envelope is one failed attempt with null usage, no fabricated zero', async () => {
    fixture.post.mockImplementation(async () => Response.json({ error: { code: 401, message: 'fixture-private-key' } }, { status: 401 })); const p = input();
    const result = await owner(p); expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain('fixture-private-key');
    expect(p.accounting.completeAttempt.mock.calls[0][1]).toMatchObject({ usage: null, outcome: 'failed' });
    expect(fixture.post).toHaveBeenCalledTimes(1); expect(p.accounting.completeAttempt).toHaveBeenCalledTimes(1);
  });
});
