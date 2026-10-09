import { accountingManagementRoute, accountingQuery } from "@/lib/apiKeyBudget/managementHttp.js";
import { getUsageManagement } from "@/lib/apiKeyBudget/management.js";
export async function GET(request, context) {
  return accountingManagementRoute(request, context, { action: params => getUsageManagement(params.id, accountingQuery(request)) });
}
