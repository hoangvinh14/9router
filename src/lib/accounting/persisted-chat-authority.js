import { verifyAccountingSchemaRows } from "../db/migrations/002-accounting-foundation.js";
import { verifyAccountingPolicySchemaRows } from "../db/helpers/accounting-policy.js";
import { resolveOpenAICompatibleApiType } from "../../../open-sse/services/provider.js";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { readPersistedAccountingIdentity } from "./persisted-request-authority.js";
import { unavailable } from "./attempt-payload.js";
import { BUDGET_CALENDAR_REVISION } from "./budget-windows.js";
import { budgetError } from "./budget-errors.js";
import { rowToConn } from "../db/repos/connectionsRepo.js";
import { rowToNode } from "../db/repos/nodesRepo.js";
import { mergeWithDefaults } from "../db/repos/settingsRepo.js";
import { resolveSavedConnectionProxy } from "../network/connectionProxy.js";
import { parseModel, RESERVED_PROVIDER_PREFIXES } from "../../sse/services/model.js";
import { resolveModelInfoFromAliases } from "../../../open-sse/services/model.js";
import { buildKeyAllowSets } from "../../sse/services/keyAccess.js";
import { chooseChatConnection } from "../../sse/services/chat-account-selection.js";
import { isModelLockActive } from "../../../open-sse/services/accountFallback.js";

const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const json = value => JSON.parse(value);
function projection(reader, db, credential) {
  const { key, binding, coverage, policy } = readPersistedAccountingIdentity(reader, db, credential);
  const nodes = reader.all("SELECT * FROM providerNodes ORDER BY id").map(rowToNode);
  const connections = reader.all("SELECT * FROM providerConnections ORDER BY id").map(rowToConn);
  const pools = reader.all("SELECT * FROM proxyPools ORDER BY id").map(row => ({ ...json(row.data), id: row.id, isActive: row.isActive === 1 }));
  const settings = mergeWithDefaults(json(reader.get("SELECT data FROM settings WHERE id=1")?.data || "{}"));
  const combos = reader.all("SELECT * FROM combos ORDER BY id").map(row => ({ ...row, models: json(row.models) }));
  const kv = reader.all("SELECT * FROM kv WHERE scope IN ('modelAliases','customModels','disabledModels') ORDER BY scope,key");
  const aliases = Object.fromEntries(kv.filter(row => row.scope === "modelAliases").map(row => [row.key, json(row.value)]));
  const stableConnections = connections.map(connection => {
    // Ordinary selection owns these two bookkeeping fields. Every credential,
    // lock, activation and routing field remains in the authority projection.
    const { lastUsedAt, consecutiveUseCount, updatedAt, ...stable } = connection;
    return stable;
  });
  const material = [key, policy, nodes, stableConnections, pools, settings, combos, kv, coverage.id, coverage.bindingKeyId, binding,
    reader.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")?.value ?? null, BUDGET_CALENDAR_REVISION];
  return { key, policy, coverage, nodes, connections, pools, settings, combos, aliases, material, revision: digest(material) };
}

// Application-specific persisted selection. No reader or general getter escapes.
export function createPersistedChatAuthority(db, credential) {
  const lifetime = db.ownerInstanceId;
  const read = reader => projection(reader, db, credential);
  const fresh = () => {
    if (db.ownerInstanceId !== lifetime) throw unavailable("Chat accounting lifetime changed");
    return db.withPersistedAccountingAuthority(read);
  };
  function healthy(reader = db) {
    const state = db.health();
    if (db.ownerInstanceId !== lifetime || !state.healthy || !state.owned || state.closed) throw unavailable("Healthy chat authority unavailable");
    const schema = reader.all("SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger')");
    verifyAccountingSchemaRows(schema); verifyAccountingPolicySchemaRows(schema);
    return read(reader);
  }
  const selection = () => db.health().healthy ? healthy() : fresh();
  let initial = selection(), generation = initial.coverage.generation;
  function current(reader = null) {
    const value = reader ? healthy(reader) : selection();
    return unchanged(value);
  }
  function unchanged(value) {
    if (!isDeepStrictEqual(value.policy, initial.policy)) throw budgetError('api_key_accounting_unavailable', { reason: 'policy_changed' });
    if (value.revision !== initial.revision || value.coverage.generation !== generation || value.coverage.maintenance) throw unavailable("Chat request authority changed");
    return value;
  }
  function modelInfo(requested, view = initial) {
    const parsed = parseModel(requested);
    if (!parsed.isAlias && !RESERVED_PROVIDER_PREFIXES.has(parsed.providerAlias)) {
      const node = view.nodes.find(node => node.prefix === parsed.providerAlias && ["openai-compatible", "anthropic-compatible", "custom-embedding"].includes(node.type));
      if (node) return { provider: node.id, model: parsed.model };
    }
    if (parsed.isAlias && view.combos.some(combo => combo.name === requested)) return { provider: null, model: requested };
    return resolveModelInfoFromAliases(requested, view.aliases);
  }
  function authorizeTarget(requested) {
    const view = current();
    if (typeof requested !== "string" || !requested) throw unavailable("Chat model required");
    if (view.key.accessRestricted === 1) {
      const allow = json(view.key.accessAllow);
      if (!Array.isArray(allow) || allow.some(entry => typeof entry !== "string")) throw unavailable("Invalid chat access policy");
      const sets = buildKeyAllowSets(allow, view.combos, allow.map(entry => modelInfo(entry, view)));
      const combo = comboModels(requested);
      const info = modelInfo(requested, view);
      const allowed = combo || !info.provider ? sets.combos.has(requested.toLowerCase()) : sets.models.has(`${info.provider}/${info.model}`.toLowerCase());
      if (!allowed) throw unavailable("Chat key access denied");
    }
    return true;
  }
  function comboModels(requested) {
    if (requested.includes("/")) return null;
    const combo = initial.combos.find(combo => combo.name === requested);
    return combo?.models?.length ? [...combo.models] : null;
  }
  function resolveCredentials(provider, model, excluded = new Set()) {
    const view = current();
    const available = view.connections.filter(c => c.provider === provider && c.isActive && !excluded.has(c.id) && !isModelLockActive(c, model));
    available.sort((a, b) => (a.priority || 999) - (b.priority || 999));
    const connection = chooseChatConnection(available, view.settings, provider);
    if (!connection) return null;
    return { ...resolveCredentialsFromView(view, connection),
      connectionName: connection.displayName || connection.name || connection.email || connection.id, _connection: connection };
  }

  function assertSelection(candidate, credentials, reader = null) {
    return assertAgainst(current(reader), candidate, credentials);
  }
  function assertPersistedSelection(candidate, credentials) {
    return assertAgainst(unchanged(fresh()), candidate, credentials);
  }
  function assertAgainst(view, { provider, model, connectionId }, credentials) {
    const node = view.nodes.find(node => node.id === provider);
    if (!model) throw unavailable('Chat model authority missing');
    if (!/^openai-compatible-/.test(provider) || node?.type !== "openai-compatible" ||
        (node.apiType || "chat") !== "chat" || resolveOpenAICompatibleApiType(provider, credentials) !== "chat") throw budgetError('model_accounting_unsupported');
    const connection = view.connections.find(c => c.id === connectionId);
    if (!connection?.isActive || connection.provider !== provider || isModelLockActive(connection, model)) throw unavailable("Chat selection unavailable");
    const expected = resolveCredentialsFromView(view, connection);
    for (const field of ["apiKey", "accessToken", "refreshToken", "idToken", "projectId", "connectionId"]) {
      if ((credentials[field] ?? null) !== (expected[field] ?? null)) throw unavailable("Chat credentials changed");
    }
    if (!isDeepStrictEqual(credentials.providerSpecificData || {}, expected.providerSpecificData)) throw unavailable("Chat route changed");
    if (credentials.runtimeTransport) throw unavailable("Chat runtime transport changed");
    return true;
  }
  function resolveCredentialsFromView(view, connection) {
    const specific = connection.providerSpecificData || {};
    const poolId = specific.proxyPoolId === "__none__" ? null : specific.proxyPoolId;
    const pool = view.pools.find(pool => pool.id === poolId);
    if (poolId && (!pool?.isActive || !pool.proxyUrl)) throw unavailable("Chat proxy pool unavailable");
    const proxy = resolveSavedConnectionProxy(specific, pool);
    return { ...connection, connectionId: connection.id, providerSpecificData: { ...specific,
      connectionProxyEnabled: proxy.connectionProxyEnabled, connectionProxyUrl: proxy.connectionProxyUrl,
      connectionNoProxy: proxy.connectionNoProxy, connectionProxyPoolId: proxy.proxyPoolId || null,
      strictProxy: proxy.strictProxy === true, vercelRelayUrl: proxy.vercelRelayUrl || "" } };
  }
  function prepareAccountFailure(connectionId, model, patch) {
    const before = current(db), material = structuredClone(before.material);
    const allowed = ["testStatus", "lastError", "errorCode", "lastErrorAt", "backoffLevel", `modelLock_${model}`, "modelLock___all"];
    if (Object.keys(patch).some(key => !allowed.includes(key))) throw unavailable("Unknown account failure mutation");
    const expected = material[3].find(connection => connection.id === connectionId);
    if (!expected) throw unavailable("Unknown failure connection");
    Object.assign(expected, patch);
    let consumed = false;
    return () => {
      if (consumed) throw unavailable("Account failure mutation already observed");
      consumed = true;
      const after = read(db);
      if (!isDeepStrictEqual(structuredClone(after.material), material) || after.coverage.generation !== generation) throw unavailable("Authority changed during account failure update");
      initial = after;
    };
  }
  function acceptOwnGap(nextGeneration) {
    // The caller supplies only its privately retained, delivered operation ACK.
    if (nextGeneration !== generation + 1) throw unavailable("Unexpected chat gap generation");
    generation = nextGeneration;
    try { current(); } catch (error) { generation--; throw error; }
  }
  return Object.freeze({ apiKeyId: initial.key.id, unlimited: initial.policy.unlimited,
    settings: () => {
      const settings = current().settings;
      const fields = ["requireApiKey", "ccFilterNaming", "comboStrategies", "comboStrategy", "comboStickyRoundRobinLimit", "capacityAdapter", "providerThinking",
        "rtkEnabled", "headroomEnabled", "headroomUrl", "headroomCompressUserMessages", "headroomTimeoutMs", "cavemanEnabled", "cavemanLevel",
        "ponytailEnabled", "ponytailLevel", "pxpipeEnabled", "pxpipeMinChars", "pxpipeTimeoutMs", "providerOverrides"];
      return structuredClone(Object.fromEntries(fields.filter(field => settings[field] !== undefined).map(field => [field, settings[field]])));
    }, modelInfo: requested => modelInfo(requested, current()), comboModels,
    authorizeTarget, resolveCredentials, assertSelection, assertPersistedSelection, assertCurrent: () => { current(); return true; }, acceptOwnGap,
    generation: () => generation, prepareAccountFailure });
}
