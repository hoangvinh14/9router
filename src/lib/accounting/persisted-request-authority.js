import { createHash, randomUUID } from "node:crypto";
import { readAccountingPolicy } from "../db/helpers/accounting-policy.js";
import { text, timestamp, unavailable } from "./attempt-payload.js";

const capabilities = new WeakMap();
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function objectJson(value) {
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw unavailable("Invalid persisted selection");
  return parsed;
}

export function readPersistedAccountingIdentity(reader, db, credential) {
  const key = reader.get("SELECT * FROM apiKeys WHERE key=?", [credential]);
  if (!key || key.isActive !== 1) throw unavailable("Accounting key inactive or missing");
  const { coverage, fingerprint, retiredBindings } = db.coverage.inspectIdentity(key.id, credential);
  const binding = reader.get("SELECT * FROM apiKeyBindings WHERE apiKeyId=?", [key.id]);
  const markers = new Map(reader.all("SELECT key,value FROM _meta WHERE key IN ('accountingCoverageId','accountingBindingKeyId','accountingBindingsInitialized','accountingPoliciesInitialized')").map(row => [row.key, row.value]));
  const meta = name => markers.get(name);
  if (coverage.maintenance || !binding || binding.retiredAt || binding.fingerprint !== fingerprint ||
      retiredBindings.some(b => b.apiKeyId === key.id || b.fingerprint === fingerprint) ||
      meta("accountingCoverageId") !== coverage.id || meta("accountingBindingKeyId") !== coverage.bindingKeyId ||
      meta("accountingBindingsInitialized") !== "1" || meta("accountingPoliciesInitialized") !== "1") throw unavailable("Persisted identity or coverage unavailable");
  const policy = readAccountingPolicy(reader, key.id);
  if (!db.health().healthy && !policy.unlimited) throw unavailable("Recording failure requires explicit unlimited policy");
  return { key, binding, coverage, policy };
}

// Internal proof of persisted identity and selection, never POST permission.
// All retained credentials and projection material stay private to this lifetime.
export function createPersistedRequestAuthority(db) {
  if (capabilities.has(db)) return capabilities.get(db);
  if (!db.ownerInstanceId || !db.coverage || typeof db.withPersistedAccountingAuthority !== "function") throw unavailable("Persisted request authority unavailable");
  const issued = new WeakMap(), lifetime = db.ownerInstanceId;
  function read(input) {
    if (db.ownerInstanceId !== lifetime) throw unavailable("Accounting lifetime changed");
    return db.withPersistedAccountingAuthority(reader => {
      const { key, binding, coverage, policy } = readPersistedAccountingIdentity(reader, db, input.credential);
      const connection = reader.get("SELECT * FROM providerConnections WHERE id=?", [input.connectionId]);
      if (!connection || connection.provider !== input.provider || connection.isActive !== 1) throw unavailable("Persisted connection unavailable");
      const connectionData = objectJson(connection.data);
      const node = reader.get("SELECT * FROM providerNodes WHERE id=?", [input.provider]);
      if (/^(openai|anthropic)-compatible-/.test(input.provider) && !node) throw unavailable("Persisted provider node unavailable");
      if (node) objectJson(node.data);
      const specific = connectionData.providerSpecificData || {};
      const poolId = specific.proxyPoolId === "__none__" ? null : specific.proxyPoolId || null;
      const pool = poolId ? reader.get("SELECT * FROM proxyPools WHERE id=?", [poolId]) : null;
      if (poolId && (!pool || pool.isActive !== 1 || !objectJson(pool.data).proxyUrl)) throw unavailable("Persisted proxy pool unavailable");
      const settings = reader.all("SELECT * FROM settings ORDER BY id");
      for (const row of settings) objectJson(row.data);
      const activated = reader.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")?.value;
      if (activated !== undefined) timestamp(activated);
      const material = [key, binding, policy, connection, node || null, pool, settings,
        reader.all("SELECT * FROM combos ORDER BY id"),
        reader.all("SELECT * FROM kv WHERE scope IN ('modelAliases','customModels','disabledModels') ORDER BY scope,key"),
        coverage.id, coverage.bindingKeyId, activated ?? null];
      return { apiKeyId: key.id, policy, generation: coverage.generation, materialHash: hash(material), connectionData };
    });
  }
  function mint(input, value, requestId) {
    const proof = Object.freeze({ requestId, apiKeyId: value.apiKeyId, provider: input.provider, model: input.model,
      connectionId: input.connectionId, policyVersion: value.policy.version, unlimited: value.policy.unlimited,
      coverageGeneration: value.generation });
    issued.set(proof, { input, materialHash: value.materialHash, connectionData: value.connectionData });
    return proof;
  }
  function prove({ credential, provider, model, connectionId }) {
    for (const [name, value] of Object.entries({ credential, provider, model, connectionId })) text(value, name, name === "credential" ? 8192 : 512);
    const input = Object.freeze({ credential, provider, model, connectionId });
    return mint(input, read(input), randomUUID());
  }
  function assertCurrent(proof, expectedGeneration = proof?.coverageGeneration) {
    const prior = issued.get(proof);
    if (!prior) throw unavailable("Unknown persisted request proof");
    const current = read(prior.input);
    if (current.materialHash !== prior.materialHash || current.generation !== expectedGeneration) throw unavailable("Persisted request authority changed");
    return mint(prior.input, current, proof.requestId);
  }
  function assertCredentials(proof, credentials) {
    const prior = issued.get(proof);
    if (!prior || credentials?.connectionId !== prior.input.connectionId) throw unavailable("Unknown selected credentials");
    assertCurrent(proof);
    for (const field of ["apiKey", "accessToken", "refreshToken", "idToken", "projectId"]) {
      if ((credentials[field] ?? null) !== (prior.connectionData[field] ?? null)) throw unavailable("Selected credentials changed");
    }
    const saved = prior.connectionData.providerSpecificData || {};
    for (const field of ["baseUrl", "apiType"]) {
      if ((credentials.providerSpecificData?.[field] ?? null) !== (saved[field] ?? null)) throw unavailable("Selected provider changed");
    }
    return true;
  }
  const capability = Object.freeze({ prove, assertCurrent, assertCredentials });
  capabilities.set(db, capability);
  return capability;
}
