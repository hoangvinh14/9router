import { getAdapter } from "../db/driver.js";
import { configureCatalogScheduler, isCatalogSchedulerEnabled } from "./catalogScheduler.js";
import { syncCatalog } from "./catalogSync.js";

const state = global.__referencePricingScheduleCoordinator ??= { tail: Promise.resolve(), handlers: false };
export function readCatalogScheduleSync(db) {
  const row = db.get("SELECT value FROM kv WHERE scope='referencePricing' AND key='schedule'");
  if (!row) return false;
  let value;
  try { value = JSON.parse(row.value); } catch { throw new Error("Invalid stored pricing schedule"); }
  if (!value || Array.isArray(value) || Object.keys(value).length !== 1 || typeof value.enabled !== "boolean") throw new Error("Invalid stored pricing schedule");
  return value.enabled;
}
function healthy(db) {
  if (!db.health().healthy || db.coverage.status().maintenance) throw new Error("Pricing schedule storage unavailable");
}
function scheduledAdmission(db) { healthy(db); if (!readCatalogScheduleSync(db)) throw new Error("Pricing schedule disabled"); }
function reconcile(db) {
  const enabled = readCatalogScheduleSync(db);
  configureCatalogScheduler(enabled, {
    sync: () => syncCatalog({ scheduledAdmission }),
    adapter: getAdapter,
  });
  if (!state.handlers) {
    state.handlers = true;
    for (const signal of ["SIGINT", "SIGTERM", "exit"]) process.once(signal, () => configureCatalogScheduler(false));
  }
  return { schedulerConfigured: enabled, schedulerEnabled: isCatalogSchedulerEnabled() };
}
function coordinated(work) {
  const run = state.tail.then(work);
  state.tail = run.catch(() => {});
  return run;
}
// Default off; explicit startup only, no immediate fetch. The 24h interval starts
// from process configuration, not wall-clock catch-up. GET never invokes this.
export function initializeCatalogSchedule() {
  return coordinated(async () => {
    const db = await getAdapter(); healthy(db);
    return reconcile(db);
  });
}
// Serialization covers persistence and runtime reconciliation, preventing an old
// enable callback from overriding a newer disable. Disable prevents NEW scheduled
// fetches; an already started sync is allowed to finish its last-good publication.
export function setCatalogSchedule(enabled) {
  if (typeof enabled !== "boolean") return Promise.reject(new Error("Invalid pricing schedule"));
  return coordinated(async () => {
    const db = await getAdapter(); healthy(db);
    db.durableTransaction(() => db.run("INSERT INTO kv(scope,key,value) VALUES('referencePricing','schedule',?) ON CONFLICT(scope,key) DO UPDATE SET value=excluded.value", [JSON.stringify({ enabled })]));
    if (!enabled) configureCatalogScheduler(false);
    try { return reconcile(db); }
    catch {
      configureCatalogScheduler(false);
      const error = new Error("Pricing schedule saved; runtime configuration unavailable");
      error.configurationSaved = true;
      throw error;
    }
  });
}
