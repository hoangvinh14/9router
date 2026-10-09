import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fsyncDirectory, synchronousResult } from "./durableFile.js";

// Internal inspection provenance cannot be supplied by replacing public methods.
const ownershipRecords = new WeakMap();
export function withOwnershipInspection(owner, inspect) {
  const state = ownershipRecords.get(owner);
  if (!state || state.inspecting || typeof inspect !== "function" || inspect.constructor?.name === "AsyncFunction") throw new Error("Ownership inspection unavailable");
  state.assertOwned();
  state.inspecting = true;
  try {
    const result = synchronousResult(inspect(state.directory));
    state.assertOwned();
    return result;
  } finally { state.inspecting = false; }
}

// Linux process incarnation is required for automatic dead-owner reclamation.
// Other hosts can acquire a fresh lock, but ambiguous stale locks need an operator.
function incarnation(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return { startTime: fields[19], bootId: fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() };
  } catch { return null; }
}
function readOwner(file) {
  try {
    const row = JSON.parse(fs.readFileSync(file, "utf8"));
    if (row.version !== 1 || !Number.isSafeInteger(row.pid) || row.pid < 1 ||
        typeof row.instanceId !== "string" || typeof row.directory !== "string") throw new Error();
    return row;
  } catch {
    throw new Error("Database writer ownership invalid or unverifiable; operator recovery required");
  }
}
function proveDead(row, directory) {
  if (row.directory !== directory || !row.startTime || !row.bootId) {
    throw new Error("Database writer ownership ambiguous; operator recovery required");
  }
  const current = incarnation(row.pid);
  if (current) {
    if (current.startTime !== row.startTime || current.bootId !== row.bootId) {
      throw new Error("Database writer PID reuse ambiguous; operator recovery required");
    }
    throw new Error("Database writer already active for DATA_DIR");
  }
  // Absence of /proc alone is not proof (permissions/platform/container boundary).
  try { process.kill(row.pid, 0); } catch (error) {
    if (error.code === "ESRCH" && process.platform === "linux" &&
        incarnation(process.pid)?.bootId === row.bootId) return;
  }
  throw new Error("Database writer liveness unverifiable; operator recovery required");
}

export function acquireWriterOwnership(dataDirectory) {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const directory = fs.realpathSync(dataDirectory);
  const lockPath = path.join(directory, ".gateway-writer.lock");
  const recoveryPath = path.join(directory, ".gateway-writer-recovery");
  const processIdentity = incarnation(process.pid);
  const record = { version: 1, directory, pid: process.pid, instanceId: randomUUID(), ...processIdentity };
  let recoveredOwnerInstanceId = null;


  function publish() {
    const fd = fs.openSync(lockPath, "wx", 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(record)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fsyncDirectory(directory);
  }
  // Every acquisition, including fresh publication, takes this arbitration gate.
  // A crash holding it is deliberately operator-recovered, never timed out.
  try { fs.mkdirSync(recoveryPath, { mode: 0o700 }); }
  catch { throw new Error("Database writer acquisition/recovery in progress or interrupted; operator recovery required"); }
  try {
    if (fs.existsSync(lockPath)) {
      const old = readOwner(lockPath);
      proveDead(old, directory);
      fs.unlinkSync(lockPath);
      fsyncDirectory(directory);
      recoveredOwnerInstanceId = old.instanceId;
    }
    publish();
  } finally {
    fs.rmdirSync(recoveryPath);
    fsyncDirectory(directory);
  }
  let released = false;
  const inspection = { directory, inspecting: false, assertOwned: null };
  function assertOwned() {
    if (released || readOwner(lockPath).instanceId !== record.instanceId) throw new Error("Database writer ownership lost");
  }
  function release() {
    if (inspection.inspecting) throw new Error("Writer release during inspection unavailable");
    if (released) return;
    assertOwned();
    fs.unlinkSync(lockPath);
    fsyncDirectory(directory);
    released = true;
  }
  const owner = { instanceId: record.instanceId, recoveredOwnerInstanceId, directory, lockPath, assertOwned, release };
  inspection.assertOwned = assertOwned;
  ownershipRecords.set(owner, inspection);
  return owner;
}
