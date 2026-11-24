import { requireAccountingAdmin } from '../../../../../lib/accounting/management-auth.js';
import { findInstalledBudgetProfileForKey } from '../../../../../lib/accounting/profile-registry.js';
import { nanoUsd } from '../../../../../lib/accounting/exact-money.js';
import { boundedAccountingJson } from '../../../../../lib/accounting/management-request.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const unavailable = () => json({ error: { message: 'Accounting profile unavailable', code: 'api_key_accounting_unavailable' } }, 503);
const validId = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id);

// No fixture flag, schema creation or default zero-spend response. This shipping
// management endpoint remains unavailable until actual coverage/lifecycle admits
// configuration. Inference credentials and optional dashboard-login settings do
// not grant management authority.
export async function GET(request, { params }) {
  const denied = await requireAccountingAdmin(request);
  if (denied) return denied;
  const { id } = await params;
  if (!validId(id)) return json({ error: { message: 'Invalid key ID' } }, 400);
  const profile = await findInstalledBudgetProfileForKey(id);
  if (!profile) {
    return json({ readiness: { ready: false, reason: 'no_admitted_profile' }, policy: null, usage: null });
  }
  try {
    const { getInstalledAccountingServices } = await import('../../../../../lib/accounting/installed-service.js');
    const { ledger } = await getInstalledAccountingServices();
    const snapshot = ledger.inspectBudget(id);
    if (!snapshot.policy) return json({ keyId: id, error: { code: 'budget_not_configured' } }, 503);
    return json({ readiness: { ready: true, reason: null }, ...snapshot,
      ...(profile.referencePrices ? { referencePrices: profile.referencePrices } : {}),
    });
  } catch { return unavailable(); }
}

export async function PUT(request, { params }) {
  const denied = await requireAccountingAdmin(request, true);
  if (denied) return denied;
  const { id } = await params;
  if (!validId(id)) return json({ error: { message: 'Invalid key ID' } }, 400);
  let body;
  try {
    body = await boundedAccountingJson(request);
    if (!body || Object.keys(body).sort().join(',') !== 'expectedVersion,limits' ||
        !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0 ||
        !body.limits || Object.keys(body.limits).sort().join(',') !== 'monthly,weekly') throw new Error();
    for (const amount of Object.values(body.limits)) if (amount !== null) nanoUsd(amount);
  } catch (error) {
    return json({ error: { message: 'Invalid budget request' } }, error.status === 413 ? 413 : 400);
  }
  if (!await findInstalledBudgetProfileForKey(id)) return unavailable();
  try {
    const { getInstalledAccountingServices } = await import('../../../../../lib/accounting/installed-service.js');
    const { policy } = await getInstalledAccountingServices();
    return json({ policy: policy.save(id, body.expectedVersion, body.limits) });
  } catch (error) {
    if (error?.code === 'api_key_accounting_conflict' && error.status === 409) {
      return json({ error: { message: 'Accounting operation conflict', code: error.code } }, 409);
    }
    return unavailable();
  }
}
