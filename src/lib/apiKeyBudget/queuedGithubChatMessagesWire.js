import { isDeepStrictEqual } from 'node:util';
import { snapshotAccountingGroup } from '../db/accountingGroupPayload.js';
import { validateQueuedSavedProxyWire } from './queuedSavedProxyWire.js';
import { validateQueuedSelectedPoolWire } from './queuedPoolWire.js';
import { validateAccountingProxyEnvironment } from '../../../open-sse/config/accountedProxyEnvironment.js';
import { validateAccountingGithubChatMessagesDispatch, validateAccountingGithubChatMessagesPost } from '../../../open-sse/config/accountedGithubChatMessagesDispatch.js';
import { githubMessagesHeaders, githubMessagesIdentity } from '../../../open-sse/config/accountedGithubMessagesCandidate.js';
import { ACCOUNTED_GITHUB_CHAT_MESSAGES_PROTOCOL } from '../../../open-sse/config/accountedGithubChatMessagesCandidate.js';
const unavailable = () => { throw new Error('Queued GitHub Chat Messages wire unavailable'); };
const record = value => value && typeof value === 'object' && !Array.isArray(value);
export function validateQueuedGithubChatMessagesWire(authority, value) {
  const wire = snapshotAccountingGroup([{ type: 'wire', value }])[0].value;
  const fields = ['protocol', 'url', 'headers', 'credentials', 'providerOverrides', 'proxyOptions', 'proxyEnvironment', 'githubChatMessagesTransport'];
  const credentialFields = ['apiKey', 'accessToken', 'copilotToken', 'connectionId', 'providerSpecificData'];
  if (authority?.provider !== 'github' || authority.connection?.authType !== 'oauth' || !record(wire) || wire.protocol !== ACCOUNTED_GITHUB_CHAT_MESSAGES_PROTOCOL ||
      Object.keys(wire).length !== fields.length || !fields.every(key => Object.hasOwn(wire, key)) || !record(wire.headers) || !record(wire.credentials) ||
      Object.keys(wire.credentials).length !== credentialFields.length || !credentialFields.every(key => Object.hasOwn(wire.credentials, key))) unavailable();
  let connection, settings;
  try { connection = JSON.parse(authority.connection.data); settings = JSON.parse(authority.settings); } catch { unavailable(); }
  if (!record(connection) || !record(settings) || connection.apiKey || wire.credentials.apiKey !== null || !githubMessagesIdentity(connection.accessToken) ||
      wire.credentials.accessToken !== connection.accessToken || wire.credentials.connectionId !== authority.connection.id ||
      !record(connection.providerSpecificData) || !isDeepStrictEqual(wire.credentials.providerSpecificData, connection.providerSpecificData) ||
      !githubMessagesIdentity(connection.providerSpecificData.copilotToken) || wire.credentials.copilotToken !== connection.providerSpecificData.copilotToken) unavailable();
  const dispatch = validateAccountingGithubChatMessagesDispatch(wire.githubChatMessagesTransport, wire.url);
  if (dispatch.model !== authority.model || !isDeepStrictEqual(wire.providerOverrides, settings.providerOverrides?.github ?? null)) unavailable();
  const canonical = new Headers(githubMessagesHeaders(wire.credentials, dispatch.requestId)), expected = new Headers(canonical);
  if (wire.providerOverrides?.headers !== undefined) {
    if (!record(wire.providerOverrides.headers)) unavailable();
    const seen = new Set();
    for (const [name, header] of Object.entries(wire.providerOverrides.headers)) {
      if (typeof header !== 'string' || seen.has(name.toLowerCase())) unavailable();
      seen.add(name.toLowerCase()); expected.set(name, header);
    }
  }
  const actual = new Headers(), seen = new Set();
  for (const [name, header] of Object.entries(wire.headers)) {
    if (typeof header !== 'string' || seen.has(name.toLowerCase())) unavailable();
    seen.add(name.toLowerCase()); actual.set(name, header);
  }
  if (!isDeepStrictEqual([...actual], [...expected]) || !isDeepStrictEqual([...actual], [...canonical])) unavailable();
  validateAccountingGithubChatMessagesPost(dispatch, wire.url, { method: 'POST', redirect: 'error', body: dispatch.serializedBody, headers: wire.headers });
  validateAccountingProxyEnvironment(wire.proxyEnvironment); validateQueuedSavedProxyWire(authority, wire.proxyOptions);
  if (authority.proxyPool) validateQueuedSelectedPoolWire(authority, wire.proxyOptions);
  return wire;
}
