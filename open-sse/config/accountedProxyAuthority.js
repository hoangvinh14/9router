// Internal saved transport authority, not a client-controlled header or provider
// eligibility grant. Unsupported transports fail closed, never become direct.
const SAVED_PROXY_PROTOCOLS = new Set(['http:', 'https:']);

// Shared with the legacy transport: retain the existing hostname-only matching
// semantics instead of inventing different NO_PROXY rules at the admission gate.
export function shouldBypassByNoProxy(targetUrl, noProxyValue) {
  const noProxy = noProxyValue == null ? '' : String(noProxyValue).trim();
  if (!noProxy) return false;
  let hostname;
  try { hostname = new URL(targetUrl).hostname.toLowerCase(); } catch { return false; }
  const patterns = noProxy.split(',').map(p => p.trim().toLowerCase()).filter(Boolean);
  return patterns.some(pattern => {
    if (pattern === '*') return true;
    if (pattern.startsWith('.')) return hostname.endsWith(pattern) || hostname === pattern.slice(1);
    return hostname === pattern || hostname.endsWith(`.${pattern}`);
  });
}
export function validatePersistedGlobalProxy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !['url', 'noProxy'].includes(key)) ||
      typeof value.url !== 'string' || !value.url.trim() ||
      typeof value.noProxy !== 'string' || /[\u0000-\u001f\u007f]/.test(value.url + value.noProxy)) {
    throw new Error('Persisted global proxy authority unavailable');
  }
  // URL parsing normalizes dot paths and hides empty query/fragment delimiters.
  // Inspect original intent first: only a proxy origin plus optional root slash
  // is supported; no backslash/whitespace or path may normalize into eligibility.
  const raw = value.url.trim();
  if (!/^https?:\/\/[^/?#\\\s]+\/?$/i.test(raw)) throw new Error('Persisted global proxy transport unsupported');
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error('Persisted global proxy authority unavailable'); }
  if (!SAVED_PROXY_PROTOCOLS.has(parsed.protocol) || !parsed.hostname || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('Persisted global proxy transport unsupported');
  }
  return Object.freeze({ url: parsed.href, noProxy: value.noProxy.trim() });
}

// Narrow active HTTP(S) pool transport only. Inactive/empty/non-HTTP pools do
// not grant legacy/global/direct fallback or relay/rotation eligibility.
export function validatePersistedPoolProxy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !['id', 'url', 'noProxy', 'strictProxy', 'type', 'isActive'].includes(key)) ||
      typeof value.id !== 'string' || !value.id.trim() || /[\u0000-\u001f\u007f]/.test(value.id) ||
      value.isActive !== true || typeof value.strictProxy !== 'boolean' || !['http', 'https'].includes(value.type)) {
    throw new Error('Persisted pool proxy authority unavailable');
  }
  const proxy = validatePersistedGlobalProxy({ url: value.url, noProxy: value.noProxy });
  return Object.freeze({ id: value.id, ...proxy, strictProxy: value.strictProxy, type: value.type, isActive: true });
}

export function resolvePersistedPoolProxy(targetUrl, poolValue, globalValue = undefined) {
  const pool = validatePersistedPoolProxy(poolValue);
  const global = globalValue === undefined ? null : validatePersistedGlobalProxy(globalValue);
  const poolUrl = shouldBypassByNoProxy(targetUrl, pool.noProxy) ? null : pool.url;
  const globalUrl = global && !shouldBypassByNoProxy(targetUrl, global.noProxy) ? global.url : null;
  const resolved = poolUrl || globalUrl;
  if (!resolved && pool.strictProxy) throw new Error('[ProxyFetch] Proxy required but none resolved (strictProxy=true)');
  return resolved;
}
