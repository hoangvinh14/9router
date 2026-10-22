import { getAdapter } from "../db/driver.js";
import { configureCatalogScheduler, isCatalogSchedulerEnabled } from "./catalogScheduler.js";
import { syncCatalog, assertPricingHealthy, readReferenceRow, writeReferenceRow } from "./catalogSync.js";
import { validateCatalogSchedule, withPricingStateLock } from "./referenceState.js";

export function readCatalogScheduleSync(db) {
  const row = readReferenceRow(db, "schedule");
  return row === null ? false : validateCatalogSchedule(row).enabled;
}
function scheduledAdmission(db) {
  assertPricingHealthy(db);
  if (!readCatalogScheduleSync(db)) throw new Error("Pricing schedule disabled");
}
// Called only inside the shared publication/import/schedule coordinator.
export function reconcileCatalogScheduleSync(db) {
  assertPricingHealthy(db);
  const enabled = readCatalogScheduleSync(db);
  configureCatalogScheduler(enabled, { sync: () => syncCatalog({ scheduledAdmission }), adapter: getAdapter });
  return { schedulerConfigured: enabled, schedulerEnabled: isCatalogSchedulerEnabled() };
}
export function reconcileSavedCatalogScheduleSync(db) {
  try { return reconcileCatalogScheduleSync(db); }
  catch {
    configureCatalogScheduler(false);
    const error = new Error("Pricing configuration saved; runtime configuration unavailable");
    error.configurationSaved = true;
    throw error;
  }
}
// Serving-only explicit invocation. No immediate fetch and no signal handlers.
export function initializeCatalogSchedule() {
  return withPricingStateLock(async () => {
    const db = await getAdapter(); assertPricingHealthy(db);
    db.durableTransaction(() => {});
    return reconcileCatalogScheduleSync(db);
  });
}
export function setCatalogSchedule(enabled) {
  if (typeof enabled !== "boolean") return Promise.reject(new Error("Invalid pricing schedule"));
  return withPricingStateLock(async () => {
    const db = await getAdapter(); assertPricingHealthy(db);
    db.durableTransaction(() => writeReferenceRow(db, "schedule", { enabled }));
    if (!enabled) configureCatalogScheduler(false);
    return reconcileSavedCatalogScheduleSync(db);
  });
}
