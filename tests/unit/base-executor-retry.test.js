// Locks BaseExecutor.execute retry/fallback behavior (docs 04 GAP #1, docs 11 §7).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the network layer so we can script upstream responses.
const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const { BaseExecutor } = await import("../../open-sse/executors/base.js");

function res(status) {
  return { status, headers: { get: () => "" } };
}

function makeExec(config) {
  const ex = new BaseExecutor("test", config);
  // make headers trivial; credentials empty
  return ex;
}

const creds = { apiKey: "k" };
const { ProxyPoolUnavailableError } = await import('../../open-sse/utils/proxyPolicyError.js');

// mockReset returns the mock function. Do not return it from beforeEach:
// Vitest treats returned functions as cleanup and would invoke the fetch mock.
beforeEach(() => { fetchMock.mockReset(); });
afterEach(() => vi.useRealTimers());

describe('BaseExecutor local proxy policy refusal is not retryable network failure', () => {
  it.each([false, 'caller policy cancellation', new Error('caller policy cancellation')])('caller abort still owns exact reason over typed policy refusal: %s', async reason => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const ex = makeExec({ baseUrls: ['https://a/api', 'https://b/api'] });
    fetchMock.mockImplementationOnce(async () => { controller.abort(reason); throw new ProxyPoolUnavailableError(); });
    let observed;
    const work = ex.execute({ model: 'm', body: {}, stream: false, credentials: creds, signal: controller.signal }).catch(value => { observed = value; });
    await vi.advanceTimersByTimeAsync(0);
    expect(observed).toBe(reason);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await work;
  });
  it('message lookalike is not granted local policy classification and keeps network retries', async () => {
    vi.useFakeTimers();
    const ex = makeExec({ baseUrl: 'https://a/api', retry: { 502: { attempts: 1, delayMs: 3000 } } });
    fetchMock.mockRejectedValueOnce(new Error(new ProxyPoolUnavailableError().message)).mockResolvedValueOnce(res(200));
    const work = ex.execute({ model: 'm', body: {}, stream: false, credentials: creds });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect((await work).response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
  it('required unavailable pool rejects exactly without network backoff or URL fallback', async () => {
    vi.useFakeTimers();
    const error = new ProxyPoolUnavailableError();
    const ex = makeExec({ baseUrls: ['https://a/api', 'https://b/api'] });
    ex.computeRetryDelay = vi.fn(() => { throw new Error('Policy entered retry hook'); });
    fetchMock.mockRejectedValue(error);
    let reason;
    const work = ex.execute({ model: 'm', body: {}, stream: false, credentials: creds }).catch(value => { reason = value; });
    await vi.advanceTimersByTimeAsync(0);
    expect(reason).toBe(error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ex.computeRetryDelay).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await work;
  });
});

describe("BaseExecutor caller cancellation owns retries", () => {
  const config = { baseUrls: ["https://a/api", "https://b/api"], retry: { 502: { attempts: 2, delayMs: 5000 } } };
  const args = signal => ({ model: "m", body: {}, stream: false, credentials: creds, signal });
  async function rejectedReason(promise) { try { await promise; throw new Error("Expected rejection"); } catch (reason) { return reason; } }
  it.each([new Error("caller custom reason"), "primitive caller reason"])("pre-abort prevents transformation and fetch: %s", async reason => {
    const controller = new AbortController(); controller.abort(reason);
    const ex = makeExec(config); ex.transformRequest = vi.fn();
    expect(await rejectedReason(ex.execute(args(controller.signal)))).toBe(reason);
    expect(ex.transformRequest).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("default abort during fetch never enters network retries/fallback", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(async () => { controller.abort(); throw controller.signal.reason; });
    expect(await rejectedReason(makeExec(config).execute(args(controller.signal)))).toBe(controller.signal.reason);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(["status", "network"])("abort cancels %s backoff and leaves no timer or second POST", async kind => {
    vi.useFakeTimers(); const controller = new AbortController(), reason = new Error("cancel backoff");
    const cancel = vi.fn().mockResolvedValue(undefined);
    if (kind === "status") fetchMock.mockResolvedValueOnce({ ...res(502), body: { cancel } });
    else fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    const result = rejectedReason(makeExec(config).execute(args(controller.signal)));
    await vi.advanceTimersByTimeAsync(0); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1); controller.abort(reason);
    expect(await result).toBe(reason); expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(6000); expect(fetchMock).toHaveBeenCalledTimes(1);
    // Status response is disposed before backoff, not held until caller abort.
    if (kind === "status") { expect(cancel).toHaveBeenCalledWith(undefined); expect(cancel).toHaveBeenCalledTimes(1); }
  });
  it("custom reason from an in-flight fetch escapes before retry/fallback", async () => {
    const controller = new AbortController(), reason = "custom reason";
    fetchMock.mockImplementationOnce(async () => { controller.abort(reason); throw new Error("transport wraps cancellation"); });
    expect(await rejectedReason(makeExec(config).execute(args(controller.signal)))).toBe(reason);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("abort while retry hook is pending prevents the next POST when it settles", async () => {
    const controller = new AbortController(), reason = new Error("cancel hook"); let release, entered;
    const started = new Promise(resolve => { entered = resolve; });
    const hook = new Promise(resolve => { release = resolve; }); const ex = makeExec(config);
    ex.computeRetryDelay = vi.fn(() => { entered(); return hook; });
    const cancel = vi.fn().mockRejectedValue(new Error("cleanup failed"));
    fetchMock.mockResolvedValueOnce({ ...res(502), body: { cancel } });
    const result = rejectedReason(ex.execute(args(controller.signal))); await started;
    controller.abort(reason); release(0);
    expect(await result).toBe(reason); expect(fetchMock).toHaveBeenCalledTimes(1); expect(cancel).toHaveBeenCalledWith(reason);
  });
  it.each(["primitive hook abort", new Error("custom hook abort")])("never-returning hook promptly yields exact caller reason: %s", async reason => {
    let entered; const started = new Promise(resolve => { entered = resolve; });
    const controller = new AbortController(), ex = makeExec(config);
    const cancel = vi.fn(() => new Promise(() => {}));
    ex.computeRetryDelay = vi.fn(() => { entered(); return new Promise(() => {}); });
    const add = vi.spyOn(controller.signal, "addEventListener"), remove = vi.spyOn(controller.signal, "removeEventListener");
    fetchMock.mockResolvedValueOnce({ ...res(502), body: { cancel } });
    const result = rejectedReason(ex.execute(args(controller.signal))); await started;
    controller.abort(reason); expect(await result).toBe(reason);
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(cancel).toHaveBeenCalledWith(reason);
    // Match owned hook listeners; AbortSignal.any internals are not ours.
    for (const [event, callback] of add.mock.calls.filter(row => row[0] === "abort")) expect(remove.mock.calls.some(row => row[0] === event && row[1] === callback)).toBe(true);
    add.mockRestore(); remove.mockRestore();
  });
  it("late hook rejection after cancellation is observed and never retries", async () => {
    let rejectHook, entered; const started = new Promise(resolve => { entered = resolve; });
    const controller = new AbortController(), ex = makeExec(config), reason = "late abort";
    ex.computeRetryDelay = () => { entered(); return new Promise((_resolve, reject) => { rejectHook = reject; }); };
    fetchMock.mockResolvedValueOnce(res(502));
    const result = rejectedReason(ex.execute(args(controller.signal))); await started; controller.abort(reason);
    expect(await result).toBe(reason); rejectHook(new Error("late provider hook error"));
    await Promise.resolve(); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("synchronous hook abort/throw preserves caller reason and disposes once", async () => {
    const controller = new AbortController(), reason = { caller: "sync hook cancel" }, ex = makeExec(config);
    const cancel = vi.fn(() => { throw new Error("cleanup failure"); });
    ex.computeRetryDelay = () => { controller.abort(reason); throw new Error("foreign throw"); };
    fetchMock.mockResolvedValueOnce({ ...res(502), body: { cancel } });
    expect(await rejectedReason(ex.execute(args(controller.signal)))).toBe(reason); expect(cancel).toHaveBeenCalledTimes(1); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("committed retry disposes response before backoff and never awaits pending cleanup", async () => {
    vi.useFakeTimers(); const cancel = vi.fn(() => new Promise(() => {}));
    fetchMock.mockResolvedValueOnce({ ...res(502), body: { cancel } }).mockResolvedValueOnce(res(200));
    const result = makeExec(config).execute(args(undefined)); await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledTimes(1); expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000); expect((await result).response.status).toBe(200); expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("fallback cancels discarded response but a vetoed final response remains readable", async () => {
    const cancel = vi.fn().mockRejectedValue(new Error("cleanup failure"));
    const ex = makeExec({ baseUrls: ["https://a/api", "https://b/api"], retry: { 429: { attempts: 0 } } });
    fetchMock.mockResolvedValueOnce({ ...res(429), body: { cancel } }).mockResolvedValueOnce(res(200));
    expect((await ex.execute(args(undefined))).response.status).toBe(200); expect(cancel).toHaveBeenCalledTimes(1);
    const final = new Response("caller owned", { status: 429 }), finalCancel = vi.spyOn(final.body, "cancel");
    const single = makeExec({ baseUrl: "https://a/api", retry: { 429: { attempts: 1 } } }); single.computeRetryDelay = () => false;
    fetchMock.mockResolvedValueOnce(final); const returned = await single.execute(args(undefined));
    expect(returned.response).toBe(final); expect(finalCancel).not.toHaveBeenCalled(); expect(await final.text()).toBe("caller owned");
  });
  it("connect timeout retains network retry policy without aborting the caller", async () => {
    vi.useFakeTimers(); const controller = new AbortController(); const ex = makeExec({ ...config, timeoutMs: 10, retry: { 502: { attempts: 1, delayMs: 0 } } });
    fetchMock.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }))).mockResolvedValueOnce(res(200));
    const result = ex.execute(args(controller.signal)); await vi.advanceTimersByTimeAsync(11);
    expect((await result).response.status).toBe(200); expect(controller.signal.aborted).toBe(false); expect(fetchMock).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
});

describe("BaseExecutor.execute — retry by status (config-driven)", () => {
  it("retries 502 `attempts` times then succeeds", async () => {
    const ex = makeExec({ baseUrl: "https://x/api", retry: { 502: { attempts: 3, delayMs: 0 } } });
    fetchMock
      .mockResolvedValueOnce(res(502))
      .mockResolvedValueOnce(res(502))
      .mockResolvedValueOnce(res(200));
    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    expect(out.response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops after exhausting 502 attempts on a single url and throws", async () => {
    const ex = makeExec({ baseUrl: "https://x/api", retry: { 502: { attempts: 2, delayMs: 0 } } });
    fetchMock.mockResolvedValue(res(502));
    // single url: 1 initial + 2 retries = 3 calls, then returns the 502 response (no fallback url)
    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    expect(out.response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("BaseExecutor.execute — baseUrls fallback", () => {
  it("falls over to the next url on 429 (shouldRetry)", async () => {
    const ex = makeExec({ baseUrls: ["https://a/api", "https://b/api"], retry: { 429: { attempts: 0 } } });
    fetchMock
      .mockResolvedValueOnce(res(429)) // url[0] → fallback
      .mockResolvedValueOnce(res(200)); // url[1] ok
    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    expect(out.response.status).toBe(200);
    expect(out.url).toBe("https://b/api");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("BaseExecutor.execute — network error retry/fallback", () => {
  it("maps network exception to 502 retry config", async () => {
    const ex = makeExec({ baseUrl: "https://x/api", retry: { 502: { attempts: 1, delayMs: 0 } } });
    fetchMock
      .mockImplementationOnce(async () => { throw new Error("ECONNRESET"); })
      .mockResolvedValueOnce(res(200));
    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    expect(out.response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws when the only url fails with network error and no retries left", async () => {
    const ex = makeExec({ baseUrl: "https://x/api", retry: { 502: { attempts: 0 } } });
    // mockImplementationOnce (not persistent) avoids vitest flagging a reused rejection.
    fetchMock.mockImplementationOnce(async () => { throw new Error("boom"); });
    let thrown = null;
    try {
      await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    } catch (e) {
      thrown = e;
    }
    expect(thrown?.message).toBe("boom");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("BaseExecutor.execute — computeRetryDelay hook veto", () => {
  it("only invokes computeRetryDelay when status has retry config", async () => {
    const ex = makeExec({ baseUrl: "https://x/api", retry: { 503: { attempts: 1, delayMs: 0 } } });
    ex.computeRetryDelay = vi.fn().mockResolvedValue(0);
    fetchMock.mockResolvedValueOnce(res(500));
    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    expect(out.response.status).toBe(500);
    expect(ex.computeRetryDelay).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("hook returning false skips retry (uses fallback path)", async () => {
    const ex = makeExec({ baseUrl: "https://x/api", retry: { 429: { attempts: 5, delayMs: 0 } } });
    ex.computeRetryDelay = vi.fn().mockResolvedValue(false);
    fetchMock.mockResolvedValueOnce(res(429));
    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    // hook vetoes retry → no fallback url → returns the 429 response as-is
    expect(out.response.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
