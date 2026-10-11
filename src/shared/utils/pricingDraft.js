import { validateRate } from "../../lib/pricing/money.js";
import { getModelType } from "../../../open-sse/config/providerModels.js";

import { REFERENCE_RATE_FIELDS } from '../../../open-sse/config/accountingCacheTiers.js';
export const PRICING_FIELDS = REFERENCE_RATE_FIELDS;
function displayRate(value) {
  if (value === undefined || value === null) return '';
  const text = String(value);
  // Expand only the legacy numeric GET representation. No arithmetic/rounding,
  // and no exponent acceptance for user strings or validation relaxation.
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !/[eE]/.test(text)) return text;
  const [mantissa, exponent] = text.toLowerCase().split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  const digits = whole + fraction, point = whole.length + Number(exponent);
  return point <= 0 ? `0.${'0'.repeat(-point)}${digits}`
    : point >= digits.length ? digits + '0'.repeat(point - digits.length)
      : `${digits.slice(0, point)}.${digits.slice(point)}`;
}
export function pricingDraft(pricing) {
  const draft = Object.create(null);
  for (const [provider, models] of Object.entries(pricing || {})) {
    draft[provider] = Object.create(null);
    for (const [model, rates] of Object.entries(models)) {
      draft[provider][model] = Object.fromEntries(PRICING_FIELDS.map(field => [field, displayRate(rates[field])]));
    }
  }
  return draft;
}
function comparable(value) {
  if (value === "") return "";
  try { return validateRate(value); } catch { return value; }
}
// Complete model replacements ONLY for changed rows. Blank optional fields mean
// documented input/output fallback, except 1h writes which remain unavailable.
// Required fields never fabricate zero.
export function changedPricingModels(baseline, draft) {
  const changed = Object.create(null);
  for (const [provider, models] of Object.entries(draft)) {
    for (const [model, rates] of Object.entries(models)) {
      const original = baseline[provider]?.[model] || {};
      if (PRICING_FIELDS.every(field => comparable(rates[field] || "") === comparable(original[field] || ""))) continue;
      const complete = {};
      for (const field of PRICING_FIELDS) {
        const value = rates[field] || "";
        if (value === "") {
          if (field === "input" || field === "output" && getModelType(provider, model) !== "embedding") throw new Error(`${provider}/${model}: input and output rates are required`);
        } else {
          try { complete[field] = validateRate(value); }
          catch { throw new Error(`${provider}/${model}: ${field} requires a nonnegative decimal with at most nine decimal places`); }
        }
      }
      changed[provider] ||= Object.create(null);
      changed[provider][model] = complete;
    }
  }
  return changed;
}

export async function submitPricingDraft(baseline, draft, fetcher = fetch) {
  const changes = changedPricingModels(baseline, draft);
  if (Object.keys(changes).length === 0) return false;
  const response = await fetcher("/api/pricing", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes),
  });
  if (!response.ok) {
    let result;
    try { result = await response.json(); } catch { /* Untrusted error body may not be JSON. */ }
    throw new Error(typeof result?.error === "string" ? result.error : "Failed to save pricing");
  }
  return true;
}
