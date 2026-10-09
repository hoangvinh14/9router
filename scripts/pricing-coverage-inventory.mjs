// Read-only audit of a captured public catalog. This is NOT a validated pricing
// snapshot: no persistence, fetch, rounding, pruning, or registry mutation.
import fs from "node:fs";
import { createHash } from "node:crypto";
import REGISTRY from "../open-sse/providers/registry/index.js";
import { MODEL_PRICING, PROVIDER_PRICING } from "../open-sse/providers/pricing.js";
import { parseCatalogJson, decimalLexeme, isCatalogNumber } from "../src/lib/pricing/catalogJson.js";
import { validateRate } from "../src/lib/pricing/money.js";
import { mappedReference, knownCanonicalReference, MAPPING_REVISION } from "../src/lib/pricing/catalogMapping.js";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: node scripts/pricing-coverage-inventory.mjs captured-public-catalog.json output.json");
const bytes = fs.readFileSync(input);
const catalog = parseCatalogJson(bytes.toString("utf8"));
const invalid = [];
function auditRates(value, path) {
  if (!value || typeof value !== "object") return;
  for (const [key, field] of Object.entries(value)) {
    const location = `${path}/${key}`;
    if (isCatalogNumber(field) && key !== "size") {
      try { validateRate(decimalLexeme(field)); }
      catch { invalid.push({ path: location, originalLexeme: field.numericLexeme }); }
    } else if (typeof field === "object") auditRates(field, location);
  }
}
let modelCount = 0;
for (const [provider, entry] of Object.entries(catalog)) {
  for (const [model, item] of Object.entries(entry.models || {})) {
    modelCount++;
    auditRates(item.cost, `${provider}/${model}/cost`);
  }
}
const rows = [];
for (const provider of REGISTRY) {
  for (const model of provider.models || []) {
    const kind = model.kind || model.type || "llm";
    if (!["llm", "embedding"].includes(kind)) continue;
    const mapping = mappedReference(provider.id, model.id);
    const entry = mapping && catalog[mapping.provider]?.models?.[mapping.model];
    const cost = entry?.cost;
    const canonical = knownCanonicalReference(provider.id, model.id);
    const bundledProvider = Object.hasOwn(PROVIDER_PRICING[provider.id] || {}, model.id)
      || Object.hasOwn(PROVIDER_PRICING[provider.alias] || {}, model.id);
    rows.push({ provider: provider.id, alias: provider.alias || provider.id, model: model.id, kind,
      mapping: mapping ? { provider: mapping.provider, model: mapping.model, virtual: mapping.virtual } : null,
      inventoryStatus: !entry ? "missing_or_unmapped" : !cost ? "cost_absent" : "cost_present_unvalidated",
      nonFlatCostFields: cost ? Object.keys(cost).filter(key => !["input", "output", "cache_read", "cache_write", "reasoning"].includes(key)) : [],
      offlineReference: bundledProvider ? "exact_provider" : canonical && Object.hasOwn(MODEL_PRICING, canonical.canonicalModel) ? "explicit_canonical_virtual" : "manual_required" });
  }
}
const counts = rows.reduce((result, row) => {
  for (const label of [row.inventoryStatus, row.offlineReference]) result[label] = (result[label] || 0) + 1;
  return result;
}, {});
const artifact = { classification: "UNVALIDATED_CAPTURED_PUBLIC_INVENTORY_NOT_ACTIVE_PRICING", source: "https://models.dev/api.json",
  capturedFileMtime: fs.statSync(input).mtime.toISOString(), auditedAt: new Date().toISOString(),
  sourceSha256: createHash("sha256").update(bytes).digest("hex"), mappingRevision: MAPPING_REVISION,
  bytes: bytes.length, catalogProviders: Object.keys(catalog).length, catalogModels: modelCount,
  invalidOriginalRateLexemes: invalid, registryRows: rows.length, counts, rows,
  limitations: ["Capture time is file mtime, not independently attested HTTP response time", "Entire live batch is rejected under strict precision contract", "Cost presence is not validated semantics or routability", "Compatible nodes and dynamic aliases require per-instance manual validation; no suffix guessing", "No manual overrides or application database read"] };
fs.writeFileSync(output, JSON.stringify(artifact, null, 2) + "\n");
console.log(JSON.stringify({ ...artifact, invalidOriginalRateLexemes: invalid.length, rows: undefined }, null, 2));
