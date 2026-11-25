import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import initSqlJs from "sql.js";
import { PRAGMA_SQL } from "../schema.js";
import { acquireSqlJsWriter } from './sqljs-writer.js';
import { registerNativeSqliteState } from './nodeClosure.js';

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

export async function createSqlJsAdapter(filePath, { accounting = false } = {}) {
  if (accounting && process.platform !== 'linux') throw new Error('SQL.js accounting requires Linux directory sync');
  const SQLLib = await loadSql();
  const owner = acquireSqlJsWriter(filePath);
  filePath = owner.file;
  let db;
  try {
    refuseNativeSidecars(filePath);
    const buf = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
    if (buf?.[18] === 2 || buf?.[19] === 2) throw new Error('SQL.js cannot open a native SQLite WAL database');
    refuseNativeSidecars(filePath);
    db = new SQLLib.Database(buf);
    db.exec(PRAGMA_SQL);
  } catch (error) {
    db?.close();
    owner.release();
    throw error;
  }
  // Schema is created/synced by migrate.js after adapter init

  let dirty = false;
  let closed = false;
  let poisoned = false;
  let imageActive = false;
  let ordinaryDepth = 0;
  let wasDirty = false;
  let publicationFailed;
  let saveTimer = null;
  const SAVE_DEBOUNCE_MS = 100;

  function assertUsable() {
    if (closed || poisoned) throw new Error('SQL.js connection unavailable');
    if (accounting) owner.assertOwned();
  }

  function writeImage(destination, data, verifyDestination) {
    const staged = destination + "." + randomUUID() + ".tmp";
    const fd = fs.openSync(staged, "wx", 0o600);
    let renamed = false;
    try {
      try {
        fs.writeFileSync(fd, data);
        fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
      verifyDestination();
      fs.renameSync(staged, destination);
      renamed = true;
      if (process.platform !== "win32") {
        const dir = fs.openSync(path.dirname(destination), "r");
        try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
      }
    } finally {
      if (!renamed) {
        try { fs.unlinkSync(staged); } catch {}
      }
    }
  }

  function persist() {
    if (imageActive || ordinaryDepth) throw new Error('Cannot publish SQL.js during a transaction');
    owner.assertOwned();
    refuseNativeSidecars(filePath);
    writeImage(filePath, Buffer.from(db.export()), () => {
      refuseNativeSidecars(filePath);
      owner.assertOwned();
    });
    if (accounting) db.exec(PRAGMA_SQL);
    dirty = false;
  }

  function scheduleSave() {
    dirty = true;
    if (imageActive) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (dirty) {
        try { persist(); } catch (e) {
          if (accounting) { poisoned = true; publicationFailed?.(); }
          console.error("[sqljs] save failed:", e);
        }
      }
    }, SAVE_DEBOUNCE_MS);
  }

  function paramsObj(params) {
    if (!params || (Array.isArray(params) && params.length === 0)) return undefined;
    return params;
  }

  function run(sql, params = []) {
    assertUsable();
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
    assertUsable();
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
    assertUsable();
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
    assertUsable();
    db.exec(sql);
    scheduleSave();
  }

  function transaction(fn) {
    assertUsable();
    const sp = `sp_${Math.random().toString(36).slice(2)}`;
    db.exec(`SAVEPOINT ${sp}`);
    ordinaryDepth++;
    try {
      const result = fn();
      db.exec(`RELEASE ${sp}`);
      scheduleSave();
      return result;
    } catch (e) {
      try { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); } catch {}
      throw e;
    } finally { ordinaryDepth--; }
  }

  if (accounting) registerNativeSqliteState(db, {
    open: () => !closed && !poisoned,
    inTransaction: () => imageActive || ordinaryDepth !== 0,
    imageTransactions: Object.freeze({
      begin() {
        assertUsable();
        db.exec('BEGIN IMMEDIATE');
        clearTimeout(saveTimer);
        wasDirty = dirty;
        imageActive = true;
      },
      commit() {
        assertUsable();
        db.exec('COMMIT');
        imageActive = false;
        if (!dirty) return;
        clearTimeout(saveTimer);
        try { persist(); }
        catch (error) {
          poisoned = true;
          publicationFailed?.();
          throw error;
        }
      },
      rollback() {
        db.exec('ROLLBACK');
        imageActive = false;
        dirty = wasDirty;
        if (dirty) scheduleSave();
      },
    }),
  });

  function close() {
    if (closed) { owner.release(); return; }
    if (imageActive || ordinaryDepth) throw new Error('Cannot close SQL.js during a transaction');
    if (saveTimer) clearTimeout(saveTimer);
    if (dirty && !poisoned) persist();
    db.close();
    closed = true;
    process.off("beforeExit", closeOnExit);
    process.off("exit", closeOnExit);
    process.off("SIGINT", flush);
    process.off("SIGTERM", flush);
    owner.release();
  }

  // Flush on shutdown
  const flush = () => { if (dirty && !poisoned && !imageActive) try { persist(); } catch {} };
  const closeOnExit = () => { try { close(); } catch {} };
  process.on("beforeExit", closeOnExit);
  // Server signal handlers can call process.exit() before the flush runs.
  process.on("exit", closeOnExit);
  process.on("SIGINT", flush);
  process.on("SIGTERM", flush);

  return { driver: "sql.js", run, get, all, exec, transaction, close, raw: db,
    backupTo(destination) {
      assertUsable();
      if (imageActive || ordinaryDepth) throw new Error('Cannot back up SQL.js during a transaction');
      if (fs.lstatSync(destination, { throwIfNoEntry: false })) throw new Error('SQL.js backup destination already exists');
      const bytes = db.export();
      db.exec(PRAGMA_SQL);
      const snapshot = new SQLLib.Database(bytes);
      try {
        if (snapshot.exec("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'requestDetails'").length) {
          snapshot.exec('DELETE FROM requestDetails; VACUUM');
        }
        writeImage(destination, Buffer.from(snapshot.export()), () => {
          refuseNativeSidecars(destination);
          if (fs.lstatSync(destination, { throwIfNoEntry: false })) throw new Error('SQL.js backup destination already exists');
        });
      } finally { snapshot.close(); }
      return destination;
    },
    ...(accounting ? {
      observeCheckpointFailure(notify) { publicationFailed = notify; if (poisoned) notify(); },
      closeStrict() {
        close();
        return { closure: 'confirmed', checkpoint: poisoned ? 'failed' : 'confirmed' };
      },
    } : {}),
  };
}
