// Isolated Node fixture only; no aliases, live keys, network or production DB.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { acquireWriterOwnership } from "../../src/lib/db/writerOwnership.js";
import { createNodeSqliteAdapter } from "../../src/lib/db/adapters/nodeSqliteAdapter.js";
import { TABLES, buildCreateTableSql, SCHEMA_VERSION } from "../../src/lib/db/schema.js";
import { openAccountingCoverage } from "../../src/lib/db/accountingCoverage.js";
import { retainKeyBindings } from "../../src/lib/db/helpers/apiKeyBindings.js";
// Historical setup reproduction, not a supported production initializer.
import { initializeExplicitPoliciesSync } from "./legacy-policy-initialization.mjs";
const [directory, mode] = process.argv.slice(2);
if (!directory || !path.isAbsolute(directory) || !["crash", "inspect"].includes(mode)) throw new Error("Invalid proof fixture arguments");
const owner = acquireWriterOwnership(directory); const file = path.join(directory, "data.sqlite");
const db = await createNodeSqliteAdapter(file, owner);
if (mode === "crash") {
  db.durableTransaction(() => {
    for (const name of ["_meta", "apiKeys", "apiKeyBindings", "apiKeyBudgetPolicies", "apiKeyAccounting"]) db.exec(buildCreateTableSql(name, TABLES[name]));
    db.run("INSERT INTO _meta(key,value) VALUES('schemaVersion',?)", [String(SCHEMA_VERSION)]);
  });
  db.coverage = openAccountingCoverage(db, owner);
  db.durableTransaction(() => { db.run("INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES('child-key','fixture-only-secret',1,'2026-10-03T00:00:00.000Z')"); retainKeyBindings(db, db.coverage, [{ id: "child-key", key: "fixture-only-secret" }]); });
  initializeExplicitPoliciesSync(db);
  db.durableTransaction(() => db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')"));
  const exec = DatabaseSync.prototype.exec; let injected = false;
  DatabaseSync.prototype.exec = function (sql) {
    if (!injected && sql.startsWith("RELEASE")) { injected = true; throw new Error("fixture uncertain release"); }
    return exec.call(this, sql);
  };
  try { db.durableTransaction(() => db.run("UPDATE apiKeyBudgetPolicies SET weeklyLimitNanoUsd=1,version=1 WHERE apiKeyId='child-key'")); }
  catch (error) { if (!error.message.includes("uncertain release")) throw error; }
  finally { DatabaseSync.prototype.exec = exec; }
  const proof = db.provePersistedUnlimited("child-key", db.coverage);
  db.coverage.latchGap("child-key", "fixture_proof_then_gap");
  fs.writeSync(1, `ACK:${JSON.stringify({ policyVersion: proof.policyVersion, gap: true })}\n`);
  process.kill(process.pid, "SIGKILL");
} else {
  db.coverage = openAccountingCoverage(db, owner);
  const policy = db.get("SELECT weeklyLimitNanoUsd,monthlyLimitNanoUsd,version FROM apiKeyBudgetPolicies WHERE apiKeyId='child-key'");
  fs.writeSync(1, `RESULT:${JSON.stringify({ policy, gaps: db.coverage.status("child-key").gaps, recovered: Boolean(owner.recoveredOwnerInstanceId) })}\n`);
  db.close(); owner.release();
}
