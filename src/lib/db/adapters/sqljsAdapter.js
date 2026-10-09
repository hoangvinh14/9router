import fs from "node:fs";
import initSqlJs from "sql.js";
import { PRAGMA_SQL } from "../schema.js";
import { atomicDurableWrite, fsyncDirectory, synchronousResult } from "../durableFile.js";
import { validateAccountingArtifacts } from "../accountingCoverage.js";
import { validatePersistedUnlimited } from "../unlimitedAdmissionProof.js";
import { validatePersistedRequest } from '../persistedRequestProof.js';
import { validatePersistedSelection } from '../persistedSelectionProof.js';
import path from "node:path";

let SQL = null;

async function loadSql() {
  if (SQL) return SQL;
  SQL = await initSqlJs();
  return SQL;
}

export async function createSqlJsAdapter(filePath, { assertOwned = () => {}, directory } = {}) {
  assertOwned();
  const SQLLib = await loadSql();
  const buf = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
  const db = new SQLLib.Database(buf);
  try {
    if (directory) validateAccountingArtifacts(sql => {
      const result = db.exec(sql)[0];
      return result?.values?.[0] ? Object.fromEntries(result.columns.map((column, index) => [column, result.values[0][index]])) : undefined;
    }, directory);
    db.exec(PRAGMA_SQL);
  } catch (error) { db.close(); throw error; }
  // Schema is created/synced by migrate.js after adapter init

  let dirty = false;
  let saveTimer = null;
  const SAVE_DEBOUNCE_MS = 100;

  let unhealthy = null;
  let closed = false;
  let depth = 0;
  function assertHealthy() {
    assertOwned();
    if (closed) throw new Error("SQL.js adapter closed");
    if (unhealthy) throw new Error("SQL.js adapter unhealthy: persistence acknowledgement failed");
  }
  function persist() {
    assertHealthy();
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    try {
      atomicDurableWrite(filePath, Buffer.from(db.export()));
      dirty = false;
    } catch (error) {
      unhealthy = error;
      throw error;
    }
  }

  function scheduleSave() {
    dirty = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (dirty && !unhealthy && !closed) {
        try { persist(); } catch (e) { unhealthy = e; console.error("[sqljs] persistence unavailable"); }
      }
    }, SAVE_DEBOUNCE_MS);
    saveTimer.unref?.();
  }

  function paramsObj(params) {
    if (!params || (Array.isArray(params) && params.length === 0)) return undefined;
    return params;
  }

  function run(sql, params = []) {
    assertHealthy();
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
    assertHealthy();
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
    assertHealthy();
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
    assertHealthy();
    db.exec(sql);
    scheduleSave();
  }

  function transaction(fn) {
    assertHealthy();
    if (fn.constructor?.name === "AsyncFunction") throw new Error("Database transaction callback must be synchronous");
    const sp = `sp_${Math.random().toString(36).slice(2)}`;
    db.exec(`SAVEPOINT ${sp}`);
    depth++;
    let releasing = false;
    try {
      const result = synchronousResult(fn());
      // A nested rollback/release uncertainty may have been caught by a caller;
      // it still forbids this outer frame from publishing/persisting success.
      assertHealthy();
      releasing = true;
      db.exec(`RELEASE ${sp}`);
      scheduleSave();
      return result;
    } catch (e) {
      if (releasing) unhealthy ||= e;
      try { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); }
      catch (rollbackError) { unhealthy ||= rollbackError; }
      throw e;
    } finally { depth--; }
  }

  function durableTransaction(fn) {
    assertHealthy();
    if (depth) throw new Error("Durable transaction must be outermost");
    const result = transaction(fn);
    persist();
    return result;
  }
  function backupTo(file, excludedTables = []) {
    assertHealthy();
    // SQL.js ATTACH uses its virtual filesystem, not the host filesystem.
    // Clone the current export, remove only excluded observability tables and
    // write a real SQLite artifact with the same acknowledgement primitive.
    const clone = new SQLLib.Database(db.export());
    try {
      for (const table of excludedTables) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new Error("Invalid backup table");
        clone.exec(`DROP TABLE IF EXISTS ${table}`);
      }
      atomicDurableWrite(file, Buffer.from(clone.export()));
    } finally { clone.close(); }
  }
  function close() {
    if (closed) return;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    process.removeListener("beforeExit", flush);
    process.removeListener("SIGINT", flush);
    process.removeListener("SIGTERM", flush);
    try { if (dirty && !unhealthy) persist(); }
    finally { closed = true; db.close(); }
  }

  const flush = () => {
    if (dirty && !unhealthy && !closed) {
      try { persist(); } catch (error) { unhealthy = error; console.error("[sqljs] shutdown persistence unavailable"); }
    }
  };
  process.on("beforeExit", flush);
  process.on("SIGINT", flush);
  process.on("SIGTERM", flush);

  function provePersistedUnlimited(apiKeyId, coverage) {
    return provePersistedSnapshot(get => validatePersistedUnlimited(get, coverage, apiKeyId));
  }
  function provePersistedRequest(input, coverage) {
    try { return provePersistedSnapshot(get => validatePersistedRequest(get, coverage, input)); }
    catch { throw new Error('Persisted request proof unavailable'); }
  }
  function provePersistedSelection(input, coverage) {
    try { return provePersistedSnapshot((get, all) => validatePersistedSelection(get, all, coverage, input)); }
    catch { throw new Error('Persisted selection proof unavailable'); }
  }
  function provePersistedSnapshot(validate) {
    assertOwned();
    if (!directory || !unhealthy || closed || depth) throw new Error("Unlimited admission proof unavailable");
    // Poisoned RAM is never exported again. Suppress even a pending debounce;
    // close/flush already refuse exports while unhealthy. Entire proof is sync.
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    let fd, snapshot;
    try {
      fd = fs.openSync(filePath, "r");
      const before = fs.fstatSync(fd);
      if (!before.isFile()) throw new Error("Unlimited admission proof unavailable");
      const bytes = fs.readFileSync(fd);
      fs.fsyncSync(fd);
      fsyncDirectory(path.dirname(filePath));
      const installed = fs.statSync(filePath);
      if (installed.dev !== before.dev || installed.ino !== before.ino || installed.size !== before.size) throw new Error("Unlimited admission proof unavailable");
      assertOwned();
      snapshot = new SQLLib.Database(bytes);
      const getPersisted = (sql, params = []) => {
        const stmt = snapshot.prepare(sql);
        try { stmt.bind(params); return stmt.step() ? stmt.getAsObject() : undefined; }
        finally { stmt.free(); }
      };
      if (getPersisted("PRAGMA quick_check")?.quick_check !== "ok") throw new Error("Unlimited admission proof unavailable");
      const allPersisted = (sql, params = []) => {
        const stmt = snapshot.prepare(sql);
        try {
          stmt.bind(params);
          const rows = [];
          while (stmt.step()) rows.push(stmt.getAsObject());
          return rows;
        } finally { stmt.free(); }
      };
      const proof = validate(getPersisted, allPersisted);
      assertOwned();
      return proof;
    } finally { snapshot?.close(); if (fd !== undefined) fs.closeSync(fd); }
  }
  return { driver: "sql.js", run, get, all, exec, transaction, durableTransaction, backupTo, close, provePersistedUnlimited, provePersistedRequest, provePersistedSelection,
    canMemoizePricing: () => { assertHealthy(); return depth === 0 && !dirty; },
    health: () => ({ healthy: !unhealthy && !closed, poisoned: Boolean(unhealthy), closed, durability: "atomic-fsync" }) };
}
