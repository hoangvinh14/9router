import { createHash } from "node:crypto";
import REGISTRY from "../../../open-sse/providers/registry/index.js";
import { getAdapter } from "../db/driver.js";
import { resolveReferencePriceSync } from "./referenceResolver.js";

const inventory = REGISTRY.flatMap(provider => (provider.models || []).flatMap(model => {
  const kind = model.kind || model.type || "llm";
  if (!["llm", "embedding"].includes(kind)) return [];
  return [{ provider: provider.id, model: model.id, endpoint: kind === "embedding" ? "embeddings" : "chat" }];
})).sort((a, b) => JSON.stringify([a.provider, a.model, a.endpoint]).localeCompare(JSON.stringify([b.provider, b.model, b.endpoint]), "en"));
function invalid(status = 400, code = "invalid_pricing_coverage_query") { throw Object.assign(new Error(code), { status, code }); }
export async function getPricingCoverage({ limit = 50, offset = 0, revision = null } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 || !Number.isSafeInteger(offset) || offset < 0 || offset > inventory.length || revision !== null && (typeof revision !== "string" || !/^[a-f0-9]{64}$/.test(revision))) invalid();
  const db = await getAdapter(); if (!db.health().healthy) invalid(503, "pricing_storage_unavailable");
  // Resolve against one synchronous read view. Cache the exact kv lookups and
  // their parsed payloads; do not parse the multi-MiB catalog per model.
  const cache = new Map(), parsed = new Map();
  const view = { get(sql, params) {
    const key = JSON.stringify([sql, params]);
    if (!cache.has(key)) cache.set(key, db.get(sql, params));
    return cache.get(key);
  }, readReferencePricing(scope, key) {
    const identity = JSON.stringify([scope, key]);
    if (!parsed.has(identity)) {
      const row = view.get("SELECT value FROM kv WHERE scope=? AND key=?", [scope, key]);
      let value = null;
      if (row) { try { value = JSON.parse(row.value); } catch { invalid(503, "pricing_storage_unavailable"); } }
      parsed.set(identity, value);
    }
    return parsed.get(identity);
  } };
  const rows = inventory.map(item => {
    const result = resolveReferencePriceSync(view, item.provider, item.model, item.endpoint);
    return result.status === "priced" ? { ...item, status: "priced", source: result.snapshot.source, virtual: result.snapshot.virtual,
      rates: result.snapshot.rates, fallbackSemantics: result.snapshot.fallbackSemantics, mapping: result.snapshot.mapping,
      catalogRevision: result.snapshot.catalogRevision, syncedAt: result.snapshot.syncedAt, snapshotRevision: result.snapshot.revision }
      : { ...item, status: "unavailable", reason: result.reason };
  });
  const current = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  if (revision !== null && revision !== current) invalid(409, "pricing_coverage_revision_changed");
  const counts = { total: rows.length, priced: 0, unavailable: 0, bySource: {}, byEndpoint: { chat: { total: 0, priced: 0, unavailable: 0 }, embeddings: { total: 0, priced: 0, unavailable: 0 } } };
  for (const row of rows) {
    counts[row.status]++; counts.byEndpoint[row.endpoint].total++; counts.byEndpoint[row.endpoint][row.status]++;
    if (row.source) counts.bySource[row.source] = (counts.bySource[row.source] || 0) + 1;
  }
  return { revision: current, virtualReference: true, currency: "USD", unit: "USD/1M tokens", usageCertified: false,
    counts, rows: rows.slice(offset, offset + limit), nextOffset: offset + limit < rows.length ? offset + limit : null };
}
export function pricingCoverageQuery(request) {
  let query; try { query = new URL(request.url).searchParams; } catch { invalid(); }
  if ([...query.keys()].some(key => !["limit", "offset", "revision"].includes(key) || query.getAll(key).length !== 1)) invalid();
  for (const field of ["limit", "offset"]) if (query.has(field) && !/^(0|[1-9]\d{0,5})$/.test(query.get(field))) invalid();
  return { limit: query.has("limit") ? Number(query.get("limit")) : 50, offset: query.has("offset") ? Number(query.get("offset")) : 0, revision: query.get("revision") };
}
