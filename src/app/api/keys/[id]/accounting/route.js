import { accountingManagementRoute, accountingQuery } from "@/lib/apiKeyBudget/managementHttp.js";
import { listAccountingManagement } from "@/lib/apiKeyBudget/management.js";
export async function GET(request, context) {
  return accountingManagementRoute(request, context, { action: params => listAccountingManagement(params.id, accountingQuery(request)) });
}
