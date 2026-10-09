import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
let db, dir, ledger, project, replay, api;
const original = process.env.DATA_DIR;
const now = () => new Date().toISOString();
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-projection-")); process.env.DATA_DIR = dir; delete global._dbAdapter; delete global._recentRing; vi.resetModules();
  db = await (await import("@/lib/db/driver.js")).getAdapter(); api = await import("@/lib/db/index.js");
  await api.importDb({ apiKeys: [{ id: "key-a", key: "fixture-secret-never-projected", name: "Projection key" }] });
  ledger = await import("@/lib/db/repos/apiKeyAccountingRepo.js");
  const usage = await import("@/lib/db/repos/usageRepo.js"); project = usage.projectAccountingUsageSync; replay = usage.replayAccountingUsageSync;
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; delete global._recentRing; fs.rmSync(dir, { recursive: true, force: true }); if (original === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = original; });
function settle(id, timestamp = now()) {
  ledger.insertAttemptSync(db, { attemptId: id, requestId: "server-request", apiKeyId: "key-a", ownerInstanceId: db.ownerInstanceId, startedAt: timestamp, provider: "fixture", model: "fixture", endpoint: "chat", priceSnapshot: { rates: { input: "1", output: "2" } } });
  ledger.finalizeAttemptSync(db, id, { state: "settled", outcome: "failed", costNanoUsd: "17", usage: { exact: true, input: 10, output: 2, cacheRead: 1, cacheWrite: 0, reasoning: 0, reasoningIncludedInOutput: true }, finishedAt: timestamp });
}
describe("idempotent ledger usage projection", () => {
  it("identical tokens/time with distinct IDs project twice, same ID replay once with original cost", async () => {
    const timestamp = now(); settle("a", timestamp); settle("b", timestamp);
    await (await import("@/lib/db/repos/pricingRepo.js")).updatePricing({ fixture: { fixture: { input: "999", output: "999" } } });
    const results = await Promise.all(Array.from({ length: 8 }, () => Promise.resolve().then(() => project(db, "a"))));
    expect(results.filter(r => r.inserted)).toHaveLength(1); expect(project(db, "b").inserted).toBe(true);
    expect(db.all("SELECT apiKey,apiKeyId,attemptId,cost FROM usageHistory")).toEqual([
      expect.objectContaining({ apiKey: null, apiKeyId: "key-a", attemptId: "a", cost: 0.000000017 }), expect.objectContaining({ apiKey: null, apiKeyId: "key-a", attemptId: "b", cost: 0.000000017 }),
    ]);
    for (const period of ["24h", "all"]) {
      const stats = await api.getUsageStats(period); const buckets = Object.values(stats.byApiKey);
      expect(buckets).toHaveLength(1); expect(buckets[0].requests).toBe(2); expect(buckets[0].apiKeyId).toBe("key-a"); expect(JSON.stringify(stats)).not.toContain("fixture-secret-never-projected");
    }
  });
  it("failure between history/day writes rolls back receipt and permits retry without ledger mutation", () => {
    settle("a"); const run = db.run.bind(db);
    vi.spyOn(db, "run").mockImplementation((sql, params) => { if (sql.startsWith("INSERT INTO usageDaily")) throw new Error("analytic write failure"); return run(sql, params); });
    expect(() => project(db, "a")).toThrow(/analytic/);
    expect(db.all("SELECT * FROM usageHistory")).toEqual([]); expect(db.all("SELECT * FROM kv WHERE scope='accountingProjection'")).toEqual([]);
    expect(ledger.getAttemptSync(db, "a").costNanoUsd).toBe("17");
    vi.restoreAllMocks(); expect(project(db, "a").inserted).toBe(true);
  });
  it("retained receipts survive history retention and config import, never resurrect daily totals", async () => {
    settle("a"); project(db, "a"); const day = db.get("SELECT data FROM usageDaily").data;
    db.durableTransaction(() => db.run("DELETE FROM usageHistory"));
    await api.importDb({ apiKeys: [{ id: "key-a", key: "fixture-secret-never-projected" }] });
    expect(project(db, "a").inserted).toBe(false); expect(db.all("SELECT * FROM usageHistory")).toEqual([]); expect(db.get("SELECT data FROM usageDaily").data).toBe(day);
    db.durableTransaction(() => db.run("DELETE FROM usageDaily")); expect(project(db, "a").inserted).toBe(false); expect(db.all("SELECT * FROM usageDaily")).toEqual([]);
  });
  it("bounded replay repairs crash gaps and skips retained receipts after deletion/restart", async () => {
    settle("a"); settle("b"); settle("c"); project(db, "a");
    db.durableTransaction(() => db.run("DELETE FROM usageHistory"));
    expect(replay(db, { limit: 1 })).toEqual({ attempted: 1, projected: 1, failedAttemptIds: [], nextCursor: "b" });
    db.close(); db = await (await import("@/lib/db/driver.js")).getAdapter();
    expect(replay(db, { limit: 1, afterAttemptId: "b" })).toEqual({ attempted: 1, projected: 1, failedAttemptIds: [], nextCursor: null });
    expect(replay(db)).toEqual({ attempted: 0, projected: 0, failedAttemptIds: [], nextCursor: null });
    expect(db.all("SELECT attemptId FROM usageHistory ORDER BY attemptId").map(r => r.attemptId)).toEqual(["b", "c"]);
    expect(db.get("SELECT value FROM _meta WHERE key='totalRequestsLifetime'").value).toBe("3");
  });
  it("healthy failed projection is retryable; unhealthy persistence stops the page", () => {
    settle("a"); settle("b"); const run = db.run.bind(db);
    vi.spyOn(db, "run").mockImplementation((sql, params) => {
      if (sql.startsWith("INSERT INTO usageHistory") && params[6] === "a") throw new Error("projection failed");
      return run(sql, params);
    });
    expect(replay(db)).toEqual({ attempted: 2, projected: 1, failedAttemptIds: ["a"], nextCursor: null });
    expect(ledger.getAttemptSync(db, "a").costNanoUsd).toBe("17");
    vi.restoreAllMocks(); expect(replay(db).projected).toBe(1);
    settle("c"); let healthy = true;
    vi.spyOn(db, "health").mockImplementation(() => ({ healthy }));
    vi.spyOn(db, "durableTransaction").mockImplementation(() => { healthy = false; throw new Error("uncertain persistence"); });
    expect(() => replay(db)).toThrow(/storage unavailable/);
  });
  it("replay validates bounds and excludes pending/unresolved/not-dispatched attempts", () => {
    for (const options of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { afterAttemptId: "" }, { afterAttemptId: 1 }]) expect(() => replay(db, options)).toThrow(/page/);
    ledger.insertAttemptSync(db, { attemptId: "pending", requestId: "request", apiKeyId: "key-a", ownerInstanceId: db.ownerInstanceId, startedAt: now(), provider: "fixture", model: "fixture", endpoint: "chat" });
    expect(replay(db).attempted).toBe(0);
    ledger.finalizeAttemptSync(db, "pending", { state: "unresolved", outcome: "unknown", finishedAt: now() });
    expect(replay(db).attempted).toBe(0);
  });
  it("waived unknown usage displays audited zero charge with availability metadata, not fabricated tokens", () => {
    ledger.insertAttemptSync(db, { attemptId: "a", requestId: "request", apiKeyId: "key-a", ownerInstanceId: db.ownerInstanceId, startedAt: now(), provider: "fixture", model: "fixture", endpoint: "chat" });
    const unknown = ledger.finalizeAttemptSync(db, "a", { state: "unresolved", outcome: "aborted", finishedAt: now() });
    expect(() => project(db, "a")).toThrow(/Terminal/);
    ledger.resolveAttemptSync(db, "a", { action: "waive", expectedVersion: unknown.resolutionVersion, operationId: "waiver", actor: "admin", reason: "unknown explicitly waived", evidence: "operator reviewed" });
    project(db, "a"); const row = db.get("SELECT cost,tokens,meta FROM usageHistory");
    expect(row.cost).toBe(0); expect(JSON.parse(row.tokens)).toEqual({}); expect(JSON.parse(row.meta)).toMatchObject({ accountingState: "waived", usageAvailable: false, costNanoUsd: "0" });
  });
});
