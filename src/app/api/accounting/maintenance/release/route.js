import { accountingManagementRoute } from '@/lib/apiKeyBudget/managementHttp.js';
import { releaseGlobalMaintenanceManagement } from '@/lib/apiKeyBudget/globalManagement.js';

// Explicit operator recovery, never activation or startup repair.
export function POST(request) {
  return accountingManagementRoute(request, { params: Promise.resolve({}) }, {
    mutation: true, action: (_params, input, actor) => releaseGlobalMaintenanceManagement(input, actor),
  });
}
