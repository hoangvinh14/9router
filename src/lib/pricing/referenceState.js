import { createHash } from "node:crypto";
import { completeReferenceRates, isPlainRecord } from "./rateValidation.js";

export const CATALOG_SOURCE = "https://models.dev/api.json";
const state = global.__referencePricingStateCoordinator ??= { tail: Promise.resolve() };
// Publication, config import and schedule mutations share one serial boundary.
// Fetching is outside this lock; an admitted fetch may publish after an import,
// but replaces only catalog/status, never the imported schedule or overrides.
export function withPricingStateLock(work) {
  const run = state.tail.then(work);
  state.tail = run.catch(() => {});
  return run;
}
function keys(value, allowed) {
  if (!isPlainRecord(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error("Invalid reference pricing state");
}
function timestamp(value) {
  if (typeof value !== "string" || value.length !== 24 || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error("Invalid reference pricing timestamp");
  return value;
}
const PROVIDER = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const MODEL = /^[A-Za-z0-9@~][A-Za-z0-9_.:/()+@~ -]{0,255}$/;
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);
function entriesProjection(input) {
  if (!isPlainRecord(input) || !Object.keys(input).length || Object.keys(input).length > 50000) throw new Error("Invalid reference catalog entries");
  const entries = Object.create(null);
  for (const key of Object.keys(input).sort()) {
    const entry = input[key];
    keys(entry, ["provider", "model", "status", "rates", "reason"]);
    if (typeof entry.provider !== "string" || !PROVIDER.test(entry.provider) || FORBIDDEN.has(entry.provider)
        || typeof entry.model !== "string" || !MODEL.test(entry.model) || FORBIDDEN.has(entry.model)
        || key !== `${entry.provider}/${entry.model}`) throw new Error("Invalid reference catalog identity");
    const result = { provider: entry.provider, model: entry.model, status: entry.status };
    if (entry.status === "priced") {
      if (entry.reason !== undefined) throw new Error("Invalid priced catalog reason");
      const rates = completeReferenceRates(entry.rates);
      // Synced flat cost semantics contain token rates only; typed manual rates
      // cannot be smuggled into the trusted fixed-source catalog projection.
      const flat = ["input", "output", "cached", "cache_creation", "reasoning"];
      if (Object.keys(rates).some(field => !flat.includes(field))) throw new Error("Invalid synced rate schema");
      result.rates = Object.fromEntries(Object.keys(rates).sort().map(field => [field, rates[field]]));
    } else {
      const reason = entry.status === "missing" ? "cost_absent" : entry.status === "unsupported" ? "non_flat_cost_semantics" : null;
      if (!reason || entry.reason !== reason || entry.rates !== undefined) throw new Error("Invalid catalog availability");
      result.reason = reason;
    }
    entries[key] = result;
  }
  return entries;
}
export function catalogRevision(entries) {
  return createHash("sha256").update(JSON.stringify(entriesProjection(entries))).digest("hex");
}
export function validateStoredCatalog(input) {
  keys(input, ["source", "unit", "currency", "revision", "entries", "syncedAt"]);
  if (input.source !== CATALOG_SOURCE || input.unit !== "USD/1M tokens" || input.currency !== "USD") throw new Error("Invalid reference catalog source/units");
  const entries = entriesProjection(input.entries);
  const revision = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
  if (input.revision !== revision) throw new Error("Reference catalog revision mismatch");
  return { source: CATALOG_SOURCE, unit: "USD/1M tokens", currency: "USD", revision, entries, syncedAt: timestamp(input.syncedAt) };
}
export function validateCatalogStatus(input) {
  keys(input, ["lastAttempt", "lastSuccess", "error"]);
  const result = {};
  if (input.lastAttempt !== undefined) result.lastAttempt = timestamp(input.lastAttempt);
  if (input.lastSuccess !== undefined) result.lastSuccess = timestamp(input.lastSuccess);
  if (input.error !== null && input.error !== "pricing_sync_failed") throw new Error("Invalid catalog status error");
  result.error = input.error;
  return result;
}
export function validateCatalogSchedule(input) {
  keys(input, ["enabled"]);
  if (typeof input.enabled !== "boolean" || Object.keys(input).length !== 1) throw new Error("Invalid pricing schedule");
  return { enabled: input.enabled };
}
export function validateReferenceState(input) {
  keys(input, ["version", "catalog", "status", "schedule"]);
  if (input.version !== 1 || Object.keys(input).length !== 4) throw new Error("Invalid reference pricing projection version");
  const result = {
    version: 1,
    catalog: input.catalog === null ? null : validateStoredCatalog(input.catalog),
    status: input.status === null ? null : validateCatalogStatus(input.status),
    schedule: validateCatalogSchedule(input.schedule),
  };
  if (Buffer.byteLength(JSON.stringify(result)) > 20 * 1024 * 1024) throw new Error("Reference pricing state too large");
  return result;
}
