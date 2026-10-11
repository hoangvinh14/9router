import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ post: vi.fn(), refresh: vi.fn() }));
vi.mock('../../open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => fixture.post(...args) }));
vi.mock('../../open-sse/executors/index.js', () => ({ getExecutor: () => ({ refreshCredentials: fixture.refresh }) }));
let core;
beforeEach(async () => {
  vi.resetModules(); fixture.post.mockReset().mockImplementation(async () => Response.json({ data: [], usage: { prompt_tokens: 10, total_tokens: 10 } })); fixture.refresh.mockReset();
  ({ handleEmbeddingsCore: core } = await import('../../open-sse/handlers/embeddingsCore.js'));
});
afterEach(() => { vi.restoreAllMocks(); });
function input() {
  return { body: { model: 'fixture-embedding', input: ['fixture original'] }, modelInfo: { provider: 'openai', model: 'fixture-embedding' },
    credentials: { apiKey: 'fixture-upstream', accessToken: null }, proxyOptions: { persistedGlobalProxy: null }, accounting: {
      requiresUnhealthyEmbeddingsWire: true, gate: vi.fn(), assertSupported: vi.fn(ok => { if (!ok) throw new Error('Fixture unsupported embedding'); }),
      beforeAttempt: vi.fn(async () => ({ fixture: 'own-admission' })), completeAttempt: vi.fn(async () => ({ fixture: 'own-terminal' })), assertSuccessfulTerminal: vi.fn(),
    } };
}
describe('unhealthy embeddings real core original entry boundary before adapter/input reads', () => {
  it.each(['fixture-embedding', 'openai/fixture-embedding'])('permits only exact model or gateway prefix %s without changing original text', async model => {
    const p = input(); p.body.model = model; expect((await core(p)).success).toBe(true); expect(fixture.post).toHaveBeenCalledTimes(1);
    const [, options, , contract] = fixture.post.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({ model: 'fixture-embedding', input: ['fixture original'], encoding_format: 'float' });
    expect(contract.unhealthyEmbeddingsTransport.body).toEqual({ model: 'fixture-embedding', input: ['fixture original'] });
  });
  it.each(['input-getter', 'credential-getter', 'model-getter', 'proxy-getter', 'extra-original', 'wrong-model', 'oversized', 'proxy', 'cycle'])('refuses %s after positive without programmable reads/intent/POST', async mode => {
    expect((await core(input())).success).toBe(true); fixture.post.mockClear(); const p = input(); let reads = 0;
    if (mode === 'input-getter') Object.defineProperty(p.body, 'input', { enumerable: true, get() { reads++; return ['fixture original']; } });
    if (mode === 'credential-getter') Object.defineProperty(p.credentials, 'apiKey', { enumerable: true, get() { reads++; return 'fixture-upstream'; } });
    if (mode === 'model-getter') Object.defineProperty(p.modelInfo, 'provider', { enumerable: true, get() { reads++; return 'openai'; } });
    if (mode === 'proxy-getter') Object.defineProperty(p.proxyOptions, 'persistedGlobalProxy', { enumerable: true, get() { reads++; return null; } });
    if (mode === 'extra-original') p.body.user = 'unsupported';
    if (mode === 'wrong-model') p.body.model = 'openai/other';
    if (mode === 'oversized') p.body.input = 'x'.repeat(262145);
    if (mode === 'proxy') p.body = new Proxy(p.body, {});
    if (mode === 'cycle') p.body.self = p.body;
    await expect(core(p)).rejects.toThrow(); expect(reads).toBe(0); expect(p.accounting.beforeAttempt).not.toHaveBeenCalled(); expect(p.accounting.completeAttempt).not.toHaveBeenCalled(); expect(fixture.post).not.toHaveBeenCalled(); expect(fixture.refresh).not.toHaveBeenCalled();
  });
});
