// DB safety backups — taken ONLY before a schema change (see migrate.js).
//
// ⚠️ AGENT/DEV NOTES:
// - Backups are a best-effort safety net before schema migrations. There is NO
//   automated restore path; recovery is manual (copy a backup file back).
// - Backups intentionally EXCLUDE the `requestDetails` table (observability log,
//   auto-pruned, non-critical) so a multi-hundred-MB DB backs up as a few MB.
// - Only the newest KEEP_BACKUPS are kept; older ones are pruned automatically.
import fs from "node:fs";
import path from "node:path";
import { BACKUPS_DIR, ensureDirs } from "./paths.js";
import { timestampSlug, getAppVersion } from "./version.js";

const KEEP_BACKUPS = 3;

// Tables excluded from safety backups (large, non-critical, reproducible).
const BACKUP_EXCLUDE_TABLES = ["requestDetails"];
const quoteIdentifier = name => '"' + name.replace(/"/g, '""') + '"';

export function makeBackupDir(label) {
  ensureDirs();
  const ver = getAppVersion();
  const slug = `${label}-${ver}-${timestampSlug()}`;
  const dir = path.join(BACKUPS_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });
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
// sqlite_schema stores normalized persistent CREATE INDEX SQL. Qualify only
// the created name, never ON/expressions/predicates (SQLite's attached-index
// grammar resolves those in the index's schema). Refuse unrecognized prefixes.
function backupIndexSql(sql, name) {
  const prefix = /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+/i.exec(sql);
  if (!prefix) throw new Error('Unsupported backup index definition');
  let end = prefix[0].length;
  const start = end;
  const quote = sql[start];
  let decoded = '';
  if (['"', '`', '['].includes(quote)) {
    const close = quote === '[' ? ']' : quote;
    end++;
    let closed = false;
    while (end < sql.length) {
      const ch = sql[end++];
      if (ch === close) {
        if (close !== ']' && sql[end] === close) { decoded += close; end++; }
        else { closed = true; break; }
      } else decoded += ch;
    }
    if (!closed) throw new Error('Unsupported backup index name');
  } else {
    const identifier = /^[A-Za-z_][A-Za-z_0-9$]*/.exec(sql.slice(start));
    if (!identifier) throw new Error('Unsupported backup index name');
    decoded = identifier[0]; end += decoded.length;
  }
  if (decoded !== name || !/^\s+ON\s/i.test(sql.slice(end))) throw new Error('Unsupported backup index definition');
  return sql.slice(0, start) + 'bak.' + sql.slice(start);
}

export function backupDbLite(adapter, destDir, destName = "data.sqlite") {
  // Never delete/reuse an artifact still attached by an earlier failed cleanup.
  // Do not close the shared caller-owned connection to force cleanup.
  if (adapter.all('PRAGMA database_list').some(db => db.name === 'bak')) throw new Error('Backup attachment unavailable');
  const dest = path.join(destDir, destName);
  try { fs.rmSync(dest, { force: true }); } catch {}
  const escaped = dest.replace(/'/g, "''");

  adapter.exec(`ATTACH DATABASE '${escaped}' AS bak`);
  let copyFailed = false;
  let copyError;
  try {
    const excluded = new Set(BACKUP_EXCLUDE_TABLES);
    adapter.transaction(() => {
      // Inventory is the first main-DB read in the same snapshot as row copies.
      // Reading schema before the transaction lets concurrent DDL/data changes
      // produce a mixed artifact. This is not standalone-commit/restore proof.
      const tables = adapter
        .all(`SELECT name, sql FROM main.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
        .filter((t) => !excluded.has(t.name));
      for (const t of tables) {
        // Recreate table structure in backup DB, then copy rows.
        const createSql = t.sql.replace(/CREATE TABLE\s+/i, "CREATE TABLE bak.");
        adapter.exec(createSql);
        const table = quoteIdentifier(t.name);
        const columns = adapter.all(`PRAGMA main.table_xinfo(${table})`);
        if (!columns.length || columns.some(c => ![0, 2, 3].includes(c.hidden))) throw new Error('Unsupported backup table columns');
        // Generated columns are recomputed from their original DDL, never
        // inserted explicitly. Quote names instead of interpreting DB metadata
        // as SQL syntax. No implicit-rowid preservation claim here.
        const writable = columns.filter(c => c.hidden === 0).map(c => quoteIdentifier(c.name)).join(', ');
        if (!writable) throw new Error('Unsupported backup table columns');
        adapter.exec(`INSERT INTO bak.${table} (${writable}) SELECT ${writable} FROM main.${table}`);
      }
      // Row copies rebuild AUTOINCREMENT only from surviving rows. Retain the
      // original high-water marks (including empty tables/deleted highest IDs)
      // entirely in SQLite, without lossy JavaScript INTEGER conversion.
      if (adapter.get(`SELECT name FROM main.sqlite_master WHERE type='table' AND name='sqlite_sequence'`) &&
          adapter.get(`SELECT name FROM bak.sqlite_master WHERE type='table' AND name='sqlite_sequence'`)) {
        adapter.exec(`DELETE FROM bak.sqlite_sequence`);
        adapter.exec(`INSERT INTO bak.sqlite_sequence(name, seq) SELECT name, seq FROM main.sqlite_sequence WHERE name IN (SELECT name FROM bak.sqlite_master WHERE type='table')`);
      }
      const includedTables = new Set(tables.map(t => t.name));
      const indexes = adapter.all(`SELECT name, tbl_name, sql FROM main.sqlite_master WHERE type='index' AND sql IS NOT NULL`);
      for (const index of indexes) {
        if (includedTables.has(index.tbl_name)) adapter.exec(backupIndexSql(index.sql, index.name));
      }
    });
  } catch (error) {
    copyFailed = true;
    copyError = error;
  }
  try { adapter.exec("DETACH DATABASE bak"); }
  catch (error) {
    if (!copyFailed) throw error;
    // Preserve the exact primary failure, including non-Error thrown values.
    // Secondary failure is visible without leaking SQL/paths/credential values.
    try { console.warn('[DB][backup] detach failed after copy failure; attachment retained'); } catch {}
  }
  if (copyFailed) throw copyError;
  return dest;
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
