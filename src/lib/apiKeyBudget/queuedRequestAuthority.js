import { validateKeyBindings } from '../db/helpers/apiKeyBindings.js';
import { snapshotAccountingGroup } from '../db/accountingGroupPayload.js';

const unavailable = () => { throw new Error('Queued request authority unavailable'); };
function objectRecord(text) {
  if (typeof text !== 'string') unavailable();
  let parsed;
  try { parsed = JSON.parse(text); } catch { unavailable(); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) unavailable();
  return parsed;
}

// INTERNAL healthy owned SQL view only. No async read, no management output,
// no dispatch/pricing/transport authority and no unhealthy independent proof.
// Exact persisted rows are equality constraints for detached original work.
export function captureQueuedRequestAuthoritySync(db, { credential, apiKeyId, provider, model, connectionId = null }) {
  if (!db.health().healthy || typeof credential !== 'string' || !credential || typeof apiKeyId !== 'string' ||
      typeof provider !== 'string' || !provider || typeof model !== 'string' || !model) unavailable();
  const state = db.coverage.status(apiKeyId);
  if (state.maintenance) unavailable();
  const key = db.get('SELECT * FROM apiKeys WHERE key=?', [credential]);
  if (!key || key.id !== apiKeyId || ![1, true].includes(key.isActive)) unavailable();
  // Import validation permits a new unbound key; admission does not. Persisted
  // binding is mandatory, and remains an equality constraint after preparation.
  const binding = db.get('SELECT * FROM apiKeyBindings WHERE apiKeyId=?', [apiKeyId]);
  if (!binding || binding.retiredAt || binding.fingerprint !== db.coverage.fingerprint(credential)) unavailable();
  validateKeyBindings(db, db.coverage, [key]);
  const settings = db.get('SELECT data FROM settings WHERE id=1')?.data;
  objectRecord(settings);
  const ledgerStartedAt = db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")?.value;
  if (typeof ledgerStartedAt !== 'string' || !ledgerStartedAt) unavailable();
  let connection = null, proxyPool = null;
  if (connectionId !== null) {
    if (typeof connectionId !== 'string' || !connectionId) unavailable();
    connection = db.get('SELECT * FROM providerConnections WHERE id=?', [connectionId]);
    if (!connection || connection.provider !== provider || ![1, true].includes(connection.isActive)) unavailable();
    const extra = objectRecord(connection.data), specific = extra.providerSpecificData;
    if (specific !== undefined && specific !== null && (typeof specific !== 'object' || Array.isArray(specific))) unavailable();
    const poolId = specific?.proxyPoolId;
    if (poolId !== undefined && poolId !== null && typeof poolId !== 'string') unavailable();
    if (poolId?.trim() && poolId.trim() !== '__none__') {
      proxyPool = db.get('SELECT * FROM proxyPools WHERE id=?', [poolId.trim()]);
      if (!proxyPool || ![0, 1, false, true].includes(proxyPool.isActive)) unavailable();
      objectRecord(proxyPool.data);
    }
  }
  const after = db.coverage.status(apiKeyId);
  if (after.maintenance || after.id !== state.id || after.generation !== state.generation) unavailable();
  // Strict bounded detached data; contains credential/connection secrets. Never
  // log/persist/expose this equality material through management or analytics.
  return snapshotAccountingGroup([{ type: 'authority', value: { credential, apiKeyId, provider, model, connectionId,
    key, binding, settings, ledgerStartedAt, coverageId: state.id, connection, proxyPool } }])[0].value;
}
