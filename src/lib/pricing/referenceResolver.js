import { createHash } from "node:crypto";
import { MODEL_PRICING, PROVIDER_PRICING, isFreeModel, ZERO_PRICING } from "../../../open-sse/providers/pricing.js";
import { mappedReference, knownCanonicalReference, isApprovedFreeReference, providerIdentity, MAPPING_REVISION } from "./catalogMapping.js";
import { completeReferenceRates } from "./rateValidation.js";
import { REFERENCE_ENDPOINTS, RATE_UNITS, EXTENDED_RATE_FIELDS } from "./constants.js";
import { pricingMemoView } from "./snapshotMemo.js";
import { getAdapter } from "../db/driver.js";
export { completeReferenceRates } from "./rateValidation.js";

const own = (object, key) => object && Object.hasOwn(object, key) ? object[key] : undefined;
function storedJson(db, scope, key) {
  if (typeof db.readReferencePricing === "function") return db.readReferencePricing(scope, key);
  const row = db.get("SELECT value FROM kv WHERE scope=? AND key=?", [scope, key]);
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { throw new Error("Stored reference pricing corrupt"); }
}
const unavailable = reason => ({ status: "unavailable", reason, code: "model_pricing_unavailable" });
export function resolveReferencePriceSync(db, provider, model, endpoint = "chat") {
  const memo = pricingMemoView(db, provider, model, endpoint);
  if (memo?.cached) return memo.cached;
  const result = Object.freeze(resolveUncachedReferencePrice(memo?.view || db, provider, model, endpoint));
  return memo ? memo.publish(result) : result;
}
function resolveUncachedReferencePrice(db, provider, model, endpoint) {
  if (!REFERENCE_ENDPOINTS.includes(endpoint) || typeof provider !== "string" || !provider || typeof model !== "string" || !model) return unavailable("unsupported_reference_endpoint_or_identity");
  const id = providerIdentity(provider);
  const catalog = storedJson(db, "referencePricing", "catalog");
  const providerOverrides = storedJson(db, "pricing", provider);
  const canonicalOverrides = provider === id ? null : storedJson(db, "pricing", id);
  const manual = providerOverrides && Object.hasOwn(providerOverrides, model)
    ? providerOverrides[model] : own(canonicalOverrides, model);
  // An explicitly present invalid override remains a barrier, not inherited price.
  const hasManual = providerOverrides && Object.hasOwn(providerOverrides, model)
    || canonicalOverrides && Object.hasOwn(canonicalOverrides, model);
  const mapping = mappedReference(id, model);
  const synced = mapping && own(catalog?.entries, `${mapping.provider}/${mapping.model}`);
  const bundled = own(own(PROVIDER_PRICING, provider), model) ?? own(own(PROVIDER_PRICING, id), model);
  const canonical = knownCanonicalReference(id, model);
  let selected, source, virtual = mapping?.virtual ?? false;
  if (hasManual) { selected = manual; source = "manual"; virtual = true; }
  else if (synced?.status === "unsupported") return unavailable("unsupported_catalog_price_semantics");
  else if (synced?.status === "priced") { selected = synced.rates; source = "synced"; }
  else if (bundled) { selected = bundled; source = "bundled_provider"; }
  else if (isApprovedFreeReference(id) && isFreeModel(model)) { selected = ZERO_PRICING; source = "approved_free_namespace"; }
  else if (canonical && own(MODEL_PRICING, canonical.canonicalModel)) { selected = own(MODEL_PRICING, canonical.canonicalModel); source = "bundled_canonical_reference"; virtual = true; }
  else return unavailable("exact_reference_mapping_missing");
  let rates;
  try { rates = completeReferenceRates(selected, endpoint); }
  catch { return unavailable("invalid_complete_reference_rates"); }
  const rateUnits = Object.fromEntries(EXTENDED_RATE_FIELDS.filter(field => Object.hasOwn(rates, field)).map(field => [field, RATE_UNITS[field]]));
  const snapshot = {
    provider: id, model, endpoint, rates, source, virtual, currency: "USD", unit: "USD/1M tokens",
    mapping: mapping ? Object.freeze({ provider: mapping.provider, model: mapping.model, revision: MAPPING_REVISION }) : null,
    catalogRevision: source === "synced" ? catalog.revision : null,
    syncedAt: source === "synced" ? catalog.syncedAt : null,
    fallbackSemantics: Object.freeze({
      cached: rates.cached === undefined ? "input_rate" : "explicit",
      cache_creation: rates.cache_creation === undefined ? "input_rate" : "explicit",
      reasoning: rates.reasoning === undefined ? "output_rate" : "explicit",
      ...explicitCacheTier(rates),
    }),
  };
  if (Object.keys(rateUnits).length) snapshot.rateUnits = Object.freeze(rateUnits);
  const revision = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  Object.freeze(rates);
  return { status: "priced", snapshot: Object.freeze({ ...snapshot, revision }) };
}
function explicitCacheTier(rates) {
  if (rates.cache_creation_1h !== undefined) return { cache_creation_1h: "explicit" };
  return {};
}
export async function resolveReferencePrice(provider, model, endpoint = "chat") {
  return resolveReferencePriceSync(await getAdapter(), provider, model, endpoint);
}
