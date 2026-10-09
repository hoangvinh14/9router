import { accountingManagementRoute } from '@/lib/apiKeyBudget/managementHttp.js';
import { getGlobalAccountingManagement, resolveGlobalGapManagement } from '@/lib/apiKeyBudget/globalManagement.js';
const context = { params: Promise.resolve({}) };
export async function GET(request) {
  return accountingManagementRoute(request, context, { action: () => getGlobalAccountingManagement() });
}
export async function POST(request) {
  return accountingManagementRoute(request, context, { mutation: true, action: (_params, input, actor) => resolveGlobalGapManagement(input, actor) });
}
