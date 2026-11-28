import { requireAccountingAdmin } from '../../../../../../lib/accounting/management-auth.js';
import { boundedAccountingJson } from '../../../../../../lib/accounting/management-request.js';
import { getInstalledAccountingServices } from '../../../../../../lib/accounting/installed-service.js';

export const dynamic = 'force-dynamic';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

// Existing-bound-policy status only, not key discovery, usage or dispatch rights.
// The owner uses BEGIN IMMEDIATE: read-facing, NOT readonly acquisition/zero I/O.
export async function GET(request, { params }) {
  const denied = await requireAccountingAdmin(request);
  if (denied) return denied;
  const { id } = await params;
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) {
    return json({ error: { message: 'Invalid key ID' } }, 400);
  }
  try {
    const { policy } = await getInstalledAccountingServices();
    return json({ readiness: { ready: true, reason: null }, ...policy.inspectRetirement(id), usage: null });
  } catch {
    return json({ error: { message: 'Accounting retirement status unavailable', code: 'api_key_accounting_unavailable' } }, 503);
  }
}

// Retirement, NOT DELETE or secret erasure. The disabled app row, current secret
// and stable accounting history remain. No enrollment/schema creation/opener or
// producer permission: installed provenance/startup refusal remains authoritative.
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
    return json({ error: { message: 'Invalid retirement request' } }, error.status === 413 ? 413 : 400);
  }
  try {
    const { policy } = await getInstalledAccountingServices();
    policy.retireAudited(id, expectedVersion); // transition + actor-class event, same observed commit
    return json({ retired: true, credentialMaterialRetained: true });
  } catch (error) {
    const conflict = error?.status === 409 && error?.code === 'api_key_accounting_conflict';
    // Never expose key existence, secret, raw SQL, driver failure or cleanup cause.
    return json({ error: { message: conflict ? 'Accounting operation conflict' : 'Accounting retirement unavailable',
      code: conflict ? 'api_key_accounting_conflict' : 'api_key_accounting_unavailable' } }, conflict ? 409 : 503);
  }
}
