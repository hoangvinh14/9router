import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
let db, context, repo, pricing, dir, now;
const original = process.env.DATA_DIR;
const usage = { exact: true, input: 1000000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, reasoningIncludedInOutput: true };
const candidate = { provider: "fixture", model: "fixture" };
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-budget-policy-")); process.env.DATA_DIR = dir; delete global._dbAdapter; vi.resetModules();
  db = await (await import("@/lib/db/driver.js")).getAdapter();
  await (await import("@/lib/db/index.js")).importDb({ apiKeys: [{ id: "key-a", key: "fixture-secret-a" }, { id: "key-b", key: "fixture-secret-b" }] });
  // TEST ONLY: production service deliberately has no activation function.
  db.durableTransaction(() => db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt',?)", ["2026-10-01T00:00:00.000Z"]));
  now = "2026-10-03T00:00:00.000Z";
  context = async (id = "key-a") => (await import("@/lib/apiKeyBudget/service.js")).createBudgetContext(id, { adapter: async () => db, clock: () => now });
  repo = await import("@/lib/db/repos/apiKeyAccountingRepo.js"); pricing = await import("@/lib/db/repos/pricingRepo.js");
  await pricing.updatePricing({ fixture: { fixture: { input: "1", output: "2" } } });
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(dir, { recursive: true, force: true }); if (original === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = original; });
describe("recorded-spend budget service (inactive, no reservations)", () => {
  it("null unlimited vs zero immediate deny and candidate-local missing pricing", async () => {
    const c = await context(); expect(c.gate().budgeted).toBe(false);
    c.updatePolicy({ weeklyLimitUsd: "0", monthlyLimitUsd: null, expectedVersion: 0 });
    expect(() => c.beginAttempt(candidate)).toThrowError(expect.objectContaining({ code: "api_key_budget_exceeded", status: 429, candidateLocal: false }));
    c.updatePolicy({ weeklyLimitUsd: "2", monthlyLimitUsd: null, expectedVersion: 1 });
    expect(() => c.beginAttempt({ provider: "custom", model: "unknown" })).toThrowError(expect.objectContaining({ code: "model_pricing_unavailable", candidateLocal: true }));
    expect(db.all("SELECT * FROM apiKeyAccounting")).toEqual([]);
  });
  it("multiple live admissions may overshoot, committed spend then blocks either window", async () => {
    const c = await context(); c.updatePolicy({ weeklyLimitUsd: "1", monthlyLimitUsd: "2", expectedVersion: 0 });
    const attempts = [c.beginAttempt(candidate), c.beginAttempt(candidate), c.beginAttempt(candidate)];
    expect(new Set(attempts.map(a => a.attemptId)).size).toBe(3); expect(c.gate().counts.pending).toBe(3);
    for (const a of attempts) c.completeAttempt(a, { usage });
    expect(repo.sumSpendSync(db, "key-a", "2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z")).toBe("3000000000");
    expect(() => c.gate()).toThrowError(expect.objectContaining({ code: "api_key_budget_exceeded", resetAt: "2026-10-31T17:00:00.000Z" }));
    const b = await context("key-b"); expect(b.gate().spent.monthly).toBe("0");
  });
  it("enable after unlimited spend, lower/raise/toggle retains spent and rechecks fresh policy", async () => {
    const c = await context(); c.completeAttempt(c.beginAttempt(candidate), { usage });
    c.updatePolicy({ weeklyLimitUsd: null, monthlyLimitUsd: "1", expectedVersion: 0 });
    expect(() => c.gate()).toThrow(/exceeded/);
    c.updatePolicy({ weeklyLimitUsd: null, monthlyLimitUsd: "2", expectedVersion: 1 }); expect(c.gate().spent.monthly).toBe("1000000000");
    const other = await context(); other.updatePolicy({ weeklyLimitUsd: "0", monthlyLimitUsd: null, expectedVersion: 2 });
    expect(() => c.beginAttempt(candidate)).toThrow(/exceeded/);
    other.updatePolicy({ weeklyLimitUsd: null, monthlyLimitUsd: null, expectedVersion: 3 }); expect(c.gate().spent.monthly).toBe("1000000000");
  });
  it("long attempt settles into its start window; unknown remains unresolved across reset", async () => {
    const c = await context(); const a = c.beginAttempt(candidate);
    now = "2026-11-01T00:00:00.000Z"; c.completeAttempt(a, { usage }); expect(c.gate().spent.monthly).toBe("0");
    const unknown = c.beginAttempt(candidate); c.completeAttempt(unknown, { outcome: "aborted" });
    now = "2027-01-01T00:00:00.000Z";
    c.updatePolicy({ weeklyLimitUsd: "10", monthlyLimitUsd: null, expectedVersion: 0 });
    expect(() => c.gate()).toThrowError(expect.objectContaining({ code: "api_key_accounting_unresolved" }));
    expect(repo.getAttemptSync(db, unknown.attemptId).costNanoUsd).toBeNull();
  });
  it("duplicate settlement retains durable time and snapshot, late conflict cannot debit twice", async () => {
    const c = await context(); const a = c.beginAttempt(candidate);
    await pricing.updatePricing({ fixture: { fixture: { input: "5", output: "5" } } });
    const first = c.completeAttempt(a, { usage }); now = "2026-10-03T00:01:00.000Z";
    expect(c.completeAttempt(a, { usage })).toEqual(first); expect(first.costNanoUsd).toBe("1000000000");
    expect(() => c.completeAttempt(a, { usage: { ...usage, input: 2 } })).toThrow(/conflict/);
    expect(repo.getAttemptSync(db, a.attemptId).costNanoUsd).toBe("1000000000");
  });
  it("analytics failure never changes acked settlement and same terminal retry replays projection", async () => {
    const project = vi.fn(() => { throw new Error("analytic unavailable"); });
    const c = await (await import("@/lib/apiKeyBudget/service.js")).createBudgetContext("key-a", { adapter: async () => db, clock: () => now, project });
    const a = c.beginAttempt(candidate); const result = c.completeAttempt(a, { usage });
    expect(result.state).toBe("settled"); expect(result.costNanoUsd).toBe("1000000000"); expect(project).toHaveBeenCalledTimes(1);
    expect(db.coverage.status("key-a").gaps).toEqual([]);
    project.mockImplementation((adapter, attemptId) => { expect(adapter).toBe(db); expect(attemptId).toBe(a.attemptId); });
    expect(c.completeAttempt(a, { usage })).toEqual(result); expect(project).toHaveBeenCalledTimes(2);
  });
  it("unlimited unknown pricing/estimated usage is unresolved, not free", async () => {
    const c = await context(); const a = c.beginAttempt({ provider: "custom", model: "unknown" });
    expect(a.priceSnapshot).toBeNull(); expect(c.completeAttempt(a, { usage }).state).toBe("unresolved");
    expect(c.gate().counts.unresolved).toBe(1);
    const b = c.beginAttempt(candidate); expect(c.completeAttempt(b, { usage: { ...usage, exact: false } }).costNanoUsd).toBeNull();
  });
  it("intent failure requires durable gap, failed latch denies, gap blocks budget activation", async () => {
    const c = await context();
    const real = db.durableTransaction.bind(db);
    vi.spyOn(db, "durableTransaction").mockImplementation(() => { throw new Error("disk failure"); });
    const a = c.beginAttempt(candidate); expect(a.unrecorded).toBe(true);
    expect(db.coverage.status("key-a").gaps.some(g => !g.resolvedAt)).toBe(true);
    vi.restoreAllMocks(); db.durableTransaction = real;
    expect(() => c.updatePolicy({ weeklyLimitUsd: "1", monthlyLimitUsd: null, expectedVersion: 0 })).toThrow(/unavailable/);
    vi.spyOn(db, "durableTransaction").mockImplementation(() => { throw new Error("disk failure"); });
    vi.spyOn(db.coverage, "latchGap").mockImplementation(() => { throw new Error("sidecar fsync failure"); });
    expect(() => c.beginAttempt(candidate)).toThrow(/unavailable/);
  });
  it("budgeted intent write failure denies without using unlimited gap exception", async () => {
    const c = await context(); c.updatePolicy({ weeklyLimitUsd: "2", monthlyLimitUsd: null, expectedVersion: 0 });
    vi.spyOn(db, "durableTransaction").mockImplementation(() => { throw new Error("disk failure"); });
    const gap = vi.spyOn(db.coverage, "latchGap"); expect(() => c.beginAttempt(candidate)).toThrow(/unavailable/); expect(gap).not.toHaveBeenCalled();
  });
  it("stale unlimited proof cannot bypass changed policy after storage poisons (availability gate open)", async () => {
    const c = await context(); c.gate();
    const other = await context(); other.updatePolicy({ weeklyLimitUsd: "1", monthlyLimitUsd: null, expectedVersion: 0 });
    vi.spyOn(db, "health").mockReturnValue({ healthy: false });
    const gap = vi.spyOn(db.coverage, "latchGap");
    expect(() => c.beginAttempt(candidate)).toThrow(/unavailable/);
    const fresh = await context(); expect(() => fresh.beginAttempt(candidate)).toThrow(/unavailable/);
    expect(gap).not.toHaveBeenCalled();
  });
  it("late exact usage resolves unknown; audited waiver protects against later debit", async () => {
    const c = await context(); const a = c.beginAttempt(candidate);
    c.completeAttempt(a, { outcome: "failed" });
    expect(c.completeAttempt(a, { outcome: "failed", usage }).costNanoUsd).toBe("1000000000");
    const b = c.beginAttempt(candidate); const unknown = c.completeAttempt(b, { outcome: "aborted" });
    const recovery = { action: "waive", expectedVersion: unknown.resolutionVersion, operationId: "service-waiver", actor: "admin", reason: "trace reviewed", evidence: "provider missing usage explicitly waived" };
    c.resolveAttempt(b.attemptId, recovery); c.resolveAttempt(b.attemptId, recovery);
    expect(() => c.completeAttempt(b, { usage })).toThrow(/conflict/);
    expect(repo.getAttemptSync(db, b.attemptId).costNanoUsd).toBe("0");
  });
  it("settlement write failure latches unlimited gap, budgeted failure denies, failed latch denies", async () => {
    const c = await context(); const a = c.beginAttempt(candidate);
    vi.spyOn(db, "durableTransaction").mockImplementation(() => { throw new Error("disk failure"); });
    expect(c.completeAttempt(a, { usage }).unrecorded).toBe(true);
    expect(db.coverage.status("key-a").gaps.some(g => !g.resolvedAt)).toBe(true);
    vi.spyOn(db.coverage, "latchGap").mockImplementation(() => { throw new Error("latch failure"); });
    expect(() => c.completeAttempt(a, { usage })).toThrow(/unavailable/);
    vi.restoreAllMocks();
    const other = await context("key-b"); other.updatePolicy({ weeklyLimitUsd: "2", monthlyLimitUsd: null, expectedVersion: 0 });
    const b = other.beginAttempt(candidate);
    vi.spyOn(db, "durableTransaction").mockImplementation(() => { throw new Error("disk failure"); });
    const latch = vi.spyOn(db.coverage, "latchGap"); expect(() => other.completeAttempt(b, { usage })).toThrow(/unavailable/); expect(latch).not.toHaveBeenCalled();
  });
  it("gap persists across reopen, blocks activation until scoped audited reconciliation", async () => {
    const c = await context(); db.coverage.latchGap("key-a", "fixture outage");
    db.close(); db = await (await import("@/lib/db/driver.js")).getAdapter();
    const restarted = await context(); const gap = db.coverage.status("key-a").gaps.find(g => !g.resolvedAt);
    expect(() => restarted.updatePolicy({ weeklyLimitUsd: "2", monthlyLimitUsd: null, expectedVersion: 0 })).toThrow(/unavailable/);
    restarted.reconcileGap({ gapId: gap.id, apiKeyId: "key-a", expectedGeneration: gap.generation, operationId: "gap-service-recovery", actor: "admin", reason: "outage approved", evidence: "coverage gap explicitly waived" });
    expect(restarted.updatePolicy({ weeklyLimitUsd: "2", monthlyLimitUsd: null, expectedVersion: 0 }).version).toBe(1);
    expect(() => c.completeAttempt({ attemptId: "forged", requestId: c.requestId, apiKeyId: "key-a" }, { usage })).toThrow(/conflict/);
    expect(() => restarted.completeAttempt(null)).toThrow(/conflict/);
  });
  it("maintenance/ownership errors never become unlimited exceptions; no-key cannot bypass", async () => {
    const c = await context(), noKey = await context(null); expect(noKey.beginAttempt(candidate)).toBeNull();
    db.coverage.enterMaintenance("restore"); expect(() => c.beginAttempt(candidate)).toThrow(/unavailable/); expect(() => noKey.beginAttempt(candidate)).toThrow(/unavailable/);
  });
  it("in-flight terminal usage survives deletion; identity cannot cross requests", async () => {
    const c = await context(); const a = c.beginAttempt(candidate);
    await (await import("@/lib/db/repos/apiKeysRepo.js")).deleteApiKey("key-a");
    expect(c.completeAttempt(a, { usage }).costNanoUsd).toBe("1000000000");
    const other = await context("key-b"); expect(() => other.completeAttempt(a, { usage })).toThrow(/conflict/);
    expect(() => c.beginAttempt(candidate)).toThrow(/unavailable/);
  });
});
