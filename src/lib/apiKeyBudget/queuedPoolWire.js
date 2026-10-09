import { isDeepStrictEqual } from 'node:util';
import { snapshotAccountingGroup } from '../db/accountingGroupPayload.js';
import { validatePersistedPoolProxy } from '../../../open-sse/config/accountedProxyAuthority.js';

const unavailable = () => { throw new Error('Queued selected pool wire unavailable'); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);

// INTERNAL selected-pool equality only. Does not authorize dispatch, global/env
// fallback, NO_PROXY outcome, provider eligibility, URL, relay or rotation.
// Must also run against the original prepared work before enqueue, not just a
// fresh row after queue wait. Never changes the prepared route to obtain equality.
export function validateQueuedSelectedPoolWire(authority, value) {
  const options = snapshotAccountingGroup([{ type: 'pool-wire', value }])[0].value;
  if (!object(options) || !authority?.connection || !authority.proxyPool) unavailable();
  let connection, pool;
  try { connection = JSON.parse(authority.connection.data); pool = JSON.parse(authority.proxyPool.data); } catch { unavailable(); }
  if (!object(connection) || !object(pool)) unavailable();
  const selected = connection.providerSpecificData?.proxyPoolId;
  if (typeof selected !== 'string' || !selected.trim() || selected.trim() === '__none__' || selected.trim() !== authority.proxyPool.id) unavailable();
  const saved = validatePersistedPoolProxy({ id: authority.proxyPool.id, url: pool.proxyUrl,
    noProxy: pool.noProxy ?? '', strictProxy: pool.strictProxy ?? false,
    type: pool.type ?? 'http', isActive: authority.proxyPool.isActive === 1 });
  // Match the selected original resolved route, never allow legacy/global/direct
  // fallback to replace a missing, inactive, unavailable or non-HTTP pool.
  if (options.proxyPoolId !== saved.id || options.connectionProxyEnabled !== true ||
      options.strictProxy !== saved.strictProxy || options.proxyPoolUnavailable === true || options.vercelRelayUrl) unavailable();
  const resolved = validatePersistedPoolProxy({ ...saved, url: options.connectionProxyUrl,
    noProxy: options.connectionNoProxy });
  if (!isDeepStrictEqual(resolved, saved)) unavailable();
  if (Object.hasOwn(options, 'persistedPoolProxy') && !isDeepStrictEqual(validatePersistedPoolProxy(options.persistedPoolProxy), saved)) unavailable();
  // Detached bounded evidence only. Global proxy and bypass result need separate
  // saved authority and actual transport controls; this helper grants neither.
  return options;
}
