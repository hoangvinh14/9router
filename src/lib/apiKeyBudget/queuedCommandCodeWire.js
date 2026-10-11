import { isDeepStrictEqual } from 'node:util';
import { snapshotAccountingGroup } from '../db/accountingGroupPayload.js';
import { validateQueuedSavedProxyWire } from './queuedSavedProxyWire.js';
import { validateQueuedSelectedPoolWire } from './queuedPoolWire.js';
import { validateAccountingProxyEnvironment } from '../../../open-sse/config/accountedProxyEnvironment.js';
import { validateAccountingCommandCodeDispatch, validateAccountingCommandCodePost } from '../../../open-sse/config/accountedCommandCodeDispatch.js';
import { validateAccountingCommandCodeChatOptions } from '../../../open-sse/config/accountedCommandCodeChatDispatch.js';
import { ACCOUNTED_COMMANDCODE_PROTOCOL, commandCodeToken } from '../../../open-sse/config/accountedCommandCodeCandidate.js';
const unavailable = () => { throw new Error('Queued CommandCode wire unavailable'); };
const record = value => value && typeof value === 'object' && !Array.isArray(value);

// Internal equality of already captured native work, not dispatch authority.
// Fresh persisted rows may refuse stale material, never rebuild/reselect it.
export function validateQueuedCommandCodeWire(authority, value) {
  const wire = snapshotAccountingGroup([{ type: 'wire', value }])[0].value;
  const fields = ['protocol', 'url', 'headers', 'credentials', 'providerOverrides', 'proxyOptions', 'proxyEnvironment', 'commandCodeTransport'];
  const hasChatCapture = record(wire) && Object.hasOwn(wire, 'commandCodeChatCapture');
  if (hasChatCapture) fields.push('commandCodeChatCapture');
  if (authority?.provider !== 'commandcode' || !authority.connection || authority.connection.authType === 'oauth' ||
      !record(wire) || wire.protocol !== ACCOUNTED_COMMANDCODE_PROTOCOL || Object.keys(wire).length !== fields.length ||
      !fields.every(key => Object.hasOwn(wire, key)) || !record(wire.headers) || !record(wire.credentials) || Object.keys(wire.credentials).length !== 4 ||
      !['apiKey', 'accessToken', 'connectionId', 'providerSpecificData'].every(key => Object.hasOwn(wire.credentials, key))) unavailable();
  let connection, settings;
  try { connection = JSON.parse(authority.connection.data); settings = JSON.parse(authority.settings); } catch { unavailable(); }
  if (!record(connection) || !record(settings) || !commandCodeToken(connection.apiKey) || connection.accessToken ||
      wire.credentials.apiKey !== connection.apiKey || wire.credentials.accessToken !== null || wire.credentials.connectionId !== authority.connection.id ||
      !record(connection.providerSpecificData ?? {}) || !isDeepStrictEqual(wire.credentials.providerSpecificData, connection.providerSpecificData ?? {})) unavailable();
  const dispatch = validateAccountingCommandCodeDispatch(wire.commandCodeTransport, wire.url);
  if (dispatch.model !== authority.model || !isDeepStrictEqual(wire.providerOverrides, settings.providerOverrides?.commandcode ?? null)) unavailable();
  const canonical = new Headers({ ...dispatch.commandCodeConfig.baseTransport.headers, 'Content-Type': 'application/json',
    Accept: 'text/event-stream', Authorization: `Bearer ${connection.apiKey}`, 'x-session-id': dispatch.sessionId });
  const expected = new Headers(canonical), overrides = wire.providerOverrides;
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
  // Saved headers cannot replace selected key/session/client identity. Require
  // original full header equality as well as strict generic POST validation.
  if (!isDeepStrictEqual([...actual], [...expected]) || !isDeepStrictEqual([...actual], [...canonical])) unavailable();
  validateAccountingCommandCodePost(dispatch, wire.url, { method: 'POST', redirect: 'error', body: dispatch.serializedBody, headers: actual });
  if (hasChatCapture) {
    const evidence = validateAccountingCommandCodeChatOptions({ capture: wire.commandCodeChatCapture, nativeTransport: dispatch }, wire.url,
      { method: 'POST', redirect: 'error', body: dispatch.serializedBody, headers: wire.headers }, wire.proxyOptions);
    if (!isDeepStrictEqual(evidence.capture.original.credentials, wire.credentials) ||
        !isDeepStrictEqual(evidence.capture.original.providerOverrides, wire.providerOverrides)) unavailable();
  }
  validateAccountingProxyEnvironment(wire.proxyEnvironment);
  validateQueuedSavedProxyWire(authority, wire.proxyOptions);
  if (authority.proxyPool) validateQueuedSelectedPoolWire(authority, wire.proxyOptions);
  return wire;
}
