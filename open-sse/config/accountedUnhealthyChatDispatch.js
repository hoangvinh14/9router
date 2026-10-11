import { isDeepStrictEqual, types } from 'node:util';
import { PROVIDERS } from './providers.js';
import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { supportsUnhealthyChatRequest } from './accountedChatProviders.js';
import { validatePersistedGlobalProxy, validatePersistedPoolProxy } from './accountedProxyAuthority.js';

const unavailable = () => { throw new Error('Unhealthy Chat dispatch unavailable'); };
const FIELDS = Object.freeze(['provider', 'model', 'body', 'config', 'credentials', 'proxyOptions', 'providerOverrides', 'url', 'headers', 'serialized']);
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function checkProxy(value) {
  if (value === null) return;
  const derived = ['connectionProxyEnabled', 'connectionProxyUrl', 'connectionNoProxy', 'strictProxy',
    'proxyPoolUnavailable', 'proxyPoolId', 'vercelRelayUrl'];
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !Object.keys(value).length || Object.keys(value).some(key => !['persistedGlobalProxy', 'persistedPoolProxy', ...derived].includes(key))) unavailable();
  if (Object.hasOwn(value, 'persistedGlobalProxy') && value.persistedGlobalProxy !== null) validatePersistedGlobalProxy(value.persistedGlobalProxy);
  const pool = Object.hasOwn(value, 'persistedPoolProxy') ? validatePersistedPoolProxy(value.persistedPoolProxy) : null;
  if (!derived.some(key => Object.hasOwn(value, key))) return;
  // Core-derived fields must all describe the same saved pool or explicitly
  // disabled connection transport. Unknown/incomplete envelopes never downgrade.
  if (!derived.every(key => Object.hasOwn(value, key)) || !Object.hasOwn(value, 'persistedGlobalProxy')) unavailable();
  const expected = { connectionProxyEnabled: !!pool, connectionProxyUrl: pool ? pool.url : '',
    connectionNoProxy: pool ? pool.noProxy : '', strictProxy: pool ? pool.strictProxy : false,
    proxyPoolUnavailable: false, proxyPoolId: pool ? pool.id : null, vercelRelayUrl: '' };
  if (!derived.every(key => isDeepStrictEqual(value[key], expected[key]))) unavailable();
}
// All inputs have already passed the bounded descriptor-safe snapshot. These
// optional identity fields are retained equality data, never credential origin.
function checkCredentials(credentials, proxyOptions) {
  const allowed = ['apiKey', 'accessToken', 'authType', 'connectionId', 'connectionName', 'rawHeaders', 'providerSpecificData'];
  if (!credentials || Array.isArray(credentials) || Object.keys(credentials).some(key => !allowed.includes(key)) ||
      typeof credentials.apiKey !== 'string' || !credentials.apiKey || /[\u0000-\u0020\u007f]/.test(credentials.apiKey) ||
      credentials.accessToken != null ||
      (credentials.authType !== undefined && credentials.authType !== 'apikey')) unavailable();
  for (const key of ['connectionId', 'connectionName']) {
    if (Object.hasOwn(credentials, key) && (typeof credentials[key] !== 'string' || !credentials[key] || /[\u0000-\u001f\u007f]/.test(credentials[key]))) unavailable();
  }
  if (Object.hasOwn(credentials, 'rawHeaders')) {
    const raw = credentials.rawHeaders;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.values(raw).some(value => typeof value !== 'string')) unavailable();
  }
  if (!Object.hasOwn(credentials, 'providerSpecificData')) return;
  const specific = credentials.providerSpecificData;
  if (!specific || typeof specific !== 'object' || Array.isArray(specific) || Object.keys(specific).some(key => ![
    'connectionProxyEnabled', 'connectionProxyUrl', 'connectionNoProxy', 'connectionProxyPoolId', 'vercelRelayUrl', 'proxyPoolId',
  ].includes(key)) ||
      (Object.hasOwn(specific, 'connectionProxyEnabled') && specific.connectionProxyEnabled !== false) ||
      ['connectionProxyUrl', 'connectionNoProxy', 'vercelRelayUrl'].some(key => Object.hasOwn(specific, key) && specific[key] !== '') ||
      (Object.hasOwn(specific, 'connectionProxyPoolId') && specific.connectionProxyPoolId !== null)) unavailable();
  // A selected saved pool must be represented by independently pinned proxy
  // evidence as well. Pool IDs alone cannot select or silently fall back.
  if (Object.hasOwn(specific, 'proxyPoolId') && specific.proxyPoolId !== null && specific.proxyPoolId !== '__none__' &&
      (typeof specific.proxyPoolId !== 'string' || !specific.proxyPoolId || proxyOptions?.persistedPoolProxy?.id !== specific.proxyPoolId)) unavailable();
}
// Shared API-key/proxy data guard only. It performs its own bounded snapshot;
// this does not run or authorize any Chat/embedding schema, selection or ACK.
export function captureUnhealthyApiKeyMaterial(credentials, proxyOptions) {
  const material = snapshotAccountingPreparedData({ credentials, proxyOptions });
  checkProxy(material.proxyOptions);
  checkCredentials(material.credentials, material.proxyOptions);
  return material;
}
function check(value) {
  if (!exactKeys(value, FIELDS) || value.provider !== 'openai' ||
      !supportsUnhealthyChatRequest(value.body, value.model) ||
      !isDeepStrictEqual(value.config, snapshotAccountingPreparedData(PROVIDERS.openai)) ||
      value.url !== PROVIDERS.openai.baseUrl || value.providerOverrides !== null ||
      !value.credentials || typeof value.credentials.apiKey !== 'string' || !value.credentials.apiKey ||
      /[\u0000-\u0020\u007f]/.test(value.credentials.apiKey) || value.credentials.accessToken ||
      value.credentials.runtimeTransport || value.credentials.refreshToken ||
      (value.credentials.authType !== undefined && value.credentials.authType !== 'apikey')) unavailable();
  const headers = { 'Content-Type': 'application/json', ...value.config.headers,
    Authorization: `Bearer ${value.credentials.apiKey}` };
  if (!isDeepStrictEqual(value.headers, headers) || value.serialized !== JSON.stringify(value.body)) unavailable();
  checkProxy(value.proxyOptions);
  checkCredentials(value.credentials, value.proxyOptions);
}
// Bounded internal evidence only: full original inputs detached before any
// field/coercion access. Registry equality is not credential/proof/ACK authority.
export function captureUnhealthyChatDispatch(input) {
  const result = snapshotAccountingPreparedData(input);
  check(result);
  return result;
}
// Current POST must match the retained whole image. The caller still owes fresh
// independent persisted selection and its own admission/terminal durable ACKs.
export function validateUnhealthyChatDispatch(evidence, url, init, proxyOptions) {
  const retained = captureUnhealthyChatDispatch(evidence);
  const current = snapshotAccountingPreparedData({ url, init, proxyOptions });
  if (current.url !== retained.url || !exactKeys(current.init, ['method', 'headers', 'body', 'redirect']) ||
      current.init.method !== 'POST' || current.init.redirect !== 'error' ||
      current.init.body !== retained.serialized || !isDeepStrictEqual(current.init.headers, retained.headers) ||
      !isDeepStrictEqual(current.proxyOptions, retained.proxyOptions)) unavailable();
  return retained;
}

// The native AbortSignal is lifecycle input, not serializable equality data.
// Inspect descriptors first; never evaluate accessors while projecting POST.
export function validateUnhealthyChatOptions(evidence, url, options, proxyOptions) {
  if (typeof url !== 'string' || !options || typeof options !== 'object' || types.isProxy(options) ||
      Object.getPrototypeOf(options) !== Object.prototype) unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(options);
  const fields = ['method', 'headers', 'body', 'redirect'];
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || ![...fields, 'signal'].includes(key)) ||
      !fields.every(key => Object.hasOwn(descriptors, key)) ||
      Object.values(descriptors).some(value => !value.enumerable || !Object.hasOwn(value, 'value'))) unavailable();
  return validateUnhealthyChatDispatch(evidence, url,
    Object.fromEntries(fields.map(key => [key, descriptors[key].value])), proxyOptions);
}
