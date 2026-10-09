import { isDeepStrictEqual } from 'node:util';
import { snapshotAccountingGroup } from '../db/accountingGroupPayload.js';
import { validateQueuedSelectedPoolWire } from './queuedPoolWire.js';
import { validateQueuedSavedProxyWire } from './queuedSavedProxyWire.js';
import { validateAccountingProxyEnvironment } from '../../../open-sse/config/accountedProxyEnvironment.js';
import { validateAccountingRuntimeTransport } from '../../../open-sse/config/accountedRuntimeTransport.js';
import { validateAccountingBaseTransport } from '../../../open-sse/config/accountedBaseTransport.js';

const unavailable = () => { throw new Error('Queued prepared wire unavailable'); };
const record = value => value && typeof value === 'object' && !Array.isArray(value);

// INTERNAL equality check for the narrow Base OpenAI-shaped header owner only.
// Not provider/URL/proxy eligibility, selection, OAuth refresh or dispatch ACK.
// Wire material is already detached before admission. Never persist/log secrets.
export function validateQueuedBaseWire(authority, value) {
  const wire = snapshotAccountingGroup([{ type: 'wire', value }])[0].value;
  if (!['openai', 'deepseek'].includes(authority.provider) || !authority.connection ||
      !record(wire) || !record(wire.headers) || !record(wire.credentials) || typeof wire.stream !== 'boolean' ||
      typeof wire.url !== 'string' || !wire.url || Object.keys(wire).some(key => !['url', 'headers', 'credentials', 'providerOverrides', 'proxyOptions', 'proxyEnvironment', 'runtimeTransport', 'baseTransport', 'urlIndex', 'stream'].includes(key))) unavailable();
  let connection, settings;
  try { connection = JSON.parse(authority.connection.data); settings = JSON.parse(authority.settings); } catch { unavailable(); }
  if (!record(connection) || !record(settings)) unavailable();
  // Only credentials that the Base header builder can use; never fall back from
  // a stale preferred accessToken to another API key or newly refreshed token.
  for (const field of ['accessToken', 'apiKey']) {
    if ((wire.credentials[field] ?? null) !== (connection[field] ?? null)) unavailable();
  }
  if (Object.keys(wire.credentials).some(key => !['apiKey', 'accessToken'].includes(key))) unavailable();
  const overrides = settings.providerOverrides?.[authority.provider] ?? null;
  if (!isDeepStrictEqual(wire.providerOverrides ?? null, overrides)) unavailable();
  const token = connection.accessToken || connection.apiKey;
  if (typeof token !== 'string' || !token || /[\r\n\u0000]/.test(token)) unavailable();
  if (!Object.hasOwn(wire, 'runtimeTransport')) unavailable();
  validateAccountingRuntimeTransport(authority.provider, wire.runtimeTransport, wire.url);
  validateAccountingBaseTransport(authority.provider, wire.baseTransport, wire.url, wire.urlIndex, wire.runtimeTransport);
  const expected = new Headers({ 'Content-Type': 'application/json' });
  const declaredHeaders = wire.runtimeTransport !== null ? wire.runtimeTransport.headers : wire.baseTransport.headers;
  if (declaredHeaders !== null && declaredHeaders !== undefined) {
    if (!record(declaredHeaders)) unavailable();
    const declaredNames = new Set();
    for (const [name, header] of Object.entries(declaredHeaders)) {
      if (typeof header !== 'string' || declaredNames.has(name.toLowerCase())) unavailable();
      declaredNames.add(name.toLowerCase()); expected.set(name, header);
    }
  }
  expected.set('Authorization', `Bearer ${token}`);
  if (wire.stream) expected.set('Accept', 'text/event-stream');
  if (overrides?.headers !== undefined) {
    if (!record(overrides.headers)) unavailable();
    const overrideNames = new Set();
    for (const [name, header] of Object.entries(overrides.headers)) {
      if (typeof header !== 'string' || overrideNames.has(name.toLowerCase())) unavailable();
      overrideNames.add(name.toLowerCase());
      expected.set(name, header);
    }
  }
  const actual = new Headers();
  const seen = new Set();
  for (const [name, header] of Object.entries(wire.headers)) {
    if (typeof header !== 'string' || seen.has(name.toLowerCase())) unavailable();
    seen.add(name.toLowerCase()); actual.set(name, header);
  }
  // Exact complete normalized header set for this narrow protocol slice only.
  // Never invoke a builder again or accept undeclared extra header authority.
  if (!isDeepStrictEqual([...actual], [...expected])) unavailable();
  // Original resolved pool route must match saved selected pool, not merely a
  // newly captured pool row. Service repeats this in its dequeue transaction.
  validateAccountingProxyEnvironment(wire.proxyEnvironment);
  validateQueuedSavedProxyWire(authority, wire.proxyOptions ?? null);
  if (authority.proxyPool) validateQueuedSelectedPoolWire(authority, wire.proxyOptions);
  // Saved route equality does not establish external environment/direct outcome.
  // Those gates remain mandatory before the queued candidate is activated.
  return wire;
}
