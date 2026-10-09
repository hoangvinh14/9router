import { afterEach, describe, expect, it, vi } from 'vitest';

// Real executor/transport graph is collected before per-case timing. This tests
// policy/cancellation dispatch, not cold import performance or real sockets.
const originalFetch = globalThis.fetch;
const fetch = vi.fn(async () => new Response('must not escape'));
let BaseExecutor, ProxyPoolUnavailableError;
try {
  vi.stubGlobal('fetch', fetch);
  ({ BaseExecutor } = await import('../../open-sse/executors/base.js'));
  ({ ProxyPoolUnavailableError } = await import('../../open-sse/utils/proxyPolicyError.js'));
} finally { vi.unstubAllGlobals(); globalThis.fetch = originalFetch; }

afterEach(() => { vi.useRealTimers(); fetch.mockClear(); });

describe('real BaseExecutor -> real transport required unavailable pool', () => {
  it.each(['no signal', 'live caller signal'])('rejects before alternate fetch/backoff with %s', async mode => {
    vi.useFakeTimers();
    const executor = new BaseExecutor('test', { baseUrls: ['https://api.openai.com/v1/chat/completions', 'https://fixture.invalid/fallback'] });
    const retryLog = vi.fn();
    const policy = Object.freeze({ proxyPoolId: 'fixture-pool', strictProxy: true, proxyPoolUnavailable: true,
      connectionProxyEnabled: true, connectionProxyUrl: 'http://127.0.0.1:9012', connectionNoProxy: '*',
      vercelRelayUrl: 'https://relay.invalid', persistedGlobalProxy: Object.freeze({ url: 'http://127.0.0.1:9012', noProxy: '*' }) });
    const before = structuredClone(policy);
    const controller = new AbortController();
    let observed;
    const work = executor.execute({ model: 'fixture-model', body: {}, stream: false,
      credentials: { apiKey: 'fixture-dummy' }, proxyOptions: policy,
      signal: mode === 'live caller signal' ? controller.signal : undefined,
      log: { debug: retryLog } }).catch(error => { observed = error; });
    await vi.advanceTimersByTimeAsync(0);
    expect(observed).toBeInstanceOf(ProxyPoolUnavailableError);
    expect(observed.message).toBe('[ProxyFetch] Proxy required pool unavailable (strictProxy=true)');
    expect(fetch).not.toHaveBeenCalled(); expect(retryLog).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0); expect(controller.signal.aborted).toBe(false);
    expect(policy).toEqual(before); await work;
  });
});
