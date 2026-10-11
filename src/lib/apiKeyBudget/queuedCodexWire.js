import { isDeepStrictEqual } from 'node:util';
import { snapshotAccountingGroup } from '../db/accountingGroupPayload.js';
import { validateQueuedSavedProxyWire } from './queuedSavedProxyWire.js';
import { validateQueuedSelectedPoolWire } from './queuedPoolWire.js';
import { validateAccountingProxyEnvironment } from '../../../open-sse/config/accountedProxyEnvironment.js';
import { validateAccountingCodexDispatch, validateAccountingCodexPost } from '../../../open-sse/config/accountedCodexDispatch.js';
import { codexAccountingHeaders } from '../../../open-sse/config/accountedCodexCandidate.js';

const unavailable = () => { throw new Error('Queued Codex wire unavailable'); };
const record = value => value && typeof value === 'object' && !Array.isArray(value);
export function validateQueuedCodexWire(authority, value) {
  const wire = snapshotAccountingGroup([{ type: 'wire', value }])[0].value;
  const fields = ['protocol', 'url', 'headers', 'credentials', 'providerOverrides', 'proxyOptions', 'proxyEnvironment', 'codexTransport'];
  if (authority?.provider !== 'codex' || !authority.connection || authority.connection.authType !== 'oauth' || !record(wire) ||
      wire.protocol !== 'native-codex' || Object.keys(wire).length !== fields.length || fields.some(key => !Object.hasOwn(wire, key)) ||
      !record(wire.headers) || !record(wire.credentials) || Object.keys(wire.credentials).length !== 4 ||
      !['apiKey', 'accessToken', 'connectionId', 'providerSpecificData'].every(key => Object.hasOwn(wire.credentials, key))) unavailable();
  let connection, settings;
  try { connection = JSON.parse(authority.connection.data); settings = JSON.parse(authority.settings); } catch { unavailable(); }
  if (!record(connection) || !record(settings) || connection.apiKey || wire.credentials.apiKey !== null ||
      typeof connection.accessToken !== 'string' || !connection.accessToken || /[\x00-\x20\x7f]/.test(connection.accessToken) ||
      wire.credentials.accessToken !== connection.accessToken || wire.credentials.connectionId !== authority.connection.id ||
      !record(connection.providerSpecificData) || !isDeepStrictEqual(wire.credentials.providerSpecificData, connection.providerSpecificData)) unavailable();
  const dispatch = validateAccountingCodexDispatch(wire.codexTransport, wire.url);
  if (dispatch.model !== authority.model) unavailable();
  const overrides = settings.providerOverrides?.codex ?? null;
  if (!isDeepStrictEqual(wire.providerOverrides, overrides)) unavailable();
  const expected = new Headers(codexAccountingHeaders(wire.credentials, dispatch.baseTransport.headers));
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
  // Overrides cannot replace the selected OAuth account/token/session/config.
  const canonical = new Headers(codexAccountingHeaders(wire.credentials, dispatch.baseTransport.headers));
  if (!isDeepStrictEqual([...actual], [...expected]) || !isDeepStrictEqual([...actual], [...canonical])) unavailable();
  validateAccountingCodexPost(dispatch, wire.url, { method: 'POST', redirect: 'error', body: dispatch.serializedBody, headers: wire.headers });
  validateAccountingProxyEnvironment(wire.proxyEnvironment);
  validateQueuedSavedProxyWire(authority, wire.proxyOptions);
  if (authority.proxyPool) validateQueuedSelectedPoolWire(authority, wire.proxyOptions);
  return wire;
}
