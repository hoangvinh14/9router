import { PRICING_REVISION_KEY } from '../db/pricingRevision.js';
import { MAPPING_REVISION } from './catalogMapping.js';

const MAX_SNAPSHOTS = 1024;
const MAX_PARSED_ROWS = 128;
// Adapter lifetime owns public pricing data only; no key/request/attempt state.
// Weak keys isolate DATA_DIR/reopen, and the global survives Next HMR.
const states = global.__referencePricingMemo ??= new WeakMap();
function boundedSet(map, key, value, limit) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  if (map.size > limit) map.delete(map.keys().next().value);
}
export function pricingMemoView(db, provider, model, endpoint) {
  try {
    if (typeof db.health === 'function' && db.health().healthy !== true) throw new Error('Reference pricing storage unavailable');
    // Custom synchronous coverage views and standalone fixtures lack the durable
    // cache seam. Preserve their behavior, but never assume they are committed.
    if (typeof db.canMemoizePricing !== 'function') return null;
    if (db.canMemoizePricing() !== true) { states.delete(db); return null; }
    const revision = db.get('SELECT value FROM _meta WHERE key=?', [PRICING_REVISION_KEY])?.value;
    if (typeof revision !== 'string' || !/^(0|[1-9]\d*)$/.test(revision) || BigInt(revision) > 9007199254740991n) throw new Error('Reference pricing revision unavailable');
    let state = states.get(db);
    if (!state || state.revision !== revision || state.mapping !== MAPPING_REVISION) {
      state = { revision, mapping: MAPPING_REVISION, rows: new Map(), snapshots: new Map() };
      states.set(db, state);
    }
    // Do not retain unbounded caller identities. Eligibility is still decided by
    // the resolver, not by this cache's bound or a fuzzy canonical identity.
    if (typeof provider !== 'string' || provider.length > 256 || typeof model !== 'string' || model.length > 256) return null;
    const identity = JSON.stringify([provider, model, endpoint]);
    return {
      cached: state.snapshots.get(identity),
      view: { readReferencePricing(scope, key) {
        const rowKey = JSON.stringify([scope, key]);
        if (!state.rows.has(rowKey)) {
          const row = db.get('SELECT value FROM kv WHERE scope=? AND key=?', [scope, key]);
          let value = null;
          if (row) { try { value = JSON.parse(row.value); } catch { throw new Error('Stored reference pricing corrupt'); } }
          boundedSet(state.rows, rowKey, value, MAX_PARSED_ROWS);
        }
        return state.rows.get(rowKey);
      } },
      publish(result) { boundedSet(state.snapshots, identity, result, MAX_SNAPSHOTS); return result; },
    };
  } catch (error) { states.delete(db); throw error; }
}
