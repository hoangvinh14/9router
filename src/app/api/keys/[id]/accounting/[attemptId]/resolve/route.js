import { accountingManagementRoute } from "@/lib/apiKeyBudget/managementHttp.js";
import { resolveAccountingManagement } from "@/lib/apiKeyBudget/management.js";
export async function POST(request, context) {
  return accountingManagementRoute(request, context, { mutation: true, action: (params, body, actor) => resolveAccountingManagement(params.id, params.attemptId, body, actor) });
}
