import { NextResponse } from "next/server";
import { authorizeManagement } from "@/lib/auth/managementGuard.js";
import { getPricingCoverage, pricingCoverageQuery } from "@/lib/pricing/coverageReport.js";
export async function GET(request) {
  const authorization = await authorizeManagement(request);
  if (authorization.response) return authorization.response;
  const headers = { "Cache-Control": "no-store" };
  try { return NextResponse.json(await getPricingCoverage(pricingCoverageQuery(request)), { headers }); }
  catch (error) {
    const status = [400, 409].includes(error.status) ? error.status : 503;
    return NextResponse.json({ error: status === 400 ? "Invalid pricing coverage query" : status === 409 ? "Pricing changed; restart coverage pagination" : "Pricing coverage unavailable",
      code: status === 400 ? "invalid_pricing_coverage_query" : status === 409 ? "pricing_coverage_revision_changed" : "pricing_storage_unavailable" }, { status, headers });
  }
}
