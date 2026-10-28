import { synchronousResult } from "../durableFile.js";

export function verifyNativeDurability(db) {
  const mode = db.prepare("PRAGMA journal_mode").get();
  const sync = db.prepare("PRAGMA synchronous").get();
  if (mode?.journal_mode !== "wal" || Number(sync?.synchronous) !== 2) throw new Error("SQLite durable WAL/FULL configuration unavailable");
}
export function nativeTransactions(db, assertOpen, publication = {}) {
  let depth = 0, poisoned = false;
  function assertHealthy() { assertOpen(); if (poisoned) throw new Error("SQLite adapter poisoned: uncertain acknowledgement"); }
  function transaction(fn, durable = false) {
    assertHealthy();
    if (typeof fn !== "function" || fn.constructor?.name === "AsyncFunction") throw new Error("Database transaction callback must be synchronous");
    if (durable && depth) throw new Error("Durable transaction must be outermost");
    if (durable) verifyNativeDurability(db);
    if (durable) publication.prepare?.();
    const savepoint = `sp_${depth}_${Math.random().toString(36).slice(2)}`;
    db.exec(`SAVEPOINT ${savepoint}`); depth++;
    let releasing = false;
    try {
      const result = fn();
      if (result && typeof result.then === "function") poisoned = true;
      synchronousResult(result);
      assertHealthy();
      if (durable) verifyNativeDurability(db);
      releasing = true;
      if (durable) publication.beforeRelease?.();
      db.exec(`RELEASE ${savepoint}`);
      if (durable) publication.acknowledge?.();
      return result;
    } catch (error) {
      if (releasing) poisoned = true;
      try { db.exec(`ROLLBACK TO ${savepoint}`); db.exec(`RELEASE ${savepoint}`); }
      catch { poisoned = true; }
      if (durable) publication.fail?.(releasing && depth === 1);
      else if (poisoned) publication.invalidate?.();
      throw error;
    } finally { depth--; }
  }
  return {
    assertHealthy,
    transaction: fn => transaction(fn),
    durableTransaction: fn => transaction(fn, true),
    canMemoizePricing: () => { assertHealthy(); return depth === 0; },
    status: () => ({ poisoned, depth }),
  };
}
