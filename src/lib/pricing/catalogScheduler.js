import { getAdapter } from "../db/driver.js";
import { syncCatalog } from "./catalogSync.js";

const INTERVAL_MS = 24 * 60 * 60 * 1000;
const state = global.__referencePricingScheduler ??= { timer: null };
export function configureCatalogScheduler(enabled, { sync = syncCatalog, adapter = getAdapter } = {}) {
  if (typeof enabled !== "boolean") throw new Error("Invalid pricing sync schedule setting");
  if (!enabled) { if (state.timer) clearInterval(state.timer); state.timer = null; return; }
  if (state.timer) return;
  state.timer = setInterval(() => {
    adapter().then(db => {
      if (db.health().healthy !== true) return;
      return sync();
    }).catch(() => { console.warn("[ReferencePricing] scheduled sync degraded"); });
  }, INTERVAL_MS);
  state.timer.unref?.();
}
export function isCatalogSchedulerEnabled() { return Boolean(state.timer); }
