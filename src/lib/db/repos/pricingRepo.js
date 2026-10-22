import { getAdapter } from "../driver.js";
import { PROVIDER_PRICING, getPricingForModel as bundledModel } from "../../../../open-sse/providers/pricing.js";
import REGISTRY from "../../../../open-sse/providers/registry/index.js";
import { validatePricingMutation, validatePricingIdentifier } from "../../pricing/pricingValidation.js";
import { mappedReference, providerIdentity } from "../../pricing/catalogMapping.js";
import { validateStoredCatalog } from "../../pricing/referenceState.js";
import { completeReferenceRates } from "../../pricing/rateValidation.js";

function parseStored(value) {
  try { return JSON.parse(value); }
  catch { throw new Error("Stored pricing configuration corrupt"); }
}
function readUserPricing(db) {
  const input = Object.create(null);
  for (const row of db.all("SELECT key,value FROM kv WHERE scope='pricing'")) input[row.key] = parseStored(row.value);
  return validatePricingMutation(input);
}
function readCatalog(db) {
  const row = db.get("SELECT value FROM kv WHERE scope='referencePricing' AND key='catalog'");
  return row ? validateStoredCatalog(parseStored(row.value)) : null;
}
const numeric = rates => Object.fromEntries(Object.entries(rates).map(([key, value]) => [key, Number(value)]));
function selected(user, catalog, provider, model, exact = false) {
  const project = rates => exact ? { ...rates } : numeric(rates);
  const id = providerIdentity(provider);
  if (Object.hasOwn(user[provider] || {}, model)) return project(user[provider][model]);
  if (Object.hasOwn(user[id] || {}, model)) return project(user[id][model]);
  const mapping = mappedReference(id, model);
  const entry = mapping && catalog?.entries?.[`${mapping.provider}/${mapping.model}`];
  if (entry?.status === "unsupported") return null;
  if (entry?.status === "priced") return project(entry.rates);
  return undefined;
}
// The writer lease excludes cooperating external writers. After this tested
// dirty-publication barrier, all reads below are synchronous with no JS yield.
function committed(db) { db.durableTransaction(() => {}); }
export async function getPricing() { return pricingMap(false); }
// Separate exact-value metadata for editing. Never reconstruct persisted manual
// or synced rates from the lossy numeric compatibility map. Canonical decimal
// values are preserved, not original spelling (e.g. 1.00 vs 1).
export async function getEditorPricing() { return { exact: await pricingMap(true) }; }
async function pricingMap(exact) {
  const db = await getAdapter(); committed(db);
  const user = readUserPricing(db), catalog = readCatalog(db), result = {};
  const providers = new Set([...Object.keys(PROVIDER_PRICING), ...Object.keys(user)]);
  for (const entry of REGISTRY) { providers.add(entry.id); if (entry.alias) providers.add(entry.alias); }
  for (const provider of providers) {
    const id = providerIdentity(provider);
    const bundled = { ...PROVIDER_PRICING[id], ...PROVIDER_PRICING[provider] };
    const models = new Set([...Object.keys(bundled), ...Object.keys(user[id] || {}), ...Object.keys(user[provider] || {})]);
    const mapping = mappedReference(provider, "");
    if (mapping && catalog) for (const entry of Object.values(catalog.entries)) if (entry.provider === mapping.provider) models.add(entry.model);
    const rows = {};
    for (const model of models) {
      const chosen = selected(user, catalog, provider, model, exact);
      if (chosen === null) continue;
      if (chosen !== undefined) rows[model] = chosen;
      else if (bundled[model]) {
        if (!exact) rows[model] = { ...bundled[model] };
        else {
          // A legacy bundled Number has no recoverable extra precision. Admit
          // only complete rates accepted by the strict reference validator.
          try { rows[model] = completeReferenceRates(bundled[model]); }
          catch { /* Not an editable complete reference source. */ }
        }
      }
    }
    if (Object.keys(rows).length) result[provider] = rows;
  }
  return result;
}
// Legacy analytics compatibility remains separate from strict reference snapshots.
export async function getPricingForModel(provider, model) {
  if (!model) return null;
  const db = await getAdapter(); committed(db);
  const chosen = selected(readUserPricing(db), readCatalog(db), provider, model);
  return chosen !== undefined ? chosen : bundledModel(provider, model);
}
const canonical = object => JSON.stringify(Object.fromEntries(Object.keys(object).sort().map(key => [key,
  Object.fromEntries(Object.entries(object[key]).sort(([a], [b]) => a.localeCompare(b)))])));
export async function updatePricing(pricingData) {
  const input = validatePricingMutation(pricingData);
  const db = await getAdapter();
  db.durableTransaction(() => {
    for (const [provider, models] of Object.entries(input)) {
      if (!Object.keys(models).length) continue;
      const row = db.get("SELECT value FROM kv WHERE scope='pricing' AND key=?", [provider]);
      const current = row ? validatePricingMutation({ [provider]: parseStored(row.value) })[provider] : {};
      const merged = { ...current, ...models };
      if (canonical(current) === canonical(merged)) continue;
      db.run("INSERT INTO kv(scope,key,value) VALUES('pricing',?,?) ON CONFLICT(scope,key) DO UPDATE SET value=excluded.value", [provider, JSON.stringify(merged)]);
    }
  });
  return numericUserPricing(readUserPricing(db));
}
function numericUserPricing(user) {
  return Object.fromEntries(Object.entries(user).map(([provider, models]) => [provider,
    Object.fromEntries(Object.entries(models).map(([model, rates]) => [model, numeric(rates)]))]));
}
export async function resetPricing(provider, model) {
  if (provider === undefined || provider === null) {
    if (model !== undefined && model !== null) throw new Error("Pricing reset provider required");
    const db = await getAdapter(); committed(db);
    return numericUserPricing(readUserPricing(db));
  }
  validatePricingIdentifier(provider); if (model !== undefined && model !== null) validatePricingIdentifier(model);
  const db = await getAdapter();
  db.durableTransaction(() => {
    if (model === undefined || model === null) { db.run("DELETE FROM kv WHERE scope='pricing' AND key=?", [provider]); return; }
    const row = db.get("SELECT value FROM kv WHERE scope='pricing' AND key=?", [provider]);
    if (!row) return;
    const current = validatePricingMutation({ [provider]: parseStored(row.value) })[provider];
    if (!Object.hasOwn(current, model)) return;
    delete current[model];
    if (!Object.keys(current).length) db.run("DELETE FROM kv WHERE scope='pricing' AND key=?", [provider]);
    else db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key=?", [JSON.stringify(current), provider]);
  });
  return numericUserPricing(readUserPricing(db));
}
export async function resetAllPricing() {
  const db = await getAdapter(); db.durableTransaction(() => db.run("DELETE FROM kv WHERE scope='pricing'"));
  return {};
}
