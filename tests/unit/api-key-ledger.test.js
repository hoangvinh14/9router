import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
let dir, db, repo;
const original = process.env.DATA_DIR;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-ledger-"));
  process.env.DATA_DIR = dir;
  delete global._dbAdapter;
  vi.resetModules();
  db = await (await import("@/lib/db/driver.js")).getAdapter();
  repo = await import("@/lib/db/repos/apiKeyAccountingRepo.js");
});
afterEach(() => {
  db?.close(); delete global._dbAdapter;
  fs.rmSync(dir, { recursive: true, force: true });
  if (original === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = original;
});
const intent = (id = "attempt-1") => ({ attemptId: id, requestId: "request-1", apiKeyId: "key-1", ownerInstanceId: "owner-1", startedAt: "2026-10-03T00:00:00.000Z", provider: "openai", model: "test", endpoint: "chat", priceSnapshot: { input: "1", output: "2" } });
// Real durable writes/imports can exceed the default 5s body timeout on a
// contended disk. Keep a finite suite-local bound; ownership assertions remain
// strict, and this does not make teardown of timed-out async work safe.
describe("durable API key ledger", { timeout: 20_000 }, () => {
  it("SQL.js real foundation migration/backup/sidecar round-trip independently preserves every accounting table", async () => {
    db.close();
    const { createSqlJsAdapter } = await import("@/lib/db/adapters/sqljsAdapter.js");
    const { acquireWriterOwnership } = await import("@/lib/db/writerOwnership.js");
    const { openAccountingCoverage } = await import("@/lib/db/accountingCoverage.js");
    const { runMigrationOnce } = await import("@/lib/db/migrate.js");
    const { retainKeyBindings } = await import("@/lib/db/helpers/apiKeyBindings.js");
    const { backupDbLite } = await import("@/lib/db/backup.js");
    const owner = acquireWriterOwnership(dir);
    const sql = await createSqlJsAdapter(path.join(dir, "db", "data.sqlite"), owner);
    try {
      await runMigrationOnce(sql);
      sql.coverage = openAccountingCoverage(sql, owner);
      sql.durableTransaction(() => retainKeyBindings(sql, sql.coverage, [{ id: "key-1", key: "sqljs-secret" }]));
      repo.putPolicySync(sql, "key-1", { weeklyLimitNanoUsd: "50", monthlyLimitNanoUsd: "100" }, 0);
      repo.insertAttemptSync(sql, intent());
      repo.finalizeAttemptSync(sql, "attempt-1", { state: "unresolved", outcome: "aborted", finishedAt: "2026-10-03T00:01:00.000Z" });
      repo.resolveAttemptSync(sql, "attempt-1", { action: "cost_correction", costNanoUsd: "17", expectedVersion: 1, operationId: "sqljs-correction", actor: "admin", reason: "evidence checked", evidence: "provider trace" });
      sql.coverage.latchGap("key-1", "simulated outage");
      const backupDir = path.join(dir, "sqljs-backup"); fs.mkdirSync(backupDir);
      const file = backupDbLite(sql, backupDir);
      const { DatabaseSync } = await import("node:sqlite");
      const reader = new DatabaseSync(file, { readOnly: true });
      try {
        expect(reader.prepare("PRAGMA integrity_check").get().integrity_check).toBe("ok");
        expect(reader.prepare("SELECT costNanoUsd FROM apiKeyAccounting").get().costNanoUsd).toBe(17);
        expect(reader.prepare("SELECT weeklyLimitNanoUsd,monthlyLimitNanoUsd FROM apiKeyBudgetPolicies").get()).toMatchObject({ weeklyLimitNanoUsd: 50, monthlyLimitNanoUsd: 100 });
        expect(reader.prepare("SELECT action FROM apiKeyAccountingAudit").get().action).toBe("cost_correction");
        expect(reader.prepare("SELECT value FROM _meta WHERE key='accountingCoverageId'").get().value).toBe(sql.coverage.status().id);
        expect(reader.prepare("SELECT fingerprint FROM apiKeyBindings").get().fingerprint).toMatch(/^[a-f0-9]{64}$/);
        expect(reader.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='accounting_audit_no_delete'").get()).toBeDefined();
      } finally { reader.close(); }
      const captured = JSON.parse(fs.readFileSync(path.join(backupDir, ".accounting-coverage.json")));
      expect(captured.gaps[0].apiKeyId).toBe("key-1");
      sql.close();
      const reopened = await createSqlJsAdapter(file);
      expect(repo.getAttemptSync(reopened, "attempt-1").costNanoUsd).toBe("17");
      reopened.close();
    } finally { sql.close(); owner.release(); }
  });
  it("migration is additive and does not advertise activation or debit old history", () => {
    const tables = db.all("SELECT name FROM sqlite_master WHERE type='table'").map(r => r.name);
    expect(tables).toEqual(expect.arrayContaining(["apiKeyBudgetPolicies", "apiKeyAccounting", "apiKeyAccountingAudit", "apiKeyBindings"]));
    expect(db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined();
    expect(db.all("SELECT * FROM apiKeyAccounting")).toEqual([]);
  });
  it("post-legacy-import attribution matches exact secrets only, without charging history", async () => {
    db.close();
    fs.writeFileSync(path.join(dir, "db.json"), JSON.stringify({ apiKeys: [{ id: "legacy-key", key: "legacy-secret", name: "legacy" }] }));
    fs.writeFileSync(path.join(dir, "usage.json"), JSON.stringify({ history: [
      { apiKey: "legacy-secret", timestamp: "2026-09-01T00:00:00.000Z", tokens: { prompt_tokens: 2 } },
      { apiKey: "legacy-s***", timestamp: "2026-09-01T00:00:00.000Z", tokens: { prompt_tokens: 3 } },
      { apiKey: "unmapped", timestamp: "2026-09-01T00:00:00.000Z", tokens: { prompt_tokens: 4 } },
    ] }));
    fs.rmSync(path.join(dir, "db"), { recursive: true, force: true });
    fs.unlinkSync(path.join(dir, ".accounting-coverage.json"));
    db = await (await import("@/lib/db/driver.js")).getAdapter();
    expect(db.all("SELECT apiKeyId FROM usageHistory ORDER BY id").map(r => r.apiKeyId)).toEqual(["legacy-key", null, null]);
    expect(db.all("SELECT * FROM apiKeyAccounting")).toEqual([]);
    expect(db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined();
  });
  it("stable active identity does not depend on name/masked prefix", async () => {
    const keys = await import("@/lib/db/repos/apiKeysRepo.js");
    await (await import("@/lib/db/index.js")).importDb({ apiKeys: [{ id: "a", key: "same-prefix-A" }, { id: "b", key: "same-prefix-B" }] });
    await keys.updateApiKey("a", { name: "renamed" });
    expect((await keys.resolveApiKey("same-prefix-A")).id).toBe("a");
    expect((await keys.resolveApiKey("same-prefix-B")).id).toBe("b");
    await keys.updateApiKey("a", { isActive: false });
    expect(await keys.resolveApiKey("same-prefix-A")).toBeNull();
  });
  it("attempt insert is idempotent, conflicting identity is rejected and settlement counted once", () => {
    repo.insertAttemptSync(db, intent());
    repo.insertAttemptSync(db, intent());
    expect(() => repo.insertAttemptSync(db, { ...intent(), apiKeyId: "key-2" })).toThrow(/conflict/i);
    const result = { state: "settled", outcome: "success", usage: { input: 12, output: 4 }, costNanoUsd: "128", finishedAt: "2026-10-03T00:01:00.000Z" };
    repo.finalizeAttemptSync(db, "attempt-1", result);
    repo.finalizeAttemptSync(db, "attempt-1", result);
    expect(repo.sumSpendSync(db, "key-1", "2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z")).toBe("128");
    expect(() => repo.finalizeAttemptSync(db, "attempt-1", { ...result, costNanoUsd: "129" })).toThrow(/conflict/i);
    expect(() => repo.finalizeAttemptSync(db, "attempt-1", { ...result, costNanoUsd: "0" })).toThrow(/conflict/i);
  });
  it("database enforces append-only audits, target validation and state/cost invariant", () => {
    repo.insertAttemptSync(db, intent());
    expect(() => db.run("UPDATE apiKeyAccounting SET state='settled' WHERE attemptId='attempt-1'")).toThrow(/state cost/);
    expect(() => db.run("UPDATE apiKeyAccounting SET costNanoUsd=0 WHERE attemptId='attempt-1'")).toThrow(/state cost/);
    repo.finalizeAttemptSync(db, "attempt-1", { state: "unresolved", outcome: "aborted", finishedAt: "2026-10-03T00:01:00.000Z" });
    repo.resolveAttemptSync(db, "attempt-1", { action: "waive", expectedVersion: 1, operationId: "waiver", actor: "admin", reason: "unknown charge approved", evidence: "reviewed trace" });
    expect(() => db.run("DELETE FROM apiKeyAccountingAudit")).toThrow(/append-only/);
    expect(() => db.run("UPDATE apiKeyAccountingAudit SET reason='changed'")).toThrow(/append-only/);
    expect(repo.getAttemptSync(db, "attempt-1").costNanoUsd).toBe("0");
    expect(() => db.run("INSERT INTO apiKeyAccountingAudit(id,operationId,actor,reason,action,beforeJson,afterJson,createdAt) VALUES('bad','bad','a','r','waive','{}','{}','now')")).toThrow(/target/);
  });
  it("unknown cost remains null, cross-window unresolved survives key/history deletion", () => {
    repo.insertAttemptSync(db, intent());
    repo.finalizeAttemptSync(db, "attempt-1", { state: "unresolved", outcome: "aborted", finishedAt: "2026-10-03T00:01:00.000Z" });
    db.run("DELETE FROM usageHistory"); db.run("DELETE FROM apiKeys");
    expect(repo.getAttemptSync(db, "attempt-1").costNanoUsd).toBeNull();
    expect(repo.countStatesSync(db, "key-1").unresolved).toBe(1);
  });
  it("audited recovery CAS cannot double debit or be overwritten by late callback", () => {
    repo.insertAttemptSync(db, intent());
    repo.finalizeAttemptSync(db, "attempt-1", { state: "unresolved", outcome: "network_unknown", finishedAt: "2026-10-03T00:01:00.000Z" });
    const recovery = { action: "cost_correction", costNanoUsd: "25", expectedVersion: 1, operationId: "recovery-op", actor: "admin", reason: "provider evidence checked", evidence: "exact provider invoice token report" };
    repo.resolveAttemptSync(db, "attempt-1", recovery);
    repo.resolveAttemptSync(db, "attempt-1", recovery);
    expect(repo.getAttemptSync(db, "attempt-1").costNanoUsd).toBe("25");
    expect(() => repo.resolveAttemptSync(db, "attempt-1", { ...recovery, operationId: "new-op" })).toThrow(/version/);
    expect(() => repo.finalizeAttemptSync(db, "attempt-1", { state: "settled", outcome: "success", usage: { input: 1 }, costNanoUsd: "30", finishedAt: "2026-10-03T00:02:00.000Z" })).toThrow(/conflict/);
    expect(repo.getAttemptSync(db, "attempt-1").costNanoUsd).toBe("25");
    expect(db.all("SELECT action FROM apiKeyAccountingAudit").map(r => r.action)).toEqual(["cost_correction", "observation_conflict"]);
  });
  it("non-owner fails before adapter loading, settings, analytics, migration or close writes", async () => {
    const { acquireWriterOwnership } = await import("@/lib/db/writerOwnership.js");
    const owner = acquireWriterOwnership(dir + "-other");
    const originalDir = process.env.DATA_DIR;
    const originalGlobal = global._dbAdapter;
    const originalFile = path.join(dir + "-other", "sentinel"); fs.writeFileSync(originalFile, "unchanged");
    process.env.DATA_DIR = dir + "-other"; delete global._dbAdapter; vi.resetModules();
    const loadSql = vi.fn(() => { throw new Error("must not open adapter"); });
    vi.doMock("@/lib/db/adapters/nodeSqliteAdapter.js", () => ({ createNodeSqliteAdapter: loadSql }));
    vi.doMock("@/lib/db/adapters/sqljsAdapter.js", () => ({ createSqlJsAdapter: loadSql }));
    try {
      const api = await import("@/lib/db/index.js");
      await expect(api.updateSettings({ forbidden: true })).rejects.toThrow(/writer/);
      await expect(api.getUsageStats()).rejects.toThrow(/writer/);
      await expect(api.initDb()).rejects.toThrow(/writer/);
      expect(loadSql).not.toHaveBeenCalled();
      expect(fs.readFileSync(originalFile, "utf8")).toBe("unchanged");
      expect(fs.existsSync(path.join(dir + "-other", "db"))).toBe(false);
    } finally {
      vi.doUnmock("@/lib/db/adapters/nodeSqliteAdapter.js"); vi.doUnmock("@/lib/db/adapters/sqljsAdapter.js");
      owner.release(); fs.rmSync(dir + "-other", { recursive: true, force: true });
      process.env.DATA_DIR = originalDir; global._dbAdapter = originalGlobal; vi.resetModules();
    }
  });
  it("policy CAS retains spend; zero and unlimited are different; sums use BigInt", () => {
    repo.putPolicySync(db, "key-1", { weeklyLimitNanoUsd: "0", monthlyLimitNanoUsd: null }, 0);
    expect(repo.getPolicySync(db, "key-1").weeklyLimitNanoUsd).toBe("0");
    expect(() => repo.putPolicySync(db, "key-1", { weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null }, 0)).toThrow(/version/i);
    for (const id of ["a", "b"]) {
      repo.insertAttemptSync(db, intent(id));
      repo.finalizeAttemptSync(db, id, { state: "settled", outcome: "success", costNanoUsd: "9000000000000000", usage: { input: 1 }, finishedAt: "2026-10-03T00:01:00.000Z" });
    }
    expect(repo.sumSpendSync(db, "key-1", "2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z")).toBe("18000000000000000");
    expect(() => repo.putPolicySync(db, "key-1", { weeklyLimitNanoUsd: "9000000000000001", monthlyLimitNanoUsd: null }, 1)).toThrow(/range/i);
  });
  it("config import keeps ledger and rejects deleted secret rebinding before mutation", async () => {
    const api = await import("@/lib/db/index.js");
    await api.importDb({ apiKeys: [{ id: "key-1", key: "test-secret" }] });
    repo.insertAttemptSync(db, intent());
    repo.finalizeAttemptSync(db, "attempt-1", { state: "settled", outcome: "success", costNanoUsd: "12", usage: { input: 1 }, finishedAt: "2026-10-03T00:01:00.000Z" });
    await api.deleteApiKey("key-1");
    const before = await api.exportDb();
    await expect(api.importDb({ apiKeys: [{ id: "different-id", key: "test-secret" }] })).rejects.toMatchObject({ status: 409 });
    await expect(api.importDb({ apiKeys: [{ id: "key-1", key: "different-secret" }] })).rejects.toMatchObject({ status: 409 });
    await expect(api.importDb({ apiKeys: [{ id: "key-1", key: "test-secret" }] })).rejects.toMatchObject({ status: 409 });
    expect(await api.exportDb()).toEqual(before);
    await api.importDb({ apiKeys: [] });
    expect(repo.getAttemptSync(db, "attempt-1").costNanoUsd).toBe("12");
    expect(JSON.stringify(db.all("SELECT * FROM apiKeyBindings"))).not.toContain("test-secret");
  });
  it("gap acknowledgement requires durable audit and cannot clear maintenance or newer generation", () => {
    const coverage = db.coverage;
    coverage.latchGap("key-1", "intent recording failed");
    const gap = coverage.status("key-1").gaps[0];
    const operation = { gapId: gap.id, apiKeyId: "key-1", expectedGeneration: gap.generation, operationId: "reconcile-1", actor: "admin", reason: "approved waiver", evidence: "operator verified outage" };
    coverage.enterMaintenance("restore");
    coverage.reconcileGap(operation);
    expect(coverage.status().maintenance).not.toBeNull();
    expect(db.all("SELECT * FROM apiKeyAccountingAudit")).toHaveLength(1);
    coverage.reconcileGap(operation);
    expect(db.all("SELECT * FROM apiKeyAccountingAudit")).toHaveLength(1);
    coverage.latchGap("key-1", "new outage");
    const newer = coverage.status().gaps.find(g => !g.resolvedAt);
    expect(newer.generation).toBeGreaterThan(gap.generation);
    expect(() => coverage.reconcileGap({ ...operation, gapId: newer.id })).toThrow(/generation/i);
    expect(() => coverage.reconcileGap({ ...operation, apiKeyId: "different-key" })).toThrow(/scope/i);
  });
  it("crash-window after durable gap audit before sidecar ack remains blocked and replayable", async () => {
    db.coverage.latchGap("key-1", "recording outage");
    const gap = db.coverage.status().gaps[0];
    const recovery = { gapId: gap.id, apiKeyId: "key-1", expectedGeneration: gap.generation, operationId: "gap-crash-replay", actor: "admin", reason: "waiver approved", evidence: "outage reviewed" };
    const rename = vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("crash before sidecar ack"); });
    expect(() => db.coverage.reconcileGap(recovery)).toThrow("crash before sidecar ack");
    rename.mockRestore();
    expect(db.get("SELECT COUNT(*) AS count FROM apiKeyAccountingAudit WHERE operationId=?", [recovery.operationId]).count).toBe(1);
    expect(() => db.coverage.status()).toThrow(/unavailable/);
    db.close();
    db = await (await import("@/lib/db/driver.js")).getAdapter();
    expect(db.coverage.status().gaps[0].resolvedAt).toBeUndefined();
    db.coverage.reconcileGap(recovery);
    expect(db.coverage.status().gaps[0].resolvedAt).toBeDefined();
    expect(db.get("SELECT COUNT(*) AS count FROM apiKeyAccountingAudit WHERE operationId=?", [recovery.operationId]).count).toBe(1);
  });
  it("unhealthy audit leaves gap latched and missing sidecar never initializes clean", () => {
    db.coverage.latchGap(null, "global outage");
    const gap = db.coverage.status().gaps[0];
    const durable = vi.spyOn(db, "durableTransaction").mockImplementation(() => { throw new Error("disk failed"); });
    expect(() => db.coverage.reconcileGap({ gapId: gap.id, apiKeyId: null, expectedGeneration: gap.generation, operationId: "global-reconcile", actor: "admin", reason: "waive", evidence: "outage reviewed" })).toThrow("disk failed");
    durable.mockRestore();
    expect(db.coverage.status().gaps[0].resolvedAt).toBeUndefined();
    fs.unlinkSync(db.coverage.file);
    expect(() => db.coverage.status()).toThrow(/unavailable/i);
  });
  it("physical backup reopens with ledger, policy, bindings and sidecar but excludes logs", async () => {
    repo.insertAttemptSync(db, intent());
    repo.putPolicySync(db, "key-1", { weeklyLimitNanoUsd: "17", monthlyLimitNanoUsd: null }, 0);
    const dest = path.join(dir, "backup"); fs.mkdirSync(dest);
    const { backupDbLite } = await import("@/lib/db/backup.js");
    const file = backupDbLite(db, dest);
    const { createNodeSqliteAdapter } = await import("@/lib/db/adapters/nodeSqliteAdapter.js");
    const copy = await createNodeSqliteAdapter(file);
    expect(copy.get("SELECT attemptId FROM apiKeyAccounting").attemptId).toBe("attempt-1");
    expect(copy.get("SELECT weeklyLimitNanoUsd FROM apiKeyBudgetPolicies").weeklyLimitNanoUsd).toBe(17);
    expect(copy.get("SELECT name FROM sqlite_master WHERE name='requestDetails'")).toBeUndefined();
    expect(fs.existsSync(path.join(dest, ".accounting-coverage.json"))).toBe(true);
    copy.close();
  });
  it("rejected unrelated config never retires existing keys", async () => {
    const api = await import("@/lib/db/index.js");
    await api.importDb({ apiKeys: [{ id: "kept", key: "keep-secret" }] });
    const before = fs.readFileSync(db.coverage.file);
    await expect(api.importDb({ apiKeys: [], providerConnections: [{ id: "bad", provider: null }] })).rejects.toThrow();
    expect(fs.readFileSync(db.coverage.file)).toEqual(before);
    expect((await api.resolveApiKey("keep-secret")).id).toBe("kept");
  });
  it("mismatched artifacts fail before mutation and shutdown flush", async () => {
    const file = path.join(dir, "db", "data.sqlite");
    const sidecar = db.coverage.file;
    db.close();
    const data = JSON.parse(fs.readFileSync(sidecar, "utf8"));
    data.id = "different-deployment";
    fs.writeFileSync(sidecar, JSON.stringify(data));
    const before = fs.readFileSync(file);
    const sidecarBefore = fs.readFileSync(sidecar);
    const { acquireWriterOwnership } = await import("@/lib/db/writerOwnership.js");
    const owner = acquireWriterOwnership(dir);
    try {
      const { createNodeSqliteAdapter } = await import("@/lib/db/adapters/nodeSqliteAdapter.js");
      const { createSqlJsAdapter } = await import("@/lib/db/adapters/sqljsAdapter.js");
      await expect(createNodeSqliteAdapter(file, owner)).rejects.toThrow(/mismatched/);
      await expect(createSqlJsAdapter(file, owner)).rejects.toThrow(/mismatched/);
      expect(fs.readFileSync(file)).toEqual(before);
      expect(fs.readFileSync(sidecar)).toEqual(sidecarBefore);
    } finally { owner.release(); }
  });
  it("missing required sidecar denies reopen and old unbound database cannot adopt dirty coverage", async () => {
    const sidecar = db.coverage.file;
    db.close();
    const { acquireWriterOwnership } = await import("@/lib/db/writerOwnership.js");
    const { createNodeSqliteAdapter } = await import("@/lib/db/adapters/nodeSqliteAdapter.js");
    const { createSqlJsAdapter } = await import("@/lib/db/adapters/sqljsAdapter.js");
    const file = path.join(dir, "db", "data.sqlite");
    const saved = fs.readFileSync(sidecar);
    fs.unlinkSync(sidecar);
    const owner = acquireWriterOwnership(dir);
    await expect(createNodeSqliteAdapter(file, owner)).rejects.toThrow(/unavailable/);
    await expect(createSqlJsAdapter(file, owner)).rejects.toThrow(/unavailable/);
    const data = JSON.parse(saved); data.generation = 1; data.maintenance = { generation: 1, reason: "restore", startedAt: "2026-10-03T00:00:00.000Z" };
    fs.writeFileSync(sidecar, JSON.stringify(data));
    const empty = path.join(dir, "unbound.sqlite");
    await expect(createNodeSqliteAdapter(empty, owner)).rejects.toThrow(/unavailable/);
    await expect(createSqlJsAdapter(empty, owner)).rejects.toThrow(/unavailable/);
    owner.release();
  });
  it("maintenance release is a separate audited scope-wide operation", () => {
    const coverage = db.coverage;
    coverage.enterMaintenance("managed restore");
    coverage.latchGap("key-1", "old snapshot omits attempts");
    const maintenance = coverage.status().maintenance;
    const recovery = { expectedGeneration: maintenance.generation, operationId: "maintenance-release", actor: "admin", reason: "restore checked", evidence: "all artifacts reconciled" };
    coverage.releaseMaintenance(recovery);
    expect(coverage.status().maintenance).toBeNull();
    expect(coverage.status().gaps.some(g => !g.resolvedAt)).toBe(true);
    coverage.releaseMaintenance(recovery);
    expect(db.all("SELECT * FROM apiKeyAccountingAudit WHERE action='maintenance_release'")).toHaveLength(1);
  });
  it("managed older restore preserves retired keys and new gaps, then requires separate reconciliation", async () => {
    const api = await import("@/lib/db/index.js");
    await api.importDb({ apiKeys: [{ id: "key-1", key: "old-secret" }] });
    const { backupDbLite } = await import("@/lib/db/backup.js");
    const older = path.join(dir, "older"); fs.mkdirSync(older);
    const snapshot = backupDbLite(db, older);
    await api.deleteApiKey("key-1");
    db.coverage.latchGap("key-1", "outage after snapshot");
    const { prepareManagedRestore, applyManagedRestore } = await import("@/lib/db/managedRestore.js");
    prepareManagedRestore(db, path.join(dir, "pre-restore"), "operator restoration");
    const before = fs.readFileSync(path.join(dir, ".accounting-coverage.json"));
    await applyManagedRestore(dir, snapshot);
    expect(fs.readFileSync(path.join(dir, ".accounting-coverage.json"))).toEqual(before);
    db = await (await import("@/lib/db/driver.js")).getAdapter();
    expect(db.coverage.status().maintenance).not.toBeNull();
    expect(db.coverage.status().gaps.filter(g => !g.resolvedAt)).toHaveLength(2);
    expect(await api.resolveApiKey("old-secret")).toBeNull();
    expect(db.get("SELECT retiredAt FROM apiKeyBindings WHERE apiKeyId='key-1'").retiredAt).not.toBeNull();
    await expect(api.importDb({ apiKeys: [{ id: "new-id", key: "old-secret" }] })).rejects.toMatchObject({ status: 409 });
  });
  it.each([false, true])("managed restore retains maintenance ACK history, matching release audit in snapshot=%s", async includesAudit => {
    const { backupDbLite } = await import("@/lib/db/backup.js");
    const snapshotDirectory = path.join(dir, "ack-snapshot"); fs.mkdirSync(snapshotDirectory);
    let snapshot;
    if (!includesAudit) snapshot = backupDbLite(db, snapshotDirectory);
    db.coverage.enterMaintenance("original reviewed maintenance");
    const release = { expectedGeneration: db.coverage.status().maintenance.generation, operationId: "restore-ack-release", actor: "fixture-operator", reason: "reviewed", evidence: "all-scope fixture evidence" };
    db.coverage.releaseMaintenance(release); const receipt = db.coverage.maintenanceReceipt(release);
    if (includesAudit) snapshot = backupDbLite(db, snapshotDirectory);
    const { prepareManagedRestore, applyManagedRestore } = await import("@/lib/db/managedRestore.js");
    const prepared = prepareManagedRestore(db, path.join(dir, "ack-pre-restore"), "fixture restoration");
    const sidecar = path.join(dir, ".accounting-coverage.json"), before = fs.readFileSync(sidecar);
    const saved = JSON.parse(before); expect(saved.maintenanceReleases).toHaveLength(1);
    expect(fs.readFileSync(prepared.coverageBackup).equals(before)).toBe(true);
    await applyManagedRestore(dir, snapshot); expect(fs.readFileSync(sidecar).equals(before)).toBe(true);
    db = await (await import("@/lib/db/driver.js")).getAdapter();
    expect(db.driver).toBe("node:sqlite"); const maintenance = db.coverage.status().maintenance;
    expect(maintenance.generation).toBeGreaterThan(release.expectedGeneration);
    expect(db.coverage.status().gaps.some(gap => gap.apiKeyId === null && !gap.resolvedAt)).toBe(true);
    if (includesAudit) {
      expect(db.coverage.maintenanceReceipt(release)).toEqual(receipt); db.coverage.releaseMaintenance(release);
      expect(db.get("SELECT COUNT(*) AS n FROM apiKeyAccountingAudit WHERE operationId=?", [release.operationId]).n).toBe(1);
    } else {
      expect(() => db.coverage.maintenanceReceipt(release)).toThrow(); expect(() => db.coverage.releaseMaintenance(release)).toThrow();
      expect(db.get("SELECT COUNT(*) AS n FROM apiKeyAccountingAudit WHERE operationId=?", [release.operationId]).n).toBe(0);
    }
    expect(db.coverage.status().maintenance).toEqual(maintenance); expect(fs.readFileSync(sidecar).equals(before)).toBe(true);
    expect(db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined();
  });
  it("managed restore refuses missing/mismatched recovery artifacts", async () => {
    const { prepareManagedRestore, applyManagedRestore } = await import("@/lib/db/managedRestore.js");
    const prepared = prepareManagedRestore(db, path.join(dir, "restore-backup"), "operator restoration");
    const liveFile = path.join(dir, "db", "data.sqlite");
    const before = fs.readFileSync(liveFile);
    fs.unlinkSync(prepared.coverageBackup);
    await expect(applyManagedRestore(dir, prepared.databaseBackup)).rejects.toThrow();
    expect(fs.readFileSync(liveFile)).toEqual(before);
    expect(JSON.parse(fs.readFileSync(path.join(dir, ".accounting-coverage.json"))).maintenance).not.toBeNull();
  });
  it("duplicate import identities reject atomically", async () => {
    const api = await import("@/lib/db/index.js");
    const before = await api.exportDb();
    await expect(api.importDb({ apiKeys: [{ id: "a", key: "first" }, { id: "a", key: "second" }] })).rejects.toMatchObject({ status: 409 });
    await expect(api.importDb({ apiKeys: [{ id: "a", key: "first" }, { id: "b", key: "first" }] })).rejects.toMatchObject({ status: 409 });
    expect(await api.exportDb()).toEqual(before);
  });
});
