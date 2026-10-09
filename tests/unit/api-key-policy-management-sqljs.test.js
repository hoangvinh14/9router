import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { it, expect, vi } from "vitest";
import { createSqlJsAdapter } from "@/lib/db/adapters/sqljsAdapter.js";
import { acquireWriterOwnership } from "@/lib/db/writerOwnership.js";
import { openAccountingCoverage } from "@/lib/db/accountingCoverage.js";
import { runMigrationOnce } from "@/lib/db/migrate.js";
import { putPolicySync, getPolicySync } from "@/lib/db/repos/apiKeyAccountingRepo.js";
it("SQL.js policy guard+CAS share single durable export; rejected guard leaves installed bytes/version", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-policy-guard-sqljs-")), file = path.join(dir, "db.sqlite"), owner = acquireWriterOwnership(dir);
  let db;
  try {
    db = await createSqlJsAdapter(file, owner); await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner);
    const guard = () => {
      if (!db.health().healthy || db.coverage.status("key-a").gaps.some(g => !g.resolvedAt) || db.coverage.status().maintenance) throw new Error("guard denied");
    };
    const transaction = vi.spyOn(db, "durableTransaction");
    expect(putPolicySync(db, "key-a", { weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null }, 0, guard).version).toBe(1);
    expect(transaction).toHaveBeenCalledTimes(1);
    const before = fs.readFileSync(file); db.coverage.latchGap("key-a", "fixture uncertainty");
    expect(() => putPolicySync(db, "key-a", { weeklyLimitNanoUsd: "1000000000", monthlyLimitNanoUsd: null }, 1, guard)).toThrow("guard denied");
    expect(fs.readFileSync(file)).toEqual(before); expect(getPolicySync(db, "key-a").version).toBe(1);
    db.coverage.enterMaintenance("fixture maintenance");
    expect(() => putPolicySync(db, "key-a", { weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null }, 1, guard)).toThrow("guard denied");
    expect(fs.readFileSync(file)).toEqual(before);
    vi.restoreAllMocks(); db.close(); db = await createSqlJsAdapter(file, owner); db.coverage = openAccountingCoverage(db, owner);
    expect(getPolicySync(db, "key-a")).toMatchObject({ version: 1, weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null });
    expect(db.coverage.status("key-a").gaps).toHaveLength(1);
  } finally { vi.restoreAllMocks(); db?.close(); owner.release(); fs.rmSync(dir, { recursive: true, force: true }); }
}, 20000);
