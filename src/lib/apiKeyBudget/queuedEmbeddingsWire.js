import { isDeepStrictEqual } from 'node:util';
import { snapshotAccountingGroup } from '../db/accountingGroupPayload.js';
import { validateQueuedSavedProxyWire } from './queuedSavedProxyWire.js';
import { validateQueuedSelectedPoolWire } from './queuedPoolWire.js';
import { validateAccountingProxyEnvironment } from '../../../open-sse/config/accountedProxyEnvironment.js';
import { validateAccountingEmbeddingsDispatch } from '../../../open-sse/config/accountedEmbeddingsDispatch.js';

const unavailable = () => { throw new Error('Queued embeddings wire unavailable'); };
const record = value => value && typeof value === 'object' && !Array.isArray(value);
export function validateQueuedEmbeddingsWire(authority, value) {
  const wire = snapshotAccountingGroup([{ type: 'wire', value }])[0].value;
  const fields = ['protocol', 'url', 'headers', 'credentials', 'providerOverrides', 'proxyOptions', 'proxyEnvironment', 'embeddingsTransport'];
  if (authority.provider !== 'openai' || !authority.connection || !record(wire) ||
      wire.protocol !== 'native-embeddings' || Object.keys(wire).length !== fields.length || fields.some(key => !Object.hasOwn(wire, key)) ||
      !record(wire.headers) || !record(wire.credentials) || Object.keys(wire.credentials).length !== 2) unavailable();
  let connection, settings;
  try { connection = JSON.parse(authority.connection.data); settings = JSON.parse(authority.settings); } catch { unavailable(); }
  if (!record(connection) || !record(settings) || typeof connection.apiKey !== 'string' || !connection.apiKey || connection.accessToken ||
      /[\r\n\u0000]/.test(connection.apiKey) || wire.credentials.apiKey !== connection.apiKey || wire.credentials.accessToken !== null) unavailable();
  // Embeddings' adapter does not consume dashboard chat provider overrides.
  // Nonempty overrides remain unsupported, never manufacture their application.
  if (wire.providerOverrides !== null || settings.providerOverrides?.openai != null) unavailable();
  const transport = validateAccountingEmbeddingsDispatch(wire.embeddingsTransport, wire.url);
  if (transport.model !== authority.model) unavailable();
  const expected = new Headers({ 'Content-Type': 'application/json', Authorization: `Bearer ${connection.apiKey}`, ...(transport.mediaConfig.headers || {}) });
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
