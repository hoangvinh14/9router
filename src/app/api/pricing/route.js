import { NextResponse } from "next/server";
import { getPricing, updatePricing, resetPricing, resetAllPricing } from "@/lib/localDb.js";
import { getDefaultPricing } from "open-sse/providers/pricing.js";
import { PricingValidationError, readPricingMutation, validatePricingIdentifier } from "@/lib/pricing/pricingValidation.js";
import { authorizeManagement } from '@/lib/auth/managementGuard.js';

const json = (body, options = {}) => NextResponse.json(body, { ...options, headers: { 'Cache-Control': 'no-store' } });

/**
 * GET /api/pricing
 * Get current pricing configuration (merged user + defaults)
 */
export async function GET(request) {
  const auth = await authorizeManagement(request);
  if (auth.response) return auth.response;
  try {
    const pricing = await getPricing();
    return json(pricing);
  } catch {
    console.error("Error fetching pricing");
    return json(
      { error: "Failed to fetch pricing" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/pricing
 * Update pricing configuration
 * Body: complete model rates as decimal strings or legacy finite numbers.
 * Optional cache/reasoning fields inherit documented input/output rates.
 */
export async function PATCH(request) {
  const auth = await authorizeManagement(request, { mutation: true });
  if (auth.response) return auth.response;
  try {
    let body;
    try { body = await readPricingMutation(request); }
    catch { return json({ error: "Invalid pricing data: complete bounded decimal rates required" }, { status: 400 }); }

    const updatedPricing = await updatePricing(body);
    return json(updatedPricing);
  } catch (error) {
    if (error instanceof PricingValidationError) return json({ error: error.message }, { status: 400 });
    console.error("Error updating pricing");
    return json(
      { error: "Failed to update pricing" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/pricing
 * Reset pricing to defaults
 * Query params: ?provider=xxx&model=yyy (optional)
 */
export async function DELETE(request) {
  const auth = await authorizeManagement(request, { mutation: true });
  if (auth.response) return auth.response;
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider");
    const model = searchParams.get("model");
    try {
      if (provider !== null) validatePricingIdentifier(provider);
      if (model !== null) validatePricingIdentifier(model);
      if (model !== null && provider === null) throw new PricingValidationError();
    } catch { return json({ error: "Invalid pricing reset target" }, { status: 400 }); }

    if (provider && model) {
      // Reset specific model
      await resetPricing(provider, model);
    } else if (provider) {
      // Reset entire provider
      await resetPricing(provider);
    } else {
      // Reset all pricing
      await resetAllPricing();
    }

    const pricing = await getPricing();
    return json(pricing);
  } catch {
    console.error("Error resetting pricing");
    return json(
      { error: "Failed to reset pricing" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/pricing/defaults
 * Get default pricing configuration
 */
export async function GET_DEFAULTS(request) {
  const auth = await authorizeManagement(request);
  if (auth.response) return auth.response;
  try {
    const defaultPricing = getDefaultPricing();
    return json(defaultPricing);
  } catch {
    console.error("Error fetching default pricing");
    return json(
      { error: "Failed to fetch default pricing" },
      { status: 500 }
    );
  }
}