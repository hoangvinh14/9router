import { describe, it, expect, vi, afterEach } from "vitest";
import { readRetryErrorBody } from "../../open-sse/utils/retryErrorBody.js";
import { RETRY_ERROR_BODY_MAX_BYTES, RETRY_ERROR_BODY_TIMEOUT_MS } from "../../open-sse/config/retryBodyLimits.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
afterEach(() => vi.useRealTimers());
const encode = text => new TextEncoder().encode(text);
function stalled() {
  let resolveCancel; const cancelled = new Promise(resolve => { resolveCancel = resolve; });
  return { response: new Response(new ReadableStream({ cancel(reason) { resolveCancel(reason); } }), { status: 429 }), cancelled };
}
describe("bounded owned retry-error clone reader", () => {
  it("reads split UTF8 exact text without consuming original", async () => {
    const bytes = encode("Chào 👋");
    const response = new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }));
    expect(await readRetryErrorBody(response)).toBe("Chào 👋"); expect(response.bodyUsed).toBe(false); expect(await response.text()).toBe("Chào 👋");
  });
  it("no-signal deadline rejects promptly without waiting for tee cancellation", async () => {
    vi.useFakeTimers(); const { response, cancelled } = stalled();
    const result = readRetryErrorBody(response); const assertion = expect(result).rejects.toThrow("Retry error body inspection timed out");
    // Observe the assertion promise immediately even if it fails while timers
    // advance, then re-await the original so failures still fail this test.
    const observed = assertion.then(() => {}, () => {});
    await vi.advanceTimersByTimeAsync(RETRY_ERROR_BODY_TIMEOUT_MS); await observed; await assertion; expect(vi.getTimerCount()).toBe(0);
    const originalReason = "dispose original"; await response.body.cancel(originalReason);
    const reasons = await cancelled; expect(reasons[0]).toBe(originalReason); expect(reasons[1].message).toBe("Retry error body inspection timed out");
  });
  it("cancelled read done=true cannot turn a partial retry body into successful EOF", async () => {
    vi.useFakeTimers(); let completeRead;
    const pending = new Promise(resolve => { completeRead = resolve; });
    const reader = { read: vi.fn().mockResolvedValueOnce({ value: encode('{"error":{"message":"reset after 60s"}}'), done: false }).mockImplementation(() => pending),
      cancel: vi.fn(() => { completeRead({ done: true }); return new Promise(() => {}); }), releaseLock: vi.fn() };
    const response = { clone: () => ({ body: { getReader: () => reader } }) };
    const outcome = readRetryErrorBody(response).then(value => ({ value }), error => ({ error }));
    await vi.advanceTimersByTimeAsync(RETRY_ERROR_BODY_TIMEOUT_MS);
    const result = await outcome; expect(result.value).toBeUndefined(); expect(result.error.message).toBe("Retry error body inspection timed out");
    expect(reader.cancel).toHaveBeenCalledWith(result.error); expect(reader.releaseLock).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("real tee partial body times out without returning retry metadata prefix", async () => {
    vi.useFakeTimers(); let resolveCancel;
    const cancelled = new Promise(resolve => { resolveCancel = resolve; });
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(encode('{"error":{"message":"reset after 60s"}}')); }, cancel(reason) { resolveCancel(reason); } }));
    const outcome = readRetryErrorBody(response).then(value => ({ value }), error => ({ error }));
    await vi.advanceTimersByTimeAsync(RETRY_ERROR_BODY_TIMEOUT_MS);
    const result = await outcome; expect(result.value).toBeUndefined(); expect(result.error.message).toBe("Retry error body inspection timed out");
    await response.body.cancel("original dispose"); expect((await cancelled)[1]).toBe(result.error);
  });
  it.each(["primitive", new Error("custom caller")])("abort preserves exact reason and releases owned listener: %s", async reason => {
    const { response, cancelled } = stalled(), controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener"), remove = vi.spyOn(controller.signal, "removeEventListener");
    const result = readRetryErrorBody(response, { signal: controller.signal });
    controller.abort(reason); await expect(result).rejects.toBe(reason);
    for (const [event, fn] of add.mock.calls) expect(remove.mock.calls.some(row => row[0] === event && row[1] === fn)).toBe(true);
    await response.body.cancel(reason); expect(await cancelled).toEqual([reason, reason]);
    add.mockRestore(); remove.mockRestore();
  });
  it("preabort prevents cloning and malformed configuration denies before cloning", async () => {
    const response = new Response("original"), clone = vi.spyOn(response, "clone"), controller = new AbortController(); controller.abort("before");
    await expect(readRetryErrorBody(response, { signal: controller.signal })).rejects.toBe("before");
    await expect(readRetryErrorBody(response, { maxBytes: 0 })).rejects.toThrow("Invalid retry body bounds"); expect(clone).not.toHaveBeenCalled();
  });
  it("raw byte overflow never returns truncated parseable metadata; cancels clone", async () => {
    let resolveCancel; const cancelled = new Promise(resolve => { resolveCancel = resolve; });
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(encode('"ééé"')); }, cancel(reason) { resolveCancel(reason); } }));
    await expect(readRetryErrorBody(response, { maxBytes: 5 })).rejects.toThrow("Retry error body exceeds byte limit");
    await response.body.cancel("original dispose"); expect((await cancelled)[1].message).toBe("Retry error body exceeds byte limit");
  });
  it("upstream read error remains primary error", async () => {
    const reason = new Error("transport failure"); const response = new Response(new ReadableStream({ start(controller) { controller.error(reason); } }));
    await expect(readRetryErrorBody(response)).rejects.toBe(reason);
  });
});
describe("Antigravity bounded retry metadata compatibility", () => {
  const ag = new AntigravityExecutor();
  it("body timeout uses status backoff, header cap still wins and original remains caller-owned", async () => {
    vi.useFakeTimers(); const { response, cancelled } = stalled(); response.headers.set("Retry-After", "60");
    const result = ag.computeRetryDelay(response, 1); await vi.advanceTimersByTimeAsync(RETRY_ERROR_BODY_TIMEOUT_MS);
    expect(await result).toBe(false); expect(response.bodyUsed).toBe(false);
    await response.body.cancel("original dispose"); await cancelled;
  });
  it("timeout with no header uses existing transient status policy", async () => {
    vi.useFakeTimers(); const { response, cancelled } = stalled(); const result = ag.computeRetryDelay(response, 2);
    await vi.advanceTimersByTimeAsync(RETRY_ERROR_BODY_TIMEOUT_MS); expect(await result).toBe(4000);
    await response.body.cancel("original dispose"); await cancelled;
  });
  it("oversize retry-body metadata is not parsed, original final response is unchanged", async () => {
    const text = JSON.stringify({ error: { message: "quota resets after 60s", padding: "x".repeat(RETRY_ERROR_BODY_MAX_BYTES) } });
    const response = new Response(text, { status: 429 });
    expect(await ag.computeRetryDelay(response, 1)).toBe(2000); expect(await response.text()).toBe(text);
  });
  it("caller abort is not swallowed into backoff and both tee branches preserve reason identity", async () => {
    const { response, cancelled } = stalled(), controller = new AbortController(), reason = { caller: "stop" };
    const result = ag.computeRetryDelay(response, 1, 0, { signal: controller.signal }); controller.abort(reason);
    await expect(result).rejects.toBe(reason); await response.body.cancel(reason);
    const reasons = await cancelled; expect(reasons[0]).toBe(reason); expect(reasons[1]).toBe(reason);
  });
});
