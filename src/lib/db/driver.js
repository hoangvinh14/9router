import { ensureDirs, DATA_FILE } from "./paths.js";
import { DATA_DIR } from "../dataDir.js";
import { acquireWriterOwnership } from "./writerOwnership.js";
import { initializeAvailableAdapter } from "./engineAcquisition.js";

// Use global to survive Next.js dev hot-reload (module state resets on reload)
if (!global._dbAdapter) global._dbAdapter = { instance: null, initPromise: null, logged: false };
const state = global._dbAdapter;

async function tryBunSqlite() {
  // Bun runtime only — built-in, no install needed
  if (!process.versions.bun) return null;
  return initializeAvailableAdapter("bun:sqlite", () => import("bun:sqlite"),
    () => import("./adapters/bunSqliteAdapter.js"),
    ({ createBunSqliteAdapter }) => createBunSqliteAdapter(DATA_FILE, state.owner));
}

async function tryBetterSqlite() {
  // Skip on Bun — better-sqlite3 native bindings unsupported
  if (process.versions.bun) return null;
  // Skip on Node >= 24: the native addon SIGSEGVs on load there, which is a
  // process-level crash the try/catch below cannot recover from. node:sqlite covers it.
  const [nodeMajor] = process.versions.node.split(".").map(Number);
  if (nodeMajor >= 24) return null;
  return initializeAvailableAdapter("better-sqlite3", () => import("better-sqlite3"),
    () => import("./adapters/betterSqliteAdapter.js"),
    ({ createBetterSqliteAdapter }) => createBetterSqliteAdapter(DATA_FILE, state.owner));
}

async function tryNodeSqlite() {
  // Built-in since Node 22.5.0 — no install needed. Skip under Bun (no node:sqlite).
  if (process.versions.bun) return null;
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < 22 || (maj === 22 && min < 5)) return null;
  return initializeAvailableAdapter("node:sqlite", () => import("node:sqlite"),
    () => import("./adapters/nodeSqliteAdapter.js"),
    ({ createNodeSqliteAdapter }) => createNodeSqliteAdapter(DATA_FILE, state.owner));
}

async function trySqlJs() {
  const { createSqlJsAdapter } = await import("./adapters/sqljsAdapter.js");
  return createSqlJsAdapter(DATA_FILE, state.owner);
}

async function initializeOwnedAdapter() {
  // Ownership precedes directory maintenance, adapter file load, timers and migration.
  state.owner = acquireWriterOwnership(DATA_DIR);
  ensureDirs();
  // Order per runtime:
  //   Bun:  bun:sqlite → sql.js
  //   Node: better-sqlite3 → node:sqlite (≥22.5) → sql.js
  let adapter = await tryBunSqlite();
  if (!adapter) adapter = await tryBetterSqlite();
  if (!adapter) adapter = await tryNodeSqlite();
  if (!adapter) adapter = await trySqlJs();
  if (!adapter) throw new Error("[DB] No SQLite driver available (bun/better/node/sql.js all failed)");
  state.initializingAdapter = adapter;

  if (!state.logged) {
    console.log(`[DB] Driver: ${adapter.driver} | file: ${DATA_FILE}`);
    state.logged = true;
  }

  const { runMigrationOnce } = await import("./migrate.js");
  await runMigrationOnce(adapter);
  adapter.durableTransaction(() => {});
  const { openAccountingCoverage } = await import("./accountingCoverage.js");
  adapter.coverage = openAccountingCoverage(adapter, state.owner);
  const { retainKeyBindings } = await import("./helpers/apiKeyBindings.js");
  adapter.durableTransaction(() => {
    const retired = adapter.coverage.retiredBindings();
    for (const binding of retired) {
      const existing = adapter.get("SELECT * FROM apiKeyBindings WHERE apiKeyId=? OR fingerprint=?", [binding.apiKeyId, binding.fingerprint]);
      if (existing && (existing.apiKeyId !== binding.apiKeyId || existing.fingerprint !== binding.fingerprint)) throw new Error("Restored key binding conflict");
      adapter.run("INSERT OR IGNORE INTO apiKeyBindings(apiKeyId,fingerprint,createdAt,retiredAt) VALUES(?,?,?,?)", [binding.apiKeyId, binding.fingerprint, binding.retiredAt, binding.retiredAt]);
      adapter.run("UPDATE apiKeyBindings SET retiredAt=? WHERE apiKeyId=?", [binding.retiredAt, binding.apiKeyId]);
      adapter.run("UPDATE apiKeys SET isActive=0 WHERE id=?", [binding.apiKeyId]);
    }
    retainKeyBindings(adapter, adapter.coverage, adapter.all("SELECT * FROM apiKeys").filter(k => !retired.some(b => b.apiKeyId === k.id)));
    adapter.run(`UPDATE usageHistory SET apiKeyId=(SELECT id FROM apiKeys WHERE apiKeys.key=usageHistory.apiKey)
      WHERE apiKeyId IS NULL AND apiKey IS NOT NULL AND EXISTS(SELECT 1 FROM apiKeys WHERE apiKeys.key=usageHistory.apiKey)`);
    if (state.owner.recoveredOwnerInstanceId) adapter.run("UPDATE apiKeyAccounting SET state='unresolved',outcome='network_unknown',finishedAt=?,resolutionVersion=resolutionVersion+1 WHERE state='pending' AND ownerInstanceId=?", [new Date().toISOString(), state.owner.recoveredOwnerInstanceId]);
  });
  const owner = state.owner;
  const originalClose = adapter.close.bind(adapter);
  let closed = false;
  const onExit = () => { try { adapter.close(); } catch { console.error("[DB] writer shutdown unavailable"); } };
  const onSignal = () => { onExit(); process.exit(0); };
  adapter.close = () => {
    if (closed) return;
    process.removeListener("beforeExit", onExit);
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    // A graceful stop with live intents is still ambiguous. Keep the owner
    // record until process death can be proved; a subsequent owner then marks
    // those pending attempts unresolved rather than silently releasing them.
    const healthy = adapter.health().healthy;
    const hasPending = !healthy || adapter.get("SELECT COUNT(*) AS count FROM apiKeyAccounting WHERE state='pending' AND ownerInstanceId=?", [owner.instanceId]).count > 0;
    originalClose();
    if (!hasPending) owner.release();
    closed = true;
    if (state.instance === adapter) {
      state.instance = null;
      state.initPromise = null;
    }
  };
  // Driver decides pending recovery before adapter shutdown hooks close reads.
  process.prependOnceListener("beforeExit", onExit);
  process.prependOnceListener("SIGINT", onSignal);
  process.prependOnceListener("SIGTERM", onSignal);
  adapter.ownerInstanceId = state.owner.instanceId;
  adapter.recoveredOwnerInstanceId = state.owner.recoveredOwnerInstanceId;
  state.initializingAdapter = null;
  return adapter;
}

async function initAdapter() {
  try { return await initializeOwnedAdapter(); }
  catch (error) {
    // Stop timers/flush hooks before releasing a failed initialization's owner.
    // If stopping/flush itself fails, retain exclusion instead of allowing a
    // second writer to race uncertain in-memory state.
    try {
      state.initializingAdapter?.close();
      state.initializingAdapter = null;
      state.owner?.release();
    } catch { console.error("[DB] initialization failed; writer exclusion retained"); }
    throw error;
  }
}

export async function getAdapter() {
  if (state.instance) { state.owner.assertOwned(); return state.instance; }
  if (!state.initPromise) state.initPromise = initAdapter().then((a) => { state.instance = a; return a; });
  return state.initPromise;
}

export function getAdapterSync() {
  if (!state.instance) throw new Error("[DB] adapter not initialized — await getAdapter() first");
  state.owner.assertOwned();
  return state.instance;
}
