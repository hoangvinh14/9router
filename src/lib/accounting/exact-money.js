import { decimalToNanoUsd } from "../pricing/decimalMoney.js";
import { ALL_RATE_FIELDS, EXTENDED_RATE_FIELDS, MAX_NANO_USD, RATE_UNITS } from "../pricing/constants.js";
import { snapshotPayload } from "./attempt-payload.js";

const TOKEN_UNIT = 1_000_000n;
function quantity(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid exact quantity");
  return BigInt(value);
}
export function nanoUsd(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,15})$/.test(value) || BigInt(value) > MAX_NANO_USD) throw new Error("Invalid nanoUSD amount");
  return value;
}
export function validatePriceSnapshot(snapshot) {
  const copy = snapshotPayload(snapshot);
  if (!copy || copy.currency !== "USD" || copy.unit !== "USD/1M tokens" || !copy.rates || typeof copy.rates !== "object" || Array.isArray(copy.rates) || !copy.revision) throw new Error("Original exact price snapshot required");
  for (const [field, rate] of Object.entries(copy.rates)) {
    if (!ALL_RATE_FIELDS.includes(field)) throw new Error("Unknown original rate category");
    decimalToNanoUsd(rate);
    if (copy.rateUnits?.[field] !== undefined && copy.rateUnits[field] !== RATE_UNITS[field]) throw new Error("Original rate unit mismatch");
  }
  decimalToNanoUsd(copy.rates.input);
  decimalToNanoUsd(copy.rates.output);
  return copy;
}

// Provider adapters own observed category/provenance mapping. This core never estimates.
export function costFromExactUsageSnapshot(evidence, original) {
  const usage = snapshotPayload(evidence);
  const snapshot = validatePriceSnapshot(original);
  if (!usage || usage.exact !== true) throw new Error("Exact usage required");
  const rates = snapshot.rates;
  let numerator = 0n;
  if (usage.components !== undefined) {
    if (Object.keys(usage).some(k => !["exact", "components", "provenance"].includes(k)) || typeof usage.provenance !== "string" || !usage.provenance || !Array.isArray(usage.components)) throw new Error("Invalid component provenance");
    // Without a narrower original category contract, require every priced
    // category (including explicit zero counts) from the original price snapshot.
    const required = snapshot.usageSemantics?.requiredCategories ?? Object.keys(rates);
    if (!Array.isArray(required) || !required.length || new Set(required).size !== required.length) throw new Error("Original category authority required");
    if (snapshot.usageSemantics && Object.keys(snapshot.usageSemantics).some(k => k !== "requiredCategories")) throw new Error("Unsupported original usage semantics");
    if (required.some(category => !ALL_RATE_FIELDS.includes(category) || !Object.hasOwn(rates, category))) throw new Error("Invalid original required category");
    const seen = new Set();
    for (const component of usage.components) {
      const { category, count, unit } = component;
      if (Object.keys(component).sort().join(",") !== "category,count,unit" || !ALL_RATE_FIELDS.includes(category) || seen.has(category) || !required.includes(category)) throw new Error("Invalid exact component category");
      seen.add(category);
      if ((snapshot.rateUnits?.[category] ?? snapshot.unit) !== RATE_UNITS[category] || unit !== RATE_UNITS[category]) throw new Error("Original component rate/unit required");
      const denominator = unit === "USD/1000 uses" ? 1000n : TOKEN_UNIT;
      numerator += quantity(count) * BigInt(decimalToNanoUsd(rates[category])) * (TOKEN_UNIT / denominator);
    }
    if (required.some(category => !seen.has(category))) throw new Error("Missing exact required category");
  } else {
    const fields = ["exact", "input", "output", "cacheRead", "cacheWrite", "reasoning", "reasoningIncludedInOutput", "cacheWrite5m", "cacheWrite1h"];
    if (Object.keys(usage).some(k => !fields.includes(k)) || snapshot.usageSemantics?.requiredCategories || typeof usage.reasoningIncludedInOutput !== "boolean") throw new Error("Exact usage inclusion authority required");
    if (EXTENDED_RATE_FIELDS.some(category => Object.hasOwn(rates, category))) throw new Error("Exact component evidence required for original extended categories");
    const input = quantity(usage.input);
    const output = quantity(usage.output);
    const read = quantity(usage.cacheRead);
    const write = quantity(usage.cacheWrite);
    const reasoning = quantity(usage.reasoning);
    if (read + write > input || usage.reasoningIncludedInOutput && reasoning > output) throw new Error("Invalid exact usage subsets");
    const rate = (field, fallback) => BigInt(decimalToNanoUsd(rates[field] === undefined ? rates[fallback] : rates[field]));
    let writeCost = write * rate("cache_creation", "input");
    if (usage.cacheWrite5m !== undefined || usage.cacheWrite1h !== undefined) {
      const five = quantity(usage.cacheWrite5m);
      const hour = quantity(usage.cacheWrite1h);
      if (five + hour !== write) throw new Error("Invalid cache tier subsets");
      const hourRate = hour === 0n && rates.cache_creation_1h === undefined ? 0n : rate("cache_creation_1h");
      writeCost = five * rate("cache_creation", "input") + hour * hourRate;
    } else if (rates.cache_creation_1h !== undefined || snapshot.usageSemantics?.cacheWriteTiers === "observed_5m_1h") throw new Error("Missing exact cache tiers");
    if (snapshot.usageSemantics && Object.keys(snapshot.usageSemantics).some(k => k !== "cacheWriteTiers")) throw new Error("Unsupported original usage semantics");
    numerator = (input - read - write) * rate("input") + read * rate("cached", "input") + writeCost +
      (usage.reasoningIncludedInOutput ? output - reasoning : output) * rate("output") + reasoning * rate("reasoning", "output");
  }
  return nanoUsd(((numerator + TOKEN_UNIT / 2n) / TOKEN_UNIT).toString());
}
