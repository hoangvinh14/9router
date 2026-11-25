import { randomBytes } from 'node:crypto';
import { requireAccountingAdmin } from '../../../../../../lib/accounting/management-auth.js';
import { boundedAccountingJson } from '../../../../../../lib/accounting/management-request.js';
import { getInstalledAccountingServices } from '../../../../../../lib/accounting/installed-service.js';
import { getApiKeyById } from '../../../../../../lib/db/repos/apiKeysRepo.js';

export const dynamic = 'force-dynamic';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function POST(request, { params }) {
  const denied = await requireAccountingAdmin(request, true);
  if (denied) return denied;
  const { id } = await params;
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) {
    return json({ error: { message: 'Invalid key ID' } }, 400);
  }
  let expectedVersion;
  try {
    const body = await boundedAccountingJson(request);
    if (!body || Array.isArray(body) || Object.keys(body).join(',') !== 'expectedVersion' ||
        !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1) throw new Error();
    expectedVersion = body.expectedVersion;
  } catch (error) {
    return json({ error: { message: 'Invalid rotation request' } }, error.status === 413 ? 413 : 400);
  }

  try {
    const { policy } = await getInstalledAccountingServices();
    const current = await getApiKeyById(id);
    if (!current?.key) return json({ error: { message: 'Accounting rotation unavailable' } }, 503);
    const key = 'sk-r' + randomBytes(32).toString('hex');
    const rotated = policy.rotate(id, expectedVersion, current.key, key);
    return json({ policy: rotated, key });
  } catch (error) {
    const conflict = error?.status === 409 && error?.code === 'api_key_accounting_conflict';
    return json({ error: { message: conflict ? 'Accounting operation conflict' : 'Accounting rotation unavailable',
      code: conflict ? 'api_key_accounting_conflict' : 'api_key_accounting_unavailable' } }, conflict ? 409 : 503);
  }
}
