import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dirs = [];
function temp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-durable-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function child(script, args = []) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", script, ...args], { cwd: root, encoding: "utf8" });
}
const ownerImport = 'import { acquireWriterOwnership } from "./src/lib/db/writerOwnership.js";';

describe("pre-open single writer ownership", () => {
  it("rejects a second process and alias directory without changing the lock", async () => {
    const { acquireWriterOwnership } = await import("../../src/lib/db/writerOwnership.js");
    const dir = temp();
    const owner = acquireWriterOwnership(dir);
    const before = fs.readFileSync(owner.lockPath);
    const other = child(`${ownerImport} acquireWriterOwnership(process.argv[1]);`, [dir]);
    expect(other.status).not.toBe(0);
    expect(other.stderr).toContain("writer");
    const alias = path.join(temp(), "alias");
    fs.symlinkSync(dir, alias);
    expect(child(`${ownerImport} acquireWriterOwnership(process.argv[1]);`, [alias]).status).not.toBe(0);
    expect(fs.readFileSync(owner.lockPath)).toEqual(before);
    owner.release();
  });
  it("recovers only a proved dead owner; two contenders cannot both win", async () => {
    const dir = temp();
    const first = child(`${ownerImport} const o = acquireWriterOwnership(process.argv[1]); console.log(o.instanceId);`, [dir]);
    expect(first.status).toBe(0);
    const { acquireWriterOwnership } = await import("../../src/lib/db/writerOwnership.js");
    const owner = acquireWriterOwnership(dir);
    expect(owner.recoveredOwnerInstanceId).toBe(first.stdout.trim());
    expect(child(`${ownerImport} acquireWriterOwnership(process.argv[1]);`, [dir]).status).not.toBe(0);
    owner.release();
  });
  it("simultaneous dead-owner contenders have exactly one writable owner", async () => {
    const dir = temp();
    expect(child(`${ownerImport} acquireWriterOwnership(process.argv[1]);`, [dir]).status).toBe(0);
    const script = `${ownerImport} process.stdin.once("data",()=>{try{const o=acquireWriterOwnership(process.argv[1]);process.stdout.write("OWNER\\n");process.stdin.resume();}catch{process.stdout.write("DENIED\\n");process.exit(0);}});`;
    const workers = [0, 1].map(() => spawn(process.execPath, ["--input-type=module", "-e", script, dir], { cwd: root, stdio: ["pipe", "pipe", "pipe"] }));
    const results = workers.map(worker => new Promise((resolve, reject) => {
      worker.stdout.once("data", data => resolve(data.toString().trim()));
      worker.once("error", reject);
      worker.once("exit", code => { if (code !== 0) reject(new Error(`contender failed: ${code}`)); });
    }));
    for (const worker of workers) worker.stdin.write("go");
    expect((await Promise.all(results)).sort()).toEqual(["DENIED", "OWNER"]);
    await Promise.all(workers.map(worker => {
      if (worker.exitCode !== null) return Promise.resolve();
      const exited = new Promise(resolve => worker.once("exit", resolve)); worker.kill("SIGKILL"); return exited;
    }));
  });
  it("rejects malformed lock and PID reuse ambiguity", async () => {
    const { acquireWriterOwnership } = await import("../../src/lib/db/writerOwnership.js");
    const dir = temp();
    const owner = acquireWriterOwnership(dir);
    const record = JSON.parse(fs.readFileSync(owner.lockPath, "utf8"));
    owner.release();
    record.startTime = "not-the-live-start-time";
    fs.writeFileSync(owner.lockPath, JSON.stringify(record));
    expect(() => acquireWriterOwnership(dir)).toThrow(/ambiguous|reuse/i);
    fs.writeFileSync(owner.lockPath, "{");
    expect(() => acquireWriterOwnership(dir)).toThrow(/unverifiable|invalid/i);
  });
});

describe("durable SQLite acknowledgement", () => {
  it.each(["intent", "settled", "signal"])("owned ledger %s restart retains costs and recovers only proved orphan pending", mode => {
    const dir = temp();
    const run = action => spawnSync(process.execPath, ["tests/fixtures/accounting-child.mjs", dir, action], { cwd: root, encoding: "utf8", timeout: 15000 });
    const first = run(mode);
    if (mode === "signal") expect(first.status, first.stderr).toBe(0);
    else expect(first.signal, first.stderr).toBe("SIGKILL");
    const second = run("inspect");
    expect(second.status, second.stderr).toBe(0);
    const line = second.stdout.split("\n").find(s => s.startsWith("RESULT:"));
    const attempt = JSON.parse(line.slice(7));
    expect(attempt.state).toBe(mode === "settled" ? "settled" : "unresolved");
    expect(attempt.costNanoUsd).toBe(mode === "settled" ? "31" : null);
  }, 30000);
  it("SQL.js intent survives SIGKILL immediately after ack", async () => {
    const dir = temp();
    const file = path.join(dir, "data.sqlite");
    const script = `import { createSqlJsAdapter } from "./src/lib/db/adapters/sqljsAdapter.js";
      const db = await createSqlJsAdapter(process.argv[1]);
      db.exec("CREATE TABLE ledger (id TEXT PRIMARY KEY, cost INTEGER)");
      db.durableTransaction(() => db.run("INSERT INTO ledger VALUES (?,?)", ["intent", 17]));
      process.stdout.write("ACK\\n"); setInterval(() => {}, 1000);`;
    const worker = spawn(process.execPath, ["--input-type=module", "-e", script, file], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    const ack = await new Promise((resolve, reject) => {
      worker.stdout.once("data", data => resolve(data.toString()));
      worker.once("exit", code => reject(new Error(`child exited before ACK: ${code}`)));
    });
    expect(ack).toContain("ACK");
    const exit = new Promise(resolve => worker.once("exit", resolve));
    worker.kill("SIGKILL");
    await exit;
    const { createSqlJsAdapter } = await import("../../src/lib/db/adapters/sqljsAdapter.js");
    const db = await createSqlJsAdapter(file);
    expect(db.get("SELECT cost FROM ledger WHERE id = ?", ["intent"]).cost).toBe(17);
    db.close();
  });
  it("SQL.js uncertain flush poisons reads/writes/timers and never overwrites persisted state", async () => {
    const { createSqlJsAdapter } = await import("../../src/lib/db/adapters/sqljsAdapter.js");
    const file = path.join(temp(), "data.sqlite");
    const db = await createSqlJsAdapter(file);
    db.durableTransaction(() => { db.exec("CREATE TABLE ledger (cost INTEGER)"); db.run("INSERT INTO ledger VALUES (7)"); });
    const before = fs.readFileSync(file);
    const rename = vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("disk failure"); });
    expect(() => db.durableTransaction(() => db.run("UPDATE ledger SET cost=99"))).toThrow("disk failure");
    rename.mockRestore();
    expect(db.health().healthy).toBe(false);
    expect(() => db.get("SELECT * FROM ledger")).toThrow(/unhealthy/i);
    expect(() => db.run("UPDATE ledger SET cost=101")).toThrow(/unhealthy/i);
    db.close();
    expect(fs.readFileSync(file)).toEqual(before);
    const persisted = await createSqlJsAdapter(file);
    expect(persisted.get("SELECT cost FROM ledger").cost).toBe(7);
    persisted.close();
  });
  it("SQL.js timer is cancelled by durable flush and failed debounce cannot overwrite on close", async () => {
    vi.useFakeTimers();
    const { createSqlJsAdapter } = await import("../../src/lib/db/adapters/sqljsAdapter.js");
    const file = path.join(temp(), "timer.sqlite");
    const db = await createSqlJsAdapter(file);
    try {
      db.durableTransaction(() => { db.exec("CREATE TABLE ledger(cost INTEGER)"); db.run("INSERT INTO ledger VALUES(1)"); });
      const rename = vi.spyOn(fs, "renameSync");
      db.run("UPDATE ledger SET cost=2");
      db.durableTransaction(() => db.run("UPDATE ledger SET cost=3"));
      const calls = rename.mock.calls.length;
      vi.advanceTimersByTime(500);
      expect(rename.mock.calls.length).toBe(calls);
      const persisted = fs.readFileSync(file);
      rename.mockImplementation(() => { throw new Error("debounce failure"); });
      db.run("UPDATE ledger SET cost=4");
      vi.advanceTimersByTime(100);
      expect(db.health().healthy).toBe(false);
      rename.mockRestore(); db.close();
      expect(fs.readFileSync(file)).toEqual(persisted);
    } finally { db.close(); vi.useRealTimers(); }
  });
  it("SQL.js rejects async transactions and rollbacks are persisted coherently", async () => {
    const { createSqlJsAdapter } = await import("../../src/lib/db/adapters/sqljsAdapter.js");
    const file = path.join(temp(), "data.sqlite");
    const db = await createSqlJsAdapter(file);
    db.durableTransaction(() => db.exec("CREATE TABLE ledger (cost INTEGER)"));
    expect(() => db.durableTransaction(async () => db.run("INSERT INTO ledger VALUES (1)"))).toThrow(/synchronous/i);
    expect(() => db.durableTransaction(() => { db.run("INSERT INTO ledger VALUES (2)"); throw new Error("rollback"); })).toThrow("rollback");
    expect(db.all("SELECT * FROM ledger")).toEqual([]);
    db.close();
  });
  it("SQL.js backup is a real independently readable artifact", async () => {
    const { createSqlJsAdapter } = await import("../../src/lib/db/adapters/sqljsAdapter.js");
    const dir = temp(); const db = await createSqlJsAdapter(path.join(dir, "live.sqlite"));
    db.durableTransaction(() => { db.exec("CREATE TABLE ledger (cost INTEGER); CREATE TABLE requestDetails (id TEXT)"); db.run("INSERT INTO ledger VALUES(19)"); });
    const file = path.join(dir, "backup.sqlite");
    db.backupTo(file, ["requestDetails"]);
    const { DatabaseSync } = await import("node:sqlite");
    const copy = new DatabaseSync(file, { readOnly: true });
    expect(copy.prepare("PRAGMA integrity_check").get().integrity_check).toBe("ok");
    expect(copy.prepare("SELECT cost FROM ledger").get().cost).toBe(19);
    expect(copy.prepare("SELECT name FROM sqlite_master WHERE name='requestDetails'").get()).toBeUndefined();
    copy.close(); db.close();
  });
  it.each(["write", "file-fsync", "directory-fsync"])("SQL.js %s failure never acknowledges and blocks later writes", async phase => {
    const { createSqlJsAdapter } = await import("../../src/lib/db/adapters/sqljsAdapter.js");
    const db = await createSqlJsAdapter(path.join(temp(), "live.sqlite"));
    db.durableTransaction(() => db.exec("CREATE TABLE ledger (cost INTEGER)"));
    let injection;
    if (phase === "write") injection = vi.spyOn(fs, "writeFileSync").mockImplementation(() => { throw new Error("injected write failure"); });
    else {
      const real = fs.fsyncSync; let calls = 0;
      injection = vi.spyOn(fs, "fsyncSync").mockImplementation(fd => { calls++; if (calls === (phase === "file-fsync" ? 1 : 2)) throw new Error("injected fsync failure"); return real(fd); });
    }
    expect(() => db.durableTransaction(() => db.run("INSERT INTO ledger VALUES(1)"))).toThrow(/injected/);
    injection.mockRestore();
    expect(db.health().healthy).toBe(false);
    expect(() => db.get("SELECT * FROM ledger")).toThrow(/unhealthy/);
    expect(() => db.run("INSERT INTO ledger VALUES(2)")).toThrow(/unhealthy/);
    db.close();
  });
  it("uncertain native commit poisons reads and transactions; confirmed rollback does not", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const { nativeTransactions } = await import("../../src/lib/db/adapters/nativeDurability.js");
    const raw = new DatabaseSync(path.join(temp(), "live.sqlite"));
    raw.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE ledger(cost INTEGER)");
    const tx = nativeTransactions(raw, () => {});
    expect(() => tx.transaction(() => { raw.exec("INSERT INTO ledger VALUES(1)"); throw new Error("rollback"); })).toThrow("rollback");
    expect(tx.isHealthy()).toBe(true);
    const exec = raw.exec.bind(raw);
    const injection = vi.spyOn(raw, "exec").mockImplementation(sql => { if (sql.startsWith("RELEASE")) throw new Error("commit unavailable"); return exec(sql); });
    expect(() => tx.durableTransaction(() => raw.exec("INSERT INTO ledger VALUES(2)"))).toThrow("commit unavailable");
    injection.mockRestore();
    expect(tx.isHealthy()).toBe(false);
    expect(() => tx.assertUsable()).toThrow(/unhealthy/);
    expect(() => tx.transaction(() => {})).toThrow(/unhealthy/);
    raw.close();
  });
  it("Node durable ack survives process death without close/checkpoint", async () => {
    const file = path.join(temp(), "data.sqlite");
    const result = child(`import { createNodeSqliteAdapter } from "./src/lib/db/adapters/nodeSqliteAdapter.js";
      const db=await createNodeSqliteAdapter(process.argv[1]);
      db.durableTransaction(()=>{db.exec("CREATE TABLE ledger(cost INTEGER)");db.run("INSERT INTO ledger VALUES(31)");});
      process.kill(process.pid,"SIGKILL");`, [file]);
    expect(result.signal).toBe("SIGKILL");
    const { createNodeSqliteAdapter } = await import("../../src/lib/db/adapters/nodeSqliteAdapter.js");
    const db = await createNodeSqliteAdapter(file); expect(db.get("SELECT cost FROM ledger").cost).toBe(31); db.close();
  });
  it("Node native SQLite uses verified WAL/FULL and acknowledges committed rows", async () => {
    const { createNodeSqliteAdapter } = await import("../../src/lib/db/adapters/nodeSqliteAdapter.js");
    const file = path.join(temp(), "data.sqlite");
    const db = await createNodeSqliteAdapter(file);
    expect(db.get("PRAGMA journal_mode").journal_mode).toBe("wal");
    expect(db.get("PRAGMA synchronous").synchronous).toBe(2);
    db.durableTransaction(() => { db.exec("CREATE TABLE ledger (cost INTEGER)"); db.run("INSERT INTO ledger VALUES (23)"); });
    expect(() => db.durableTransaction(async () => {})).toThrow(/synchronous/i);
    db.close();
    const reopened = await createNodeSqliteAdapter(file);
    expect(reopened.get("SELECT cost FROM ledger").cost).toBe(23);
    reopened.close();
  });
});
