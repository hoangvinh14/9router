import { accountingManagementRoute } from "@/lib/apiKeyBudget/managementHttp.js";
import { resolveGapManagement } from "@/lib/apiKeyBudget/management.js";
export async function POST(request, context) {
  return accountingManagementRoute(request, context, { mutation: true, action: (params, body, actor) => resolveGapManagement(params.id, body, actor) });
}
