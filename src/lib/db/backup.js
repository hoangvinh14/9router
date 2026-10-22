// DB safety backups before schema changes and configuration imports.
//
// ⚠️ AGENT/DEV NOTES:
// - A verified backup is required before schema migrations/configuration import.
//   Recovery must preserve the DB and accounting sidecar as a compatible bundle.
// - Backups intentionally EXCLUDE the `requestDetails` table (observability log,
//   auto-pruned, non-critical) so a multi-hundred-MB DB backs up as a few MB.
// - Only the newest KEEP_BACKUPS are kept; older ones are pruned automatically.
import fs from "node:fs";
import path from "node:path";
import { BACKUPS_DIR, ensureDirs } from "./paths.js";
import { timestampSlug, getAppVersion } from "./version.js";
import { atomicDurableWrite, fsyncDirectory } from "./durableFile.js";
import { COVERAGE_FILE } from "./accounting-coverage.js";

const KEEP_BACKUPS = 3;

// Tables excluded from safety backups (large, non-critical, reproducible).
const BACKUP_EXCLUDE_TABLES = ["requestDetails"];

export function makeBackupDir(label) {
  ensureDirs();
  const ver = getAppVersion();
  const slug = `${label}-${ver}-${timestampSlug()}`;
  const dir = fs.mkdtempSync(path.join(BACKUPS_DIR, `${slug}-`));
  fsyncDirectory(BACKUPS_DIR);
  return dir;
}

export function backupFile(srcPath, destDir, destName = null) {
  if (!fs.existsSync(srcPath)) return null;
  const name = destName || path.basename(srcPath);
  const dest = path.join(destDir, name);
  fs.copyFileSync(srcPath, dest);
  return dest;
}

// Lightweight DB backup via ATTACH: create an empty sqlite file, copy every
// table EXCEPT the excluded ones into it. Avoids duplicating the huge
// observability log, so the backup stays small regardless of DB size.
export function backupDbLite(adapter, destDir, destName = "data.sqlite") {
  const dest = path.join(destDir, destName);
  if (typeof adapter.backupTo === "function") {
    adapter.backupTo(dest, BACKUP_EXCLUDE_TABLES);
    backupCoverage(destDir);
    pruneOldBackups();
    return dest;
  }
  if (fs.existsSync(dest)) throw new Error("Backup destination must be a new file");
  const escaped = dest.replace(/'/g, "''");

  adapter.exec(`ATTACH DATABASE '${escaped}' AS bak`);
  try {
    const excluded = new Set(BACKUP_EXCLUDE_TABLES);
    const tables = adapter
      .all(`SELECT name, sql FROM main.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
      .filter((t) => !excluded.has(t.name));

    adapter.transaction(() => {
      for (const t of tables) {
        // Recreate table structure in backup DB, then copy rows.
        const createSql = t.sql.replace(/CREATE TABLE\s+/i, "CREATE TABLE bak.");
        adapter.exec(createSql);
        adapter.exec(`INSERT INTO bak.${t.name} SELECT * FROM main.${t.name}`);
      }
      const included = new Set(tables.map(t => t.name));
      for (const object of adapter.all("SELECT type,tbl_name,sql FROM main.sqlite_master WHERE type IN ('index','trigger') AND sql IS NOT NULL")) {
        if (!included.has(object.tbl_name)) continue;
        adapter.exec(object.sql.replace(/^(CREATE\s+(?:UNIQUE\s+)?(?:INDEX|TRIGGER)\s+)/i, "$1bak."));
      }
    });
    if (Object.values(adapter.get("PRAGMA bak.quick_check"))[0] !== "ok") throw new Error("Pre-change backup verification failed");
    for (const table of tables) {
      const name = table.name.replaceAll('"', '""');
      if (adapter.get(`SELECT COUNT(*) AS count FROM main."${name}"`).count !== adapter.get(`SELECT COUNT(*) AS count FROM bak."${name}"`).count) throw new Error("Pre-change backup row mismatch");
    }
  } finally {
    try { adapter.exec("DETACH DATABASE bak"); } catch {}
  }
  const fd = fs.openSync(dest, "r");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fsyncDirectory(destDir);
  backupCoverage(destDir);
  pruneOldBackups();
  return dest;
}

function backupCoverage(destDir) {
  const source = path.join(path.dirname(BACKUPS_DIR), COVERAGE_FILE);
  if (fs.existsSync(source)) atomicDurableWrite(path.join(destDir, COVERAGE_FILE), fs.readFileSync(source));
}

export function pruneOldBackups() {
  if (!fs.existsSync(BACKUPS_DIR)) return;
  const entries = fs.readdirSync(BACKUPS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, full: path.join(BACKUPS_DIR, e.name), mtime: fs.statSync(path.join(BACKUPS_DIR, e.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const old of entries.slice(KEEP_BACKUPS)) {
    try { fs.rmSync(old.full, { recursive: true, force: true }); } catch {}
  }
}
