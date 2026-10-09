import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

// A successful return means file data and the rename's directory entry were fsynced.
// Failure after rename is an uncertain acknowledgement, never a rollback guarantee.
export function atomicDurableWrite(file, data) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, file);
    fsyncDirectory(path.dirname(file));
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

export function fsyncDirectory(directory) {
  const fd = fs.openSync(directory, "r");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

export function synchronousResult(result) {
  if (result && typeof result.then === "function") {
    // Observe a rejected promise without admitting async transaction work.
    Promise.resolve(result).catch(() => {});
    throw new Error("Database transaction callback must be synchronous");
  }
  return result;
}
