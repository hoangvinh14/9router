// Built-in node:sqlite adapter — available in Node >= 22.5.0.
// No native build, no npm install. Ordinary API mirrors betterSqliteAdapter.
import { PRAGMA_SQL } from "../schema.js";
import { assertNoSqlJsWriter, nodeClosureConfirmed, registerNativeSqliteState } from "./nodeClosure.js";
import { CURRENT_ACCOUNTING_MARKERS, readAccountingMarkers } from "../../accounting/mutation-barrier.js";

const CHECKPOINT_INTERVAL_MS = 60 * 1000;
const markedInstalledConnections = new WeakSet();

export function isMarkedInstalledNodeConnection(raw) {
  return markedInstalledConnections.has(raw);
}

// Ordinary callers preserve original factory error identity and best-effort close.
export async function createNodeSqliteAdapter(filePath) {
  const result = await openNodeSqliteAttempt(filePath);
  if (!result.ok) throw result.error;
  return result.adapter;
}

// Internal per-ATTEMPT result; never infer lifecycle from an error's identity or
// client fields. No accounting readiness, migration, replacement or ACK authority.
export function openNodeSqliteAttempt(filePath) {
  return openAttempt(filePath, false);
}

// Installed startup only: same acquired raw connection, before configuration or
// background resources. NOT read-only/pre-open/no-filesystem-effects admission.
export function openInstalledNodeSqliteAttempt(filePath, { requireMarked = false } = {}) {
  return openAttempt(filePath, true, requireMarked);
}

async function openAttempt(filePath, installed, requireMarked = false) {
  let sqlite;
  try { sqlite = await import("node:sqlite"); }
  catch (error) { return Object.freeze({ ok: false, phase: "unavailable_before_open", error }); }
  return openNativeSqliteAttempt(() => new sqlite.DatabaseSync(filePath), {
    driver: "node:sqlite", filePath, installed, requireMarked,
  });
}

export function openNativeSqliteAttempt(connect, { driver, filePath, installed = true, requireMarked = false, state }) {
  let phase = "unavailable_before_open";
  let db;
  let checkpointTimer;
  let closed = false;
  let checkpoint = "not_attempted";
  let onCheckpointFailure;
  function runCheckpoint() {
    try {
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      if (checkpoint !== "failed") checkpoint = "confirmed";
    } catch (error) {
      // Contention can defer a checkpoint while the WAL remains available.
      const code = error?.errcode & 255;
      if (code === 5 || code === 6 || /^SQLITE_(BUSY|LOCKED)(_|$)/.test(error?.code ?? "")) return;
      checkpoint = "failed";
      onCheckpointFailure?.();
    }
  }
  function observeCheckpointFailure(notify) {
    onCheckpointFailure = notify;
    if (checkpoint === "failed") notify();
  }
  let onShutdown;
  let onSigint;
  let onSigterm;
  const stmtCache = new Map();
  function checkImageOwner() {
    try { assertNoSqlJsWriter(filePath); }
    catch {
      phase = "startup_refused";
      throw Object.assign(new Error('Accounting database startup unsupported'), {
        status: 503, code: 'api_key_accounting_startup_unavailable', startupReason: 'sqljs_image_owned',
      });
    }
  }
  const removeResources = () => {
    if (checkpointTimer !== undefined) clearInterval(checkpointTimer);
    if (onShutdown) process.removeListener("beforeExit", onShutdown);
    if (onSigint) process.removeListener("SIGINT", onSigint);
    if (onSigterm) process.removeListener("SIGTERM", onSigterm);
  };
  const isClosed = () => nodeClosureConfirmed(db);
  function closeStrict() {
    if (checkpointTimer !== undefined) clearInterval(checkpointTimer);
    if (closed || isClosed()) {
      closed = true;
      removeResources();
      return Object.freeze({ closure: isClosed() ? "confirmed" : "unknown", checkpoint });
    }
    try { runCheckpoint(); } catch { checkpoint = "failed"; }
    try { closeNative(); }
    catch { return Object.freeze({ closure: "unknown", checkpoint }); }
    // Ordinary cleanup follows a normal native close return on older runtimes
    // too; strict confirmation additionally requires readable isOpen === false.
    closed = true;
    removeResources();
    return Object.freeze({ closure: isClosed() ? "confirmed" : "unknown", checkpoint });
  }
  function prepare(sql) {
    let stmt = stmtCache.get(sql);
    if (!stmt) { stmt = db.prepare(sql); stmtCache.set(sql, stmt); }
    return stmt;
  }
  function closeNative() {
    if (driver === "bun:sqlite") {
      for (const stmt of stmtCache.values()) stmt.finalize();
      stmtCache.clear();
      state.close(db);
      return;
    }
    stmtCache.clear();
    db.close();
  }
  try {
    if (filePath !== ":memory:") checkImageOwner();
    phase = "open_failed_unknown";
    db = connect();
    if (state) registerNativeSqliteState(db, state);
    phase = "initialization_failed";
    if (installed) {
      // Inventory only. Complete marked state still needs the publication gate.
      phase = "startup_refused";
      let reason = 'marker_inventory';
      try {
        const markers = readAccountingMarkers({ all: (sql, params) => prepare(sql).all(...params) });
        if (!markers.length && requireMarked) {
          reason = 'missing_accounting_schema';
          throw new Error();
        }
        if (!markers.length) phase = "initialization_failed";
        else {
          reason = 'incomplete_accounting_schema';
          if (markers.length !== CURRENT_ACCOUNTING_MARKERS.length ||
              markers.some(row => row.type !== 'table' || !CURRENT_ACCOUNTING_MARKERS.includes(row.name))) throw new Error();
          reason = 'unsupported_app_state';
          if (!prepare("SELECT 1 FROM main.sqlite_schema WHERE type = 'table' AND name = '_meta'").get() ||
              prepare('PRAGMA journal_mode').get()?.journal_mode !== 'wal') throw new Error();
          markedInstalledConnections.add(db);
        }
      } catch {
        throw Object.assign(new Error('Accounting database startup unsupported'), {
          status: 503, code: 'api_key_accounting_startup_unavailable', startupReason: reason,
        });
      }
    }
    db.exec(PRAGMA_SQL);
    // A SQL.js opening can race the pre-open check. The native connection
    // must establish WAL mode before it can serve any writes.
    if (filePath !== ":memory:") {
      if (prepare('PRAGMA journal_mode').get()?.journal_mode !== 'wal') throw new Error('SQLite WAL unavailable');
      checkImageOwner();
    }
    checkpointTimer = setInterval(runCheckpoint, CHECKPOINT_INTERVAL_MS);
    if (typeof checkpointTimer.unref === "function") checkpointTimer.unref();
    // once removes itself even if close fails. Legacy signal exit behavior is
    // unchanged; not accounting-safe multi-connection shutdown.
    onShutdown = () => { closeStrict(); };
    onSigint = () => { onShutdown(); process.exit(0); };
    onSigterm = () => { onShutdown(); process.exit(0); };
    process.once("beforeExit", onShutdown);
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
    const adapter = {
      driver,
      run(sql, params = []) {
        const r = prepare(sql).run(...params);
        return { changes: Number(r.changes ?? 0), lastInsertRowid: Number(r.lastInsertRowid ?? 0) };
      },
      get(sql, params = []) { return prepare(sql).get(...params); },
      all(sql, params = []) { return prepare(sql).all(...params); },
      exec(sql) { return db.exec(sql); },
      transaction(fn) {
        if (driver !== "node:sqlite") return db.transaction(fn)();
        const sp = `sp_${Math.random().toString(36).slice(2)}`;
        db.exec(`SAVEPOINT ${sp}`);
        try {
          const r = fn();
          db.exec(`RELEASE ${sp}`);
          return r;
        } catch (e) {
          try { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); } catch {}
          throw e;
        }
      },
      checkpoint: runCheckpoint,
      // Still best-effort; strict disposition is internal, not a new public ACK.
      close() { closeStrict(); },
      raw: db,
    };
    return Object.freeze({ ok: true, adapter, closeStrict, observeCheckpointFailure });
  } catch (error) {
    // Covers ALL post-open setup, including partial timer/listener installation.
    removeResources();
    let closure = "unknown";
    let cleanupError;
    if (db) {
      try { closeNative(); if (isClosed()) closure = "confirmed"; }
      catch (failure) { cleanupError = failure; }
    }
    // Internal evidence only: accounting boundary never exposes either cause.
    return Object.freeze({ ok: false, phase, closure, error, cleanupError });
  }
}
