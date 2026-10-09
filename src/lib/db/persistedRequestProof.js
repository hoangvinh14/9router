import { validatePersistedUnlimited } from './unlimitedAdmissionProof.js';

const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length > 0;
const unavailable = () => { throw new Error('Persisted request proof unavailable'); };
function record(value) {
  if (typeof value !== 'string') unavailable();
  let parsed;
  try { parsed = JSON.parse(value); } catch { unavailable(); }
  if (!object(parsed)) unavailable();
  return parsed;
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

// Reads only inside an adapter-owned fresh persisted snapshot. This proof is
// caller/config evidence, NOT a price, supported-provider, dispatch or gap ACK.
// Secrets remain request-local; never return them through management/log APIs.
export function validatePersistedRequest(get, coverage, input) {
  if (!object(input) || !text(input.credential) || !text(input.provider) || !text(input.model) || !text(input.connectionId)) unavailable();
  const key = get('SELECT id FROM apiKeys WHERE key=?', [input.credential]);
  if (!key) unavailable();
  const proof = validatePersistedUnlimited(get, coverage, key.id);
  const settings = record(get('SELECT data FROM settings WHERE id=1')?.data);
  const row = get('SELECT * FROM providerConnections WHERE id=?', [input.connectionId]);
  if (!row || row.isActive !== 1 || row.provider !== input.provider || !text(row.authType)) unavailable();
  const extra = record(row.data);
  // Persisted columns always win over JSON shadow fields, as in the normal repo.
  const connection = { ...extra, id: row.id, provider: row.provider, authType: row.authType,
    name: row.name, email: row.email, priority: row.priority, isActive: true,
    createdAt: row.createdAt, updatedAt: row.updatedAt };
  // Pool evidence belongs to the same independently durable snapshot, never a
  // normal repository read or a new writable connection. This does not resolve
  // transport eligibility, inactive-pool fallback, relay or rotation strategy.
  const specific = connection.providerSpecificData;
  if (specific !== undefined && specific !== null && !object(specific)) unavailable();
  const rawPoolId = specific?.proxyPoolId;
  if (rawPoolId !== undefined && rawPoolId !== null && typeof rawPoolId !== 'string') unavailable();
  const poolId = rawPoolId?.trim();
  let proxyPool = null;
  if (poolId && poolId !== '__none__') {
    const poolRow = get('SELECT * FROM proxyPools WHERE id=?', [poolId]);
    if (!poolRow || poolRow.id !== poolId || ![0, 1].includes(poolRow.isActive)) unavailable();
    proxyPool = { ...record(poolRow.data), id: poolRow.id, isActive: poolRow.isActive === 1,
      testStatus: poolRow.testStatus, createdAt: poolRow.createdAt, updatedAt: poolRow.updatedAt };
  }
  const after = coverage.status(key.id);
  if (after.maintenance || after.id !== proof.coverageId || after.generation !== proof.coverageGeneration) unavailable();
  return freeze({ ...proof, provider: input.provider, model: input.model, settings, connection, proxyPool });
}
