import { PRAGMA_SQL } from "../schema.js";
import { assertManagedSql, assertReadSql } from "../durableFile.js";
import { nativeTransactions, verifyNativeDurability } from "./nativeDurability.js";
import { validateAccountingArtifacts } from "../accounting-coverage.js";

// Engine construction and ownership acquisition happen in the runtime factory.
export function wrapNativeAdapter(db, owner, driver, closeEngine = () => db.close()) {
  let closed = false, released = false, closeFailed = false, timer;
  const statements = new Map();
  const assertOpen = () => { owner.assertOwned(); if (closed || closeFailed) throw new Error("Database adapter closed or close failed"); };
  const transactions = nativeTransactions(db, assertOpen);
  function prepare(sql) {
    transactions.assertHealthy(); assertManagedSql(sql);
    let statement = statements.get(sql);
    if (!statement) {
      if (statements.size >= 128) statements.delete(statements.keys().next().value);
      statement = db.prepare(sql); statements.set(sql, statement);
    }
    return statement;
  }
  function checkpoint() { transactions.assertHealthy(); db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); }
  function shutdown() {
    try { adapter.close(); return true; }
    catch { console.error("[DB] writer shutdown unavailable"); return false; }
  }
  function signal() { const closed = shutdown(); setImmediate(() => process.exit(closed ? 0 : 1)); }
  const adapter = {
    driver,
    run(sql, params = []) {
      const result = prepare(sql).run(...params);
      return { changes: Number(result.changes ?? 0), lastInsertRowid: Number(result.lastInsertRowid ?? 0) };
    },
    get(sql, params = []) { assertReadSql(sql); return prepare(sql).get(...params); },
    all(sql, params = []) { assertReadSql(sql); return prepare(sql).all(...params); },
    exec(sql) { transactions.assertHealthy(); assertManagedSql(sql); return db.exec(sql); },
    transaction: transactions.transaction,
    durableTransaction: transactions.durableTransaction,
    canMemoizePricing: transactions.canMemoizePricing,
    health() {
      let owned = true; try { owner.assertOwned(); } catch { owned = false; }
      return { healthy: owned && !closed && !closeFailed && !transactions.status().poisoned, closed, poisoned: closeFailed || transactions.status().poisoned, owned, durability: "wal-full" };
    },
    checkpoint,
    close() {
      if (transactions.status().depth) throw new Error("Cannot close database inside transaction");
      if (released) return;
      if (closed) { owner.release(); released = true; return; }
      adapter.beforeClose?.();
      clearInterval(timer);
      process.removeListener("beforeExit", shutdown);
      process.removeListener("SIGINT", signal); process.removeListener("SIGTERM", signal);
      // Never release ownership unless the engine really closed. Failure keeps
      // exclusion; a checkpoint is optimization, not an ACK of prior failures.
      statements.clear();
      try { closeEngine(); closed = true; }
      catch (error) { closeFailed = true; throw error; }
      owner.release(); released = true;
    },
  };
  try {
    validateAccountingArtifacts((sql, params = []) => db.prepare(sql).get(...params), owner.directory);
    db.exec(PRAGMA_SQL);
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    verifyNativeDurability(db);
    timer = setInterval(() => { try { checkpoint(); } catch { /* health gate stays authoritative */ } }, 60_000);
    timer.unref?.();
    process.once("beforeExit", shutdown);
    process.once("SIGINT", signal); process.once("SIGTERM", signal);
    return adapter;
  } catch (error) {
    // This close must succeed before releasing the failed initialization lease.
    closeEngine(); closed = true; owner.release();
    throw error;
  }
}
