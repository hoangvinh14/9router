import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { nativeTransactions, verifyNativeDurability } from "@/lib/db/adapters/nativeDurability.js";
import { proveNativeUnlimited } from "@/lib/db/adapters/nativeAdmissionProof.js";
import { acquireWriterOwnership } from "@/lib/db/writerOwnership.js";
import { createNodeSqliteAdapter } from "@/lib/db/adapters/nodeSqliteAdapter.js";
import { runMigrationOnce } from "@/lib/db/migrate.js";
import { openAccountingCoverage } from "@/lib/db/accountingCoverage.js";
import { retainKeyBindings } from "@/lib/db/helpers/apiKeyBindings.js";
// Historical sidecar-first setup only; production entrypoint now refuses.
import { initializeExplicitPoliciesSync } from "../fixtures/legacy-policy-initialization.mjs";
import { createBudgetContext } from "@/lib/apiKeyBudget/service.js";
let dir, file, db, owner, raw, tx;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-native-proof-")); file = path.join(dir, "data.sqlite"); owner = acquireWriterOwnership(dir);
  db = await createNodeSqliteAdapter(file, owner); await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner);
  db.durableTransaction(() => { db.run("INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES('key-a','native-secret',1,'2026-10-03T00:00:00.000Z')"); retainKeyBindings(db, db.coverage, [{ id: "key-a", key: "native-secret" }]); });
  initializeExplicitPoliciesSync(db);
  db.durableTransaction(() => db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')"));
  raw = new DatabaseSync(file); verifyNativeDurability(raw); tx = nativeTransactions(raw, () => owner.assertOwned());
});
afterEach(() => { vi.restoreAllMocks(); raw?.close(); db?.close(); owner?.release(); fs.rmSync(dir, { recursive: true, force: true }); });
function poison({ commit = false, rollback = true } = {}) {
  const exec = raw.exec.bind(raw); let injected = false;
  vi.spyOn(raw, "exec").mockImplementation(sql => {
    if (!injected && sql.startsWith("RELEASE")) { injected = true; if (commit) exec(sql); throw new Error("uncertain release"); }
    if (!rollback && sql.startsWith("ROLLBACK")) throw new Error("uncertain rollback");
    return exec(sql);
  });
  expect(() => tx.durableTransaction(() => raw.exec("UPDATE apiKeyBudgetPolicies SET weeklyLimitNanoUsd=1,version=1 WHERE apiKeyId='key-a'"))).toThrow(/release/);
  vi.restoreAllMocks();
}
const proof = () => proveNativeUnlimited({ filePath: file, ...owner, transactions: tx, isTransaction: () => raw.isTransaction, openReader: () => new DatabaseSync(file, { readOnly: true }), coverage: db.coverage, apiKeyId: "key-a" });
describe("unused Node native quiescent WAL proof boundary", { timeout: 20_000 }, () => {
  it("verified rollback+checkpoint+new fsync reads committed unlimited, keeps writer poisoned", () => {
    poison({ rollback: false }); expect(raw.isTransaction).toBe(true);
    expect(proof().policyVersion).toBe(0); expect(raw.isTransaction).toBe(false);
    expect(tx.isHealthy()).toBe(false); expect(() => tx.assertUsable()).toThrow(/unhealthy/);
  });
  it("committed restrictive state survives lost acknowledgement and denies proof", () => {
    poison({ commit: true }); expect(raw.isTransaction).toBe(false);
    expect(() => proof()).toThrow(/unavailable/);
    expect(raw.prepare("SELECT weeklyLimitNanoUsd FROM apiKeyBudgetPolicies").get().weeklyLimitNanoUsd).toBe(1);
  });
  it("failed quiescence rollback denies even before checkpoint", () => {
    poison({ rollback: false }); vi.spyOn(raw, "exec").mockImplementation(() => { throw new Error("rollback failed"); });
    expect(() => proof()).toThrow(/rollback failed/);
  });
  it("a pinned reader prevents complete checkpoint and cannot authorize proof", () => {
    const reader = new DatabaseSync(file, { readOnly: true }); reader.exec("BEGIN"); reader.prepare("SELECT * FROM apiKeys").all();
    raw.exec("INSERT INTO kv(scope,key,value) VALUES('fixture','after-reader','1')"); poison();
    try { expect(() => proof()).toThrow(/checkpoint/); } finally { reader.exec("ROLLBACK"); reader.close(); }
  });
  it("file/directory fsync failure denies; unsupported transaction property denies", () => {
    poison(); vi.spyOn(fs, "fsyncSync").mockImplementation(() => { throw new Error("proof fsync failed"); });
    expect(() => proof()).toThrow(/fsync/); vi.restoreAllMocks();
    expect(() => tx.withQuiescentProof(() => undefined, () => true)).toThrow(/unavailable/);
  });
  it.each([false, true])("actual poisoned Node adapter validates installed state, commit=%s", commit => {
    const original = DatabaseSync.prototype.exec; let injected = false;
    vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (sql) {
      if (!injected && sql.startsWith("RELEASE")) { injected = true; if (commit) original.call(this, sql); throw new Error("adapter uncertain release"); }
      return original.call(this, sql);
    });
    expect(() => db.durableTransaction(() => db.run("UPDATE apiKeyBudgetPolicies SET weeklyLimitNanoUsd=1,version=1 WHERE apiKeyId='key-a'"))).toThrow(/uncertain release/);
    vi.restoreAllMocks(); expect(db.health().healthy).toBe(false);
    if (commit) expect(() => db.provePersistedUnlimited("key-a", db.coverage)).toThrow(/unavailable/);
    else expect(db.provePersistedUnlimited("key-a", db.coverage).policyVersion).toBe(0);
    expect(() => db.get("SELECT * FROM apiKeys")).toThrow(/unhealthy/);
  });
  it.each([false, true])("inactive service proves actual Node policy then latches, commit=%s", async commit => {
    db.ownerInstanceId = owner.instanceId;
    const context = await createBudgetContext("key-a", { adapter: async () => db, clock: () => "2026-10-03T00:01:00.000Z" });
    const original = DatabaseSync.prototype.exec; let injected = false;
    vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (sql) {
      if (!injected && sql.startsWith("RELEASE")) { injected = true; if (commit) original.call(this, sql); throw new Error("service uncertain release"); }
      return original.call(this, sql);
    });
    expect(() => db.durableTransaction(() => db.run("UPDATE apiKeyBudgetPolicies SET monthlyLimitNanoUsd=1,version=1 WHERE apiKeyId='key-a'"))).toThrow(/uncertain release/);
    vi.restoreAllMocks(); expect(() => context.gate()).toThrow(/unavailable/);
    if (commit) {
      expect(() => context.beginAttempt({ provider: "fixture", model: "fixture" })).toThrow(/unavailable/);
      expect(db.coverage.status().gaps).toEqual([]);
    } else {
      const attempt = context.beginAttempt({ provider: "fixture", model: "fixture" });
      expect(attempt).toMatchObject({ unrecorded: true, apiKeyId: "key-a", ownerInstanceId: owner.instanceId });
      expect(db.coverage.status().gaps).toHaveLength(1);
      expect(context.completeAttempt(attempt)).toMatchObject({ unrecorded: true, costNanoUsd: null, state: "unresolved" });
      expect(db.health().healthy).toBe(false);
    }
  });
  it("readonly reader cleanup failure cannot return a successful proof", () => {
    poison(); let closed = false;
    const openReader = () => {
      const reader = new DatabaseSync(file, { readOnly: true });
      return { exec: sql => reader.exec(sql), prepare: sql => reader.prepare(sql), close: () => { reader.close(); closed = true; throw new Error("reader close acknowledgement failed"); } };
    };
    expect(() => proveNativeUnlimited({ filePath: file, ...owner, transactions: tx, isTransaction: () => raw.isTransaction, openReader, coverage: db.coverage, apiKeyId: "key-a" })).toThrow(/close acknowledgement/);
    expect(closed).toBe(true); expect(tx.isHealthy()).toBe(false);
  });
  it("identity replacement after fsync is rejected and original file restored by fixture", () => {
    poison(); const replacement = path.join(dir, "replacement.sqlite"); const originalFile = path.join(dir, "original.sqlite");
    fs.copyFileSync(file, replacement); const fsync = fs.fsyncSync; let swapped = false;
    vi.spyOn(fs, "fsyncSync").mockImplementation(fd => {
      fsync(fd);
      if (!swapped) { swapped = true; fs.renameSync(file, originalFile); fs.renameSync(replacement, file); }
    });
    try { expect(() => proof()).toThrow(/file changed/); }
    finally { vi.restoreAllMocks(); fs.unlinkSync(file); fs.renameSync(originalFile, file); }
  });
  it("proof followed by durable gap survives subprocess SIGKILL and dead-owner restart", () => {
    const childDirectory = path.join(dir, "child");
    const fixture = fileURLToPath(new URL("../fixtures/unlimited-proof-child.mjs", import.meta.url));
    const crash = spawnSync(process.execPath, [fixture, childDirectory, "crash"], { encoding: "utf8", timeout: 15000 });
    expect(crash.signal, crash.stderr).toBe("SIGKILL");
    expect(crash.stdout).toContain('ACK:{"policyVersion":0,"gap":true}');
    const restart = spawnSync(process.execPath, [fixture, childDirectory, "inspect"], { encoding: "utf8", timeout: 15000 });
    expect(restart.status, restart.stderr).toBe(0);
    const result = JSON.parse(restart.stdout.split("\n").find(line => line.startsWith("RESULT:")).slice(7));
    expect(result).toMatchObject({ recovered: true, policy: { weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null, version: 0 } });
    expect(result.gaps).toHaveLength(1); expect(result.gaps[0].resolvedAt).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("fixture-only-secret");
  });
  it("adapter capability rejects healthy storage and never exposes raw recovery SQL", () => {
    expect(() => db.provePersistedUnlimited("key-a", db.coverage)).toThrow(/unavailable/);
    expect(db.health().healthy).toBe(true); expect(db.withQuiescentProof).toBeUndefined();
  });
});
