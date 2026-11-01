import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { verifyAccountingSchemaRows } from '../db/migrations/002-accounting-foundation.js';
import { verifyAccountingPolicySchemaRows } from '../db/helpers/accounting-policy.js';
import { readPersistedAccountingIdentity } from './persisted-request-authority.js';
import { unavailable } from './attempt-payload.js';
import { budgetError } from './budget-errors.js';
import { BUDGET_CALENDAR_REVISION } from './budget-windows.js';
import { rowToConn } from '../db/repos/connectionsRepo.js';
import { rowToNode } from '../db/repos/nodesRepo.js';
import { mergeWithDefaults } from '../db/repos/settingsRepo.js';
import { resolveSavedConnectionProxy } from '../network/connectionProxy.js';
import { parseModel, RESERVED_PROVIDER_PREFIXES } from '../../sse/services/model.js';
import { resolveModelInfoFromAliases } from '../../../open-sse/services/model.js';
import { buildKeyAllowSets } from '../../sse/services/keyAccess.js';
import { isModelLockActive } from '../../../open-sse/services/accountFallback.js';
import { chooseChatConnection } from '../../sse/services/chat-account-selection.js';

export function embeddingsTarget(value) {
  if (typeof value !== 'string' || !value) throw unavailable('Explicit embeddings target required');
  const base = value.replace(/\/+$/, '').replace(/\/embeddings$/, '');
  let url;
  try { url = new URL(base); } catch { throw unavailable('Invalid embeddings target'); }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
      /%2f|%5c|\\\\/i.test(value) || url.pathname.includes('//') || /\/embeddings$/.test(base)) throw unavailable('Unsupported embeddings target');
  return `${base}/embeddings`;
}
const json = JSON.parse;
function projection(reader, db, credential) {
  const identity = readPersistedAccountingIdentity(reader, db, credential);
  const nodes = reader.all('SELECT * FROM providerNodes ORDER BY id').map(rowToNode);
  const connections = reader.all('SELECT * FROM providerConnections ORDER BY id').map(rowToConn);
  const pools = reader.all('SELECT * FROM proxyPools ORDER BY id').map(row => ({...json(row.data), id:row.id, isActive:row.isActive === 1}));
  const settings = mergeWithDefaults(json(reader.get('SELECT data FROM settings WHERE id=1')?.data || '{}'));
  const combos = reader.all('SELECT * FROM combos ORDER BY id').map(row => ({...row, models:json(row.models)}));
  const kv = reader.all("SELECT * FROM kv WHERE scope IN ('modelAliases','customModels','disabledModels') ORDER BY scope,key");
  const aliases = Object.fromEntries(kv.filter(row => row.scope === 'modelAliases').map(row => [row.key,json(row.value)]));
  const stableConnections = connections.map(({lastUsedAt: _last, consecutiveUseCount: _count, updatedAt: _updated, ...stable}) => stable);
  const {key, binding, coverage, policy} = identity;
  const material = [key,policy,nodes,stableConnections,pools,settings,combos,kv,coverage.id,coverage.bindingKeyId,binding,
    reader.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")?.value ?? null,BUDGET_CALENDAR_REVISION];
  return {...identity,nodes,connections,pools,settings,combos,aliases,material,
    revision:createHash('sha256').update(JSON.stringify(material)).digest('hex')};
}

// E1-only policy: do not relax the Chat/Responses authority's apiType guards.
export function createPersistedEmbeddingsAuthority(db, credential) {
  const lifetime = db.ownerInstanceId;
  const read = reader => projection(reader,db,credential);
  const fresh = () => {
    if (db.ownerInstanceId !== lifetime) throw unavailable('Embeddings lifetime changed');
    return db.withPersistedAccountingAuthority(read);
  };
  function healthy(reader = db) {
    const state = db.health();
    if (db.ownerInstanceId !== lifetime || !state.healthy || !state.owned || state.closed) throw unavailable('Embeddings authority unavailable');
    const schema = reader.all("SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger')");
    verifyAccountingSchemaRows(schema); verifyAccountingPolicySchemaRows(schema);
    return read(reader);
  }
  const selection = () => db.health().healthy ? healthy() : fresh();
  let initial = selection(), generation = initial.coverage.generation;
  function unchanged(view) {
    if (!isDeepStrictEqual(view.policy,initial.policy)) throw budgetError('api_key_accounting_unavailable',{reason:'policy_changed'});
    if (view.revision !== initial.revision || view.coverage.generation !== generation || view.coverage.maintenance) throw unavailable('Embeddings authority changed');
    return view;
  }
  const current = reader => unchanged(reader ? healthy(reader) : selection());
  function modelInfo(requested, view = current()) {
    const parsed = parseModel(requested);
    if (!parsed.isAlias && !RESERVED_PROVIDER_PREFIXES.has(parsed.providerAlias)) {
      const node = view.nodes.find(node => node.prefix === parsed.providerAlias && node.type === 'openai-compatible');
      if (node) return {provider:node.id,model:parsed.model};
    }
    return resolveModelInfoFromAliases(requested,view.aliases);
  }
  function authorizeTarget(requested) {
    const view = current();
    if (typeof requested !== 'string' || !requested) throw unavailable('Embeddings model required');
    if (view.combos.some(combo => combo.name === requested)) throw budgetError('model_accounting_unsupported');
    if (view.key.accessRestricted === 1) {
      const allow = json(view.key.accessAllow);
      if (!Array.isArray(allow) || allow.some(entry => typeof entry !== 'string')) throw unavailable('Invalid embeddings ACL');
      const sets = buildKeyAllowSets(allow,view.combos,allow.map(entry => modelInfo(entry,view)));
      const info = modelInfo(requested,view);
      if (!sets.models.has(`${info.provider}/${info.model}`.toLowerCase())) throw unavailable('Embeddings access denied');
    }
    return modelInfo(requested,view);
  }
  function credentialsFrom(view, connection) {
    const specific = connection.providerSpecificData || {};
    const poolId = specific.proxyPoolId === '__none__' ? null : specific.proxyPoolId;
    const pool = view.pools.find(pool => pool.id === poolId);
    if (poolId && (!pool?.isActive || !pool.proxyUrl)) throw unavailable('Embeddings proxy pool unavailable');
    const proxy = resolveSavedConnectionProxy(specific,pool);
    if (proxy.vercelRelayUrl || (proxy.connectionProxyEnabled && (!proxy.strictProxy || !/^http:\/\//.test(proxy.connectionProxyUrl)))) throw unavailable('Unsupported embeddings proxy');
    return {...connection,connectionId:connection.id,providerSpecificData:{...specific,
      connectionProxyEnabled:proxy.connectionProxyEnabled,connectionProxyUrl:proxy.connectionProxyUrl,
      connectionNoProxy:proxy.connectionNoProxy,connectionProxyPoolId:proxy.proxyPoolId || null,
      strictProxy:proxy.strictProxy === true,vercelRelayUrl:proxy.vercelRelayUrl || ''}};
  }
  function assertAgainst(view, {provider,model,endpoint,connectionId}, credentials) {
    const node = view.nodes.find(node => node.id === provider);
    if (endpoint !== 'embeddings' || !model || !/^openai-compatible-/.test(provider) || node?.type !== 'openai-compatible') throw budgetError('model_accounting_unsupported');
    const connection = view.connections.find(connection => connection.id === connectionId);
    if (!connection?.isActive || connection.provider !== provider || connection.authType !== 'apikey' || isModelLockActive(connection,model)) throw unavailable('Embeddings selection unavailable');
    const expected = credentialsFrom(view,connection);
    if (typeof expected.apiKey !== 'string' || !expected.apiKey || expected.accessToken || expected.refreshToken || expected.runtimeTransport) throw unavailable('Embeddings API key required');
    for (const field of ['apiKey','accessToken','refreshToken','idToken','projectId','connectionId','authType']) {
      if ((credentials[field] ?? null) !== (expected[field] ?? null)) throw unavailable('Embeddings credentials changed');
    }
    if (credentials.runtimeTransport || !isDeepStrictEqual(credentials.providerSpecificData || {},expected.providerSpecificData)) throw unavailable('Embeddings route changed');
    if (embeddingsTarget(node.baseUrl) !== embeddingsTarget(expected.providerSpecificData.baseUrl)) throw unavailable('Embeddings node target changed');
    return true;
  }
  function prepareAccountFailure(connectionId, model, patch) {
    const material = structuredClone(current(db).material);
    const allowed = ['testStatus','lastError','errorCode','lastErrorAt','backoffLevel',`modelLock_${model}`,'modelLock___all'];
    if (Object.keys(patch).some(key => !allowed.includes(key))) throw unavailable('Unknown embeddings failure mutation');
    const connection = material[3].find(connection => connection.id === connectionId);
    if (!connection) throw unavailable('Unknown embeddings connection');
    Object.assign(connection,patch); let consumed = false;
    return () => {
      if (consumed) throw unavailable('Failure mutation already acknowledged'); consumed = true;
      const after = read(db);
      if (!isDeepStrictEqual(structuredClone(after.material),material) || after.coverage.generation !== generation) throw unavailable('Embeddings failure authority changed');
      initial = after;
    };
  }
  return Object.freeze({apiKeyId:initial.key.id,unlimited:initial.policy.unlimited,
    settings:() => structuredClone(current().settings), modelInfo, authorizeTarget,
    assertCurrent:() => {current(); return true;},
    assertSelection:(candidate,credentials,reader) => assertAgainst(current(reader),candidate,credentials),
    assertPersistedSelection:(candidate,credentials) => assertAgainst(unchanged(fresh()),candidate,credentials),
    resolveCredentials(provider,model,excluded = new Set()) {
      const view = current();
      const available = view.connections.filter(connection => connection.provider === provider && connection.isActive && !excluded.has(connection.id) && !isModelLockActive(connection,model));
      available.sort((a,b) => (a.priority || 999) - (b.priority || 999));
      const connection = chooseChatConnection(available,view.settings,provider);
      return connection ? {...credentialsFrom(view,connection),connectionName:connection.name || connection.id,_connection:connection} : null;
    },
    prepareAccountFailure, generation:() => generation,
    acceptOwnGap(next) {
      if (next !== generation + 1) throw unavailable('Unexpected embeddings gap generation');
      generation = next;
      try {current();} catch (error) {generation--; throw error;}
    },
  });
}
