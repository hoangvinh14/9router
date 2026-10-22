import { NextResponse } from "next/server";
import { getPricing, getEditorPricing, updatePricing, resetPricing, resetAllPricing } from "@/lib/db/index.js";
import { getDefaultPricing } from "open-sse/providers/pricing.js";
import { PricingValidationError, readPricingMutation, validatePricingIdentifier } from "@/lib/pricing/pricingValidation.js";
import { authorizeManagement } from "@/lib/auth/managementGuard.js";

const json = (body, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request) {
  const auth = await authorizeManagement(request);
  if (auth.response) return auth.response;
  let editor = false;
  try {
    const params = new URL(request.url).searchParams;
    if (params.has("view")) {
      if (params.getAll("view").length !== 1 || params.get("view") !== "editor" || [...params.keys()].some(key => key !== "view")) return json({ error: "Invalid pricing view" }, 400);
      editor = true;
    }
  } catch { return json({ error: "Invalid pricing view" }, 400); }
  try { return json(editor ? await getEditorPricing() : await getPricing()); }
  catch { return json({ error: "Pricing unavailable", code: "pricing_storage_unavailable" }, 503); }
}

// Complete model sources only; omission of optional fields inherits input/output.
export async function PATCH(request) {
  const auth = await authorizeManagement(request, { mutation: true });
  if (auth.response) return auth.response;
  let body;
  try { body = await readPricingMutation(request); }
  catch { return json({ error: "Invalid pricing data: complete bounded decimal rates required" }, 400); }
  try { return json(await updatePricing(body)); }
  catch (error) {
    if (error instanceof PricingValidationError) return json({ error: error.message }, 400);
    return json({ error: "Pricing unavailable", code: "pricing_storage_unavailable" }, 503);
  }
}

export async function DELETE(request) {
  const auth = await authorizeManagement(request, { mutation: true });
  if (auth.response) return auth.response;
  let provider, model;
  try {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => !["provider", "model"].includes(key))
        || params.getAll("provider").length > 1 || params.getAll("model").length > 1) throw new PricingValidationError();
    provider = params.get("provider"); model = params.get("model");
    if (provider !== null) validatePricingIdentifier(provider);
    if (model !== null) validatePricingIdentifier(model);
    if (model !== null && provider === null) throw new PricingValidationError();
  } catch { return json({ error: "Invalid pricing reset target" }, 400); }
  try {
    if (provider !== null && model !== null) await resetPricing(provider, model);
    else if (provider !== null) await resetPricing(provider);
    else await resetAllPricing();
    return json(await getPricing());
  } catch { return json({ error: "Pricing unavailable", code: "pricing_storage_unavailable" }, 503); }
}

// Kept for existing callers; no separate public defaults bypass.
export async function GET_DEFAULTS(request) {
  const auth = await authorizeManagement(request);
  if (auth.response) return auth.response;
  try { return json(getDefaultPricing()); }
  catch { return json({ error: "Pricing defaults unavailable" }, 503); }
}
