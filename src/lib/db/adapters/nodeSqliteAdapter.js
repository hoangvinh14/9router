// Built-in node:sqlite adapter — available in Node >= 22.5.0.
// No native build, no npm install. Ordinary API mirrors betterSqliteAdapter.
import { PRAGMA_SQL } from "../schema.js";
import { nodeClosureConfirmed } from "./nodeClosure.js";
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
  let phase = "unavailable_before_open";
  let db;
  let checkpointTimer;
  let closed = false;
  let checkpoint = "not_attempted";
  let onShutdown;
  let onSigint;
  let onSigterm;
  const stmtCache = new Map();
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
    try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); if (checkpoint !== "failed") checkpoint = "confirmed"; }
    catch { checkpoint = "failed"; }
    stmtCache.clear();
    try { db.close(); }
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
  try {
    const sqlite = await import("node:sqlite");
    phase = "open_failed_unknown";
    db = new sqlite.DatabaseSync(filePath);
    phase = "initialization_failed";
    if (installed) {
      // Inventory only. Complete marked state still needs the publication gate.
      phase = "startup_refused";
      let reason = 'marker_inventory';
      try {
        const markers = readAccountingMarkers({ all: (sql, params) => db.prepare(sql).all(...params) });
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
          if (!db.prepare("SELECT 1 FROM main.sqlite_schema WHERE type = 'table' AND name = '_meta'").get() ||
              db.prepare('PRAGMA journal_mode').get()?.journal_mode !== 'wal') throw new Error();
          markedInstalledConnections.add(db);
        }
      } catch {
        throw Object.assign(new Error('Accounting database startup unsupported'), {
          status: 503, code: 'api_key_accounting_startup_unavailable', startupReason: reason,
        });
      }
    }
    db.exec(PRAGMA_SQL);
    checkpointTimer = setInterval(() => {
      try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch {}
    }, CHECKPOINT_INTERVAL_MS);
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
      driver: "node:sqlite",
      run(sql, params = []) {
        const r = prepare(sql).run(...params);
        return { changes: Number(r.changes ?? 0), lastInsertRowid: Number(r.lastInsertRowid ?? 0) };
      },
      get(sql, params = []) { return prepare(sql).get(...params); },
      all(sql, params = []) { return prepare(sql).all(...params); },
      exec(sql) { return db.exec(sql); },
      transaction(fn) {
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
      checkpoint() { try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch {} },
      // Still best-effort; strict disposition is internal, not a new public ACK.
      close() { closeStrict(); },
      raw: db,
    };
    return Object.freeze({ ok: true, adapter, closeStrict });
  } catch (error) {
    // Covers ALL post-open setup, including partial timer/listener installation.
    removeResources();
    let closure = "unknown";
    let cleanupError;
    if (db) {
      try { db.close(); if (isClosed()) closure = "confirmed"; }
      catch (failure) { cleanupError = failure; }
    }
    // Internal evidence only: accounting boundary never exposes either cause.
    return Object.freeze({ ok: false, phase, closure, error, cleanupError });
  }
}
