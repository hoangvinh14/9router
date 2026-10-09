import fs from "node:fs";
import path from "node:path";
import { withOwnershipInspection } from "./writerOwnership.js";
import { fingerprintLogicalSnapshot } from "./logicalFingerprint.js";

const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const unavailable = () => { throw new Error("Logical inspection unavailable"); };
function sameFile(a, b) {
  return a.isFile() && b.isFile() && ["dev", "ino", "size", "mtimeNs", "ctimeNs"].every(field => a[field] === b[field]);
}
function rejectSidecars(file, engine) {
  if (fs.existsSync(`${file}-journal`)) unavailable();
  if (engine === "sql.js") {
    if (fs.existsSync(`${file}-wal`) || fs.existsSync(`${file}-shm`)) unavailable();
  } else if (fs.existsSync(`${file}-wal`) && !fs.existsSync(`${file}-shm`)) {
    // Do not ask SQLite to create a missing WAL-index sidecar for this operation.
    unavailable();
  }
}

// UNUSED ownership-bound inspection, NOT offline/quiescence enforcement.
// Read-only native SQLite may affect SHM locks; no immutable=1, checkpoint,
// fsync, migration or publication. Under cooperative-owner assumptions only:
// descriptor/path checks cannot exclude malicious replace-and-restore races.
// The hash does not certify a live adapter, durable ACK, freshness at return,
// or permission to initialize/adopt/recover. Loading the engine happens BEFORE
// the synchronous lease; ownership is checked again inside and after cleanup.
export async function inspectExistingLogicalSnapshot(file, { owner, engine = "node:sqlite" } = {}) {
  if (!["node:sqlite", "sql.js"].includes(engine)) unavailable();
  let Database, SQL;
  if (engine === "node:sqlite") ({ DatabaseSync: Database } = await import("node:sqlite"));
  else {
    const { default: init } = await import("sql.js");
    SQL = await init();
  }
  return withOwnershipInspection(owner, directory => {
    const expected = path.join(directory, "db", "data.sqlite");
    if (typeof file !== "string" || path.resolve(file) !== expected || fs.realpathSync(path.dirname(file)) !== path.dirname(expected)) unavailable();
    rejectSidecars(file, engine);
    let fd, connection, transaction = false, result, failure;
    const recordFailure = error => { failure ??= error; };
    try {
      if (!Number.isInteger(fs.constants.O_NOFOLLOW)) unavailable();
      fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const initial = fs.fstatSync(fd, { bigint: true });
      if (!initial.isFile() || initial.size > BigInt(MAX_IMAGE_BYTES) || initial.size < 1n || !sameFile(initial, fs.lstatSync(file, { bigint: true }))) unavailable();
      if (engine === "sql.js") {
        const bytes = Buffer.alloc(Number(initial.size));
        let offset = 0;
        while (offset < bytes.length) {
          const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
          if (!count) unavailable();
          offset += count;
        }
        connection = new SQL.Database(bytes);
      } else connection = new Database(file, { readOnly: true });
      const exec = sql => engine === "sql.js" ? connection.run(sql) : connection.exec(sql);
      const reader = { all(sql) {
        if (engine !== "sql.js") return connection.prepare(sql).all();
        const statement = connection.prepare(sql);
        try { const rows = []; while (statement.step()) rows.push(statement.getAsObject()); return rows; }
        finally { statement.free(); }
      } };
      exec("PRAGMA query_only=ON; BEGIN"); transaction = true;
      result = fingerprintLogicalSnapshot(reader);
      exec("ROLLBACK"); transaction = false;
      connection.close(); connection = null;
      rejectSidecars(file, engine);
      if (!sameFile(initial, fs.fstatSync(fd, { bigint: true })) || !sameFile(initial, fs.lstatSync(file, { bigint: true }))) unavailable();
    } catch (error) { recordFailure(error); }
    finally {
      if (connection) {
        if (transaction) { try { if (engine === "sql.js") connection.run("ROLLBACK"); else connection.exec("ROLLBACK"); } catch (error) { recordFailure(error); } }
        try { connection.close(); } catch (error) { recordFailure(error); }
      }
      if (fd !== undefined) { try { fs.closeSync(fd); } catch (error) { recordFailure(error); } }
    }
    if (failure) throw failure;
    return Object.freeze({ ...result, engine, guarantee: "logical-inspection-only" });
  });
}
