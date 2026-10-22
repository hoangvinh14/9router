import { parseCatalogJson, decimalLexeme, isCatalogNumber } from "./catalogJson.js";
import { validateRate } from "./decimalMoney.js";
import { getAdapter } from "../db/driver.js";
import { CATALOG_SOURCE, catalogRevision, validateStoredCatalog, withPricingStateLock } from "./referenceState.js";
export { CATALOG_SOURCE } from "./referenceState.js";

const MAX_BYTES = 20 * 1024 * 1024;
const COST_FIELDS = { input: "input", output: "output", cache_read: "cached", cache_write: "cache_creation", reasoning: "reasoning" };
const IDENTIFIER = /^[A-Za-z0-9@~][A-Za-z0-9_.:/()+@~ -]{0,255}$/;
const PROVIDER_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
function record(value) { return value && typeof value === "object" && !Array.isArray(value) && !isCatalogNumber(value); }
function validateTierRates(cost, hasThreshold) {
  if (!record(cost)) throw new Error("Invalid nested catalog cost");
  if (hasThreshold) {
    if (!record(cost.tier) || cost.tier.type !== "context" || !isCatalogNumber(cost.tier.size) || !/^(0|[1-9]\d*)$/.test(cost.tier.size.numericLexeme)) throw new Error("Invalid catalog tier threshold");
    if (BigInt(cost.tier.size.numericLexeme) > 1_000_000_000n) throw new Error("Catalog tier range");
  }
  if (!Object.hasOwn(cost, "input") || !Object.hasOwn(cost, "output")) throw new Error("Incomplete nested catalog rates");
  for (const [field, value] of Object.entries(cost)) {
    if (field === "tier" && hasThreshold) continue;
    if (!Object.hasOwn(COST_FIELDS, field) && !["input_audio", "output_audio"].includes(field)) throw new Error("Unknown nested catalog cost schema");
    validateRate(decimalLexeme(value));
  }
}
export function validateCatalog(text) {
  const root = parseCatalogJson(text);
  if (!record(root) || !Object.keys(root).length || Object.keys(root).length > 1000) throw new Error("Invalid catalog provider entries");
  const entries = Object.create(null); let count = 0;
  for (const [provider, data] of Object.entries(root)) {
    if (!PROVIDER_IDENTIFIER.test(provider) || !record(data) || data.id !== provider || !record(data.models)) throw new Error("Invalid catalog provider");
    for (const [model, item] of Object.entries(data.models)) {
      if (++count > 50000 || !IDENTIFIER.test(model) || !record(item) || item.id !== model) throw new Error("Invalid catalog model entries");
      const key = `${provider}/${model}`;
      if (Object.hasOwn(entries, key)) throw new Error("Duplicate catalog composite key");
      if (item.cost === undefined) { entries[key] = { provider, model, status: "missing", reason: "cost_absent" }; continue; }
      if (!record(item.cost)) throw new Error("Invalid catalog cost");
      const rates = {}; let unsupported = false;
      for (const [field, value] of Object.entries(item.cost)) {
        if (Object.hasOwn(COST_FIELDS, field)) rates[COST_FIELDS[field]] = validateRate(decimalLexeme(value));
        else {
          unsupported = true;
          if (["input_audio", "output_audio"].includes(field)) validateRate(decimalLexeme(value));
          if (field === "tiers") {
            if (!Array.isArray(value) || !value.length || value.length > 100) throw new Error("Invalid catalog tiers");
            for (const tier of value) validateTierRates(tier, true);
          }
          if (field === "context_over_200k") validateTierRates(value, false);
        }
      }
      if (rates.input === undefined || rates.output === undefined) throw new Error("Incomplete catalog rates");
      entries[key] = unsupported ? { provider, model, status: "unsupported", reason: "non_flat_cost_semantics" } : { provider, model, status: "priced", rates };
    }
  }
  if (!count) throw new Error("Empty catalog model entries");
  return { source: CATALOG_SOURCE, unit: "USD/1M tokens", currency: "USD", revision: catalogRevision(entries), entries };
}
export async function fetchCatalog({ fetchImpl = fetch, maxBytes = MAX_BYTES } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES) throw new Error("Invalid catalog size bound");
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  let reader;
  try {
    const response = await fetchImpl(CATALOG_SOURCE, { redirect: "error", signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok || response.redirected || response.url && response.url !== CATALOG_SOURCE) throw new Error("Catalog source/HTTP rejected");
    if (!response.body) throw new Error("Empty catalog response");
    reader = response.body.getReader(); const chunks = []; let bytes = 0;
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new Error("Catalog decompressed size exceeded"); }
      chunks.push(Buffer.from(chunk.value));
    }
    return validateCatalog(Buffer.concat(chunks).toString("utf8"));
  } finally { clearTimeout(timer); reader?.releaseLock(); }
}
export function readReferenceRow(db, key) {
  const row = db.get("SELECT value FROM kv WHERE scope='referencePricing' AND key=?", [key]);
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { throw new Error("Stored reference pricing corrupt"); }
}
export function writeReferenceRow(db, key, value) {
  db.run("INSERT INTO kv(scope,key,value) VALUES('referencePricing',?,?) ON CONFLICT(scope,key) DO UPDATE SET value=excluded.value", [key, JSON.stringify(value)]);
}
export function assertPricingHealthy(db) {
  if (db.health().healthy !== true) throw new Error("Pricing storage unavailable");
}
const syncState = global.__referencePricingSync ??= { flight: null };
export async function getCatalogStatus() {
  const db = await getAdapter(); assertPricingHealthy(db);
  // Publish any earlier ordinary SQL.js writes before exposing committed status.
  db.durableTransaction(() => {});
  const raw = readReferenceRow(db, "catalog"), catalog = raw && validateStoredCatalog(raw);
  const { isCatalogSchedulerEnabled } = await import("./catalogScheduler.js");
  const { readCatalogScheduleSync } = await import("./catalogSchedule.js");
  return { ...readReferenceRow(db, "status"), schedulerConfigured: readCatalogScheduleSync(db),
    schedulerEnabled: isCatalogSchedulerEnabled(), source: CATALOG_SOURCE, revision: catalog?.revision ?? null,
    syncedAt: catalog?.syncedAt ?? null, pricedCount: Object.values(catalog?.entries || {}).filter(entry => entry.status === "priced").length };
}
export async function getStoredCatalog() {
  const db = await getAdapter(); assertPricingHealthy(db); db.durableTransaction(() => {});
  const value = readReferenceRow(db, "catalog"); return value && validateStoredCatalog(value);
}
async function performSync(options) {
  const db = await getAdapter(), lastAttempt = new Date().toISOString();
  await withPricingStateLock(() => {
    assertPricingHealthy(db); options?.scheduledAdmission?.(db);
    db.durableTransaction(() => writeReferenceRow(db, "status", { ...readReferenceRow(db, "status"), lastAttempt, error: null }));
  });
  try {
    const staged = await fetchCatalog(options);
    const catalog = validateStoredCatalog({ ...staged, syncedAt: new Date().toISOString() });
    await withPricingStateLock(() => {
      assertPricingHealthy(db);
      db.durableTransaction(() => {
        writeReferenceRow(db, "catalog", catalog);
        writeReferenceRow(db, "status", { lastAttempt, lastSuccess: catalog.syncedAt, error: null });
      });
    });
    return getCatalogStatus();
  } catch (error) {
    if (db.health().healthy) await withPricingStateLock(() => {
      assertPricingHealthy(db);
      db.durableTransaction(() => writeReferenceRow(db, "status", { ...readReferenceRow(db, "status"), lastAttempt, error: "pricing_sync_failed" }));
    });
    throw error;
  }
}
export function syncCatalog(options = {}) {
  if (!syncState.flight) syncState.flight = performSync(options).finally(() => { syncState.flight = null; });
  return syncState.flight;
}
