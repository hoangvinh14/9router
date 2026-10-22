import { readPricingRevision } from "../db/pricingRevision.js";
import { MAPPING_REVISION } from "./catalogMapping.js";

const states = global.__referencePricingMemo ??= new WeakMap();
function boundedSet(map, key, value, limit) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  if (map.size > limit) map.delete(map.keys().next().value);
}
export function pricingMemoView(db, provider, model, endpoint) {
  try {
    if (typeof db.health === "function" && db.health().healthy !== true) throw new Error("Reference pricing storage unavailable");
    if (typeof db.canMemoizePricing !== "function") return null;
    if (db.canMemoizePricing() !== true) { states.delete(db); return null; }
    const revision = readPricingRevision(db);
    let state = states.get(db);
    if (!state || state.revision !== revision || state.mapping !== MAPPING_REVISION) {
      state = { revision, mapping: MAPPING_REVISION, rows: new Map(), snapshots: new Map() };
      states.set(db, state);
    }
    if (typeof provider !== "string" || provider.length > 256 || typeof model !== "string" || model.length > 256) return null;
    const identity = JSON.stringify([provider, model, endpoint]);
    return {
      cached: state.snapshots.get(identity),
      view: { readReferencePricing(scope, key) {
        const rowKey = JSON.stringify([scope, key]);
        if (!state.rows.has(rowKey)) {
          const row = db.get("SELECT value FROM kv WHERE scope=? AND key=?", [scope, key]);
          let value = null;
          if (row) { try { value = JSON.parse(row.value); } catch { throw new Error("Stored reference pricing corrupt"); } }
          boundedSet(state.rows, rowKey, value, 128);
        }
        return state.rows.get(rowKey);
      } },
      publish(result) { boundedSet(state.snapshots, identity, result, 1024); return result; },
    };
  } catch (error) { states.delete(db); throw error; }
}
