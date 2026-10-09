import { beforeEach, describe, it, expect, vi } from "vitest";
import { ApiKeyBudgetError, budgetErrorResponse, geminiBudgetErrorResponse } from "@/lib/apiKeyBudget/errors.js";
import { BUDGET_ERROR } from "../../open-sse/config/apiKeyBudgetConstants.js";
const mocks = vi.hoisted(() => ({ chat: vi.fn() }));
vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: mocks.chat }));
const { POST } = await import("../../src/app/api/v1beta/models/[...path]/route.js");
const context = action => ({ params: Promise.resolve({ path: [`gemini-2.5-flash:${action}`] }) });
const request = (action = "generateContent", signal) => new Request(`https://router.test/v1beta/models/gemini-2.5-flash:${action}`, {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer gateway-key", "x-api-key": "lower-priority", "x-goog-api-key": "lowest-header" },
  body: JSON.stringify({ contents: [{ parts: [{ text: "fixture" }] }] }), signal,
});
beforeEach(() => mocks.chat.mockReset());
describe("inactive Gemini pre-stream local budget boundary", () => {
  it.each(["generateContent", "streamGenerateContent"])("returns native429 trusted producer metadata for %s before streaming", async action => {
    const error = new ApiKeyBudgetError(BUDGET_ERROR.EXCEEDED, { requestId: "req-a", now: new Date("2026-10-04T00:00:00.000Z"), blockedWindows: [{ window: "weekly", resetAt: "2026-10-04T17:00:00.000Z" }, { window: "monthly", resetAt: "2026-10-31T17:00:00.000Z" }] });
    const response = budgetErrorResponse(error); error.message = "untrusted mutation secret";
    mocks.chat.mockResolvedValue(response);
    const native = await POST(request(action), context(action));
    expect(native.status).toBe(429); expect(native.headers.get("cache-control")).toBe("no-store");
    expect(native.headers.get("x-request-id")).toBe("req-a"); expect(native.headers.get("retry-after")).toBe("2394000");
    expect(native.headers.get("access-control-expose-headers")).toBe("Retry-After, X-Request-Id");
    expect(native.headers.get("access-control-allow-origin")).toBe("*");
    const body = await native.json(); expect(body.error).toMatchObject({ code: 429, status: "RESOURCE_EXHAUSTED", gatewayCode: BUDGET_ERROR.EXCEEDED, requestId: "req-a", timezone: "Asia/Ho_Chi_Minh", resetAt: "2026-10-31T17:00:00.000Z" });
    expect(body.error.windows).toHaveLength(2); expect(JSON.stringify(body)).not.toMatch(/secret|untrusted/);
  });
  it.each([[BUDGET_ERROR.UNAVAILABLE, 503, "UNAVAILABLE"], [BUDGET_ERROR.UNRESOLVED, 503, "UNAVAILABLE"], [BUDGET_ERROR.CONFLICT, 409, "ABORTED"]])("maps trusted %s without inventing reset/Retry-After", async (code, status, nativeStatus) => {
    mocks.chat.mockResolvedValue(budgetErrorResponse(new ApiKeyBudgetError(code, { requestId: "req-b" })));
    const response = await POST(request(), context("generateContent"));
    expect(response.status).toBe(status); expect(response.headers.get("retry-after")).toBeNull();
    expect((await response.json()).error).toMatchObject({ code: status, status: nativeStatus, gatewayCode: code, requestId: "req-b" });
  });
  it("perfect provider JSON imitator and copied/cloned wire responses are not local provenance", async () => {
    const real = budgetErrorResponse(new ApiKeyBudgetError(BUDGET_ERROR.UNAVAILABLE, { requestId: "local" }));
    const cloned = real.clone(); expect(geminiBudgetErrorResponse(cloned)).toBeNull();
    const imitation = new Response(await cloned.text(), { status: real.status, headers: real.headers });
    mocks.chat.mockResolvedValue(imitation);
    const response = await POST(request(), context("generateContent"));
    expect(response).toBe(imitation); expect((await response.json()).error.code).toBe(BUDGET_ERROR.UNAVAILABLE);
  });
  it("provider SSE budget-shaped frame is not authenticated by vocabulary", async () => {
    const frame = JSON.stringify({ error: { type: "api_key_budget_error", code: BUDGET_ERROR.EXCEEDED, message: "provider fake" } });
    mocks.chat.mockResolvedValue(new Response(`data: ${frame}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } }));
    const response = await POST(request("streamGenerateContent"), context("streamGenerateContent"));
    // Existing untrusted-frame compatibility drops errors without choices. No
    // claim of native terminal support until event-specific provenance exists.
    expect(response.status).toBe(200); expect(await response.text()).toBe("");
  });
  it("actual POST emits identical Gemini events at every byte split and EOF without a blank line", async () => {
    const wire = 'data: {"choices":[{"delta":{"content":"Chào 👋"}}]}\r\n\r\ndata: {"choices":\r\ndata: [{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}';
    const bytes = new TextEncoder().encode(wire); let expected;
    for (let split = 0; split <= bytes.length; split++) {
      mocks.chat.mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, split)); controller.enqueue(bytes.slice(split)); controller.close(); } })));
      const response = await POST(request("streamGenerateContent"), context("streamGenerateContent"));
      const text = await response.text(); expected ??= text; expect(text).toBe(expected);
    }
    const events = expected.trim().split(/\r\n\r\n/).map(line => JSON.parse(line.slice(6)));
    expect(events).toHaveLength(2); expect(events[0].candidates[0].content.parts).toEqual([{ text: "Chào 👋" }]);
    expect(events[1].candidates[0].finishReason).toBe("STOP"); expect(events[1].usageMetadata).toEqual({ promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 });
  });
  it("downstream cancellation propagates exact reason to upstream while a partial frame is retained", async () => {
    let cancelled; let resolveCancel;
    const cancellation = new Promise(resolve => { resolveCancel = resolve; });
    mocks.chat.mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":')); }, cancel(reason) { cancelled = reason; resolveCancel(); } })));
    const response = await POST(request("streamGenerateContent"), context("streamGenerateContent"));
    const reason = { caller: "stream cancel" }; await response.body.cancel(reason); await cancellation;
    expect(cancelled).toBe(reason);
  });
  it("parser overflow cancels upstream and rejects instead of silently reporting completed content", async () => {
    let cancelled; let resolveCancel;
    const cancellation = new Promise(resolve => { resolveCancel = resolve; });
    mocks.chat.mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("data: " + "x".repeat(1024 * 1024))); }, cancel(reason) { cancelled = reason; resolveCancel(); } })));
    const response = await POST(request("streamGenerateContent"), context("streamGenerateContent"));
    await expect(response.text()).rejects.toThrow("SSE line exceeds framing limit"); await cancellation;
    expect(cancelled.message).toBe("SSE line exceeds framing limit");
  });
  it("upstream read failure rejects native stream with original reason, no synthesized success", async () => {
    const reason = new Error("upstream transport failed");
    mocks.chat.mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.error(reason); } })));
    const response = await POST(request("streamGenerateContent"), context("streamGenerateContent"));
    await expect(response.text()).rejects.toBe(reason);
  });
  it("producer snapshots remain response-local even if Error is mutated/reused", async () => {
    const error = new ApiKeyBudgetError(BUDGET_ERROR.UNAVAILABLE, { requestId: "one" });
    const first = budgetErrorResponse(error); error.requestId = "two"; const second = budgetErrorResponse(error);
    expect((await geminiBudgetErrorResponse(second).json()).error.requestId).toBe("two");
    expect((await geminiBudgetErrorResponse(first).json()).error.requestId).toBe("one");
    const invalid = budgetErrorResponse(new ApiKeyBudgetError(BUDGET_ERROR.UNAVAILABLE, { requestId: "bad value" }));
    expect(() => geminiBudgetErrorResponse(invalid)).toThrow("Invalid local accounting error metadata");
  });
  it("chat conversion propagates original signal/custom reason without changing supplied credentials", async () => {
    const controller = new AbortController(), reason = new Error("caller cancel"); let seen;
    mocks.chat.mockImplementation(async incoming => { seen = incoming; return Response.json({ candidates: [] }); });
    await POST(request("generateContent", controller.signal), context("generateContent"));
    expect(seen.headers.get("authorization")).toBe("Bearer gateway-key"); expect(seen.headers.get("x-api-key")).toBe("lower-priority");
    controller.abort(reason); expect(seen.signal.aborted).toBe(true); expect(seen.signal.reason).toBe(reason);
    // Signal propagation does not itself certify active/disabled identity or
    // credential priority inside the unmodified production chat handler.
  });
});
