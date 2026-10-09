import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createSqlJsAdapter } from "@/lib/db/adapters/sqljsAdapter.js";
import { acquireWriterOwnership } from "@/lib/db/writerOwnership.js";
import { openAccountingCoverage } from "@/lib/db/accountingCoverage.js";
import { retainKeyBindings } from "@/lib/db/helpers/apiKeyBindings.js";
import { runMigrationOnce } from "@/lib/db/migrate.js";
import { createBudgetContext } from "@/lib/apiKeyBudget/service.js";
const usage = { exact: true, input: 1000000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, reasoningIncludedInOutput: true };
let dir, file, owner, db;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-service-sqljs-")); file = path.join(dir, "data.sqlite"); owner = acquireWriterOwnership(dir);
  db = await createSqlJsAdapter(file, owner); await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner); db.ownerInstanceId = owner.instanceId;
  db.durableTransaction(() => {
    db.run("INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES('key-a','fixture-secret',1,?)", ["2026-10-01T00:00:00.000Z"]);
    retainKeyBindings(db, db.coverage, [{ id: "key-a", key: "fixture-secret" }]);
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt',?)", ["2026-10-01T00:00:00.000Z"]);
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','fixture',?)", [JSON.stringify({ fixture: { input: "1", output: "2" } })]);
  });
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); owner?.release(); fs.rmSync(dir, { recursive: true, force: true }); });
const context = () => createBudgetContext("key-a", { adapter: async () => db, clock: () => "2026-10-03T00:00:00.000Z" });
// Disk fsync/import fixtures need a bounded local allowance under contention;
// do not raise the global runner timeout or relax durability assertions.
describe("real SQL.js service durability boundary", { timeout: 20_000 }, () => {
  it("uncertain intent rename failure poisons RAM but independent sidecar durably latches before exception", async () => {
    const c = await context(); const before = fs.readFileSync(file);
    const real = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => { if (to === file) throw new Error("intent rename failed"); return real(from, to); });
    expect(c.beginAttempt({ provider: "fixture", model: "fixture" }).unrecorded).toBe(true);
    expect(db.health().healthy).toBe(false); expect(fs.readFileSync(file)).toEqual(before);
    expect(db.coverage.status("key-a").gaps.some(g => !g.resolvedAt)).toBe(true);
    expect(() => c.beginAttempt({ provider: "fixture", model: "fixture" })).toThrow(/unavailable/); // already-poisoned proof gate still open
    vi.restoreAllMocks(); db.close();
    db = await createSqlJsAdapter(file, owner); db.coverage = openAccountingCoverage(db, owner); db.ownerInstanceId = owner.instanceId;
    expect(db.all("SELECT * FROM apiKeyAccounting")).toEqual([]);
    expect(db.coverage.status("key-a").gaps.some(g => !g.resolvedAt)).toBe(true);
    const restarted = await context(); expect(() => restarted.updatePolicy({ weeklyLimitUsd: "1", monthlyLimitUsd: null, expectedVersion: 0 })).toThrow(/unavailable/);
  });
  it("real intent+sidecar fsync failure never permits dispatch", async () => {
    const c = await context(); vi.spyOn(fs, "fsyncSync").mockImplementation(() => { throw new Error("all fsync failed"); });
    expect(() => c.beginAttempt({ provider: "fixture", model: "fixture" })).toThrow(/unavailable/);
  });
  it("budgeted failed settlement cannot read poisoned RAM or claim success", async () => {
    const c = await context(); c.updatePolicy({ weeklyLimitUsd: "2", monthlyLimitUsd: null, expectedVersion: 0 });
    const a = c.beginAttempt({ provider: "fixture", model: "fixture" }); const before = fs.readFileSync(file);
    const real = fs.renameSync; vi.spyOn(fs, "renameSync").mockImplementation((from, to) => { if (to === file) throw new Error("settlement rename failed"); return real(from, to); });
    expect(() => c.completeAttempt(a, { usage })).toThrow(/unavailable/);
    expect(db.health().healthy).toBe(false); expect(fs.readFileSync(file)).toEqual(before);
    expect(() => c.gate()).toThrow(/unavailable/);
    vi.restoreAllMocks(); db.close(); db = await createSqlJsAdapter(file, owner); db.coverage = openAccountingCoverage(db, owner);
    expect(db.get("SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?", [a.attemptId])).toMatchObject({ state: "pending", costNanoUsd: null });
    // Driver dead-owner recovery is tested separately; do not timeout-orphan a live owner here.
  });
  it("directory-fsync failure after rename is uncertain, not evidence of durable new policy", async () => {
    const c = await context(); c.gate(); let calls = 0; const actual = fs.fsyncSync;
    vi.spyOn(fs, "fsyncSync").mockImplementation(fd => { if (++calls === 2) throw new Error("directory fsync uncertain"); return actual(fd); });
    expect(() => c.updatePolicy({ weeklyLimitUsd: "1", monthlyLimitUsd: null, expectedVersion: 0 })).toThrow(/uncertain/);
    vi.restoreAllMocks();
    expect(db.health().healthy).toBe(false);
    expect(() => c.beginAttempt({ provider: "fixture", model: "fixture" })).toThrow(/unavailable/);
    // The renamed bytes may be readable but were not acknowledged durable;
    // the service must not authorize unlimited from either RAM or a new reader.
  });
});
