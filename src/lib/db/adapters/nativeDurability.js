import { synchronousResult } from "../durableFile.js";

export function verifyNativeDurability(db) {
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
  const mode = db.prepare("PRAGMA journal_mode").get();
  const sync = db.prepare("PRAGMA synchronous").get();
  if (mode.journal_mode !== "wal" || Number(sync.synchronous) !== 2) {
    throw new Error("SQLite durable WAL/FULL configuration unavailable");
  }
}

export function nativeTransactions(db, assertHealthy) {
  let depth = 0;
  let unhealthy = false;
  let proving = false;
  function assertUsable() { assertHealthy(); if (unhealthy || proving) throw new Error("SQLite adapter unhealthy: uncertain transaction acknowledgement"); }
  function transaction(fn) {
    assertUsable();
    if (fn.constructor?.name === "AsyncFunction") throw new Error("Database transaction callback must be synchronous");
    const sp = `sp_${Math.random().toString(36).slice(2)}`;
    db.exec(`SAVEPOINT ${sp}`);
    depth++;
    let committing = false;
    try {
      const result = synchronousResult(fn());
      committing = true;
      db.exec(`RELEASE ${sp}`);
      return result;
    } catch (error) {
      if (committing) unhealthy = true;
      try { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); } catch { unhealthy = true; }
      throw error;
    } finally { depth--; }
  }
  function durableTransaction(fn) {
    assertUsable();
    if (depth) throw new Error("Durable transaction must be outermost");
    // PRAGMA can be changed by raw SQL callers; never acknowledge unsafe settings.
    const mode = db.prepare("PRAGMA journal_mode").get();
    const sync = db.prepare("PRAGMA synchronous").get();
    if (mode.journal_mode !== "wal" || Number(sync.synchronous) !== 2) throw new Error("SQLite durable WAL/FULL configuration lost");
    return transaction(fn);
  }
  // Internal adapter seam, never exported as arbitrary SQL on the public API.
  // Permanently poisoned writer becomes quiescent, never healthy again. A new
  // checkpoint/fsync acknowledgement cannot acknowledge the original operation.
  function withQuiescentProof(isTransaction, proof) {
    assertHealthy();
    if (!unhealthy || depth || proving || typeof isTransaction() !== "boolean") throw new Error("Native admission proof unavailable");
    proving = true;
    try {
      if (isTransaction()) db.exec("ROLLBACK");
      if (isTransaction() !== false) throw new Error("Native admission proof transaction not quiescent");
      const mode = db.prepare("PRAGMA journal_mode").get();
      const sync = db.prepare("PRAGMA synchronous").get();
      if (mode.journal_mode !== "wal" || Number(sync.synchronous) !== 2) throw new Error("Native admission proof durability unavailable");
      const checkpoint = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
      if (!checkpoint || checkpoint.busy !== 0 || checkpoint.log !== 0 || checkpoint.checkpointed !== 0) throw new Error("Native admission proof checkpoint incomplete");
      const result = synchronousResult(proof());
      assertHealthy();
      if (isTransaction() !== false) throw new Error("Native admission proof transaction changed");
      return result;
    } finally { proving = false; }
  }
  return { transaction, durableTransaction, assertUsable, isHealthy: () => !unhealthy,
    canMemoizePricing: () => { assertUsable(); return depth === 0; }, withQuiescentProof };
}
