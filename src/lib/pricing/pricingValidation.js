import { completeReferenceRates } from "./referenceResolver.js";
import { getProviderModels } from "../../../open-sse/config/providerModels.js";
import REGISTRY from "../../../open-sse/providers/registry/index.js";
import { modelKind } from "../../../open-sse/providers/models/schema.js";

const modelNamespaces = new Map();
for (const entry of REGISTRY) {
  modelNamespaces.set(entry.id, entry.alias || entry.id);
  if (entry.alias) modelNamespaces.set(entry.alias, entry.alias);
}
function exactEndpoint(provider, model) {
  const namespace = modelNamespaces.get(provider);
  // Canonical provider IDs and aliases share normalized registry models, but
  // pricing validation never infers an embedding from a suffix/fuzzy match.
  const known = namespace && getProviderModels(namespace).find(entry => entry.id === model);
  return known && modelKind(known) === "embedding" ? "embeddings" : "chat";
}

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);
export class PricingValidationError extends Error {
  constructor() {
    super("Invalid pricing data: complete bounded decimal rates required");
    this.name = "PricingValidationError";
  }
}
function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
export function validatePricingIdentifier(value) {
  if (typeof value !== "string" || !value || value.length > 256 || FORBIDDEN.has(value) || /[\u0000-\u001f\u007f]/.test(value)) throw new PricingValidationError();
  return value;
}
// Bound untrusted HTTP ingress before JSON materialization, including chunked
// bodies. Decimal strings retain their bytes; numeric compatibility is validated
// after JSON parsing and never used for scaled floating-point arithmetic.
export async function readPricingMutation(request) {
  const maxBytes = 20 * 1024 * 1024;
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new PricingValidationError();
  if (!request.body) throw new PricingValidationError();
  const reader = request.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new PricingValidationError(); }
      chunks.push(Buffer.from(chunk.value));
    }
    return validatePricingMutation(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch { throw new PricingValidationError(); }
  finally { reader.releaseLock(); }
}
// PATCH replaces complete model sources, not individual fields. Optional cache
// and reasoning fields retain documented input/output fallbacks, never zeros.
// Validate the entire bounded batch before opening storage or mutating any row.
export function validatePricingMutation(input) {
  try {
    if (!record(input) || Object.keys(input).length > 1000) throw new PricingValidationError();
    const result = Object.create(null);
    let count = 0;
    for (const [provider, models] of Object.entries(input)) {
      validatePricingIdentifier(provider);
      if (!record(models)) throw new PricingValidationError();
      result[provider] = Object.create(null);
      for (const [model, rates] of Object.entries(models)) {
        if (++count > 50000) throw new PricingValidationError();
        validatePricingIdentifier(model);
        if (!record(rates) || Object.keys(rates).some(key => FORBIDDEN.has(key))) throw new PricingValidationError();
        const endpoint = exactEndpoint(provider, model);
        result[provider][model] = completeReferenceRates(rates, endpoint);
      }
    }
    return result;
  } catch { throw new PricingValidationError(); }
}
