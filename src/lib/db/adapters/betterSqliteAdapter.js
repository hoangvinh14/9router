import Database from "better-sqlite3";
import { PRAGMA_SQL } from "../schema.js";
import { verifyNativeDurability, nativeTransactions } from "./nativeDurability.js";
import { validateAccountingArtifacts } from "../accountingCoverage.js";

// Periodic checkpoint to keep WAL file small (avoid huge -wal/-shm growth)
const CHECKPOINT_INTERVAL_MS = 60 * 1000;

export function createBetterSqliteAdapter(filePath, { assertOwned = () => {}, directory } = {}) {
  assertOwned();
  const db = new Database(filePath);
  try {
    if (directory) validateAccountingArtifacts(sql => db.prepare(sql).get(), directory);
    db.exec(PRAGMA_SQL);
    verifyNativeDurability(db);
  } catch (error) { db.close(); throw error; }
  let closed = false;
  function assertHealthy() { assertOwned(); if (closed) throw new Error("SQLite adapter closed"); }
  const transactions = nativeTransactions(db, assertHealthy);

  const stmtCache = new Map();

  function prepare(sql) {
    transactions.assertUsable();
    let stmt = stmtCache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  // Truncate WAL periodically so file stays small for backup/copy
  const checkpointTimer = setInterval(() => {
    try { transactions.assertUsable(); db.pragma("wal_checkpoint(TRUNCATE)"); } catch {}
  }, CHECKPOINT_INTERVAL_MS);
  if (typeof checkpointTimer.unref === "function") checkpointTimer.unref();

  function gracefulClose() {
    if (closed) return;
    clearInterval(checkpointTimer);
    process.removeListener("beforeExit", onShutdown);
    process.removeListener("SIGINT", onShutdown);
    process.removeListener("SIGTERM", onShutdown);
    try { if (transactions.isHealthy()) { assertHealthy(); db.pragma("wal_checkpoint(TRUNCATE)"); } }
    finally { closed = true; stmtCache.clear(); db.close(); }
  }
  const onShutdown = () => { try { gracefulClose(); } catch { console.error("[DB] shutdown unavailable"); } };
  process.once("beforeExit", onShutdown);
  process.once("SIGINT", onShutdown);
  process.once("SIGTERM", onShutdown);

  return {
    driver: "better-sqlite3",
    run(sql, params = []) { return prepare(sql).run(...params); },
    get(sql, params = []) { return prepare(sql).get(...params); },
    all(sql, params = []) { return prepare(sql).all(...params); },
    exec(sql) { transactions.assertUsable(); return db.exec(sql); },
    transaction: transactions.transaction, durableTransaction: transactions.durableTransaction,
    canMemoizePricing: () => transactions.canMemoizePricing() && db.inTransaction === false,
    health: () => ({ healthy: !closed && transactions.isHealthy(), durability: "wal-full" }),
    checkpoint() { transactions.assertUsable(); db.pragma("wal_checkpoint(TRUNCATE)"); },
    close() {
      clearInterval(checkpointTimer);
      gracefulClose();
    },
  };
}
