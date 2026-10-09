import { isDeepStrictEqual } from 'node:util';
import { snapshotAccountingGroup } from '../db/accountingGroupPayload.js';
import { validatePersistedGlobalProxy } from '../../../open-sse/config/accountedProxyAuthority.js';

const unavailable = () => { throw new Error('Queued saved proxy wire unavailable'); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = value => value == null ? '' : typeof value === 'string' ? value.trim() : unavailable();

// INTERNAL saved global/legacy equality, NOT env/URL/bypass/dispatch permission.
// No mutation of process.env, no silent reconstruction of different prepared
// proxyOptions. Selected pools require their separate original pool validator.
export function validateQueuedSavedProxyWire(authority, value) {
  const options = snapshotAccountingGroup([{ type: 'saved-proxy-wire', value }])[0].value;
  if (options !== null && !object(options)) unavailable();
  let settings, connection;
  try { settings = JSON.parse(authority.settings); connection = JSON.parse(authority.connection.data); } catch { unavailable(); }
  if (!object(settings) || !object(connection)) unavailable();
  const specific = connection.providerSpecificData ?? {};
  if (!object(specific)) unavailable();
  if (settings.outboundProxyEnabled !== undefined && typeof settings.outboundProxyEnabled !== 'boolean') unavailable();
  if (options?.vercelRelayUrl || specific.vercelRelayUrl) unavailable();
  const hasSaved = options !== null && Object.hasOwn(options, 'persistedGlobalProxy');
  if (settings.outboundProxyEnabled === true) {
    const saved = validatePersistedGlobalProxy({ url: settings.outboundProxyUrl, noProxy: settings.outboundNoProxy ?? '' });
    if (!hasSaved || !isDeepStrictEqual(validatePersistedGlobalProxy(options.persistedGlobalProxy), saved)) unavailable();
  } else if (hasSaved) {
    // A caller's saved-global envelope cannot override disabled persisted policy.
    unavailable();
  }
  if (authority.proxyPool) return options; // selected original route checked separately
  if (text(specific.proxyPoolId) && text(specific.proxyPoolId) !== '__none__' ||
      text(options?.proxyPoolId) || options && Object.hasOwn(options, 'persistedPoolProxy')) unavailable();
  if (specific.connectionProxyEnabled !== undefined && typeof specific.connectionProxyEnabled !== 'boolean') unavailable();
  const enabled = specific.connectionProxyEnabled === true;
  if (enabled) {
    const saved = validatePersistedGlobalProxy({ url: specific.connectionProxyUrl, noProxy: specific.connectionNoProxy ?? '' });
    if (options?.connectionProxyEnabled !== true || options?.strictProxy === true || options?.proxyPoolUnavailable === true ||
        !isDeepStrictEqual(validatePersistedGlobalProxy({ url: options.connectionProxyUrl, noProxy: options.connectionNoProxy ?? '' }), saved)) unavailable();
  } else if (options?.connectionProxyEnabled === true || text(options?.connectionProxyUrl) || text(options?.connectionNoProxy) ||
      options?.strictProxy === true || options?.proxyPoolUnavailable === true) unavailable();
  // No saved proxy means external environment/direct outcome is still unproved;
  // callers must establish that separate authority before production integration.
  return options;
}
