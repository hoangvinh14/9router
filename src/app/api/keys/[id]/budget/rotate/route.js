import { randomBytes } from 'node:crypto';
import { requireAccountingAdmin } from '../../../../../../lib/accounting/management-auth.js';
import { boundedAccountingJson } from '../../../../../../lib/accounting/management-request.js';
import { getInstalledAccountingServices } from '../../../../../../lib/accounting/installed-service.js';
import { isRotationOperationId } from '../../../../../../lib/accounting/node-key-policy.js';

export const dynamic = 'force-dynamic';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const validKeyId = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id);

export async function GET(request, { params }) {
  const denied = await requireAccountingAdmin(request);
  if (denied) return denied;
  const { id } = await params;
  const operations = new URL(request.url).searchParams.getAll('operationId');
  if (!validKeyId(id) || operations.length !== 1 || !isRotationOperationId(operations[0])) {
    return json({ error: { message: 'Invalid rotation lookup' } }, 400);
  }
  try {
    const { policy } = await getInstalledAccountingServices();
    const receipt = policy.inspectRotation(id, operations[0]);
    return receipt ? json({ receipt }) : json({ error: { message: 'Rotation receipt not found' } }, 404);
  } catch {
    return json({ error: { message: 'Accounting rotation unavailable' } }, 503);
  }
}

export async function POST(request, { params }) {
  const denied = await requireAccountingAdmin(request, true);
  if (denied) return denied;
  const { id } = await params;
  if (!validKeyId(id)) {
    return json({ error: { message: 'Invalid key ID' } }, 400);
  }
  let expectedVersion, operationId;
  try {
    const body = await boundedAccountingJson(request);
    if (!body || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'expectedVersion,operationId' ||
        !isRotationOperationId(body.operationId) ||
        !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1) throw new Error();
    ({ expectedVersion, operationId } = body);
  } catch (error) {
    return json({ error: { message: 'Invalid rotation request' } }, error.status === 413 ? 413 : 400);
  }

  try {
    const { policy } = await getInstalledAccountingServices();
    const key = 'sk-r' + randomBytes(32).toString('hex');
    const result = policy.rotateAudited(id, expectedVersion, operationId, key);
    return json(result.policy ? { ...result, key } : result);
  } catch (error) {
    const conflict = error?.status === 409 && error?.code === 'api_key_accounting_conflict';
    return json({ error: { message: conflict ? 'Accounting operation conflict' : 'Accounting rotation unavailable',
      code: conflict ? 'api_key_accounting_conflict' : 'api_key_accounting_unavailable' } }, conflict ? 409 : 503);
  }
}
