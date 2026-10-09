import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
let db, dir, api, initialize, ledger;
const original = process.env.DATA_DIR;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-policy-init-")); process.env.DATA_DIR = dir; delete global._dbAdapter; vi.resetModules();
  db = await (await import("@/lib/db/driver.js")).getAdapter(); api = await import("@/lib/db/index.js");
  await api.importDb({ apiKeys: [{ id: "key-a", key: "init-secret" }, { id: "key-b", key: "other-secret" }] });
  // Retain original sidecar-first persisted-state/failure assertions as history.
  initialize = (await import("../fixtures/legacy-policy-initialization.mjs")).initializeExplicitPoliciesSync;
  ledger = await import("@/lib/db/repos/apiKeyAccountingRepo.js");
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(dir, { recursive: true, force: true }); if (original === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = original; });
describe("historical sidecar-first policy initialization reproductions (not production entrypoint)", { timeout: 20_000 }, () => {
  it("persists version0 defaults atomically, preserves existing restriction and CAS", () => {
    ledger.putPolicySync(db, "key-b", { weeklyLimitNanoUsd: "0", monthlyLimitNanoUsd: null }, 0);
    expect(initialize(db)).toEqual({ initialized: true, inserted: 1 });
    expect(ledger.getPolicySync(db, "key-a")).toMatchObject({ version: 0, weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null });
    expect(ledger.getPolicySync(db, "key-b")).toMatchObject({ version: 1, weeklyLimitNanoUsd: "0" });
    expect(initialize(db)).toEqual({ initialized: false, inserted: 0 });
    expect(ledger.putPolicySync(db, "key-a", { weeklyLimitNanoUsd: "1", monthlyLimitNanoUsd: null }, 0).version).toBe(1);
  });
  it("post-initialization deletion never backfills unlimited", () => {
    initialize(db); db.durableTransaction(() => db.run("DELETE FROM apiKeyBudgetPolicies WHERE apiKeyId='key-a'"));
    expect(() => initialize(db)).toThrow(/unavailable/);
    expect(() => ledger.getPolicySync(db, "key-a")).toThrow(/unavailable/);
    expect(() => ledger.putPolicySync(db, "key-a", { weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null }, 0)).toThrow(/unavailable/);
    expect(db.get("SELECT * FROM apiKeyBudgetPolicies WHERE apiKeyId='key-a'")).toBeUndefined();
  });
  it("new import identity gets an atomic default, existing import cannot heal deleted policy", async () => {
    initialize(db); const keys = await api.getApiKeys();
    await api.importDb({ apiKeys: [...keys, { id: "key-c", key: "new-secret" }] });
    expect(ledger.getPolicySync(db, "key-c")).toMatchObject({ version: 0, weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null });
    db.durableTransaction(() => db.run("DELETE FROM apiKeyBudgetPolicies WHERE apiKeyId='key-a'"));
    const before = await api.exportDb(); const coverageBefore = fs.readFileSync(db.coverage.file);
    await expect(api.importDb({ apiKeys: [...keys, { id: "key-d", key: "another-secret" }] })).rejects.toMatchObject({ code: "api_key_accounting_unavailable" });
    expect(await api.exportDb()).toEqual(before); expect(fs.readFileSync(db.coverage.file)).toEqual(coverageBefore);
    expect(db.get("SELECT * FROM apiKeyBindings WHERE apiKeyId='key-d'")).toBeUndefined();
    expect(db.get("SELECT * FROM apiKeyBudgetPolicies WHERE apiKeyId='key-d'")).toBeUndefined();
  });
  it("create key commits explicit default with binding/key, failed key insert rolls all back", async () => {
    initialize(db); const key = await api.createApiKey("new", "fixture-machine");
    expect(ledger.getPolicySync(db, key.id).version).toBe(0);
    const before = db.all("SELECT * FROM apiKeyBudgetPolicies ORDER BY apiKeyId"); const run = db.run.bind(db);
    vi.spyOn(db, "run").mockImplementation((sql, params) => { if (sql.includes("INSERT INTO apiKeys(id, key")) throw new Error("key insert failed"); return run(sql, params); });
    await expect(api.createApiKey("failed", "fixture-machine")).rejects.toThrow(/insert failed/);
    vi.restoreAllMocks(); expect(db.all("SELECT * FROM apiKeyBudgetPolicies ORDER BY apiKeyId")).toEqual(before);
    expect(db.all("SELECT * FROM apiKeyBindings")).toHaveLength(3);
  });
  it("unmarked legacy import retains missing-row compatibility", async () => {
    expect(ledger.getPolicySync(db, "key-a").version).toBe(0);
    expect(db.all("SELECT * FROM apiKeyBudgetPolicies")).toEqual([]);
    await api.importDb({ apiKeys: await api.getApiKeys() });
    expect(db.all("SELECT * FROM apiKeyBudgetPolicies")).toEqual([]);
  });
  it("activated state and external history prevent first initialization", () => {
    db.durableTransaction(() => db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')"));
    expect(() => initialize(db)).toThrow(/pristine/);
    db.durableTransaction(() => db.run("DELETE FROM _meta WHERE key='ledgerStartedAt'"));
    db.coverage.latchGap("key-a", "recording_history");
    expect(() => initialize(db)).toThrow(/unavailable/);
    expect(db.all("SELECT * FROM apiKeyBudgetPolicies")).toEqual([]);
  });
  it("missing binding or malformed version0 policy cannot initialize", () => {
    db.durableTransaction(() => db.run("DELETE FROM apiKeyBindings WHERE apiKeyId='key-a'"));
    expect(() => initialize(db)).toThrow(/binding/);
    expect(db.get("SELECT * FROM _meta WHERE key='accountingPolicyFormat'")).toBeUndefined();
  });
  it("transaction failure rolls back defaults AND initialization marker", () => {
    const run = db.run.bind(db);
    vi.spyOn(db, "run").mockImplementation((sql, params) => { if (sql === "INSERT INTO _meta(key,value) VALUES(?,?)" && params[0] === "accountingPolicyFormat") throw new Error("marker failure"); return run(sql, params); });
    expect(() => initialize(db)).toThrow(/marker failure/); vi.restoreAllMocks();
    expect(db.all("SELECT * FROM apiKeyBudgetPolicies")).toEqual([]);
    expect(db.get("SELECT * FROM _meta WHERE key='accountingPolicyFormat'")).toBeUndefined();
    expect(() => initialize(db)).toThrow(/unavailable/);
    expect(() => ledger.getPolicySync(db, "key-a")).toThrow(/unavailable/);
    expect(() => db.coverage.status()).toThrow(/unavailable/);
    expect(JSON.parse(fs.readFileSync(db.coverage.file)).policyFormat).toBe("1");
  });
  it("marked startup reopens and retained sidecar rejects a preformat managed snapshot", async () => {
    const { backupDbLite } = await import("@/lib/db/backup.js"); const older = path.join(dir, "older"); fs.mkdirSync(older);
    const snapshot = backupDbLite(db, older);
    initialize(db); db.close(); db = await (await import("@/lib/db/driver.js")).getAdapter();
    expect(ledger.getPolicySync(db, "key-a").version).toBe(0);
    const { prepareManagedRestore, applyManagedRestore } = await import("@/lib/db/managedRestore.js");
    prepareManagedRestore(db, path.join(dir, "restore-current"), "restore fixture");
    const target = path.join(dir, "db", "data.sqlite"); const before = fs.readFileSync(target); const sidecar = fs.readFileSync(path.join(dir, ".accounting-coverage.json"));
    await expect(applyManagedRestore(dir, snapshot)).rejects.toThrow(/mismatched/);
    expect(fs.readFileSync(target)).toEqual(before); expect(fs.readFileSync(path.join(dir, ".accounting-coverage.json"))).toEqual(sidecar);
  });
  it("successful durable DB commit followed by error blocks same-process policy access", () => {
    const transaction = db.durableTransaction.bind(db);
    vi.spyOn(db, "durableTransaction").mockImplementation(fn => { transaction(fn); throw new Error("lost return acknowledgement"); });
    expect(() => initialize(db)).toThrow(/acknowledgement/); vi.restoreAllMocks();
    expect(db.get("SELECT value FROM _meta WHERE key='accountingPolicyFormat'").value).toBe("1");
    expect(() => ledger.getPolicySync(db, "key-a")).toThrow(/unavailable/);
  });
  it("database marker removal denies current policy reads and reopen before writes", async () => {
    initialize(db); db.durableTransaction(() => db.run("DELETE FROM _meta WHERE key='accountingPolicyFormat'"));
    expect(() => ledger.getPolicySync(db, "key-a")).toThrow(/unavailable/);
    db.close(); const file = path.join(dir, "db", "data.sqlite"); const before = fs.readFileSync(file);
    const { acquireWriterOwnership } = await import("@/lib/db/writerOwnership.js"); const owner = acquireWriterOwnership(dir);
    try {
      const { createNodeSqliteAdapter } = await import("@/lib/db/adapters/nodeSqliteAdapter.js");
      const { createSqlJsAdapter } = await import("@/lib/db/adapters/sqljsAdapter.js");
      await expect(createNodeSqliteAdapter(file, owner)).rejects.toThrow(/mismatched/);
      await expect(createSqlJsAdapter(file, owner)).rejects.toThrow(/mismatched/);
      expect(fs.readFileSync(file)).toEqual(before);
    } finally { owner.release(); }
  });
  it.each([
    ["missing policy", "DELETE FROM apiKeyBudgetPolicies WHERE apiKeyId='key-a'"],
    ["version0 restrictive", "UPDATE apiKeyBudgetPolicies SET weeklyLimitNanoUsd=1 WHERE apiKeyId='key-a'"],
    ["negative version", "UPDATE apiKeyBudgetPolicies SET version=-1 WHERE apiKeyId='key-a'"],
    ["invalid updated time", "UPDATE apiKeyBudgetPolicies SET updatedAt='not-a-date' WHERE apiKeyId='key-a'"],
  ])("matching format with %s rejects both adapters before mutation", async (_name, sql) => {
    initialize(db); db.durableTransaction(() => db.run(sql)); db.close();
    const file = path.join(dir, "db", "data.sqlite"); const before = fs.readFileSync(file);
    const { acquireWriterOwnership } = await import("@/lib/db/writerOwnership.js"); const owner = acquireWriterOwnership(dir);
    try {
      const { createNodeSqliteAdapter } = await import("@/lib/db/adapters/nodeSqliteAdapter.js");
      const { createSqlJsAdapter } = await import("@/lib/db/adapters/sqljsAdapter.js");
      await expect(createNodeSqliteAdapter(file, owner)).rejects.toThrow(/mismatched/);
      await expect(createSqlJsAdapter(file, owner)).rejects.toThrow(/mismatched/);
      expect(fs.readFileSync(file)).toEqual(before);
    } finally { owner.release(); }
  });
  it("matching-format damaged managed snapshot is rejected with live bytes unchanged", async () => {
    initialize(db); const { backupDbLite } = await import("@/lib/db/backup.js"); const damaged = path.join(dir, "damaged"); fs.mkdirSync(damaged);
    const snapshot = backupDbLite(db, damaged); const { DatabaseSync } = await import("node:sqlite"); const edit = new DatabaseSync(snapshot);
    try { edit.exec("DELETE FROM apiKeyBudgetPolicies WHERE apiKeyId='key-a'"); } finally { edit.close(); }
    const { prepareManagedRestore, applyManagedRestore } = await import("@/lib/db/managedRestore.js");
    prepareManagedRestore(db, path.join(dir, "restore-current"), "fixture damaged snapshot");
    const target = path.join(dir, "db", "data.sqlite"); const before = fs.readFileSync(target);
    await expect(applyManagedRestore(dir, snapshot)).rejects.toThrow(/mismatched/);
    expect(fs.readFileSync(target)).toEqual(before);
  });
  it("invalid version0 restriction rejects without overwriting it", () => {
    db.durableTransaction(() => db.run("INSERT INTO apiKeyBudgetPolicies(apiKeyId,weeklyLimitNanoUsd,version,updatedAt) VALUES('key-a',1,0,'2026-10-03T00:00:00.000Z')"));
    expect(() => initialize(db)).toThrow(/unavailable/);
    expect(db.get("SELECT weeklyLimitNanoUsd FROM apiKeyBudgetPolicies").weeklyLimitNanoUsd).toBe(1);
  });
});
