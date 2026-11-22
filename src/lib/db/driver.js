import { ensureDirs, DATA_FILE } from "./paths.js";
import { stripNullBytes } from "./helpers/nullBytes.js";
import { faultAccounting } from "../accounting/process-state.js";
import { quarantineNodeAccountingConnection } from "../accounting/node-outer-transaction.js";

// Use global to survive Next.js dev hot-reload (module state resets on reload)
if (!global._dbAdapter) global._dbAdapter = { instance: null, initPromise: null, logged: false };
const state = global._dbAdapter;

async function tryBunSqlite() {
  // Bun runtime only — built-in, no install needed
  if (!process.versions.bun) return null;
  try {
    const { createBunSqliteAdapter } = await import("./adapters/bunSqliteAdapter.js");
    return await createBunSqliteAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] bun:sqlite unavailable: ${e.message}`);
    return null;
  }
}

async function tryBetterSqlite() {
  // Skip on Bun — better-sqlite3 native bindings unsupported
  if (process.versions.bun) return null;
  // Skip on Node >= 24: the native addon SIGSEGVs on load there, which is a
  // process-level crash the try/catch below cannot recover from. node:sqlite covers it.
  const [nodeMajor] = process.versions.node.split(".").map(Number);
  if (nodeMajor >= 24) return null;
  try {
    const { createBetterSqliteAdapter } = await import("./adapters/betterSqliteAdapter.js");
    return createBetterSqliteAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] better-sqlite3 unavailable: ${e.message}`);
    return null;
  }
}

async function tryNodeSqlite(requireMarked = false) {
  // Built-in since Node 22.5.0 — no install needed. Skip under Bun (no node:sqlite).
  if (process.versions.bun) return null;
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < 22 || (maj === 22 && min < 5)) return null;
  let attempt;
  try {
    const { openInstalledNodeSqliteAttempt } = await import("./adapters/nodeSqliteAdapter.js");
    attempt = await openInstalledNodeSqliteAttempt(DATA_FILE, { requireMarked });
  } catch (e) {
    console.warn(`[DB] node:sqlite unavailable: ${e?.message || 'initialization failed'}`);
    return null;
  }
  // Internal opener disposition, never a client error property. Refusal must
  // escape ordinary engine fallback even when raw cleanup is unconfirmed.
  if (!attempt.ok && attempt.phase === 'startup_refused') {
    state.accountingOpenFault = true;
    state.accountingRetired = true;
    faultAccounting();
    state.accountingInitCleanup = Object.freeze({ attempted: true,
      closure: attempt.closure === 'confirmed' ? 'confirmed' : 'unknown', checkpoint: 'not_attempted' });
    throw attempt.error;
  }
  try {
    if (!attempt.ok) {
      // Ordinary fallback stays compatible. Accounting must never consume a
      // later engine as successful recovery from an uncertain/failed open.
      if (attempt.phase !== 'unavailable_before_open') state.accountingOpenFault = true;
      throw attempt.error;
    }
    state.accountingNodeRaw = attempt.adapter.raw;
    state.accountingCloseStrict = attempt.closeStrict;
    return attempt.adapter;
  } catch (e) {
    console.warn(`[DB] node:sqlite unavailable: ${e?.message || 'initialization failed'}`);
    return null;
  }
}

async function trySqlJs() {
  try {
    const { createSqlJsAdapter } = await import("./adapters/sqljsAdapter.js");
    return await createSqlJsAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] sql.js unavailable: ${e.message}`);
    return null;
  }
}

/**
 * Make every bound string NUL-safe, once, for all drivers.
 *
 * SQLite stores TEXT as a NUL-terminated C string, so a bound string with an
 * embedded NUL is rejected by better-sqlite3 ("String contains null byte") and
 * silently truncated by node:sqlite. Values that carry raw bytes — a model id
 * or endpoint from the request, tool output, a diff — can contain one, and the
 * write then either aborts the flush worker or loses the tail without a
 * trace. Sanitising at the binding boundary covers every driver and every
 * column type with a single rule, instead of one call site at a time.
 *
 * @param {object} adapter
 * @returns {object} adapter with NUL-safe run/get/all
 */
function withNullByteSafeParams(adapter) {
  const clean = (params) => (Array.isArray(params) ? params.map(stripNullBytes) : params);
  return {
    ...adapter,
    run: (sql, params = []) => adapter.run(sql, clean(params)),
    get: (sql, params = []) => adapter.get(sql, clean(params)),
    all: (sql, params = []) => adapter.all(sql, clean(params)),
  };
}

async function initAdapter(requireMarked = false) {
  if (!requireMarked) ensureDirs();
  // Order per runtime:
  //   Bun:  bun:sqlite → sql.js
  //   Node: better-sqlite3 → node:sqlite (≥22.5) → sql.js
  let adapter;
  if (!requireMarked) {
    adapter = await tryBunSqlite();
    if (!adapter) adapter = await tryBetterSqlite();
  }
  if (!adapter) adapter = await tryNodeSqlite(requireMarked);
  if (!adapter && !requireMarked) adapter = await trySqlJs();
  if (!adapter) throw new Error("[DB] No SQLite driver available (bun/better/node/sql.js all failed)");

  // Capture the acquired connection and its opener-owned cleanup before any
  // wrapping/logging/import/await. Never infer strict closure from driver name.
  const acquired = adapter;
  const closeStrict = state.accountingNodeRaw === acquired.raw && typeof state.accountingCloseStrict === 'function'
    ? state.accountingCloseStrict : null;
  try {
    adapter = withNullByteSafeParams(acquired);
    if (!state.logged) {
      console.log(`[DB] Driver: ${adapter.driver} | file: ${DATA_FILE}`);
      state.logged = true;
    }
    const { runMigrationOnce } = await import("./migrate.js");
    await runMigrationOnce(adapter);
    return adapter;
  } catch (error) {
    // No publication/reopen/fallback after an acquired connection fails init.
    // Retirement cannot prevent cleanup; neither may replace the primary error.
    state.accountingOpenFault = true;
    state.accountingRetired = true;
    try { faultAccounting(); } catch {}
    try { quarantineNodeAccountingConnection(acquired); } catch {}
    let disposition = { attempted: true, closure: 'unknown', checkpoint: 'unknown' };
    try {
      if (closeStrict) {
        const result = closeStrict();
        disposition = { attempted: true,
          closure: result?.closure === 'confirmed' ? 'confirmed' : 'unknown',
          checkpoint: ['confirmed', 'failed', 'not_attempted'].includes(result?.checkpoint) ? result.checkpoint : 'unknown' };
      } else acquired.close(); // Ordinary best effort is NOT strict confirmation.
    } catch {}
    state.accountingInitCleanup = Object.freeze(disposition);
    throw error;
  }
}

export async function getAdapter() {
  if (state.instance) return state.instance;
  if (!state.initPromise) state.initPromise = initAdapter().then((a) => { state.instance = a; return a; });
  return state.initPromise;
}

// Offline operator only, in a fresh process with an exclusively controlled DB.
// No directory initialization, legacy migration or alternate-engine fallback.
export async function getMarkedAccountingAdapterForOfflineCheck() {
  if (state.instance || state.initPromise) throw new Error('Offline accounting check requires fresh acquisition');
  state.initPromise = initAdapter(true).then(a => { state.instance = a; return a; });
  return getAccountingAdapter();
}

// Opt-in internal capability on the SAME installed application connection.
// No second opener/DB, migration, schema creation or alternative-engine fallback.
// Unknown old HMR provenance is refused, never inferred from driver label/raw.
export async function getAccountingAdapter() {
  const { assertAccountingHealthy, faultAccounting } = await import('../accounting/process-state.js');
  const { unavailable } = await import('../accounting/attempt-payload.js');
  assertAccountingHealthy();
  let adapter;
  try { adapter = await getAdapter(); }
  catch { faultAccounting(); throw unavailable(); }
  assertAccountingHealthy();
  if (state.accountingOpenFault) { faultAccounting(); throw unavailable(); }
  if (adapter.driver !== 'node:sqlite' || state.accountingNodeRaw !== adapter.raw ||
      typeof state.accountingCloseStrict !== 'function' || state.accountingRetired || adapter.raw?.isOpen !== true) throw unavailable();
  const { quarantineNodeAccountingConnection } = await import('../accounting/node-outer-transaction.js');
  assertAccountingHealthy();
  if (!state.accountingCloseWrapped) {
    const closeStrict = state.accountingCloseStrict;
    adapter.close = () => {
      // Opt-in retirement precedes native close, even when close throws before
      // executing and isOpen remains true. Ordinary best-effort result retained.
      state.accountingRetired = true;
      let retirementFailed = false;
      try { quarantineNodeAccountingConnection(adapter); }
      catch { retirementFailed = true; faultAccounting(); }
      // A failed retirement must never skip native cleanup or regain authority.
      // Retain sanitized independent outcomes, not errors/credentials/causes.
      let closure = 'unknown'; let checkpoint = 'unknown';
      try {
        const result = closeStrict();
        closure = result?.closure === 'confirmed' ? 'confirmed' : 'unknown';
        if (['confirmed', 'failed', 'not_attempted'].includes(result?.checkpoint)) checkpoint = result.checkpoint;
      } catch { faultAccounting(); }
      if (retirementFailed || closure !== 'confirmed' || checkpoint === 'failed' || checkpoint === 'unknown') faultAccounting();
      state.accountingCloseDisposition = Object.freeze({ retirementFailed, closure, checkpoint });
    };
    state.accountingCloseWrapped = true;
  }
  // Close can occur while the accounting guard module loads.
  if (state.accountingRetired || state.accountingNodeRaw !== adapter.raw || adapter.raw.isOpen !== true) throw unavailable();
  assertAccountingHealthy();
  return adapter;
}

export function getAdapterSync() {
  if (!state.instance) throw new Error("[DB] adapter not initialized — await getAdapter() first");
  return state.instance;
}
