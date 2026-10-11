import { isDeepStrictEqual } from 'node:util';
import { snapshotAccountingGroup } from '../db/accountingGroupPayload.js';
import { validateQueuedSavedProxyWire } from './queuedSavedProxyWire.js';
import { validateQueuedSelectedPoolWire } from './queuedPoolWire.js';
import { validateAccountingProxyEnvironment } from '../../../open-sse/config/accountedProxyEnvironment.js';
import { validateAccountingGrokCliDispatch, validateAccountingGrokCliPost } from '../../../open-sse/config/accountedGrokCliDispatch.js';
import { ACCOUNTED_GROK_CLI_PROTOCOL, grokCliAccountingHeaders, grokCliIdentityString } from '../../../open-sse/config/accountedGrokCliCandidate.js';
const unavailable = () => { throw new Error('Queued Grok CLI wire unavailable'); };
const record = value => value && typeof value === 'object' && !Array.isArray(value);
export function validateQueuedGrokCliWire(authority, value) {
  const wire = snapshotAccountingGroup([{ type: 'wire', value }])[0].value;
  const fields = ['protocol', 'url', 'headers', 'credentials', 'providerOverrides', 'proxyOptions', 'proxyEnvironment', 'grokCliTransport'];
  if (authority?.provider !== 'grok-cli' || authority.connection?.authType !== 'oauth' || !record(wire) || wire.protocol !== ACCOUNTED_GROK_CLI_PROTOCOL ||
      Object.keys(wire).length !== fields.length || !fields.every(key => Object.hasOwn(wire, key)) || !record(wire.headers) || !record(wire.credentials) ||
      Object.keys(wire.credentials).length !== 4 || !['apiKey', 'accessToken', 'connectionId', 'providerSpecificData'].every(key => Object.hasOwn(wire.credentials, key))) unavailable();
  let connection, settings;
  try { connection = JSON.parse(authority.connection.data); settings = JSON.parse(authority.settings); } catch { unavailable(); }
  if (!record(connection) || !record(settings) || connection.apiKey || wire.credentials.apiKey !== null ||
      !grokCliIdentityString(connection.accessToken) || wire.credentials.accessToken !== connection.accessToken || wire.credentials.connectionId !== authority.connection.id ||
      !record(connection.providerSpecificData) || !isDeepStrictEqual(wire.credentials.providerSpecificData, connection.providerSpecificData) ||
      !grokCliIdentityString(connection.providerSpecificData.deviceId) ||
      ['email', 'userId'].some(key => connection.providerSpecificData[key] !== undefined && !grokCliIdentityString(connection.providerSpecificData[key]))) unavailable();
  const dispatch = validateAccountingGrokCliDispatch(wire.grokCliTransport, wire.url);
  if (dispatch.model !== authority.model || !isDeepStrictEqual(wire.providerOverrides, settings.providerOverrides?.['grok-cli'] ?? null)) unavailable();
  const canonical = new Headers(grokCliAccountingHeaders(wire.credentials, dispatch.grokConfig, dispatch.identity)), expected = new Headers(canonical);
  const overrides = wire.providerOverrides;
  if (overrides?.headers !== undefined) {
    if (!record(overrides.headers)) unavailable();
    const seen = new Set();
    for (const [name, header] of Object.entries(overrides.headers)) {
      if (typeof header !== 'string' || seen.has(name.toLowerCase())) unavailable();
      seen.add(name.toLowerCase()); expected.set(name, header);
    }
  }
  const actual = new Headers(), seen = new Set();
  for (const [name, header] of Object.entries(wire.headers)) {
    if (typeof header !== 'string' || seen.has(name.toLowerCase())) unavailable();
    seen.add(name.toLowerCase()); actual.set(name, header);
  }
  // Saved overrides cannot replace original selected OAuth/device/client identity.
  if (!isDeepStrictEqual([...actual], [...expected]) || !isDeepStrictEqual([...actual], [...canonical])) unavailable();
  validateAccountingGrokCliPost(dispatch, wire.url, { method: 'POST', redirect: 'error', body: dispatch.serializedBody, headers: wire.headers });
  validateAccountingProxyEnvironment(wire.proxyEnvironment); validateQueuedSavedProxyWire(authority, wire.proxyOptions);
  if (authority.proxyPool) validateQueuedSelectedPoolWire(authority, wire.proxyOptions);
  return wire;
}
