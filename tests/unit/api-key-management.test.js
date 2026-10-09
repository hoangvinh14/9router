import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
let db, dir, management, budget, accounting, recovery, gaps, token, repo;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-key-management-"));
  vi.stubEnv("DATA_DIR", dir); vi.stubEnv("JWT_SECRET", "isolated-key-management-secret-only"); delete global._dbAdapter; vi.resetModules();
  db = await (await import("@/lib/db/driver.js")).getAdapter();
  await (await import("@/lib/db/index.js")).importDb({ apiKeys: [{ id: "key-a", key: "secret-a", isActive: true }, { id: "key-b", key: "secret-b", isActive: true }] });
  management = await import("@/lib/apiKeyBudget/management.js"); repo = await import("@/lib/db/repos/apiKeyAccountingRepo.js");
  budget = await import("@/app/api/keys/[id]/budget/route.js"); accounting = await import("@/app/api/keys/[id]/accounting/route.js");
  recovery = await import("@/app/api/keys/[id]/accounting/[attemptId]/resolve/route.js"); gaps = await import("@/app/api/keys/[id]/accounting/gaps/resolve/route.js");
  token = await (await import("@/lib/auth/dashboardSession.js")).createDashboardAuthToken();
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; vi.unstubAllEnvs(); fs.rmSync(dir, { recursive: true, force: true }); });
function request(method = "GET", body, { authenticated = true, origin = "http://localhost:20128", query = "" } = {}) {
  const headers = { host: "localhost:20128", origin }; if (authenticated) headers.cookie = `auth_token=${token}`;
  return new NextRequest(`http://localhost:20128/api/keys/key-a/budget${query}`, { method, headers, ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}) });
}
const context = (id = "key-a", attemptId = "attempt-a") => ({ params: Promise.resolve({ id, attemptId }) });
function attempt(id = "attempt-a", key = "key-a") {
  repo.insertAttemptSync(db, { attemptId: id, requestId: "request-a", apiKeyId: key, ownerInstanceId: "fixture", provider: "fixture", model: "fixture", endpoint: "chat", startedAt: "2026-10-03T00:00:00.000Z", connectionId: "private-connection", priceSnapshot: { rates: { input: "1", output: "2" }, hidden: "private-snapshot" } });
  return repo.finalizeAttemptSync(db, id, { state: "unresolved", outcome: "failed", costNanoUsd: null, usage: null, terminal: { secret: "terminal-secret" }, finishedAt: "2026-10-03T00:01:00.000Z" });
}
describe("inactive privileged budget/accounting HTTP preparation", () => {
  it("authorization precedes storage/body, requires dashboard not gateway; mutation exact origin", async () => {
    const read = vi.spyOn(db, "all");
    expect((await accounting.GET(request("GET", undefined, { authenticated: false }), context())).status).toBe(401); expect(read).not.toHaveBeenCalled();
    const body = { weeklyLimitUsd: null, monthlyLimitUsd: null, expectedVersion: 0 };
    expect((await budget.PUT(request("PUT", body, { origin: "https://attacker.example" }), context())).status).toBe(403);
    expect(db.get("SELECT * FROM apiKeyBudgetPolicies WHERE apiKeyId='key-a'")).toBeUndefined();
  });
  it("observational status explicitly inactive, no ledger/default-policy init or secret exposure", async () => {
    const response = await budget.GET(request(), context()); expect(response.status).toBe(200);
    const result = await response.json(); expect(result).toMatchObject({ apiKeyId: "key-a", enforcementActive: false, ledgerStartedAt: null, explicitPolicyReady: false, status: "inactive", version: 0, weekly: { spentUsd: "0", limitUsd: null, remainingUsd: null, overshootUsd: "0" } });
    expect(JSON.stringify(result)).not.toMatch(/secret-a|bindingKeyId|fingerprint/);
    expect(db.get("SELECT * FROM apiKeyBudgetPolicies")).toBeUndefined(); expect(db.get("SELECT * FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined();
  });
  it("valid restricted edit rejected without writes, timestamp alone no activation; unlimited CAS allowed", async () => {
    for (const limit of ["0", "2.000000001"]) {
      const r = await budget.PUT(request("PUT", { weeklyLimitUsd: limit, monthlyLimitUsd: null, expectedVersion: 0 }), context());
      expect(r.status).toBe(409); expect((await r.json()).code).toBe("accounting_not_ready");
      expect(db.get("SELECT * FROM apiKeyBudgetPolicies")).toBeUndefined(); expect(db.all("SELECT * FROM apiKeyAccountingAudit")).toEqual([]);
    }
    db.durableTransaction(() => db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-01T00:00:00.000Z')"));
    expect((await budget.PUT(request("PUT", { weeklyLimitUsd: "1", monthlyLimitUsd: null, expectedVersion: 0 }), context())).status).toBe(409);
    const success = await budget.PUT(request("PUT", { weeklyLimitUsd: null, monthlyLimitUsd: null, expectedVersion: 0 }), context()); expect(success.status).toBe(200); expect((await success.json()).version).toBe(1);
    expect((await budget.PUT(request("PUT", { weeklyLimitUsd: null, monthlyLimitUsd: null, expectedVersion: 0 }), context())).status).toBe(409);
  });
  it("lexical limits/version/body strict before mutation; oversized actual body rejected", async () => {
    const base = { weeklyLimitUsd: null, monthlyLimitUsd: null, expectedVersion: 0 };
    for (const body of [{ ...base, weeklyLimitUsd: 1 }, { ...base, weeklyLimitUsd: "0.0000000001" }, { ...base, actor: "attacker" }, { ...base, expectedVersion: -1 }, {}, null, "{", " ".repeat(16385)]) {
      expect((await budget.PUT(request("PUT", body), context())).status).toBe(400);
    }
    expect(db.get("SELECT * FROM apiKeyBudgetPolicies")).toBeUndefined();
  });
  it("ledger listing unknown cost stays null, safe projection scope/pagination, deleted identity retained", async () => {
    attempt(); attempt("attempt-b"); attempt("foreign", "key-b");
    const response = await accounting.GET(request("GET", undefined, { query: "?limit=1&state=unresolved" }), context()); expect(response.status).toBe(200);
    const result = await response.json(); expect(result.attempts).toHaveLength(1); expect(result.nextCursor).toBe("attempt-a"); expect(result.attempts[0]).toMatchObject({ costUsd: null, state: "unresolved" });
    expect(JSON.stringify(result)).not.toMatch(/private-|snapshot|connectionId|ownerInstanceId|terminal-secret|secret-a/);
    const next = await management.listAccountingManagement("key-a", { afterAttemptId: result.nextCursor }); expect(next.attempts.map(a => a.attemptId)).toEqual(["attempt-b"]);
    for (const query of ["?limit=201", "?limit=01", "?state=bad", "?limit=1&limit=2", "?secret=yes"]) expect((await accounting.GET(request("GET", undefined, { query }), context())).status).toBe(400);
    await (await import("@/lib/db/repos/apiKeysRepo.js")).deleteApiKey("key-a");
    expect((await management.getBudgetManagement("key-a")).retired).toBe(true); expect((await management.listAccountingManagement("key-a")).attempts).toHaveLength(2);
    expect((await budget.PUT(request("PUT", { weeklyLimitUsd: null, monthlyLimitUsd: null, expectedVersion: 0 }), context())).status).toBe(409);
  });
  it("recovery original-price, server actor, exact usage, idempotent audit/projection, conflicts and wrong-key404", async () => {
    expect(attempt().resolutionVersion).toBe(1);
    const body = { action: "exact_usage", operationId: "recover-a", expectedVersion: 1, reason: "reviewed", evidence: "exact provider usage", usage: { exact: true, input: 1000000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, reasoningIncludedInOutput: true } };
    expect((await recovery.POST(request("POST", body), context("key-b"))).status).toBe(404);
    expect((await recovery.POST(request("POST", { ...body, actor: "attacker" }), context())).status).toBe(400);
    for (let n = 0; n < 2; n++) {
      const r = await recovery.POST(request("POST", body), context()); expect(r.status).toBe(200); expect(await r.json()).toMatchObject({ costUsd: "1", state: "settled", resolutionVersion: 2, manuallyResolved: true, recoveryReceipt: { version: 1, operationId: "recover-a", apiKeyId: "key-a", targetId: "attempt-a", kind: "attempt", action: "exact_usage", resolutionVersion: 2, state: "settled", costUsd: "1" } });
    }
    expect(db.all("SELECT actor FROM apiKeyAccountingAudit")).toEqual([{ actor: "dashboard-session" }]);
    const before = repo.getAttemptSync(db, "attempt-a");
    const late = { state: "settled", outcome: "late", costNanoUsd: "7", finishedAt: "2026-10-03T00:02:00.000Z" };
    expect(() => repo.finalizeAttemptSync(db, "attempt-a", late)).toThrow("Settlement requires cost and exact usage");
    expect(db.all("SELECT * FROM apiKeyAccountingAudit")).toHaveLength(1);
    const validLate = { ...late, usage: body.usage };
    expect(() => repo.finalizeAttemptSync(db, "attempt-a", validLate)).toThrow(/conflict/i);
    expect(repo.getAttemptSync(db, "attempt-a")).toEqual(before);
    const observations = db.all("SELECT * FROM apiKeyAccountingAudit WHERE action='observation_conflict'");
    expect(observations).toHaveLength(1);
    expect(JSON.parse(observations[0].beforeJson)).toEqual(before);
    expect(JSON.parse(observations[0].afterJson)).toEqual(validLate);
    const replay = await (await recovery.POST(request("POST", body), context())).json();
    expect(replay.recoveryReceipt).toMatchObject({ operationId: "recover-a", resolutionVersion: 2, costUsd: "1" });
    expect(JSON.stringify(replay.recoveryReceipt)).not.toMatch(/reviewed|provider usage|actor|snapshot|secret/);
    expect(db.all("SELECT * FROM kv WHERE scope='accountingProjection'")).toHaveLength(1);
    expect((await recovery.POST(request("POST", { ...body, evidence: "changed" }), context())).status).toBe(409);
    expect((await budget.PUT(request("PUT", { weeklyLimitUsd: null, monthlyLimitUsd: null, expectedVersion: 0 }), context())).status).toBe(200);
    expect(repo.getAttemptSync(db, "attempt-a").costNanoUsd).toBe("1000000000");
    const audit = db.get("SELECT * FROM apiKeyAccountingAudit"); expect(audit.afterJson).not.toContain("attacker");
  });
  it("key gap waiver cannot reconcile global/wrong-key gap, audits and preserves limits/ledger", async () => {
    db.coverage.latchGap(null, "global uncertainty"); db.coverage.latchGap("key-a", "key uncertainty");
    const state = db.coverage.status("key-a"), gap = state.gaps.find(g => g.apiKeyId === "key-a"), globalGap = state.gaps.find(g => g.apiKeyId === null);
    const body = { gapId: gap.id, expectedGeneration: gap.generation, operationId: "gap-a", reason: "reviewed", evidence: "explicit waiver" };
    expect((await gaps.POST(request("POST", { ...body, gapId: globalGap.id }), context())).status).toBe(404);
    expect((await gaps.POST(request("POST", body), context("key-b"))).status).toBe(404);
    const acknowledged = await gaps.POST(request("POST", body), context()); expect(acknowledged.status).toBe(200);
    expect((await acknowledged.json()).recoveryReceipt).toEqual({ version: 1, operationId: "gap-a", apiKeyId: "key-a", kind: "gap", targetId: gap.id, action: "coverage_waiver", generation: gap.generation });
    const replay = await gaps.POST(request("POST", body), context()); expect(replay.status).toBe(200); expect((await replay.json()).recoveryReceipt.operationId).toBe("gap-a");
    expect(db.coverage.status().gaps.find(g => g.id === globalGap.id).resolvedAt).toBeUndefined();
    expect(db.get("SELECT actor FROM apiKeyAccountingAudit").actor).toBe("dashboard-session");
    expect((await gaps.POST(request("POST", { ...body, expectedGeneration: gap.generation + 1 }), context())).status).toBe(409);
  });
  it("policy guard lives in one outer durable transaction, rejects async and failure never reports success", async () => {
    const transaction = vi.spyOn(db, "durableTransaction");
    let guarded = false;
    repo.putPolicySync(db, "key-a", { weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null }, 0, () => { guarded = true; });
    expect(guarded).toBe(true); expect(transaction).toHaveBeenCalledTimes(1);
    const denial = Object.assign(new Error("scope guard"), { status: 409 });
    expect(() => repo.putPolicySync(db, "key-a", { weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null }, 1, () => { throw denial; })).toThrow(denial);
    expect(repo.getPolicySync(db, "key-a").version).toBe(1);
    expect(() => repo.putPolicySync(db, "key-a", { weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null }, 1, async () => {})).toThrow(/synchronous/);
    expect(() => repo.putPolicySync(db, "key-a", { weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null }, 1, () => Promise.resolve())).toThrow(/synchronous/);
    transaction.mockImplementation(() => { throw new Error("private commit failure"); });
    expect((await budget.PUT(request("PUT", { weeklyLimitUsd: null, monthlyLimitUsd: null, expectedVersion: 1 }), context())).status).toBe(503);
    expect(repo.getPolicySync(db, "key-a").version).toBe(1);
  });
  it("recovery persistence failure is redacted503, projection failure keeps committed result and replay repairs", async () => {
    expect(attempt().resolutionVersion).toBe(1);
    const body = { action: "waive", expectedVersion: 1, operationId: "waive-a", reason: "reviewed", evidence: "explicit waiver" };
    const durable = db.durableTransaction.bind(db);
    const transaction = vi.spyOn(db, "durableTransaction").mockImplementation(() => { throw new Error("private commit failure"); });
    const failed = await recovery.POST(request("POST", body), context()); expect(failed.status).toBe(503);
    expect(repo.getAttemptSync(db, "attempt-a").state).toBe("unresolved");
    let calls = 0;
    transaction.mockImplementation(fn => { if (++calls === 2) throw new Error("analytics failure"); return durable(fn); });
    const success = await recovery.POST(request("POST", body), context()); expect(success.status).toBe(200);
    expect(repo.getAttemptSync(db, "attempt-a")).toMatchObject({ state: "waived", costNanoUsd: "0", resolutionVersion: 2 });
    expect(db.all("SELECT * FROM kv WHERE scope='accountingProjection'")).toHaveLength(0);
    transaction.mockImplementation(durable);
    expect((await recovery.POST(request("POST", body), context())).status).toBe(200);
    expect(db.all("SELECT * FROM kv WHERE scope='accountingProjection'")).toHaveLength(1);
    expect(db.all("SELECT * FROM apiKeyAccountingAudit")).toHaveLength(1);
    expect(repo.getAttemptSync(db, "attempt-a").resolutionVersion).toBe(2);
  });
  it("usage HTTP page breakdown distinguishes unknown from zero, no cross-key/current pricing aggregation", async () => {
    attempt(); attempt("attempt-b"); attempt("foreign", "key-b");
    repo.resolveAttemptSync(db, "attempt-a", { action: "cost_correction", expectedVersion: 1, operationId: "usage-cost-a", actor: "fixture-admin", reason: "provider proof", evidence: "exact invoice", costNanoUsd: "1000000001" });
    const usageRoute = await import("@/app/api/keys/[id]/usage/route.js");
    const response = await usageRoute.GET(request(), context()); expect(response.status).toBe(200);
    const page = await response.json();
    expect(page).toMatchObject({ aggregateScope: "page", virtualReference: true, breakdown: [{ attempts: 2, chargedAttempts: 1, unresolved: 1, pending: 0, knownCostUsd: "1.000000001", totalCostUsd: null }] });
    expect(page.attempts.map(row => row.attemptId)).toEqual(["attempt-a", "attempt-b"]);
    expect(JSON.stringify(page)).not.toMatch(/secret-a|private-|connectionId|snapshot/);
    const bounded = await usageRoute.GET(request("GET", undefined, { query: "?limit=1" }), context());
    expect(await bounded.json()).toMatchObject({ nextCursor: "attempt-a", aggregateScope: "page", breakdown: [{ attempts: 1, knownCostUsd: "1.000000001", totalCostUsd: "1.000000001" }] });
    expect((await usageRoute.GET(request("GET", undefined, { authenticated: false }), context())).status).toBe(401);
  });
  it("usage separates provider/model/endpoint, pending unknown, exactzero and waiver explicitzero", async () => {
    const insert = (id, provider, model, endpoint) => repo.insertAttemptSync(db, { attemptId: id, requestId: "request", apiKeyId: "key-a", ownerInstanceId: "fixture", provider, model, endpoint, startedAt: "2026-10-03T00:00:00.000Z" });
    insert("pending", "p", "m", "chat");
    insert("zero", "p", "m", "embeddings");
    repo.finalizeAttemptSync(db, "zero", { state: "settled", outcome: "success", finishedAt: "2026-10-03T00:01:00.000Z", costNanoUsd: "0", usage: { exact: true, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, reasoningIncludedInOutput: true } });
    insert("waived", "other", "m", "chat");
    repo.finalizeAttemptSync(db, "waived", { state: "unresolved", outcome: "failed", finishedAt: "2026-10-03T00:01:00.000Z", costNanoUsd: null });
    repo.resolveAttemptSync(db, "waived", { action: "waive", expectedVersion: 1, operationId: "waive-usage", actor: "fixture", reason: "reviewed", evidence: "explicit zero waiver" });
    const result = await management.getUsageManagement("key-a"); expect(result.breakdown).toHaveLength(3);
    expect(result.breakdown.find(g => g.endpoint === "embeddings")).toMatchObject({ chargedAttempts: 1, totalCostUsd: "0", knownCostUsd: "0" });
    expect(result.breakdown.find(g => g.provider === "other")).toMatchObject({ chargedAttempts: 1, totalCostUsd: "0" });
    expect(result.breakdown.find(g => g.provider === "p" && g.endpoint === "chat")).toMatchObject({ pending: 1, chargedAttempts: 0, totalCostUsd: null, knownCostUsd: "0" });
  });
  it("maintenance read diagnostic, mutations deny; unavailable errors redacted no-store", async () => {
    db.coverage.enterMaintenance("operator fixture"); expect((await management.getBudgetManagement("key-a")).status).toBe("maintenance");
    expect((await budget.PUT(request("PUT", { weeklyLimitUsd: null, monthlyLimitUsd: null, expectedVersion: 0 }), context())).status).toBe(503);
    vi.spyOn(db, "health").mockImplementation(() => { throw new Error("private/path secret-a"); });
    const r = await budget.GET(request(), context()); expect(r.status).toBe(503); expect(r.headers.get("cache-control")).toBe("no-store"); expect(JSON.stringify(await r.json())).not.toMatch(/private\/path|secret-a/);
  });
});
