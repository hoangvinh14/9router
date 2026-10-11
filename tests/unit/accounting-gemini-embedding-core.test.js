import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ post: vi.fn(), refresh: vi.fn() }));
vi.mock('../../open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => fixture.post(...args) }));
vi.mock('../../open-sse/executors/index.js', () => ({ getExecutor: () => ({ refreshCredentials: fixture.refresh }) }));
let core;
beforeEach(async () => {
  vi.resetModules(); fixture.post.mockReset(); fixture.refresh.mockReset(); vi.stubGlobal('fetch', vi.fn());
  ({ handleEmbeddingsCore: core } = await import('../../open-sse/handlers/embeddingsCore.js'));
  fixture.post.mockImplementation(async () => Response.json({ embedding: { values: [0.1, 0.2, 0.3] }, usageMetadata: { promptTokenCount: 10 } }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function input() {
  return { body: { model: 'gemini/gemini-embedding-001', input: 'fixture original', dimensions: 3 },
    modelInfo: { provider: 'gemini', model: 'gemini-embedding-001' }, credentials: { apiKey: 'fixture-private-key' },
    proxyOptions: { persistedGlobalProxy: { url: 'http://fixture-proxy.invalid:3210', noProxy: '' } },
    accounting: { requiresGeminiEmbeddingsWire: true, assertSupported: vi.fn(ok => { if (!ok) throw new Error('Fixture unsupported'); }),
      gate: vi.fn(), beforeAttempt: vi.fn(async () => ({ fixture: 'own-intent' })), completeAttempt: vi.fn(async () => ({ fixture: 'terminal' })), assertSuccessfulTerminal: vi.fn() },
    onRequestSuccess: vi.fn(), log: { debug: vi.fn(), warn: vi.fn() } };
}
async function positive() { const p = input(); expect((await core(p)).success).toBe(true); return p; }
describe('internal Gemini embedding core opt-in, no app origin/ACK proof', () => {
  it('exact gateway prefix conversion preserves complete original and normalized response after own authorization', async () => {
    const p = input(), result = await core(p);
    expect(result.success).toBe(true); expect(result.accountingOwned).toBe(true);
    expect((await result.response.json()).data[0].embedding).toEqual([0.1, 0.2, 0.3]);
    expect(fixture.post).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
    const evidence = fixture.post.mock.calls[0][3].geminiEmbeddingTransport;
    expect(evidence.original).toEqual({ ...p.body, model: p.modelInfo.model });
    expect(p.body.model).toBe('gemini/gemini-embedding-001');
    expect(p.accounting.completeAttempt.mock.calls[0][1]).toMatchObject({ usage: { input: 10 }, outcome: 'success' });
    expect(p.accounting.assertSuccessfulTerminal).toHaveBeenCalledTimes(1); expect(p.onRequestSuccess).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(p.log.debug.mock.calls)).not.toContain('fixture-private-key');
  });
  it.each(['unknown-original', 'wrong-prefix', 'oauth', 'numeric-input', 'base64'])('rejects %s before intent after positive, without field erasure', async fault => {
    await positive(); fixture.post.mockClear(); const p = input();
    if (fault === 'unknown-original') p.body.user = 'unknown';
    else if (fault === 'wrong-prefix') p.body.model = 'openai/gemini-embedding-001';
    else if (fault === 'oauth') p.credentials.accessToken = 'fixture-oauth';
    else if (fault === 'numeric-input') p.body.input = [123];
    else p.body.encoding_format = 'base64';
    await expect(core(p)).rejects.toThrow(); expect(p.accounting.beforeAttempt).not.toHaveBeenCalled();
    expect(p.accounting.completeAttempt).not.toHaveBeenCalled(); expect(fixture.post).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['body', 'modelInfo', 'credentials', 'proxyOptions'])('complete descriptor snapshot refuses %s getter with zero reads', async fault => {
    await positive(); fixture.post.mockClear(); const p = input(); let reads = 0;
    const key = { body: 'input', modelInfo: 'provider', credentials: 'apiKey', proxyOptions: 'persistedGlobalProxy' }[fault];
    Object.defineProperty(p[fault], key, { enumerable: true, get() { reads++; throw new Error('fixture-private-key'); } });
    await expect(core(p)).rejects.toThrow(); expect(reads).toBe(0);
    expect(p.accounting.beforeAttempt).not.toHaveBeenCalled(); expect(fixture.post).not.toHaveBeenCalled();
  });
  it('own completion delivery error escapes before normalization callback or refresh', async () => {
    await positive(); fixture.post.mockClear(); const p = input(), failure = new Error('Fixture core completion delivery lost');
    p.accounting.completeAttempt.mockRejectedValue(failure);
    await expect(core(p)).rejects.toBe(failure); expect(p.onRequestSuccess).not.toHaveBeenCalled();
    expect(p.accounting.assertSuccessfulTerminal).not.toHaveBeenCalled(); expect(fixture.refresh).not.toHaveBeenCalled();
    expect(fixture.post).toHaveBeenCalledTimes(1); expect(p.accounting.completeAttempt).toHaveBeenCalledTimes(1);
  });
});
