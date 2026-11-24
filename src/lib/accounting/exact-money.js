import { decimalToNanoUsd } from "../pricing/decimalMoney.js";
import { ALL_RATE_FIELDS, codexStandardReferenceKey, EXTENDED_RATE_FIELDS, MAX_NANO_USD, RATE_UNITS } from "../pricing/constants.js";
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
  if (copy.inputThreshold !== undefined || copy.aboveThresholdRates !== undefined) {
    const higher = copy.aboveThresholdRates;
    if (!Number.isSafeInteger(copy.inputThreshold) || copy.inputThreshold <= 0 ||
        !higher || typeof higher !== 'object' || Array.isArray(higher) ||
        Object.keys(higher).sort().join(',') !== Object.keys(copy.rates).sort().join(',')) {
      throw new Error('Invalid context-band tariff');
    }
    for (const rate of Object.values(higher)) decimalToNanoUsd(rate);
  }
  return copy;
}

export const CODEX_USD_PRICING_URL = 'https://help.openai.com/en/articles/20001415-chatgpt-rate-card-enterprise-token-based-pricing';

export function codexModelFromReference(revision) {
  const model = /^openai:codex\/([^:]+):standard:v1$/.exec(revision)?.[1];
  return model && codexStandardReferenceKey(model) === revision ? model : null;
}

export function validateCodexStandardReference(snapshot) {
  const price = validatePriceSnapshot(snapshot);
  if (!codexModelFromReference(price.revision) || price.inputThreshold !== undefined ||
      !Number.isSafeInteger(price.syncedAt) || price.syncedAt <= 0 ||
      Object.keys(price.rates).sort().join(',') !== 'cached,input,output') {
    throw new Error('Invalid Codex Standard reference price');
  }
  return price;
}

export function parseCodexStandardReferences(html, syncedAt) {
  const tables = [...html.matchAll(/<h1[^>]*>ChatGPT Work and Codex models<\/h1>(?:(?!<h1\b)[\s\S])*?<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
  if (tables.length !== 1) throw new Error('Missing Codex USD tariff table');
  const headers = [...tables[0][1].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)]
    .map(([, cell]) => cell.replace(/<[^>]+>/g, '').trim().toLowerCase());
  if (headers.join(',') !== 'model,input,cached input,output') throw new Error('Invalid Codex USD tariff columns');
  const prices = {};
  for (const [, row] of tables[0][1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(([, cell]) => cell.replace(/<[^>]+>/g, '').trim());
    if (!cells.length) continue;
    const [rawLabel, ...amounts] = cells;
    const label = rawLabel.replace(/ [*\u2020]$/, '');
    const name = label.split(' (')[0];
    if (!/^(?:GPT-|Daybreak )[A-Za-z0-9. -]+$/.test(name) || / and GPT-/.test(label)) continue;
    const model = name.toLowerCase().replaceAll(' ', '-');
    const revision = codexStandardReferenceKey(model);
    if (!revision || amounts.length !== 3 || Object.hasOwn(prices, revision) ||
        !amounts.every(value => /^\$\d+(?:\.\d+)?$/.test(value))) throw new Error('Invalid Codex USD tariff');
    const [input, cached, output] = amounts.map(value => value.slice(1));
    prices[revision] = validateCodexStandardReference({
      currency: 'USD', unit: 'USD/1M tokens', revision, syncedAt, source: CODEX_USD_PRICING_URL,
      rates: { input, cached, output },
    });
  }
  if (!Object.keys(prices).length) throw new Error('Missing Codex USD tariffs');
  return prices;
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
