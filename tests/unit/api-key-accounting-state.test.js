import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { seedRecoveryAccountingFixture } from './fixtures/accounting-recovery-db.js';
let db, dir, ledger, service, setupWork;
const originalDir = process.env.DATA_DIR;
const exact = { exact: true, input: 1000000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, reasoningIncludedInOutput: true };
const recovery = (version, extra = {}) => ({ action: "exact_usage", expectedVersion: version, operationId: "recovery", actor: "admin", reason: "Provider trace reviewed", evidence: "Exact token report", usage: exact, ...extra });
beforeEach(({ signal }) => {
  db = null; ledger = null; service = null;
  const ownedDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-recovery-"));
  dir = ownedDir; process.env.DATA_DIR = ownedDir; delete global._dbAdapter; vi.resetModules();
  setupWork = (async () => {
    let ownedDb;
    try {
      signal.throwIfAborted();
      const driver = await import("@/lib/db/driver.js"); signal.throwIfAborted();
      ownedDb = await driver.getAdapter(); signal.throwIfAborted();
      const ownedLedger = await import("@/lib/db/repos/apiKeyAccountingRepo.js"); signal.throwIfAborted();
      const ownedService = await import("@/lib/apiKeyBudget/service.js"); signal.throwIfAborted();
      seedRecoveryAccountingFixture(ownedDb, signal);
      // No shared fixture read across awaits; publish only current complete setup.
      db = ownedDb; ledger = ownedLedger; service = ownedService;
    } catch (error) { ownedDb?.close(); throw error; }
  })();
  return setupWork;
});
afterEach(async () => {
  // A timeout rejects Vitest's wrapper, not an ignored async hook. Drain this
  // captured setup before teardown/reset can admit a successor fixture.
  try { await setupWork; } catch { /* original setup failure already reported */ }
  vi.restoreAllMocks(); db?.close(); delete global._dbAdapter;
  fs.rmSync(dir, { recursive: true, force: true });
  if (originalDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = originalDir;
});
async function unknown() {
  const c = await service.createBudgetContext("key-a", { adapter: async () => db, clock: () => "2026-10-03T00:00:00.000Z" });
  const attempt = c.beginAttempt({ provider: "fixture", model: "fixture" });
  const row = c.completeAttempt(attempt, { outcome: "network_unknown" });
  return { c, attempt, row };
}
describe("audited original-snapshot exact usage recovery", { timeout: 20_000 }, () => {
  it("uses stored rates, projects once, replays across restart and forbids late overwrite", async () => {
    const { c, attempt, row } = await unknown();
    await (await import("@/lib/db/repos/pricingRepo.js")).updatePricing({ fixture: { fixture: { input: "99", output: "99" } } });
    const op = recovery(row.resolutionVersion);
    const settled = c.resolveAttempt(attempt.attemptId, op);
    expect(settled).toMatchObject({ state: "settled", costNanoUsd: "1000000000", usage: exact, manuallyResolved: 1 });
    expect(c.resolveAttempt(attempt.attemptId, op)).toEqual(settled);
    expect(db.all("SELECT * FROM usageHistory")).toHaveLength(1);
    expect(db.get("SELECT cost FROM usageHistory").cost).toBe(1);
    expect(() => c.completeAttempt(attempt, { usage: { ...exact, input: 2 }, outcome: "success" })).toThrow(/conflict/);
    expect(() => c.resolveAttempt(attempt.attemptId, recovery(row.resolutionVersion, { operationId: "other" }))).toThrow(/version/);
    db.close(); db = await (await import("@/lib/db/driver.js")).getAdapter();
    expect(ledger.resolveAttemptSync(db, attempt.attemptId, op)).toEqual(settled);
    expect(db.all("SELECT * FROM apiKeyAccountingAudit WHERE action='exact_usage'")).toHaveLength(1);
    expect(JSON.stringify(db.all("SELECT * FROM apiKeyAccountingAudit"))).not.toContain("recovery-secret");
  });
  it("invalid usage, caller cost, unexpected payload and missing snapshot never mutate", async () => {
    const { c, attempt, row } = await unknown();
    for (const extra of [{ usage: { ...exact, exact: false } }, { usage: { ...exact, input: -1 } }, { usage: { ...exact, cacheRead: 1000001 } }, { costNanoUsd: "0" }, { prompt: "secret prompt" }, { usage: { ...exact, providerResponse: "private" } }]) {
      expect(() => c.resolveAttempt(attempt.attemptId, recovery(row.resolutionVersion, extra))).toThrow();
      expect(ledger.getAttemptSync(db, attempt.attemptId)).toEqual(row);
      expect(db.all("SELECT * FROM apiKeyAccountingAudit")).toEqual([]);
    }
    db.durableTransaction(() => db.run("UPDATE apiKeyAccounting SET priceSnapshotJson=NULL WHERE attemptId=?", [attempt.attemptId]));
    expect(() => c.resolveAttempt(attempt.attemptId, recovery(row.resolutionVersion))).toThrow(/snapshot/);
    expect(ledger.getAttemptSync(db, attempt.attemptId).state).toBe("unresolved");
  });
  it("failed durable recovery is not acknowledged or projected", async () => {
    const { c, attempt, row } = await unknown();
    vi.spyOn(db, "durableTransaction").mockImplementation(() => { throw new Error("recovery disk failure"); });
    expect(() => c.resolveAttempt(attempt.attemptId, recovery(row.resolutionVersion))).toThrow(/disk failure/);
    vi.restoreAllMocks();
    expect(ledger.getAttemptSync(db, attempt.attemptId)).toEqual(row);
    expect(db.all("SELECT * FROM usageHistory")).toEqual([]);
    expect(db.all("SELECT * FROM apiKeyAccountingAudit")).toEqual([]);
  });
});
