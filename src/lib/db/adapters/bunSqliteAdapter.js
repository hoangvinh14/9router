// Bun runtime adapter — uses built-in bun:sqlite (native, fastest under Bun).
// Loaded only when process.versions.bun is present.
import { PRAGMA_SQL } from "../schema.js";
import { verifyNativeDurability, nativeTransactions } from "./nativeDurability.js";
import { validateAccountingArtifacts } from "../accountingCoverage.js";

const CHECKPOINT_INTERVAL_MS = 60 * 1000;

export async function createBunSqliteAdapter(filePath, { assertOwned = () => {}, directory } = {}) {
  assertOwned();
  // Dynamic import — only resolves under Bun runtime
  const { Database } = await import("bun:sqlite");
  const db = new Database(filePath, { create: true });
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

  const checkpointTimer = setInterval(() => {
    try { transactions.assertUsable(); db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch {}
  }, CHECKPOINT_INTERVAL_MS);
  if (typeof checkpointTimer.unref === "function") checkpointTimer.unref();

  function gracefulClose() {
    if (closed) return;
    clearInterval(checkpointTimer);
    process.removeListener("beforeExit", onShutdown);
    process.removeListener("SIGINT", onShutdown);
    process.removeListener("SIGTERM", onShutdown);
    try { if (transactions.isHealthy()) { assertHealthy(); db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } }
    finally { closed = true; stmtCache.clear(); db.close(); }
  }
  const onShutdown = () => { try { gracefulClose(); } catch { console.error("[DB] shutdown unavailable"); } };
  process.once("beforeExit", onShutdown);
  process.once("SIGINT", onShutdown);
  process.once("SIGTERM", onShutdown);

  return {
    driver: "bun:sqlite",
    run(sql, params = []) {
      const r = prepare(sql).run(...params);
      return { changes: Number(r.changes ?? 0), lastInsertRowid: Number(r.lastInsertRowid ?? 0) };
    },
    get(sql, params = []) {
      return prepare(sql).get(...params);
    },
    all(sql, params = []) {
      return prepare(sql).all(...params);
    },
    exec(sql) { transactions.assertUsable(); return db.exec(sql); },
    transaction: transactions.transaction, durableTransaction: transactions.durableTransaction,
    canMemoizePricing: () => transactions.canMemoizePricing() && db.inTransaction === false,
    health: () => ({ healthy: !closed && transactions.isHealthy(), durability: "wal-full" }),
    checkpoint() { transactions.assertUsable(); db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); },
    close() {
      clearInterval(checkpointTimer);
      gracefulClose();
    },
  };
}
