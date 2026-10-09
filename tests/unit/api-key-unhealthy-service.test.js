import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createSqlJsAdapter } from "@/lib/db/adapters/sqljsAdapter.js";
import { acquireWriterOwnership } from "@/lib/db/writerOwnership.js";
import { runMigrationOnce } from "@/lib/db/migrate.js";
import { openAccountingCoverage } from "@/lib/db/accountingCoverage.js";
import { retainKeyBindings } from "@/lib/db/helpers/apiKeyBindings.js";
// Historical sidecar-first setup only; production entrypoint now refuses.
import { initializeExplicitPoliciesSync } from "../fixtures/legacy-policy-initialization.mjs";
import { createBudgetContext } from "@/lib/apiKeyBudget/service.js";
import { putPolicySync } from "@/lib/db/repos/apiKeyAccountingRepo.js";
let dir, file, owner, db;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-unhealthy-service-")); file = path.join(dir, "data.sqlite"); owner = acquireWriterOwnership(dir);
  db = await createSqlJsAdapter(file, owner); await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner); db.ownerInstanceId = owner.instanceId;
  db.durableTransaction(() => { db.run("INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES('key-a','service-proof-secret',1,'2026-10-03T00:00:00.000Z')"); retainKeyBindings(db, db.coverage, [{ id: "key-a", key: "service-proof-secret" }]); });
  initializeExplicitPoliciesSync(db); db.durableTransaction(() => db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')"));
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); owner?.release(); fs.rmSync(dir, { recursive: true, force: true }); });
function poison() {
  const rename = fs.renameSync;
  vi.spyOn(fs, "renameSync").mockImplementation((from, to) => { if (to === file) throw new Error("unhealthy fixture"); return rename(from, to); });
  expect(() => db.durableTransaction(() => db.run("UPDATE apiKeys SET name='not-persisted'"))).toThrow(/unhealthy fixture/); vi.restoreAllMocks();
}
const context = id => createBudgetContext(id === undefined ? "key-a" : id, { adapter: async () => db, clock: () => "2026-10-03T00:01:00.000Z" });
const input = { provider: "fixture", model: "fixture", endpoint: "chat" };
describe("inactive unhealthy unlimited begin boundary", { timeout: 20_000 }, () => {
  it("every begin proves fresh persisted policy and durably latches before opaque handle", async () => {
    const c = await context(); poison(); const read = vi.spyOn(db, "get"); const prove = vi.spyOn(db, "provePersistedUnlimited");
    expect(() => c.gate()).toThrow(/unavailable/); expect(prove).not.toHaveBeenCalled();
    const a = c.beginAttempt(input); const b = c.beginAttempt(input);
    expect(a.unrecorded).toBe(true); expect(a.attemptId).not.toBe(b.attemptId); expect(prove).toHaveBeenCalledTimes(2); expect(read).not.toHaveBeenCalled();
    expect(db.coverage.status("key-a").gaps).toHaveLength(1);
    const generation = db.coverage.status().generation;
    expect(c.completeAttempt(a, { usage: { exact: true } })).toMatchObject({ state: "unresolved", costNanoUsd: null, unrecorded: true });
    expect(c.completeAttempt(a)).toMatchObject({ unrecorded: true });
    expect(db.coverage.status().generation).toBeGreaterThan(generation);
    expect(() => c.completeAttempt({ ...a })).toThrow(/conflict/);
  });
  it("stale healthy gate cannot bypass a persisted restrictive policy", async () => {
    const c = await context(); c.gate(); putPolicySync(db, "key-a", { weeklyLimitNanoUsd: "1", monthlyLimitNanoUsd: null }, 0); poison();
    expect(() => c.beginAttempt(input)).toThrow(/unavailable/);
    expect(db.coverage.status().gaps).toEqual([]);
  });
  it("mutated generation after proof and cross-key proof deny before latch", async () => {
    const c = await context(); poison(); const original = db.provePersistedUnlimited.bind(db);
    vi.spyOn(db, "provePersistedUnlimited").mockImplementation((id, coverage) => { const proof = original(id, coverage); coverage.latchGap(id, "changed_after_proof"); return proof; });
    expect(() => c.beginAttempt(input)).toThrow(/unavailable/); vi.restoreAllMocks();
    vi.spyOn(db, "provePersistedUnlimited").mockImplementation((id, coverage) => ({ ...original(id, coverage), apiKeyId: "different-key" }));
    expect(() => c.beginAttempt(input)).toThrow(/unavailable/);
  });
  it("latch persisted then threw never returns a handle; terminal latch failure keeps admission gap", async () => {
    const c = await context(); poison(); const latch = db.coverage.latchGap.bind(db.coverage);
    vi.spyOn(db.coverage, "latchGap").mockImplementation((id, reason) => { latch(id, reason); throw new Error("lost latch ack"); });
    expect(() => c.beginAttempt(input)).toThrow(/unavailable/); vi.restoreAllMocks();
    expect(db.coverage.status().gaps).toHaveLength(1); const a = c.beginAttempt(input);
    vi.spyOn(db.coverage, "latchGap").mockImplementation(() => { throw new Error("terminal latch failed"); });
    expect(() => c.completeAttempt(a)).toThrow(/unavailable/); vi.restoreAllMocks();
    expect(db.coverage.status().gaps[0].resolvedAt).toBeUndefined();
  });
  it("closed storage and maintenance never enter the proof exception", async () => {
    const c = await context(); poison(); const proof = vi.spyOn(db, "provePersistedUnlimited");
    db.coverage.enterMaintenance("fixture maintenance");
    expect(() => c.beginAttempt(input)).toThrow(/unavailable/); expect(proof).not.toHaveBeenCalled();
    vi.restoreAllMocks(); db.close();
    expect(() => c.beginAttempt(input)).toThrow(/unavailable/);
  });
  it("healthy read failure never falls through to unlimited proof", async () => {
    const c = await context(); const proof = vi.spyOn(db, "provePersistedUnlimited");
    vi.spyOn(db, "get").mockImplementation(() => { throw new Error("healthy read failed"); });
    expect(() => c.beginAttempt(input)).toThrow(/unavailable/); expect(proof).not.toHaveBeenCalled();
  });
  it("unsupported adapter/no-key/unsupported endpoint and proof failures deny", async () => {
    const c = await context(); const local = await context(null); poison();
    expect(() => local.beginAttempt(input)).toThrow(/unavailable/);
    expect(() => c.beginAttempt({ ...input, endpoint: "image" })).toThrow(/unsupported/);
    vi.spyOn(db, "provePersistedUnlimited").mockImplementation(() => { throw new Error("proof failed"); });
    expect(() => c.beginAttempt(input)).toThrow(/unavailable/); vi.restoreAllMocks();
    db.provePersistedUnlimited = undefined; expect(() => c.beginAttempt(input)).toThrow(/unavailable/);
  });
});
