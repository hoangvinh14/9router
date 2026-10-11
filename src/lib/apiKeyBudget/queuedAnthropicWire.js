import { isDeepStrictEqual } from 'node:util';
import { snapshotAccountingGroup } from '../db/accountingGroupPayload.js';
import { validateQueuedSavedProxyWire } from './queuedSavedProxyWire.js';
import { validateQueuedSelectedPoolWire } from './queuedPoolWire.js';
import { validateAccountingProxyEnvironment } from '../../../open-sse/config/accountedProxyEnvironment.js';
import { validateAccountingAnthropicDispatch, validateAccountingAnthropicPost } from '../../../open-sse/config/accountedAnthropicDispatch.js';
import { ANTHROPIC_API_VERSION } from '../../../open-sse/providers/shared.js';
import { ANTHROPIC_OAUTH_TOKEN_PREFIX } from '../../../open-sse/config/accountedAnthropicCandidate.js';
import { ACCOUNTED_CLAUDE_OAUTH_MODE, claudeOauthAccountingHeaders } from '../../../open-sse/config/accountedClaudeOauth.js';

const unavailable = () => { throw new Error('Queued Anthropic wire unavailable'); };
const record = value => value && typeof value === 'object' && !Array.isArray(value);
export function validateQueuedAnthropicWire(authority, value) {
  const wire = snapshotAccountingGroup([{ type: 'wire', value }])[0].value;
  const fields = ['protocol', 'url', 'headers', 'credentials', 'providerOverrides', 'proxyOptions', 'proxyEnvironment', 'anthropicTransport'];
  const oauth = authority?.provider === 'claude';
  if (!['anthropic', 'claude'].includes(authority?.provider) || !authority.connection || !record(wire) || wire.protocol !== 'native-anthropic' ||
      Object.keys(wire).length !== fields.length || fields.some(field => !Object.hasOwn(wire, field)) ||
      !record(wire.headers) || !record(wire.credentials) || Object.keys(wire.credentials).length !== 2) unavailable();
  let connection, settings;
  try { connection = JSON.parse(authority.connection.data); settings = JSON.parse(authority.settings); } catch { unavailable(); }
  if (!record(connection) || !record(settings)) unavailable();
  if (oauth) {
    if (!['apiKey', 'accessToken'].every(field => wire.credentials[field] === (connection[field] ?? null))) unavailable();
  } else if (typeof connection.apiKey !== 'string' || !connection.apiKey || connection.accessToken ||
      connection.apiKey.startsWith(ANTHROPIC_OAUTH_TOKEN_PREFIX) || /[\r\n\u0000]/.test(connection.apiKey) ||
      wire.credentials.apiKey !== connection.apiKey || wire.credentials.accessToken !== null) unavailable();
  const overrides = settings.providerOverrides?.[authority.provider] ?? null;
  if (!isDeepStrictEqual(wire.providerOverrides, overrides)) unavailable();
  const dispatch = validateAccountingAnthropicDispatch(wire.anthropicTransport, wire.url);
  if (dispatch.model !== authority.model || (dispatch.mode === ACCOUNTED_CLAUDE_OAUTH_MODE) !== oauth ||
      oauth && (!isDeepStrictEqual(dispatch.credentials, wire.credentials) || overrides !== null)) unavailable();
  const expected = oauth ? claudeOauthAccountingHeaders(dispatch)
    : new Headers({ 'Content-Type': 'application/json', ...(dispatch.baseTransport.headers || {}), 'x-api-key': connection.apiKey, 'anthropic-version': ANTHROPIC_API_VERSION });
  // Both buffered and live modes force a native streaming upstream request.
  expected.set('Accept', 'text/event-stream');
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
  validateAccountingAnthropicPost(dispatch, wire.url, { method: 'POST', redirect: 'error', body: dispatch.serializedBody, headers: actual });
  validateAccountingProxyEnvironment(wire.proxyEnvironment);
  validateQueuedSavedProxyWire(authority, wire.proxyOptions);
  if (authority.proxyPool) validateQueuedSelectedPoolWire(authority, wire.proxyOptions);
  return wire;
}
