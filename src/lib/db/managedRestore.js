import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import initSqlJs from "sql.js";
import { acquireWriterOwnership } from "./writerOwnership.js";
import { atomicDurableWrite } from "./durableFile.js";
import { COVERAGE_FILE, validateAccountingArtifacts } from "./accountingCoverage.js";
import { captureRestoreBundle, validateRestoreBundle, readRestoreArtifact, validateRestoreDestination } from "./restoreBundle.js";

const RESTORE_MANIFEST = ".accounting-restore.json";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
function readJson(file) {
  try { return JSON.parse(readRestoreArtifact(file, 4 * 1024 * 1024, true)); }
  catch { throw new Error("Managed restore artifacts unavailable; remain in maintenance"); }
}

// Operator-only API, not configuration upload. Caller must stop new admissions
// and then stop the process after preparation. This closes this writer before
// any replacement; external maintenance/gaps/retired bindings are not restored.
export function prepareManagedRestore(db, backupDirectory, reason) {
  if (!db.coverage || !db.ownerInstanceId) throw new Error("Managed restore requires owned accounting database");
  if (typeof reason !== "string" || !reason.trim()) throw new Error("Managed restore reason required");
  validateRestoreDestination(path.dirname(db.coverage.file), backupDirectory);
  db.coverage.enterMaintenance(reason);
  db.coverage.latchGap(null, "Managed physical restore requires scope-wide accounting reconciliation");
  const operationId = randomUUID();
  const bundle = captureRestoreBundle(db, backupDirectory, operationId);
  const sidecar = db.coverage.file;
  const coverage = db.coverage.status();
  const directory = path.dirname(sidecar);
  const source = path.join(directory, "db", "data.sqlite");
  const manifest = {
    version: 2, operationId, coverageId: coverage.id,
    generation: coverage.generation, maintenanceGeneration: coverage.maintenance.generation,
    ...bundle,
    preparedAt: new Date().toISOString(),
  };
  // Maintenance was acknowledged before stop. A crash before manifest leaves
  // maintenance latched and explicitly blocks automatic restore continuation.
  db.close();
  const owner = acquireWriterOwnership(directory);
  try {
    manifest.currentDatabaseHash = digest(fs.readFileSync(source));
    atomicDurableWrite(path.join(directory, RESTORE_MANIFEST), JSON.stringify(manifest));
  } finally { owner.release(); }
  return manifest;
}

export async function applyManagedRestore(dataDirectory, snapshotFile) {
  const owner = acquireWriterOwnership(dataDirectory);
  try {
    const manifest = readJson(path.join(owner.directory, RESTORE_MANIFEST));
    const sidecarFile = path.join(owner.directory, COVERAGE_FILE);
    const coverage = readJson(sidecarFile);
    validateRestoreBundle(manifest, owner.directory);
    if (![1, 2].includes(manifest.version) || !coverage.maintenance || coverage.id !== manifest.coverageId || coverage.generation !== manifest.generation ||
        coverage.maintenance?.generation !== manifest.maintenanceGeneration ||
        digest(readRestoreArtifact(manifest.databaseBackup)) !== manifest.databaseBackupHash ||
        digest(readRestoreArtifact(manifest.coverageBackup, 4 * 1024 * 1024, true)) !== manifest.coverageBackupHash) {
      throw new Error("Managed restore recovery artifacts mismatched; remain in maintenance");
    }
    const target = path.join(owner.directory, "db", "data.sqlite");
    const bytes = readRestoreArtifact(snapshotFile);
    const snapshotHash = digest(bytes);
    const currentHash = digest(readRestoreArtifact(target));
    const coverageHash = digest(readRestoreArtifact(sidecarFile, 4 * 1024 * 1024, true));
    if (currentHash !== manifest.currentDatabaseHash && currentHash !== manifest.appliedSnapshotHash) {
      throw new Error("Writer changed after restore preparation; remain in maintenance");
    }
    for (const suffix of ["-wal", "-shm"]) if (fs.existsSync(target + suffix)) throw new Error("SQLite writer side files present; stop/checkpoint writer before restore");
    // Independently inspect bytes without migrations, timers, PRAGMA mutation,
    // or a writable adapter. Do not execute SQL or paths from snapshot payloads.
    const SQL = await initSqlJs();
    const snapshot = new SQL.Database(bytes);
    try {
      const get = sql => {
        const result = snapshot.exec(sql)[0];
        return result?.values?.[0] ? Object.fromEntries(result.columns.map((column, index) => [column, result.values[0][index]])) : undefined;
      };
      if (get("PRAGMA integrity_check")?.integrity_check !== "ok" || get("SELECT value FROM _meta WHERE key='schemaVersion'")?.value !== "2") throw new Error("Unsupported/corrupt accounting restore snapshot");
      validateAccountingArtifacts(get, owner.directory);
      // Reject pre-accounting snapshots rather than generating clean new coverage.
      if (get("SELECT value FROM _meta WHERE key='accountingCoverageId'")?.value !== coverage.id) throw new Error("Restore snapshot coverage identity mismatch");
    } finally { snapshot.close(); }
    // The async inspection must not admit a live-intent presence/hash change.
    // Matching historical bytes never substitutes for current live authority.
    owner.assertOwned(); validateRestoreBundle(manifest, owner.directory);
    if (digest(readRestoreArtifact(target)) !== currentHash || digest(readRestoreArtifact(sidecarFile, 4 * 1024 * 1024, true)) !== coverageHash) {
      throw new Error("Writer changed after restore preparation; remain in maintenance");
    }
    // Write manifest target BEFORE replacement. Crash afterward remains replayable
    // and maintenance blocked; current external sidecar is NEVER overwritten.
    manifest.appliedSnapshotHash = snapshotHash;
    atomicDurableWrite(path.join(owner.directory, RESTORE_MANIFEST), JSON.stringify(manifest));
    atomicDurableWrite(target, bytes);
    return { operationId: manifest.operationId, maintenanceRequired: true, reconciliationRequired: true };
  } finally { owner.release(); }
}
