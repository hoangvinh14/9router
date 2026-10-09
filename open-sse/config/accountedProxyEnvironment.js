import { types, isDeepStrictEqual } from 'node:util';

// Exact transport/environment inputs, including router-managed provenance. This
// is request-local equality evidence, not permission to proxy, bypass or POST.
export const ACCOUNTED_PROXY_ENV_KEYS = Object.freeze([
  'HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy',
  'NO_PROXY', 'no_proxy', 'NINE_ROUTER_PROXY_MANAGED', 'NINE_ROUTER_PROXY_URL', 'NINE_ROUTER_NO_PROXY'
]);
const MAX_ENV_VALUE_BYTES = 8192;
const unavailable = () => { throw new Error('Accounting proxy environment unavailable'); };

// No environment mutation or exposure through management, ledger or logs.
// Null preserves absent vs present-empty semantics without arbitrary objects.
export function captureAccountingProxyEnvironment() {
  const evidence = {};
  for (const key of ACCOUNTED_PROXY_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined && (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_ENV_VALUE_BYTES || /[\r\n\u0000]/.test(value))) unavailable();
    evidence[key] = value === undefined ? null : value;
  }
  return Object.freeze(evidence);
}

// Re-read immediately at the synchronous admission mutation boundary. A fresh
// route from changed environment may not replace the originally prepared one.
export function validateAccountingProxyEnvironment(evidence) {
  if (!evidence || typeof evidence !== 'object' || types.isProxy(evidence) || Object.getPrototypeOf(evidence) !== Object.prototype) unavailable();
  const keys = Reflect.ownKeys(evidence);
  if (keys.length !== ACCOUNTED_PROXY_ENV_KEYS.length || keys.some(key => typeof key !== 'string' || !ACCOUNTED_PROXY_ENV_KEYS.includes(key))) unavailable();
  const detached = {};
  for (const key of ACCOUNTED_PROXY_ENV_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(evidence, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) unavailable();
    const value = descriptor.value;
    if (value !== null && (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_ENV_VALUE_BYTES || /[\r\n\u0000]/.test(value))) unavailable();
    detached[key] = value;
  }
  if (!isDeepStrictEqual(detached, captureAccountingProxyEnvironment())) unavailable();
  return Object.freeze(detached);
}
