import { isDeepStrictEqual } from 'node:util';
import { snapshotAccountingGroup } from '../db/accountingGroupPayload.js';
import { validateQueuedSavedProxyWire } from './queuedSavedProxyWire.js';
import { validateQueuedSelectedPoolWire } from './queuedPoolWire.js';
import { validateAccountingProxyEnvironment } from '../../../open-sse/config/accountedProxyEnvironment.js';
import { captureKiroEllipsisRepairConversion } from '../../../open-sse/config/accountedKiroRepairConversion.js';
import { validateAccountingKiroDispatch, validateAccountingKiroPost, kiroAccountingToken, ACCOUNTED_KIRO_FIXED_HEADERS } from '../../../open-sse/config/accountedKiroDispatch.js';

export const ACCOUNTED_KIRO_PROTOCOL = 'native-kiro';
const WIRE_FIELDS = Object.freeze(['protocol', 'url', 'headers', 'credentials', 'providerOverrides', 'proxyOptions', 'proxyEnvironment', 'kiroTransport']);
const CREDENTIAL_FIELDS = Object.freeze(['apiKey', 'accessToken', 'connectionId', 'providerSpecificData']);
const unavailable = () => { throw new Error('Queued Kiro wire unavailable'); };
const record = value => value && typeof value === 'object' && !Array.isArray(value);

// Internal equality of already captured native work against trusted fresh
// persisted authority, never credential/route selection or dispatch authority.
// Full wire guard precedes headers/coercion/reads. Optional repair equality is
// not predecessor ACK, owner provenance or permission to regenerate. Native
// admission/dequeue checks remain unchanged; not a same-process sandbox.
export function validateQueuedKiroWire(authority, value) {
  const wire = snapshotAccountingGroup([{ type: 'wire', value }])[0].value;
  const repair = record(wire) && Object.hasOwn(wire, 'kiroRepairCapture');
  if (authority?.provider !== 'kiro' || !authority.connection || authority.connection.authType !== 'apikey' ||
      !record(wire) || wire.protocol !== ACCOUNTED_KIRO_PROTOCOL || Object.keys(wire).length !== WIRE_FIELDS.length + (repair ? 1 : 0) ||
      !WIRE_FIELDS.every(key => Object.hasOwn(wire, key)) || !record(wire.headers) || !record(wire.credentials) ||
      Object.keys(wire.credentials).length !== CREDENTIAL_FIELDS.length || !CREDENTIAL_FIELDS.every(key => Object.hasOwn(wire.credentials, key))) unavailable();
  let connection, settings;
  try { connection = JSON.parse(authority.connection.data); settings = JSON.parse(authority.settings); } catch { unavailable(); }
  // authType is the authoritative persisted column above; connToRow strips
  // it from JSON data. Do not require a duplicate credential-side field.
  if (!record(connection) || !record(settings) ||
      !record(connection.providerSpecificData) || connection.providerSpecificData.authMethod !== 'api_key' ||
      connection.providerSpecificData.region !== 'us-east-1' || !kiroAccountingToken(connection.accessToken) ||
      connection.apiKey != null && (!kiroAccountingToken(connection.apiKey) || connection.apiKey !== connection.accessToken) ||
      wire.credentials.apiKey !== (connection.apiKey ?? null) || wire.credentials.accessToken !== connection.accessToken ||
      wire.credentials.connectionId !== authority.connection.id ||
      !isDeepStrictEqual(wire.credentials.providerSpecificData, connection.providerSpecificData)) unavailable();
  const dispatch = validateAccountingKiroDispatch(wire.kiroTransport, wire.url);
  if (dispatch.model !== authority.model || !isDeepStrictEqual(wire.providerOverrides, settings.providerOverrides?.kiro ?? null)) unavailable();
  let body;
  try { body = JSON.parse(dispatch.serializedBody); } catch { unavailable(); }
  if (repair) {
    const capture = captureKiroEllipsisRepairConversion(wire.kiroRepairCapture);
    if (capture.model !== dispatch.model || !isDeepStrictEqual(capture.actual, body)) unavailable();
  }
  // Optional profile is never injected/defaulted from credentials. Caller body
  // presence/value must equal full persisted profile identity, including null.
  if ((body.profileArn ?? null) !== (connection.providerSpecificData.profileArn ?? null)) unavailable();
  // Overlay with set(): spreading mixed-case registry/fixed names into a
  // record makes Headers append duplicate values instead of replacing them.
  const canonical = new Headers(dispatch.kiroConfig.headers);
  for (const [name, header] of Object.entries(ACCOUNTED_KIRO_FIXED_HEADERS)) canonical.set(name, header);
  canonical.set('authorization', `Bearer ${connection.apiKey ?? connection.accessToken}`);
  canonical.set('x-amz-sso-bearer', connection.accessToken);
  canonical.set('amz-sdk-invocation-id', dispatch.invocationId);
  if (Object.hasOwn(body, 'profileArn')) canonical.set('x-amzn-codewhisperer-profile-arn', body.profileArn);
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
  // Complete original header equality, not generic allowlist/presence. Saved
  // overrides cannot replace original identity or introduce unsupported work.
  if (!isDeepStrictEqual([...actual], [...expected]) || !isDeepStrictEqual([...actual], [...canonical])) unavailable();
  validateAccountingKiroPost(dispatch, wire.url, { method: 'POST', redirect: 'error', body: dispatch.serializedBody, headers: actual });
  validateAccountingProxyEnvironment(wire.proxyEnvironment);
  validateQueuedSavedProxyWire(authority, wire.proxyOptions);
  if (authority.proxyPool) validateQueuedSelectedPoolWire(authority, wire.proxyOptions);
  return wire;
}
