import { ALL_RATE_FIELDS, EXTENDED_RATE_FIELDS, REFERENCE_ENDPOINTS } from "./constants.js";
import { validateRate } from "./decimalMoney.js";

export function isPlainRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

// Complete source, never field-by-field fallback across price authorities.
export function completeReferenceRates(input, endpoint = "chat") {
  if (!REFERENCE_ENDPOINTS.includes(endpoint) || !isPlainRecord(input)) throw new Error("Invalid complete reference rates");
  if (Object.keys(input).some(field => !ALL_RATE_FIELDS.includes(field))
      || endpoint === "embeddings" && EXTENDED_RATE_FIELDS.some(field => Object.hasOwn(input, field))) {
    throw new Error("Unsupported reference rate fields");
  }
  const rates = {};
  for (const [field, value] of Object.entries(input)) {
    if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) throw new Error("Invalid legacy numeric reference rate");
    rates[field] = validateRate(typeof value === "number" ? String(value) : value);
  }
  if (rates.input === undefined || endpoint !== "embeddings" && rates.output === undefined) throw new Error("Incomplete reference rates");
  if (endpoint === "embeddings" && rates.output === undefined) rates.output = "0";
  return rates;
}
