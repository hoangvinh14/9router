import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fsyncDirectory } from "./durableFile.js";

const records = new WeakMap();
function incarnation(pid) {
  try {
    const text = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    return { startTime: text.slice(text.lastIndexOf(")") + 2).split(" ")[19], bootId: fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() };
  } catch { return null; }
}
function readOwner(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4096) throw new Error("Database writer ownership invalid");
  let row;
  try { row = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (cause) { throw new Error("Database writer ownership invalid", { cause }); }
  if (row.version !== 1 || !Number.isSafeInteger(row.pid) || row.pid < 1 || typeof row.directory !== "string" || typeof row.instanceId !== "string" || !row.instanceId) throw new Error("Database writer ownership invalid");
  return row;
}
function proveDead(row, directory) {
  const self = incarnation(process.pid);
  if (process.platform !== "linux" || row.directory !== directory || !row.startTime || !row.bootId || row.bootId !== self?.bootId) throw new Error("Database writer ownership ambiguous; operator recovery required");
  const current = incarnation(row.pid);
  if (current) throw new Error(current.startTime === row.startTime && current.bootId === row.bootId ? "Database writer already active" : "Database writer PID reuse ambiguous; operator recovery required");
  try { process.kill(row.pid, 0); }
  catch (error) { if (error.code === "ESRCH") return; }
  throw new Error("Database writer liveness unverifiable; operator recovery required");
}

export function acquireWriterOwnership(filePath) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  const directory = fs.realpathSync(path.dirname(path.resolve(filePath)));
  const file = path.join(directory, path.basename(filePath));
  const lock = path.join(directory, ".gateway-writer.lock");
  const gate = path.join(directory, ".gateway-writer-acquisition");
  const row = { version: 1, directory, pid: process.pid, instanceId: randomUUID(), ...incarnation(process.pid) };
  function arbitrate(work) {
    try { fs.mkdirSync(gate, { mode: 0o700 }); }
    catch { throw new Error("Database writer acquisition interrupted or in progress; operator recovery required"); }
    try { return work(); }
    finally { fs.rmdirSync(gate); fsyncDirectory(directory); }
  }
  arbitrate(() => {
    if (fs.existsSync(lock)) {
      const old = readOwner(lock); proveDead(old, directory);
      // All cooperating acquisitions/releases are inside the arbitration gate.
      if (readOwner(lock).instanceId !== old.instanceId) throw new Error("Database owner changed");
      fs.unlinkSync(lock); fsyncDirectory(directory);
    }
    const fd = fs.openSync(lock, "wx", 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(row)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fsyncDirectory(directory);
  });
  let removed = false, released = false;
  function releaseLease() {
    if (released) return;
    arbitrate(() => {
      if (!removed) {
        owner.assertOwned(); fs.unlinkSync(lock); removed = true;
      }
      // Only our own successful unlink permits this sync-only retry. A newer
      // owner's record is never inspected, adopted or removed by this lease.
      fsyncDirectory(directory);
    });
    // Arbitration cleanup and its directory sync are part of successful release.
    released = true;
  }
  const owner = Object.freeze({
    directory,
    instanceId: row.instanceId,
    assertOwned() {
      if (removed || released || fs.realpathSync(directory) !== directory || readOwner(lock).instanceId !== row.instanceId) throw new Error("Database writer ownership lost");
    },
    release() {
      if (records.get(owner)?.claimed) throw new Error("Claimed writer release belongs to adapter close");
      releaseLease();
    },
  });
  records.set(owner, { directory, file, claimed: false, releaseLease });
  return owner;
}

// One private token leases exactly one engine lifetime, never two RAM images.
export function claimWriter(filePath, supplied) {
  const owner = supplied ?? acquireWriterOwnership(filePath);
  const record = records.get(owner);
  if (!record || record.claimed || fs.realpathSync(path.dirname(path.resolve(filePath))) !== record.directory || path.basename(filePath) !== path.basename(record.file)) throw new Error("Invalid database writer lease");
  owner.assertOwned();
  try {
    // existsSync follows symlinks and hides dangling entries. Only a genuinely
    // absent directory entry may be treated as a new database path.
    let stat;
    try { stat = fs.lstatSync(record.file); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (stat && (!stat.isFile() || stat.nlink !== 1)) throw new Error("Database path must be a regular single-link file");
    record.claimed = true;
    // Only the claimant receives engine-close release authority. The original
    // pre-open token can no longer unlock a live engine from another caller.
    const lease = Object.freeze({ directory: owner.directory, instanceId: owner.instanceId, assertOwned: owner.assertOwned, release: record.releaseLease });
    return { owner: lease, file: record.file };
  } catch (error) { owner.release(); throw error; }
}
