// Built-in node:sqlite adapter — available in Node >= 22.5.0.
// No native build, no npm install. API mirrors betterSqliteAdapter.
import { PRAGMA_SQL } from "../schema.js";
import { verifyNativeDurability, nativeTransactions } from "./nativeDurability.js";
import { validateAccountingArtifacts } from "../accountingCoverage.js";
import { proveNativeUnlimited, proveNativeSnapshot } from "./nativeAdmissionProof.js";
import { validatePersistedRequest } from '../persistedRequestProof.js';
import { validatePersistedSelection } from '../persistedSelectionProof.js';

const CHECKPOINT_INTERVAL_MS = 60 * 1000;

export async function createNodeSqliteAdapter(filePath, { assertOwned = () => {}, directory } = {}) {
  assertOwned();
  // Engine availability is determined before this factory opens the DB.
  // Preserve process.emit and native warnings; no global suppression.
  const sqlite = await import("node:sqlite");
  const Database = sqlite.DatabaseSync;
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

  // Periodic WAL checkpoint to keep -wal/-shm small
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
    driver: "node:sqlite",
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
    canMemoizePricing: () => transactions.canMemoizePricing() && db.isTransaction === false,
    health: () => ({ healthy: !closed && transactions.isHealthy(), poisoned: !transactions.isHealthy(), closed, durability: "wal-full" }),
    checkpoint() { transactions.assertUsable(); db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); },
    provePersistedUnlimited(apiKeyId, coverage) {
      clearInterval(checkpointTimer);
      return proveNativeUnlimited({ filePath, directory, assertOwned, transactions,
        isTransaction: () => db.isTransaction,
        openReader: () => new Database(filePath, { readOnly: true }), coverage, apiKeyId });
    },
    provePersistedRequest(input, coverage) {
      if (closed || transactions.isHealthy()) throw new Error('Persisted request proof unavailable');
      clearInterval(checkpointTimer);
      try {
        return proveNativeSnapshot({ filePath, directory, assertOwned, transactions,
          isTransaction: () => db.isTransaction, openReader: () => new Database(filePath, { readOnly: true }) },
        get => validatePersistedRequest(get, coverage, input));
      } catch { throw new Error('Persisted request proof unavailable'); }
    },
    provePersistedSelection(input, coverage) {
      if (closed || transactions.isHealthy()) throw new Error('Persisted selection proof unavailable');
      clearInterval(checkpointTimer);
      try {
        return proveNativeSnapshot({ filePath, directory, assertOwned, transactions,
          isTransaction: () => db.isTransaction, openReader: () => new Database(filePath, { readOnly: true }) },
        (get, all) => validatePersistedSelection(get, all, coverage, input));
      } catch { throw new Error('Persisted selection proof unavailable'); }
    },
    close() {
      clearInterval(checkpointTimer);
      gracefulClose();
    },
  };
}
