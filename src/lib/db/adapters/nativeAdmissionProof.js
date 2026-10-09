import fs from "node:fs";
import path from "node:path";
import { fsyncDirectory } from "../durableFile.js";
import { validatePersistedUnlimited } from "../unlimitedAdmissionProof.js";

// Runtime-specific caller provides synchronous existing-file readonly open.
// No second writable connection, health restoration, or original-commit ack.
export function proveNativeUnlimited(options) {
  return proveNativeSnapshot(options, get => validatePersistedUnlimited(get, options.coverage, options.apiKeyId));
}

// Validator is internal code, synchronous, and may not retain the readonly reader.
export function proveNativeSnapshot({ filePath, directory, assertOwned, transactions, isTransaction, openReader }, validate) {
  if (!directory) throw new Error("Native admission proof requires writer ownership");
  assertOwned();
  return transactions.withQuiescentProof(isTransaction, () => {
    let fd, reader, result;
    try {
      const wal = filePath + "-wal";
      if (fs.existsSync(wal) && fs.statSync(wal).size !== 0) throw new Error("Native admission proof WAL not empty");
      fd = fs.openSync(filePath, "r");
      const identity = fs.fstatSync(fd);
      if (!identity.isFile()) throw new Error("Native admission proof file unavailable");
      fs.fsyncSync(fd); fsyncDirectory(path.dirname(filePath));
      assertOwned();
      const installed = fs.statSync(filePath);
      if (installed.dev !== identity.dev || installed.ino !== identity.ino || installed.size !== identity.size) throw new Error("Native admission proof file changed");
      reader = openReader();
      reader.exec("PRAGMA query_only=ON; BEGIN");
      const get = (sql, params = []) => reader.prepare(sql).get(...params);
      if (get("PRAGMA journal_mode")?.journal_mode !== "wal" || get("PRAGMA quick_check")?.quick_check !== "ok") throw new Error("Native admission proof snapshot unavailable");
      const all = (sql, params = []) => reader.prepare(sql).all(...params);
      result = validate(get, all);
      reader.exec("ROLLBACK");
    } finally {
      // Cleanup failures must deny: never return a proof before reader closure.
      try { reader?.close(); } finally { if (fd !== undefined) fs.closeSync(fd); }
    }
    assertOwned();
    return result;
  });
}
