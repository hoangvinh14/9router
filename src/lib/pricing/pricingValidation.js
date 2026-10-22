import { completeReferenceRates, isPlainRecord } from "./rateValidation.js";
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
  const known = namespace && getProviderModels(namespace).find(entry => entry.id === model);
  return known && modelKind(known) === "embedding" ? "embeddings" : "chat";
}
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);
export class PricingValidationError extends Error {
  constructor() { super("Invalid pricing data: complete bounded decimal rates required"); this.name = "PricingValidationError"; }
}
export function validatePricingIdentifier(value) {
  if (typeof value !== "string" || !value || value.length > 256 || FORBIDDEN.has(value) || /[\u0000-\u001f\u007f]/.test(value)) throw new PricingValidationError();
  return value;
}
// Whole batch validated before storage. PATCH replaces complete model sources.
export function validatePricingMutation(input) {
  try {
    if (!isPlainRecord(input) || Object.keys(input).length > 1000) throw new PricingValidationError();
    const result = Object.create(null); let count = 0;
    for (const [provider, models] of Object.entries(input)) {
      validatePricingIdentifier(provider);
      if (!isPlainRecord(models)) throw new PricingValidationError();
      result[provider] = Object.create(null);
      for (const [model, rates] of Object.entries(models)) {
        if (++count > 50000) throw new PricingValidationError();
        validatePricingIdentifier(model);
        result[provider][model] = completeReferenceRates(rates, exactEndpoint(provider, model));
      }
    }
    return result;
  } catch { throw new PricingValidationError(); }
}
export async function readPricingMutation(request) {
  const maxBytes = 20 * 1024 * 1024;
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || length.trim() !== length || Number(length) > maxBytes)) throw new PricingValidationError();
  if (!request.body) throw new PricingValidationError();
  const reader = request.body.getReader(), chunks = []; let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new PricingValidationError(); }
      chunks.push(Buffer.from(chunk.value));
    }
    return validatePricingMutation(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch { throw new PricingValidationError(); }
  finally { reader.releaseLock(); }
}
