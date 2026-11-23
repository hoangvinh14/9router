import { createHash } from 'node:crypto';
import { unavailable } from './attempt-payload.js';
import { isModelLockActive } from '../../../open-sse/services/accountFallback.js';

export const ACCOUNTED_ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const PROVIDER_ACCOUNT_READS = Object.freeze({
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

// Hash only security-relevant account state, not mutable bookkeeping such as
// lastUsedAt. Never put the upstream key, digest or settings into the ledger row.
export function readAnthropicAccount(scope, connectionId, model) {
  const row = scope.providerAccount([connectionId]);
  if (row?.provider !== 'anthropic' || row.authType !== 'apikey' || row.isActive !== 1) return null;
  const account = objectJson(row.data);
  const { apiKey, providerSpecificData, accessToken, refreshToken } = account;
  const rowSettings = scope.routingSettings();
  const settings = rowSettings === null ? {} : objectJson(rowSettings.data);
  if (typeof apiKey !== 'string' || !apiKey || accessToken || refreshToken || isModelLockActive(account, model) ||
      !directAccountData(providerSpecificData) || settings.outboundProxyEnabled || settings.outboundProxyUrl ||
      settings.outboundNoProxy || settings.providerOverrides?.anthropic) return null;
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

export function readCodexAccount(scope, connectionId, model) {
  const row = scope.providerAccount([connectionId]);
  if (row?.provider !== 'codex' || row.authType !== 'oauth' || row.isActive !== 1) return null;
  const account = objectJson(row.data);
  const { apiKey, accessToken, providerSpecificData } = account;
  const rowSettings = scope.routingSettings();
  const settings = rowSettings === null ? {} : objectJson(rowSettings.data);
  const accountId = codexAccountId(providerSpecificData);
  if (apiKey || !accessToken || !accountId || isModelLockActive(account, model) ||
      !directAccountData(providerSpecificData) || settings.outboundProxyEnabled || settings.outboundProxyUrl ||
      settings.outboundNoProxy || settings.providerOverrides?.codex) return null;
  return { digest: credentialDigest(accessToken), accountId };
}
