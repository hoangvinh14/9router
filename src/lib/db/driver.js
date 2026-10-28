import { ensureDirs, DATA_FILE } from "./paths.js";
import { acquireWriterOwnership } from "./writerOwnership.js";
import { initializeAvailableAdapter } from "./engineAcquisition.js";
import { openAccountingCoverage } from "./accounting-coverage.js";
import { initializeKeyBindings } from "./helpers/api-key-bindings.js";
import { installAccountingLifecycle } from "./accounting-lifecycle.js";
import { createPersistedRequestAuthority } from "../accounting/persisted-request-authority.js";

// Adapter and initialization lease survive Next HMR. Never recover by opening a
// second writable engine while a failed/uncertain initialization still owns it.
const state = global._dbAdapter ??= { instance: null, initPromise: null, logged: false };

async function selectAdapter(owner) {
  if (process.versions.bun) {
    const adapter = await initializeAvailableAdapter("bun:sqlite", () => import("bun:sqlite"),
      () => import("./adapters/bunSqliteAdapter.js"),
      ({ createBunSqliteAdapter }) => createBunSqliteAdapter(DATA_FILE, owner));
    if (adapter) return adapter;
  } else {
    const [major, minor] = process.versions.node.split(".").map(Number);
    // The addon may SIGSEGV on Node24; availability cannot be caught there.
    if (major < 24) {
      const adapter = await initializeAvailableAdapter("better-sqlite3", () => import("better-sqlite3"),
        () => import("./adapters/betterSqliteAdapter.js"),
        ({ createBetterSqliteAdapter }) => createBetterSqliteAdapter(DATA_FILE, owner));
      if (adapter) return adapter;
    }
    if (major > 22 || major === 22 && minor >= 5) {
      const adapter = await initializeAvailableAdapter("node:sqlite", () => import("node:sqlite"),
        () => import("./adapters/nodeSqliteAdapter.js"),
        ({ createNodeSqliteAdapter }) => createNodeSqliteAdapter(DATA_FILE, owner));
      if (adapter) return adapter;
    }
  }
  const { createSqlJsAdapter } = await import("./adapters/sqljsAdapter.js");
  return createSqlJsAdapter(DATA_FILE, owner);
}
async function initAdapter() {
  const owner = acquireWriterOwnership(DATA_FILE);
  let adapter, selectionStarted = false;
  try {
    ensureDirs();
    // If the factory fails it owns cleanup. The driver cannot prove that an
    // arbitrary thrown factory closed its engine; never release it here.
    selectionStarted = true;
    adapter = await selectAdapter(owner);
    const { runMigrationOnce } = await import("./migrate.js");
    await runMigrationOnce(adapter);
    adapter.durableTransaction(() => {});
    adapter.coverage = openAccountingCoverage(adapter, owner);
    adapter.ownerInstanceId = owner.instanceId;
    adapter.durableTransaction(() => initializeKeyBindings(adapter, adapter.coverage));
    installAccountingLifecycle(adapter);
    const close = adapter.close.bind(adapter);
    adapter.close = () => {
      close();
      if (state.instance === adapter) { state.instance = null; state.initPromise = null; }
    };
    if (!state.logged) { console.log(`[DB] Driver: ${adapter.driver} | file: ${DATA_FILE}`); state.logged = true; }
    return adapter;
  } catch (error) {
    if (adapter) {
      try { adapter.close(); } catch { console.error("[DB] failed initialization retains writer exclusion"); }
    } else if (!selectionStarted) owner.release();
    throw error;
  }
}
export async function getAdapter() {
  if (state.instance) {
    if (!state.instance.health().healthy) throw new Error("Database storage unavailable");
    return state.instance;
  }
  if (!state.initPromise) state.initPromise = initAdapter().then(adapter => { state.instance = adapter; return adapter; });
  return state.initPromise;
}
export function getAdapterSync() {
  if (!state.instance || !state.instance.health().healthy) throw new Error("Database storage unavailable or not initialized");
  return state.instance;
}

// An already initialized lifetime only: no replacement writer, poisoned normal
// reads or startup repair. The returned capability exposes no adapter methods.
export function getPersistedRequestAuthority() {
  if (!state.instance) throw new Error("Accounting storage not initialized");
  return createPersistedRequestAuthority(state.instance);
}
