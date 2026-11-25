import { createHash } from 'node:crypto';
import { unavailable } from './attempt-payload.js';
import { isModelLockActive } from '../../../open-sse/services/accountFallback.js';

export const ACCOUNTED_ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const ACCOUNTED_CLAUDE_URL = ACCOUNTED_ANTHROPIC_URL + '?beta=true';
export const PROVIDER_ACCOUNT_READS = Object.freeze({
  savedProxy: Object.freeze({ method:'get', sql:'SELECT isActive, data FROM proxyPools WHERE id = ?' }),
  providerAccount: Object.freeze({ method:'get', sql:'SELECT provider, authType, isActive, data FROM providerConnections WHERE id = ?' }),
});

function objectJson(raw) {
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
  return value;
}

export function directAccountData(data) {
  if (data == null) return true;
  if (typeof data !== 'object' || Array.isArray(data)) return false;
  return !['connectionProxyEnabled','connectionProxyUrl','connectionNoProxy','proxyPoolId',
    'connectionProxyPoolId','vercelRelayUrl','strictProxy','baseUrl','baseURL'].some(key => data[key]);
}

function strictPool(id, url) {
  if (typeof id !== 'string' || !id || typeof url !== 'string') throw unavailable();
  const parsed = URL.parse(url);
  if (!parsed || parsed.protocol !== 'http:' || parsed.pathname !== '/' || parsed.hash || parsed.search ||
      parsed.username || parsed.password) throw unavailable();
  return Object.freeze({ id, url });
}

export function selectedAccountProxy(data) {
  if (directAccountData(data)) return null;
  if (!data || data.strictProxy !== true || data.connectionProxyEnabled !== true ||
      data.proxyPoolId !== data.connectionProxyPoolId || data.connectionNoProxy || data.vercelRelayUrl ||
      data.baseUrl || data.baseURL) throw unavailable();
  return strictPool(data.proxyPoolId, data.connectionProxyUrl);
}

// Re-read both the connection and its pool in the same transaction as the budget gate.
// Binding discovery accepts an eligible route; dispatch always supplies the selected route.
export function accountTransportMatches(scope, data, expected) {
  if (directAccountData(data)) return expected == null;
  if (!data?.proxyPoolId) return false;
  const { proxyPoolId, ...rest } = data;
  if (!directAccountData(rest)) return false;
  const row = scope.savedProxy([proxyPoolId]);
  if (row?.isActive !== 1) return false;
  const pool = objectJson(row.data);
  if (pool.type !== 'http' || pool.strictProxy !== true || pool.noProxy) return false;
  const current = strictPool(proxyPoolId, pool.proxyUrl);
  return expected === undefined || current.id === expected?.id && current.url === expected?.url;
}

// Hash only security-relevant account state, not mutable bookkeeping such as
// lastUsedAt. Never put the upstream key, digest or settings into the ledger row.
export function readAnthropicAccount(scope, connectionId, model, expectedProxy) {
  return readApiKeyAccount(scope, connectionId, model, 'anthropic', expectedProxy);
}

export function readApiKeyAccount(scope, connectionId, model, provider, expectedProxy) {
  const row = scope.providerAccount([connectionId]);
  if (row?.provider !== provider || row.authType !== 'apikey' || row.isActive !== 1) return null;
  const account = objectJson(row.data);
  const { apiKey, providerSpecificData, accessToken, refreshToken } = account;
  const rowSettings = scope.routingSettings();
  const settings = rowSettings === null ? {} : objectJson(rowSettings.data);
  if (typeof apiKey !== 'string' || !apiKey || accessToken || refreshToken || isModelLockActive(account, model) ||
      !accountTransportMatches(scope, providerSpecificData, expectedProxy) || settings.outboundProxyEnabled || settings.outboundProxyUrl ||
      settings.outboundNoProxy || settings.providerOverrides?.[provider]) return null;
  return credentialDigest(apiKey);
}

export function isSingleWorkspaceBinding(binding) {
  return binding !== null && typeof binding === 'object' &&
    Object.keys(binding).sort().join(',') === 'connectionId,keyDigest,scope,workspaceId' &&
    binding.scope === 'single-workspace' && typeof binding.workspaceId === 'string' &&
    /^wrkspc_[A-Za-z0-9]{1,128}(?![\s\S])/.test(binding.workspaceId) &&
    typeof binding.connectionId === 'string' && binding.connectionId.length > 0 &&
    typeof binding.keyDigest === 'string' && /^[a-f0-9]{64}(?![\s\S])/.test(binding.keyDigest);
}

export function credentialDigest(apiKey) {
  if (typeof apiKey !== 'string' || !apiKey || apiKey.length > 4096) throw unavailable();
  return createHash('sha256').update(apiKey).digest('hex');
}

// Use the same effective account ID precedence as the Codex wire.
export function codexAccountId(data) {
  const accountId = data?.workspaceId || data?.chatgptAccountId || data?.accountId;
  return typeof accountId === 'string' && accountId ? accountId : null;
}

export function oauthTokenExpired(account, now) {
  if (now === undefined) return false;
  const expiry = account.expiresAt ?? account.tokenExpiresAt;
  if (expiry === undefined || expiry === null || expiry === '') return false;
  const time = typeof expiry === 'number'
    ? (expiry < 1e12 ? expiry * 1000 : expiry)
    : typeof expiry === 'string' ? Date.parse(expiry) : NaN;
  return Number.isFinite(time) && time <= now;
}

export function readCodexAccount(scope, connectionId, model, now, expectedProxy) {
  const row = scope.providerAccount([connectionId]);
  if (row?.provider !== 'codex' || row.authType !== 'oauth' || row.isActive !== 1) return null;
  const account = objectJson(row.data);
  const { apiKey, accessToken, providerSpecificData } = account;
  const rowSettings = scope.routingSettings();
  const settings = rowSettings === null ? {} : objectJson(rowSettings.data);
  const accountId = codexAccountId(providerSpecificData);
  if (apiKey || !accessToken || oauthTokenExpired(account, now) || !accountId || isModelLockActive(account, model) ||
      !accountTransportMatches(scope, providerSpecificData, expectedProxy) || settings.outboundProxyEnabled || settings.outboundProxyUrl ||
      settings.outboundNoProxy || settings.providerOverrides?.codex) return null;
  return { digest: credentialDigest(accessToken), accountId };
}

export function readClaudeAccount(scope, connectionId, model, now, expectedProxy) {
  const row = scope.providerAccount([connectionId]);
  if (row?.provider !== 'claude' || row.authType !== 'oauth' || row.isActive !== 1) return null;
  const account = objectJson(row.data);
  const { apiKey, accessToken, providerSpecificData } = account;
  const rowSettings = scope.routingSettings();
  const settings = rowSettings === null ? {} : objectJson(rowSettings.data);
  if (apiKey || !accessToken || oauthTokenExpired(account, now) || isModelLockActive(account, model) ||
      !accountTransportMatches(scope, providerSpecificData, expectedProxy) || settings.outboundProxyEnabled || settings.outboundProxyUrl ||
      settings.outboundNoProxy || settings.providerOverrides?.claude) return null;
  return credentialDigest(accessToken);
}
