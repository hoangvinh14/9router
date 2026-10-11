import { isDeepStrictEqual } from 'node:util';
import { snapshotAccountingGroup } from '../db/accountingGroupPayload.js';
import { validateQueuedSavedProxyWire } from './queuedSavedProxyWire.js';
import { validateQueuedSelectedPoolWire } from './queuedPoolWire.js';
import { validateAccountingProxyEnvironment } from '../../../open-sse/config/accountedProxyEnvironment.js';
import { validateAccountingResponsesDispatch } from '../../../open-sse/config/accountedResponsesDispatch.js';

const unavailable = () => { throw new Error('Queued Responses wire unavailable'); };
const record = value => value && typeof value === 'object' && !Array.isArray(value);
// Not a generic protocol discriminator: only exact fixed native API-key Responses
// prepared data. OAuth/Codex/tools/other protocols retain separate missing gates.
export function validateQueuedResponsesWire(authority, value) {
  const wire = snapshotAccountingGroup([{ type: 'wire', value }])[0].value;
  const fields = ['protocol', 'url', 'headers', 'credentials', 'providerOverrides', 'proxyOptions', 'proxyEnvironment', 'responsesTransport'];
  if (authority.provider !== 'openai' || !authority.connection || !record(wire) ||
      wire.protocol !== 'native-responses' || Object.keys(wire).length !== fields.length || fields.some(field => !Object.hasOwn(wire, field)) ||
      !record(wire.headers) || !record(wire.credentials) || Object.keys(wire.credentials).length !== 2) unavailable();
  let connection, settings;
  try { connection = JSON.parse(authority.connection.data); settings = JSON.parse(authority.settings); } catch { unavailable(); }
  if (!record(connection) || !record(settings) || typeof connection.apiKey !== 'string' || !connection.apiKey || connection.accessToken ||
      /[\r\n\u0000]/.test(connection.apiKey) || wire.credentials.apiKey !== connection.apiKey || wire.credentials.accessToken !== null) unavailable();
  const overrides = settings.providerOverrides?.openai ?? null;
  if (!isDeepStrictEqual(wire.providerOverrides, overrides)) unavailable();
  const dispatch = validateAccountingResponsesDispatch(wire.responsesTransport, wire.url);
  if (dispatch.model !== authority.model) unavailable();
  const expected = new Headers({ 'Content-Type': 'application/json', ...(dispatch.baseTransport.headers || {}), Authorization: `Bearer ${connection.apiKey}` });
  if (dispatch.mode === 'native-responses-sse') expected.set('Accept', 'text/event-stream');
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
  if (!isDeepStrictEqual([...actual], [...expected])) unavailable();
  validateAccountingProxyEnvironment(wire.proxyEnvironment);
  validateQueuedSavedProxyWire(authority, wire.proxyOptions);
  if (authority.proxyPool) validateQueuedSelectedPoolWire(authority, wire.proxyOptions);
  return wire;
}
