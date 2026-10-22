// Public API barrel — all DB functions
import { getAdapter } from "./driver.js";
import { stringifyJson, parseJson } from "./helpers/jsonCol.js";
import { keyAccessFromColumns, keyAccessToColumns, validateKeyAccessInput } from "@/shared/utils/keyAccess.js";
import { KEY_ACCESS_UNRESTRICTED } from "@/shared/constants/keyAccess.js";
import { validatePricingMutation } from "../pricing/pricingValidation.js";
import { validateReferenceState, withPricingStateLock } from "../pricing/referenceState.js";
import { readReferenceRow, writeReferenceRow } from "../pricing/catalogSync.js";
import { reconcileSavedCatalogScheduleSync } from "../pricing/catalogSchedule.js";
import { retainKeyBindings, retireKeyBindings, validateKeyBindings } from "./helpers/api-key-bindings.js";
import { backupDbLite, makeBackupDir } from "./backup.js";

// Settings
export {
  getSettings, updateSettings, isCloudEnabled, getCloudUrl, exportSettings,
} from "./repos/settingsRepo.js";

// Provider connections
export {
  getProviderConnections, getProviderConnectionById,
  createProviderConnection, updateProviderConnection,
  deleteProviderConnection, deleteProviderConnectionsByProvider,
  reorderProviderConnections, cleanupProviderConnections,
} from "./repos/connectionsRepo.js";

// Provider nodes
export {
  getProviderNodes, getProviderNodeById,
  createProviderNode, updateProviderNode, deleteProviderNode,
} from "./repos/nodesRepo.js";

// Proxy pools
export {
  getProxyPools, getProxyPoolById,
  createProxyPool, updateProxyPool, deleteProxyPool,
} from "./repos/proxyPoolsRepo.js";

// API keys
export {
  getApiKeys, getApiKeyById, getApiKeyByKey, createApiKey, updateApiKey, deleteApiKey, validateApiKey,
} from "./repos/apiKeysRepo.js";

// Combos
export {
  getCombos, getComboById, getComboByName,
  createCombo, updateCombo, deleteCombo,
} from "./repos/combosRepo.js";

// Aliases (model + custom + mitm)
export {
  getModelAliases, setModelAlias, deleteModelAlias,
  getCustomModels, addCustomModel, deleteCustomModel,
  getMitmAlias, setMitmAliasAll,
} from "./repos/aliasRepo.js";

// Pricing
export {
  getPricing, getEditorPricing, getPricingForModel, updatePricing, resetPricing, resetAllPricing,
} from "./repos/pricingRepo.js";

// Disabled models
export {
  getDisabledModels, getDisabledByProvider, disableModels, enableModels,
} from "./repos/disabledModelsRepo.js";

// Usage
export {
  statsEmitter, trackPendingRequest, getActiveRequests,
  saveRequestUsage, getUsageHistory, getUsageStats, getChartData,
  appendRequestLog, getRecentLogs,
} from "./repos/usageRepo.js";

// Request details
export {
  saveRequestDetail, getRequestDetails, getRequestDetailById, getDistinctProviders,
} from "./repos/requestDetailsRepo.js";

// Export/import full DB
export async function exportDb() {
  const db = await getAdapter();
  const { exportSettings } = await import("./repos/settingsRepo.js");
  const settings = await exportSettings();
  // No JS yield between committed barrier and config/reference row capture.
  db.durableTransaction(() => {});
  const referencePricing = validateReferenceState({
    version: 1, catalog: readReferenceRow(db, "catalog"), status: readReferenceRow(db, "status"),
    schedule: readReferenceRow(db, "schedule") ?? { enabled: false },
  });
  const out = {
    accountingMetadata: { version: 1, kind: "configuration-only", coverage: db.coverage.status() },
    settings,
    referencePricing,
    providerConnections: db.all(`SELECT * FROM providerConnections`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, provider: r.provider, authType: r.authType, name: r.name, email: r.email, priority: r.priority, isActive: r.isActive === 1, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    providerNodes: db.all(`SELECT * FROM providerNodes`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, type: r.type, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    proxyPools: db.all(`SELECT * FROM proxyPools`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, isActive: r.isActive === 1, testStatus: r.testStatus, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    apiKeys: db.all(`SELECT * FROM apiKeys`).map((r) => ({ id: r.id, key: r.key, name: r.name, machineId: r.machineId, isActive: r.isActive === 1, createdAt: r.createdAt, access: keyAccessFromColumns(r.accessRestricted, r.accessAllow) })),
    combos: db.all(`SELECT * FROM combos`).map((r) => ({ id: r.id, name: r.name, kind: r.kind, models: parseJson(r.models, []), createdAt: r.createdAt, updatedAt: r.updatedAt })),
    modelAliases: {},
    customModels: [],
    mitmAlias: {},
    pricing: {},
  };

  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'modelAliases'`)) out.modelAliases[r.key] = parseJson(r.value);
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'customModels'`)) out.customModels.push(parseJson(r.value));
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'mitmAlias'`)) out.mitmAlias[r.key] = parseJson(r.value);
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'pricing'`)) out.pricing[r.key] = parseJson(r.value);

  return out;
}

export async function importDb(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid database payload");
  }
  // Snapshot caller data before awaiting coordinator admission. Validate complete
  // pricing/projection before DELETE; omission preserves existing reference state.
  const snapshot = structuredClone(payload);
  // Validate serialized config and SQL-bound row fields before retaining any tombstone.
  JSON.stringify(snapshot);
  for (const [section, required] of Object.entries({ providerConnections: ["id", "provider"], providerNodes: ["id"], proxyPools: ["id"], apiKeys: ["id", "key"], combos: ["id", "name"] })) {
    const rows = snapshot[section] ?? [];
    if (!Array.isArray(rows)) throw new Error(`Invalid ${section}`);
    const ids = new Set(), names = new Set();
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`Invalid ${section} row`);
      for (const key of required) if (typeof row[key] !== "string" || !row[key]) throw new Error(`Invalid ${section} ${key}`);
      if (ids.has(row.id) || section === "combos" && names.has(row.name)) {
        const error = new Error(`Duplicate ${section} identity`);
        if (section === "apiKeys") Object.assign(error, { status: 409, code: "api_key_identity_conflict" });
        throw error;
      }
      ids.add(row.id); names.add(row.name);
      for (const field of ["name", "machineId", "createdAt", "updatedAt", "type", "kind", "email", "authType", "testStatus"]) {
        if (row[field] != null && typeof row[field] !== "string") throw new Error(`Invalid ${section} ${field}`);
      }
      if (row.priority != null && (typeof row.priority !== "number" || !Number.isFinite(row.priority))) throw new Error("Invalid connection priority");
      if (section === "apiKeys" && row.access !== undefined) {
        const checked = validateKeyAccessInput(row.access);
        if (!checked.ok) throw new Error(`apiKeys ${row.id}: ${checked.error}`);
      }
    }
  }
  snapshot.pricing = validatePricingMutation(snapshot.pricing ?? {});
  if (Object.hasOwn(snapshot, "referencePricing")) snapshot.referencePricing = validateReferenceState(snapshot.referencePricing);
  return withPricingStateLock(() => importValidatedDb(snapshot));
}

async function importValidatedDb(payload) {
  const db = await getAdapter();
  validateKeyBindings(db, db.coverage, payload.apiKeys || []);
  backupDbLite(db, makeBackupDir("before-config-import"));
  db.durableTransaction(() => {
    validateKeyBindings(db, db.coverage, payload.apiKeys || []);
    const retained = new Set((payload.apiKeys || []).map(k => k.id));
    retireKeyBindings(db, db.coverage, db.all("SELECT * FROM apiKeys").filter(k => !retained.has(k.id)));
    retainKeyBindings(db, db.coverage, payload.apiKeys || []);
    // Wipe all tables (keep _meta)
    db.run(`DELETE FROM settings`);
    db.run(`DELETE FROM providerConnections`);
    db.run(`DELETE FROM providerNodes`);
    db.run(`DELETE FROM proxyPools`);
    db.run(`DELETE FROM apiKeys`);
    db.run(`DELETE FROM combos`);
    db.run(`DELETE FROM kv WHERE scope IN ('modelAliases', 'customModels', 'mitmAlias', 'pricing')`);

    // Settings
    if (payload.settings) {
      db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [stringifyJson(payload.settings)]);
    }

    for (const c of payload.providerConnections || []) {
      const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
      db.run(
        `INSERT OR REPLACE INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, provider, authType || "oauth", name || null, email || null, priority || null, isActive === false ? 0 : 1, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const n of payload.providerNodes || []) {
      const { id, type, name, createdAt, updatedAt, ...rest } = n;
      db.run(
        `INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [id, type || null, name || null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const p of payload.proxyPools || []) {
      const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
      db.run(
        `INSERT OR REPLACE INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [id, isActive === false ? 0 : 1, testStatus || "unknown", stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const k of payload.apiKeys || []) {
      // Per-key access: a backup without `access` (older version) restores
      // unrestricted, exactly as before; a malformed `access` is refused.
      let access = KEY_ACCESS_UNRESTRICTED;
      if (k.access !== undefined) {
        const checked = validateKeyAccessInput(k.access);
        if (!checked.ok) throw new Error(`apiKeys ${k.id}: ${checked.error}`);
        access = checked.value;
      }
      const cols = keyAccessToColumns(access);
      db.run(
        `INSERT OR REPLACE INTO apiKeys(id, key, name, machineId, isActive, createdAt, accessRestricted, accessAllow) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
        [k.id, k.key, k.name || null, k.machineId || null, k.isActive === false ? 0 : 1, k.createdAt || new Date().toISOString(), cols.accessRestricted, cols.accessAllow]
      );
    }
    for (const c of payload.combos || []) {
      db.run(
        `INSERT OR REPLACE INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [c.id, c.name, c.kind || null, stringifyJson(c.models || []), c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()]
      );
    }
    for (const [a, m] of Object.entries(payload.modelAliases || {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('modelAliases', ?, ?)`, [a, stringifyJson(m)]);
    }
    for (const m of payload.customModels || []) {
      const k = `${m.providerAlias}|${m.id}|${m.type || "llm"}`;
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, stringifyJson(m)]);
    }
    for (const [tool, mappings] of Object.entries(payload.mitmAlias || {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('mitmAlias', ?, ?)`, [tool, stringifyJson(mappings || {})]);
    }
    for (const [provider, models] of Object.entries(payload.pricing)) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('pricing', ?, ?)`, [provider, stringifyJson(models)]);
    }
    if (Object.hasOwn(payload, "referencePricing")) {
      db.run("DELETE FROM kv WHERE scope='referencePricing'");
      for (const key of ["catalog", "status", "schedule"]) {
        const value = payload.referencePricing[key];
        if (value !== null) writeReferenceRow(db, key, value);
      }
    }
  });
  reconcileSavedCatalogScheduleSync(db);
  return await exportDb();
}

// Eager init helper (optional)
export async function initDb() {
  await getAdapter();
}
