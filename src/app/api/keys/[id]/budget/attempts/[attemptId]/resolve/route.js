import { requireAccountingAdmin } from '../../../../../../../../lib/accounting/management-auth.js';
import { boundedAccountingJson } from '../../../../../../../../lib/accounting/management-request.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export async function POST(request, { params }) {
  const denied = await requireAccountingAdmin(request, true);
  if (denied) return denied;
  const { id, attemptId } = await params;
  let body;
  try {
    body = await boundedAccountingJson(request);
    if (!idPattern.test(id ?? '') || !idPattern.test(attemptId ?? '') || !body ||
        Object.keys(body).sort().join(',') !== 'action,evidence,expectedVersion,operationId,reason' ||
        body.action !== 'waive' || typeof body.operationId !== 'string' || !idPattern.test(body.operationId) ||
        !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1 ||
        typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 512 ||
        typeof body.evidence !== 'string' || !body.evidence.trim() || body.evidence.length > 1000) throw new Error();
  } catch (error) {
    return json({ error: { message: 'Invalid usage recovery request' } }, error.status === 413 ? 413 : 400);
  }
  try {
    const { getInstalledAccountingServices } = await import('../../../../../../../../lib/accounting/installed-service.js');
    const { ledger } = await getInstalledAccountingServices();
    return json(ledger.waiveUnresolvedUsage(id, attemptId, body));
  } catch (error) {
    const status = error?.code === 'api_key_accounting_conflict' ? 409 : 503;
    return json({ error: { message: status === 409 ? 'Accounting operation conflict' : 'Usage recovery unavailable' } }, status);
  }
}
