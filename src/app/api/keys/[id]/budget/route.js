import { accountingManagementRoute } from "@/lib/apiKeyBudget/managementHttp.js";
import { getBudgetManagement, putBudgetManagement } from "@/lib/apiKeyBudget/management.js";
export async function GET(request, context) {
  return accountingManagementRoute(request, context, { action: params => getBudgetManagement(params.id) });
}
export async function PUT(request, context) {
  return accountingManagementRoute(request, context, { mutation: true, action: (params, body) => putBudgetManagement(params.id, body) });
}
