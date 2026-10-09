import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createSqlJsAdapter } from "@/lib/db/adapters/sqljsAdapter.js";
import { acquireWriterOwnership } from "@/lib/db/writerOwnership.js";
import { openAccountingCoverage } from "@/lib/db/accountingCoverage.js";
import { retainKeyBindings } from "@/lib/db/helpers/apiKeyBindings.js";
import { runMigrationOnce } from "@/lib/db/migrate.js";
import { putPolicySync } from "@/lib/db/repos/apiKeyAccountingRepo.js";
// Historical sidecar-first setup only; production entrypoint now refuses.
import { initializeExplicitPoliciesSync } from "../fixtures/legacy-policy-initialization.mjs";
let dir, file, owner, db;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-proof-")); file = path.join(dir, "data.sqlite"); owner = acquireWriterOwnership(dir);
  db = await createSqlJsAdapter(file, owner); await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner);
  db.durableTransaction(() => {
    db.run("INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES('key-a','proof-secret',1,'2026-10-01T00:00:00.000Z')");
    retainKeyBindings(db, db.coverage, [{ id: "key-a", key: "proof-secret" }]);
  });
  initializeExplicitPoliciesSync(db);
  db.durableTransaction(() => db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-01T00:00:00.000Z')"));
  putPolicySync(db, "key-a", { weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null }, 0);
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); owner?.release(); fs.rmSync(dir, { recursive: true, force: true }); });
function poisonBeforeRename() {
  const real = fs.renameSync;
  vi.spyOn(fs, "renameSync").mockImplementation((from, to) => { if (to === file) throw new Error("failed rename"); return real(from, to); });
  expect(() => db.durableTransaction(() => db.run("INSERT INTO kv(scope,key,value) VALUES('fixture','poison','1')"))).toThrow(/rename/);
  vi.restoreAllMocks();
}
describe("inactive SQL.js fresh durable unlimited proof", { timeout: 20_000 }, () => {
  it("reads acknowledged installed image, not poisoned RAM, and never resurrects export on close", async () => {
    poisonBeforeRename(); const before = fs.readFileSync(file);
    expect(db.provePersistedUnlimited("key-a", db.coverage)).toMatchObject({ apiKeyId: "key-a", policyVersion: 1 });
    expect(db.health().healthy).toBe(false); expect(() => db.get("SELECT * FROM apiKeys")).toThrow(/unhealthy/);
    db.coverage.latchGap("key-a", "proof_fixture_gap");
    db.close(); expect(fs.readFileSync(file)).toEqual(before);
    db = await createSqlJsAdapter(file, owner); db.coverage = openAccountingCoverage(db, owner);
    expect(db.get("SELECT * FROM kv WHERE scope='fixture'")).toBeUndefined();
    expect(db.coverage.status("key-a").gaps).toHaveLength(1);
  });
  it("after uncertain renamed restriction, new barrier cannot authorize old unlimited policy", () => {
    let calls = 0; const actual = fs.fsyncSync;
    vi.spyOn(fs, "fsyncSync").mockImplementation(fd => { if (++calls === 2) throw new Error("directory uncertain"); return actual(fd); });
    expect(() => putPolicySync(db, "key-a", { weeklyLimitNanoUsd: "1", monthlyLimitNanoUsd: null }, 1)).toThrow(/uncertain/);
    vi.restoreAllMocks();
    expect(() => db.provePersistedUnlimited("key-a", db.coverage)).toThrow(/unavailable/);
  });
  it("requires fresh file AND directory fsync acknowledgement", () => {
    poisonBeforeRename();
    for (const failureAt of [1, 2]) {
      let calls = 0; const actual = fs.fsyncSync;
      vi.spyOn(fs, "fsyncSync").mockImplementation(fd => { if (++calls === failureAt) throw new Error("proof fsync failure"); return actual(fd); });
      expect(() => db.provePersistedUnlimited("key-a", db.coverage)).toThrow(/fsync/);
      vi.restoreAllMocks();
    }
  });
  it("explicit persisted unlimited may be reproved after failed restrictive write before rename", () => {
    const real = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => { if (to === file) throw new Error("policy not installed"); return real(from, to); });
    expect(() => putPolicySync(db, "key-a", { weeklyLimitNanoUsd: "1", monthlyLimitNanoUsd: null }, 1)).toThrow(/not installed/);
    vi.restoreAllMocks();
    // Failed update was never acknowledged effective; installed durable version
    // remains authoritative. No caller may claim the restriction was committed.
    expect(db.provePersistedUnlimited("key-a", db.coverage).policyVersion).toBe(1);
  });
  it("missing policy is not implicitly certified unlimited", () => {
    db.durableTransaction(() => db.run("DELETE FROM apiKeyBudgetPolicies")); poisonBeforeRename();
    expect(() => db.provePersistedUnlimited("key-a", db.coverage)).toThrow(/unavailable/);
  });
  it("durably disabled key cannot use existing request-local identity", () => {
    db.durableTransaction(() => db.run("UPDATE apiKeys SET isActive=0 WHERE id='key-a'")); poisonBeforeRename();
    expect(() => db.provePersistedUnlimited("key-a", db.coverage)).toThrow(/unavailable/);
  });
  it("sidecar retirement or maintenance denies without relying on poisoned DB", () => {
    poisonBeforeRename(); db.coverage.enterMaintenance("fixture");
    expect(() => db.provePersistedUnlimited("key-a", db.coverage)).toThrow(/unavailable/);
  });
  it("retired binding rejects an otherwise active persisted key", () => {
    const fingerprint = db.coverage.fingerprint("proof-secret");
    db.coverage.retainRetiredBinding("key-a", fingerprint); poisonBeforeRename();
    expect(() => db.provePersistedUnlimited("key-a", db.coverage)).toThrow(/unavailable/);
  });
  it.each([
    ["schema version", "UPDATE _meta SET value='999' WHERE key='schemaVersion'"],
    ["missing activation", "DELETE FROM _meta WHERE key='ledgerStartedAt'"],
    ["malformed activation", "UPDATE _meta SET value='not-a-date' WHERE key='ledgerStartedAt'"],
    ["coverage ID", "UPDATE _meta SET value='wrong' WHERE key='accountingCoverageId'"],
    ["binding key ID", "UPDATE _meta SET value='wrong' WHERE key='accountingBindingKeyId'"],
    ["missing binding", "DELETE FROM apiKeyBindings"],
    ["changed secret", "UPDATE apiKeys SET key='different-secret' WHERE id='key-a'"],
    ["retired database binding", "UPDATE apiKeyBindings SET retiredAt='2026-10-03T00:00:00.000Z'"],
    ["weekly zero", "UPDATE apiKeyBudgetPolicies SET weeklyLimitNanoUsd=0"],
    ["monthly restriction", "UPDATE apiKeyBudgetPolicies SET monthlyLimitNanoUsd=1"],
    ["invalid policy version", "UPDATE apiKeyBudgetPolicies SET version=-1"],
    ["version0 restriction", "UPDATE apiKeyBudgetPolicies SET version=0,weeklyLimitNanoUsd=1"],
    ["missing policy format", "DELETE FROM _meta WHERE key='accountingPolicyFormat'"],
    ["unknown policy format", "UPDATE _meta SET value='999' WHERE key='accountingPolicyFormat'"],
  ])("rejects persisted %s without mutating the image", (_label, sql) => {
    db.durableTransaction(() => db.run(sql)); poisonBeforeRename();
    const before = fs.readFileSync(file);
    expect(() => db.provePersistedUnlimited("key-a", db.coverage)).toThrow(/unavailable/);
    expect(fs.readFileSync(file)).toEqual(before);
  });
  it("new acknowledgement can prove a renamed unlimited transition, never heal poisoned adapter", () => {
    putPolicySync(db, "key-a", { weeklyLimitNanoUsd: "1", monthlyLimitNanoUsd: null }, 1);
    let calls = 0; const actual = fs.fsyncSync;
    vi.spyOn(fs, "fsyncSync").mockImplementation(fd => { if (++calls === 2) throw new Error("directory uncertain"); return actual(fd); });
    expect(() => putPolicySync(db, "key-a", { weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null }, 2)).toThrow(/uncertain/);
    vi.restoreAllMocks();
    expect(db.provePersistedUnlimited("key-a", db.coverage).policyVersion).toBe(3);
    expect(db.health().healthy).toBe(false);
  });
  it("failed unlimited transition before rename retains restrictive persisted policy", () => {
    putPolicySync(db, "key-a", { weeklyLimitNanoUsd: "1", monthlyLimitNanoUsd: null }, 1);
    const real = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => { if (to === file) throw new Error("policy not installed"); return real(from, to); });
    expect(() => putPolicySync(db, "key-a", { weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null }, 2)).toThrow(/not installed/);
    vi.restoreAllMocks();
    expect(() => db.provePersistedUnlimited("key-a", db.coverage)).toThrow(/unavailable/);
  });
  it("coverage generation change inside proof invalidates its result", () => {
    poisonBeforeRename(); const original = db.coverage.status.bind(db.coverage); let calls = 0;
    vi.spyOn(db.coverage, "status").mockImplementation(id => {
      if (++calls === 2) db.coverage.latchGap("key-a", "generation_changed");
      return original(id);
    });
    expect(() => db.provePersistedUnlimited("key-a", db.coverage)).toThrow(/unavailable/);
  });
  it("proof success alone cannot acknowledge a failed independent gap latch", () => {
    poisonBeforeRename(); expect(db.provePersistedUnlimited("key-a", db.coverage).apiKeyId).toBe("key-a");
    vi.spyOn(fs, "fsyncSync").mockImplementation(() => { throw new Error("gap latch not durable"); });
    expect(() => db.coverage.latchGap("key-a", "continuation_requires_latch")).toThrow(/not durable/);
    vi.restoreAllMocks();
    expect(() => db.provePersistedUnlimited("key-a", db.coverage)).toThrow(/unavailable/);
  });
  it("explicit version0 default is proven only with matching retained format markers", () => {
    db.durableTransaction(() => db.run("UPDATE apiKeyBudgetPolicies SET version=0")); poisonBeforeRename();
    expect(db.provePersistedUnlimited("key-a", db.coverage).policyVersion).toBe(0);
  });
  it("ownership loss never authorizes proof", () => {
    poisonBeforeRename(); const record = fs.readFileSync(owner.lockPath); fs.unlinkSync(owner.lockPath);
    try { expect(() => db.provePersistedUnlimited("key-a", db.coverage)).toThrow(); }
    finally { fs.writeFileSync(owner.lockPath, record); }
  });
  it("missing coverage never silently initializes clean", () => {
    poisonBeforeRename(); fs.unlinkSync(db.coverage.file);
    expect(() => db.provePersistedUnlimited("key-a", db.coverage)).toThrow(/unavailable/);
  });
});
