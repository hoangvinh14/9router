import { createHash } from 'node:crypto';
import { unavailable } from './attempt-payload.js';
import { createNodeOuterTransaction } from './node-outer-transaction.js';
import { keyAccessFromColumns } from '../../shared/utils/keyAccess.js';
import { parseJson } from '../db/helpers/jsonCol.js';

// Read only fields that can change routing. In particular, never select
// provider connection data (credentials) to decide Claude fallback.
const MAX_ROWS = 256;
const MAX_BYTES = 32768;
export const ROUTING_READS = Object.freeze(Object.fromEntries(Object.entries({
  routingAcl: { method: 'get', sql: 'SELECT accessRestricted, accessAllow FROM apiKeys WHERE id = ?' },
  routingCombos: { method: 'all', sql: 'SELECT name, models FROM combos ORDER BY name LIMIT 257' },
  routingAliases: { method: 'all', sql: "SELECT key, value FROM kv WHERE scope = 'modelAliases' ORDER BY key LIMIT 257" },
  routingNodes: { method: 'all', sql: "SELECT id, type, (SELECT CASE WHEN type = 'text' THEN value END FROM json_each(CASE WHEN json_valid(providerNodes.data) THEN providerNodes.data ELSE '{}' END) WHERE key = 'prefix' ORDER BY id DESC LIMIT 1) AS prefix FROM providerNodes WHERE type IN ('openai-compatible', 'anthropic-compatible', 'custom-embedding') ORDER BY id LIMIT 257" },
  routingClaude: { method: 'all', sql: "SELECT DISTINCT provider FROM providerConnections WHERE provider IN ('anthropic', 'claude') AND isActive = 1 ORDER BY provider" },
  routingSettings: { method: 'get', sql: 'SELECT data FROM settings WHERE id = 1' },
}).map(([name, def]) => [name, Object.freeze(def)])));

function readState(scope, keyId) {
  const acl = scope.routingAcl([keyId]);
  if (!acl || ![0, 1].includes(acl.accessRestricted)) throw unavailable();
  const combos = scope.routingCombos();
  const aliases = scope.routingAliases();
  const nodes = scope.routingNodes();
  const claude = scope.routingClaude();
  if ([combos, aliases, nodes].some(rows => rows.length > MAX_ROWS)) throw unavailable();
  const settings = scope.routingSettings();
  const state = { acl, combos, aliases, nodes, claude, settings };
  const encoded = JSON.stringify(state);
  if (Buffer.byteLength(encoded) > MAX_BYTES) throw unavailable();
  return { state, stamp: createHash('sha256').update(encoded).digest('hex') };
}

// Final ledger transaction comparison. Matching the inputs alone is not
// proof of the selected branch; the ledger also requires its own route proof.
export function routingSnapshotMatches(scope, keyId, stamp) {
  return readState(scope, keyId).stamp === stamp;
}

export function captureNodeRoutingSnapshot(adapter, keyId) {
  const { value: { state, stamp } } = createNodeOuterTransaction(adapter, ROUTING_READS)(scope => readState(scope, keyId));
  const settings = state.settings === null ? {} : parseJson(state.settings.data);
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw unavailable();
  const access = keyAccessFromColumns(state.acl.accessRestricted, state.acl.accessAllow);
  const combos = new Map(state.combos.map(row => {
    const models = parseJson(row.models, []);
    if (!Array.isArray(models) || models.some(model => typeof model !== 'string' || !model)) throw unavailable();
    return [row.name, Object.freeze({ name: row.name, models: Object.freeze(models) })];
  }));
  // The ordinary KV reader builds a plain object; do not certify ambiguous
  // prototype-changing input as equivalent to that reader.
  if (state.aliases.some(row => row.key === '__proto__')) throw unavailable();
  const aliases = Object.freeze(Object.fromEntries(state.aliases.map(row => [row.key, parseJson(row.value)])));
  const nodes = state.nodes.map(row => Object.freeze({ id: row.id, type: row.type, prefix: row.prefix }));
  // Ordinary lookup uses the first match. Without a uniqueness requirement
  // that order can vary; refuse ambiguous accounted lookup instead.
  const seen = new Set();
  for (const node of nodes) {
    if (typeof node.prefix !== 'string') continue;
    const key = JSON.stringify([node.type, node.prefix]);
    if (seen.has(key)) throw unavailable();
    seen.add(key);
  }
  const claude = new Set(state.claude.map(row => row.provider));
  return Object.freeze({ stamp,
    access: access.restricted ? Object.freeze({ allow: Object.freeze(access.allow) }) : null,
    reads: Object.freeze({
      getSettingsData: () => structuredClone(settings),
      getCombos: () => Array.from(combos.values()),
      getComboByName: name => combos.get(name) ?? null,
      getModelAliases: () => structuredClone(aliases),
      getProviderNodes: ({ type }) => nodes.filter(node => node.type === type),
      getProviderConnections: ({ provider }) => claude.has(provider) ? [true] : [],
    }),
  });
}
