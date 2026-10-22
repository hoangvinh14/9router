import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";
import { PRAGMA_SQL } from "../schema.js";
import { atomicDurableWrite, assertManagedSql, assertReadSql, synchronousResult } from "../durableFile.js";
import { claimWriter } from "../writerOwnership.js";

let SQL;
async function loadSql() { return SQL ??= await initSqlJs(); }

export async function createSqlJsAdapter(filePath, suppliedOwner) {
  const SQLLib = await loadSql();
  const { owner, file } = claimWriter(filePath, suppliedOwner);
  let db;
  try {
    db = new SQLLib.Database(fs.existsSync(file) ? fs.readFileSync(file) : null);
    db.exec(PRAGMA_SQL);
  } catch (error) { db?.close(); owner.release(); throw error; }
  let dirty = false, timer = null, closed = false, released = false, poisoned = false, depth = 0;
  let closePublicationFailure;
  const cancel = () => { clearTimeout(timer); timer = null; };
  function assertHealthy() {
    owner.assertOwned();
    if (closed || poisoned) throw new Error("SQL.js adapter unavailable: closed or uncertain persistence");
  }
  function poison() { poisoned = true; cancel(); }
  function persist() {
    assertHealthy(); cancel();
    try { atomicDurableWrite(file, Buffer.from(db.export())); dirty = false; }
    catch (error) { poison(); throw error; }
  }
  function schedule() {
    dirty = true; cancel();
    timer = setTimeout(() => {
      timer = null;
      if (dirty && !closed && !poisoned) {
        try { persist(); } catch { poison(); console.error("[sqljs] persistence unavailable"); }
      }
    }, 100);
    timer.unref?.();
  }
  function statement(sql, params, consume) {
    assertHealthy(); assertManagedSql(sql);
    const stmt = db.prepare(sql);
    try { stmt.bind(!params || Array.isArray(params) && !params.length ? undefined : params); return consume(stmt); }
    finally { stmt.free(); }
  }
  function run(sql, params = []) {
    return statement(sql, params, stmt => {
      try {
        stmt.step();
        const changes = db.getRowsModified();
        const lastInsertRowid = db.exec("SELECT last_insert_rowid() AS id")[0]?.values?.[0]?.[0] ?? null;
        return { changes, lastInsertRowid };
      } finally { schedule(); }
    });
  }
  function transaction(fn) {
    assertHealthy();
    if (typeof fn !== "function" || fn.constructor?.name === "AsyncFunction") throw new Error("Database transaction callback must be synchronous");
    const sp = `sp_${depth}_${Math.random().toString(36).slice(2)}`;
    const previousDirty = dirty;
    db.exec(`SAVEPOINT ${sp}`); depth++;
    let releasing = false;
    try {
      const result = fn();
      if (result && typeof result.then === "function") poison();
      synchronousResult(result); assertHealthy();
      releasing = true; db.exec(`RELEASE ${sp}`); schedule();
      return result;
    } catch (error) {
      if (releasing) poison();
      try { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); dirty = previousDirty; }
      catch { poison(); }
      throw error;
    } finally { depth--; }
  }
  function flush() { if (dirty && !closed && !poisoned) { try { persist(); } catch { poison(); console.error("[sqljs] shutdown persistence unavailable"); } } }
  const adapter = {
    driver: "sql.js", run,
    get(sql, params = []) { assertReadSql(sql); return statement(sql, params, stmt => stmt.step() ? stmt.getAsObject() : undefined); },
    all(sql, params = []) { assertReadSql(sql); return statement(sql, params, stmt => { const rows = []; while (stmt.step()) rows.push(stmt.getAsObject()); return rows; }); },
    exec(sql) {
      assertHealthy(); assertManagedSql(sql);
      // SQLite exec batches are not implicitly atomic. Earlier statements may
      // have changed the image even if a later one fails.
      try { return db.exec(sql); } finally { schedule(); }
    },
    transaction,
    durableTransaction(fn) {
      assertHealthy(); if (depth) throw new Error("Durable transaction must be outermost");
      const result = transaction(fn); persist(); return result;
    },
    canMemoizePricing() { assertHealthy(); return depth === 0 && !dirty; },
    health() {
      let owned = true; try { owner.assertOwned(); } catch { owned = false; }
      return { healthy: owned && !closed && !poisoned, owned, closed, poisoned, durability: "atomic-fsync", dirty };
    },
    backupTo(destination, excludedTables = []) {
      assertHealthy(); if (depth) throw new Error("Backup must be outside transaction");
      const parent = fs.realpathSync(path.dirname(path.resolve(destination)));
      if (parent === path.dirname(file) || fs.existsSync(destination)) throw new Error("Backup destination must be a new file outside live database directory");
      // Back up the acknowledged file, not dirty RAM. Publishing here follows
      // the same ACK contract; a failed original ACK stays failed/poisoned.
      if (dirty) persist();
      const clone = new SQLLib.Database(fs.readFileSync(file));
      try {
        for (const table of excludedTables) {
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new Error("Invalid backup table");
          clone.exec(`DROP TABLE IF EXISTS ${table}`);
        }
        atomicDurableWrite(path.join(parent, path.basename(destination)), Buffer.from(clone.export()));
      } finally { clone.close(); }
    },
    close() {
      if (depth) throw new Error("Cannot close database inside transaction");
      if (released) return;
      // A release collision is retryable after engine closure; an uncertain
      // publication during close is not. Never export or close the engine twice.
      if (closed) {
        if (closePublicationFailure) throw closePublicationFailure;
        owner.release(); released = true; return;
      }
      cancel(); process.removeListener("beforeExit", flush); process.removeListener("SIGINT", flush); process.removeListener("SIGTERM", flush);
      // A poisoned image is never exported, even on close. Lost authority also
      // discards RAM rather than overwriting a replacement owner's database.
      if (dirty && !poisoned) { try { persist(); } catch (error) { closePublicationFailure = error; } }
      try { db.close(); closed = true; }
      catch (error) { poison(); throw error; }
      if (closePublicationFailure) throw closePublicationFailure; // retain exclusion on failed close publication
      owner.release(); released = true;
    },
  };
  process.on("beforeExit", flush); process.on("SIGINT", flush); process.on("SIGTERM", flush);
  return adapter;
}
