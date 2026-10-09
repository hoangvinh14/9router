import { describe, it, expect } from "vitest";
import { ApiKeyBudgetError, budgetErrorResponse } from "@/lib/apiKeyBudget/errors.js";
describe("internal local budget error contract (native route propagation pending)", () => {
  it("exhausted OR windows use latest blocked reset; no-store/header exposure/request identity", async () => {
    const error = new ApiKeyBudgetError("api_key_budget_exceeded", { requestId: "server-fixture-id", now: "2026-10-03T00:00:00.000Z", blockedWindows: [
      { window: "weekly", resetAt: "2026-10-04T17:00:00.000Z" }, { window: "monthly", resetAt: "2026-10-31T17:00:00.000Z" },
    ] });
    const response = budgetErrorResponse(error);
    expect(response.status).toBe(429); expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Request-Id")).toBe("server-fixture-id");
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain("Retry-After");
    expect(response.headers.get("Retry-After")).toBe(String((Date.parse("2026-10-31T17:00:00.000Z") - Date.parse("2026-10-03T00:00:00.000Z")) / 1000));
    expect((await response.json()).error).toMatchObject({ code: "api_key_budget_exceeded", type: "api_key_budget_error", param: null, timezone: "Asia/Ho_Chi_Minh", resetAt: "2026-10-31T17:00:00.000Z" });
  });
  it.each(["api_key_accounting_unresolved", "api_key_accounting_unavailable"])("%s is terminal, not cooldown or fake retry timing", code => {
    const error = new ApiKeyBudgetError(code); expect(error.candidateLocal).toBe(false);
    expect(budgetErrorResponse(error).status).toBe(503); expect(budgetErrorResponse(error).headers.has("Retry-After")).toBe(false);
  });
  it.each(["model_pricing_unavailable", "model_accounting_unsupported"])("%s can reject only this candidate", code => {
    expect(new ApiKeyBudgetError(code).candidateLocal).toBe(true);
  });
});
