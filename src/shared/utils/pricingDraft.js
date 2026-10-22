import { validateRate } from "../../lib/pricing/decimalMoney.js";
import { ALL_RATE_FIELDS, EXTENDED_RATE_FIELDS } from "../../lib/pricing/constants.js";
import { getModelType } from "../../../open-sse/config/providerModels.js";

export const PRICING_FIELDS = ALL_RATE_FIELDS;
// Consume only the exact editor projection. A Number here is a contract error,
// not permission to fabricate precision from the numeric compatibility map.
export function pricingDraft(pricing) {
  if (!pricing || typeof pricing !== "object" || Array.isArray(pricing)) throw new Error("Exact pricing unavailable");
  const draft = Object.create(null);
  for (const [provider, models] of Object.entries(pricing)) {
    draft[provider] = Object.create(null);
    for (const [model, rates] of Object.entries(models)) {
      draft[provider][model] = Object.fromEntries(PRICING_FIELDS.map(field => {
        const value = rates[field];
        if (value !== undefined && typeof value !== "string") throw new Error("Exact pricing unavailable");
        return [field, value ?? ""];
      }));
    }
  }
  return draft;
}
function comparable(value) {
  if (value === "") return "";
  try { return validateRate(value); } catch { return value; }
}
export function changedPricingModels(baseline, draft) {
  const changed = Object.create(null);
  for (const [provider, models] of Object.entries(draft)) {
    for (const [model, rates] of Object.entries(models)) {
      const original = baseline[provider]?.[model] || {};
      if (PRICING_FIELDS.every(field => comparable(rates[field] ?? "") === comparable(original[field] ?? ""))) continue;
      const complete = {}, embedding = getModelType(provider, model) === "embedding";
      for (const field of PRICING_FIELDS) {
        const value = rates[field] ?? "";
        if (value === "") {
          if (field === "input" || field === "output" && !embedding) throw new Error(`${provider}/${model}: complete input and output rates required`);
        } else {
          if (EXTENDED_RATE_FIELDS.includes(field) && embedding) throw new Error(`${provider}/${model}: extended rates apply to chat only`);
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
  if (!Object.keys(changes).length) return false;
  const response = await fetcher("/api/pricing", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes),
  });
  if (!response.ok) throw new Error("Pricing save denied or unavailable. Your edits have not been confirmed.");
  return true;
}
