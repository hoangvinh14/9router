import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { makeKv } from "../helpers/kvStore.js";
import { validatePricingMutation } from "../../pricing/pricingValidation.js";
import { getStoredCatalog } from "../../pricing/catalogSync.js";
import { mappedReference, mappedProviderReference, providerIdentity } from "../../pricing/catalogMapping.js";
import REGISTRY from "../../../../open-sse/providers/registry/index.js";

const pricingKv = makeKv("pricing");
function numericRates(rates) {
  return Object.fromEntries(Object.entries(rates).map(([key, value]) => [key, Number(value)]));
}

function numericPricingMap(map) {
  return Object.fromEntries(Object.entries(map).map(([provider, models]) => [provider,
    Object.fromEntries(Object.entries(models).map(([model, rates]) => [model, numericRates(rates)]))]));
}
async function getUserPricing() {
  return await pricingKv.getAll();
}

export async function getPricing() {
  const userPricing = await getUserPricing();
  const { PROVIDER_PRICING } = await import("open-sse/providers/pricing.js");
  const merged = Object.create(null);

  for (const [provider, models] of Object.entries(PROVIDER_PRICING)) merged[provider] = { ...models };
  const catalog = await getStoredCatalog();
  for (const provider of REGISTRY) {
    const mapping = mappedProviderReference(provider.id);
    if (!mapping) continue;
    // Pricing-only UI projection includes exact mapped catalog models even if
    // registry model/capability lists lag. This never registers a routable model.
    for (const entry of Object.values(catalog?.entries || {})) {
      if (entry.provider !== mapping.provider) continue;
      for (const key of new Set([provider.id, provider.alias].filter(Boolean))) {
        merged[key] ||= Object.create(null);
        if (entry.status === "priced") merged[key][entry.model] = numericRates(entry.rates);
        else if (entry.status === "unsupported") delete merged[key][entry.model];
      }
    }
  }

  // Canonical overrides apply to their legacy aliases. An explicitly stored
  // alias override wins only for that alias, matching snapshot resolution.
  for (const provider of REGISTRY) {
    if (!provider.alias || provider.alias === provider.id || !Object.hasOwn(userPricing, provider.id)) continue;
    merged[provider.alias] ||= Object.create(null);
    for (const [model, pricing] of Object.entries(userPricing[provider.id])) merged[provider.alias][model] = numericRates(pricing);
  }
  for (const [provider, models] of Object.entries(userPricing)) {
    merged[provider] ||= Object.create(null);
    for (const [model, pricing] of Object.entries(models)) merged[provider][model] = numericRates(pricing);
  }

  return merged;
}

export async function getPricingForModel(provider, model) {
  if (!model) return null;
  const userPricing = await getUserPricing();
  const id = providerIdentity(provider);
  for (const key of new Set([provider, id].filter(Boolean))) {
    if (Object.hasOwn(userPricing, key) && Object.hasOwn(userPricing[key], model)) return numericRates(userPricing[key][model]);
  }
  const mapping = mappedReference(provider, model);
  const entry = mapping && (await getStoredCatalog())?.entries?.[`${mapping.provider}/${mapping.model}`];
  if (entry?.status === "priced") return numericRates(entry.rates);
  if (entry?.status === "unsupported") return null;
  const { getPricingForModel: resolveConst } = await import("open-sse/providers/pricing.js");
  return resolveConst(provider, model);
}

// Atomic merge inside transaction (per-provider read-modify-write)
export async function updatePricing(pricingData) {
  const validated = validatePricingMutation(pricingData);
  const db = await getAdapter();
  db.durableTransaction(() => {
    for (const [provider, models] of Object.entries(validated)) {
      const row = db.get(`SELECT value FROM kv WHERE scope = 'pricing' AND key = ?`, [provider]);
      const current = row ? (parseJson(row.value, {}) || {}) : {};
      const merged = { ...current };
      for (const [model, pricing] of Object.entries(models)) {
        merged[model] = pricing;
      }
      db.run(
        `INSERT INTO kv(scope, key, value) VALUES('pricing', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [provider, stringifyJson(merged)]
      );
    }
  });
  return numericPricingMap(await getUserPricing());
}

export async function resetPricing(provider, model) {
  if (!provider) return numericPricingMap(await getUserPricing());
  const db = await getAdapter();
  db.durableTransaction(() => {
    if (!model) {
      db.run(`DELETE FROM kv WHERE scope = 'pricing' AND key = ?`, [provider]);
      return;
    }
    const row = db.get(`SELECT value FROM kv WHERE scope = 'pricing' AND key = ?`, [provider]);
    const current = row ? (parseJson(row.value, {}) || {}) : {};
    delete current[model];
    if (Object.keys(current).length === 0) {
      db.run(`DELETE FROM kv WHERE scope = 'pricing' AND key = ?`, [provider]);
    } else {
      db.run(
        `INSERT INTO kv(scope, key, value) VALUES('pricing', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [provider, stringifyJson(current)]
      );
    }
  });
  return numericPricingMap(await getUserPricing());
}

export async function resetAllPricing() {
  const db = await getAdapter();
  db.durableTransaction(() => db.run("DELETE FROM kv WHERE scope='pricing'"));
  return {};
}
