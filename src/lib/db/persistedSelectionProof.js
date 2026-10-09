import { validatePersistedUnlimited } from './unlimitedAdmissionProof.js';
import { validatePersistedRequest } from './persistedRequestProof.js';
import { isModelLockActive } from '../../../open-sse/services/accountFallback.js';

const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length > 0;
const unavailable = () => { throw new Error('Persisted selection proof unavailable'); };
function record(value) {
  let parsed;
  try { parsed = JSON.parse(value); } catch { unavailable(); }
  if (typeof value !== 'string' || !object(parsed)) unavailable();
  return parsed;
}

// INTERNAL canonical target only, not model resolution or provider eligibility.
// No lazy quota cache, virtual free connection, proxy resolution, rotating write
// or forced preferred connection. Snapshot readers never escape this validator.
export function validatePersistedSelection(get, all, coverage, input) {
  if (!object(input) || !text(input.credential) || !text(input.model) ||
      !['openai', 'anthropic', 'gemini', 'codex'].includes(input.provider) ||
      !Array.isArray(input.excludeConnectionIds) || !input.excludeConnectionIds.every(text)) unavailable();
  const key = get('SELECT id FROM apiKeys WHERE key=?', [input.credential]);
  if (!key) unavailable();
  const caller = validatePersistedUnlimited(get, coverage, key.id);
  const settings = record(get('SELECT data FROM settings WHERE id=1')?.data);
  if (settings.providerStrategies !== undefined && !object(settings.providerStrategies)) unavailable();
  const override = settings.providerStrategies?.[input.provider] || {};
  if (!object(override)) unavailable();
  // The normal path defaults to fill-first. Round-robin updates lastUsed/count
  // durably: an unhealthy writer cannot honestly execute that strategy.
  const strategy = override.fallbackStrategy || settings.fallbackStrategy || 'fill-first';
  if (strategy !== 'fill-first') unavailable();
  const excluded = new Set(input.excludeConnectionIds);
  const connections = all('SELECT * FROM providerConnections WHERE provider = ? AND isActive = ?', [input.provider, 1])
    .map(row => ({ ...record(row.data), id: row.id, provider: row.provider, authType: row.authType,
      priority: row.priority, isActive: row.isActive === 1 }));
  // Same stable priority semantics and availability filters as connectionsRepo
  // and getProviderCredentials; do not synthesize a new tie-breaking preference.
  connections.sort((a, b) => (a.priority || 999) - (b.priority || 999));
  const connection = connections.find(c => {
    if (excluded.has(c.id) || isModelLockActive(c, input.model)) return false;
    const enabled = c.providerSpecificData?.enabledModels;
    return !(input.provider === 'codex' && Array.isArray(enabled) && enabled.length && !enabled.includes(input.model));
  });
  if (!connection) unavailable();
  const proof = validatePersistedRequest(get, coverage, { ...input, connectionId: connection.id });
  if (proof.apiKeyId !== caller.apiKeyId || proof.coverageId !== caller.coverageId ||
      proof.coverageGeneration !== caller.coverageGeneration || proof.policyVersion !== caller.policyVersion) unavailable();
  return proof;
}
