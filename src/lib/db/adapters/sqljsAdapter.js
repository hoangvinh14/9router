import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import initSqlJs from "sql.js";
import { PRAGMA_SQL } from "../schema.js";

let SQL = null;

async function loadSql() {
  if (SQL) return SQL;
  SQL = await initSqlJs();
  return SQL;
}

function refuseNativeSidecars(filePath) {
  if (['-wal', '-shm', '-journal'].some(suffix => fs.lstatSync(filePath + suffix, { throwIfNoEntry: false }))) {
    throw new Error('SQL.js cannot open a native SQLite WAL database or a database with recovery sidecars');
  }
}

export async function createSqlJsAdapter(filePath) {
  const SQLLib = await loadSql();
  // The WASM image reader does not replay the native WAL or rollback journal.
  refuseNativeSidecars(filePath);
  const buf = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
  if (buf?.[18] === 2 || buf?.[19] === 2) throw new Error('SQL.js cannot open a native SQLite WAL database');
  refuseNativeSidecars(filePath);
  const db = new SQLLib.Database(buf);
  db.exec(PRAGMA_SQL);
  // Schema is created/synced by migrate.js after adapter init

  let dirty = false;
  let saveTimer = null;
  const SAVE_DEBOUNCE_MS = 100;

  function persist() {
    refuseNativeSidecars(filePath);
    const staged = filePath + "." + randomUUID() + ".tmp";
    const data = Buffer.from(db.export());
    const fd = fs.openSync(staged, "wx", 0o600);
    let renamed = false;
    try {
      try {
        fs.writeFileSync(fd, data);
        fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
      refuseNativeSidecars(filePath);
      fs.renameSync(staged, filePath);
      renamed = true;
      if (process.platform !== "win32") {
        const dir = fs.openSync(path.dirname(filePath), "r");
        try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
      }
    } finally {
      if (!renamed) {
        try { fs.unlinkSync(staged); } catch {}
      }
    }
    dirty = false;
  }

  function scheduleSave() {
    dirty = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (dirty) {
        try { persist(); } catch (e) { console.error("[sqljs] save failed:", e); }
      }
    }, SAVE_DEBOUNCE_MS);
  }

  function paramsObj(params) {
    if (!params || (Array.isArray(params) && params.length === 0)) return undefined;
    return params;
  }

  function run(sql, params = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(paramsObj(params));
      stmt.step();
      const changes = db.getRowsModified();
      const lastInsertRowid = db.exec("SELECT last_insert_rowid() as id")[0]?.values?.[0]?.[0] ?? null;
      scheduleSave();
      return { changes, lastInsertRowid };
    } finally {
      stmt.free();
    }
  }

  function get(sql, params = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(paramsObj(params));
      if (stmt.step()) return stmt.getAsObject();
      return undefined;
    } finally {
      stmt.free();
    }
  }

  function all(sql, params = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(paramsObj(params));
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  function exec(sql) {
    db.exec(sql);
    scheduleSave();
  }

  function transaction(fn) {
    const sp = `sp_${Math.random().toString(36).slice(2)}`;
    db.exec(`SAVEPOINT ${sp}`);
    try {
      const result = fn();
      db.exec(`RELEASE ${sp}`);
      scheduleSave();
      return result;
    } catch (e) {
      try { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); } catch {}
      throw e;
    }
  }

  function close() {
    if (saveTimer) clearTimeout(saveTimer);
    if (dirty) persist();
    db.close();
  }

  // Flush on shutdown
  const flush = () => { if (dirty) try { persist(); } catch {} };
  process.on("beforeExit", flush);
  process.on("SIGINT", flush);
  process.on("SIGTERM", flush);

  return { driver: "sql.js", run, get, all, exec, transaction, close, raw: db };
}
