import fs from "node:fs";
import path from "node:path";
import { LEGACY_FILES, DB_DIR } from "./paths.js";
import { TABLES, buildCreateTableSql, SCHEMA_VERSION } from "./schema.js";
import { MIGRATIONS, latestVersion } from "./migrations/index.js";
import { getMetaSync, setMetaSync } from "./helpers/metaStore.js";
import { makeBackupDir, backupFile, backupDbLite, pruneOldBackups } from "./backup.js";
import { getAppVersion } from "./version.js";
import { stringifyJson } from "./helpers/jsonCol.js";
import { assertNoAccountingMutation } from "../accounting/mutation-barrier.js";
import { keyAccessToColumns, validateKeyAccessInput } from '../../shared/utils/keyAccess.js';

// Marker file: prevents re-importing legacy JSON when user wipes data.sqlite.
const MIGRATED_MARKER = path.join(DB_DIR, ".migrated-from-json");

// Track per-adapter so reusing same adapter skips re-run, but new adapter (after reset) re-runs.
const _migratedAdapters = new WeakSet();

// Thrown when row-count assertion fails. Outer transaction rolls back,
// legacy db.json kept intact, marker not written → next boot retries.
export class MigrationAborted extends Error {
  constructor(message, droppedRows) {
    super(message);
    this.name = "MigrationAborted";
    this.droppedRows = droppedRows;
  }
}

// Insert rows one-by-one, collect failures, then assert COUNT(*) matches input length.
function importWithAssertion(adapter, tableName, rows, insertFn, rowMeta) {
  const dropped = [];
  for (const row of rows) {
    try { insertFn(row); }
    catch (err) { dropped.push({ ...rowMeta(row), reason: err.message }); }
  }
  const inserted = adapter.get(`SELECT COUNT(*) as c FROM ${tableName}`)?.c ?? 0;
  if (inserted !== rows.length) {
    // Private legacy rows/credentials must not be printed on startup failure.
    console.warn(`[DB][migrate] ${tableName} row-count mismatch: expected ${rows.length}, got ${inserted}`);
    throw new MigrationAborted(`${tableName} row-count mismatch: expected ${rows.length}, got ${inserted}`, dropped);
  }
}

const IMPORT_STATE = 'legacyImportState';
const IMPORT_STATES = new Set(['pending-v1', 'imported-v1', 'no-input-v1']);
function importUnavailable() {
  return Object.assign(new Error('Legacy import requires attention'), { code: 'legacy_import_unavailable' });
}
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function legacyKeyAccess(key) {
  const checked = input => {
    const result = validateKeyAccessInput(input);
    if (!result.ok) throw importUnavailable();
    return keyAccessToColumns(result.value);
  };
  const object = Object.hasOwn(key, 'access') ? checked(key.access) : null;
  let columns = null;
  if (Object.hasOwn(key, 'accessRestricted') || Object.hasOwn(key, 'accessAllow')) {
    if (![0, 1, false, true].includes(key.accessRestricted) || typeof key.accessAllow !== 'string') throw importUnavailable();
    let allow;
    try { allow = JSON.parse(key.accessAllow); } catch { throw importUnavailable(); }
    columns = checked({ restricted: key.accessRestricted === 1 || key.accessRestricted === true, allow });
  }
  if (object && columns && (object.accessRestricted !== columns.accessRestricted || object.accessAllow !== columns.accessAllow)) throw importUnavailable();
  return object ?? columns ?? keyAccessToColumns(null);
}
function legacyRecordId(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw importUnavailable();
  return value;
}
function legacyCustomModelKey(model) {
  const provider = legacyRecordId(model.providerAlias);
  const id = legacyRecordId(model.id);
  // Preserve the existing optional-type default for absent/null/empty values.
  const type = model.type === undefined || model.type === null || model.type === '' ? 'llm' : legacyRecordId(model.type);
  return `${provider}|${id}|${type}`;
}
function assertDistinctLegacyKeys(rows, keyOf) {
  const keys = new Set();
  for (const row of rows) {
    const key = keyOf(row);
    if (keys.has(key)) throw importUnavailable();
    keys.add(key);
  }
}
function validateLegacyMapValues(name, data) {
  // These existing repositories consume maps of objects or lists of model IDs.
  // A declared null/scalar is not absence and must not be replaced by empties.
  if (name === 'main') {
    for (const mappings of Object.values(data.mitmAlias ?? {})) if (!record(mappings)) throw importUnavailable();
    for (const models of Object.values(data.pricing ?? {})) {
      if (!record(models) || Object.values(models).some(price => !record(price))) throw importUnavailable();
    }
  }
  if (name === 'disabled') {
    for (const ids of Object.values(data.disabled ?? {})) {
      if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw importUnavailable();
    }
  }
}
function validateLegacyUsageValues(data) {
  for (const entry of data.history ?? []) {
    if (Object.hasOwn(entry, 'tokens') && !record(entry.tokens)) throw importUnavailable();
  }
  for (const day of Object.values(data.dailySummary ?? {})) if (!record(day)) throw importUnavailable();
}
const LEGACY_CONSUMED_FIELDS = Object.freeze({
  main: ['settings', 'providerConnections', 'providerNodes', 'proxyPools', 'apiKeys', 'combos', 'modelAliases', 'customModels', 'mitmAlias', 'pricing'],
  usage: ['history', 'dailySummary', 'totalRequestsLifetime'],
  disabled: ['disabled'],
  details: ['records'],
  apiKey: ['id', 'key', 'name', 'machineId', 'isActive', 'createdAt', 'access', 'accessRestricted', 'accessAllow'],
  combo: ['id', 'name', 'kind', 'models', 'createdAt', 'updatedAt'],
  usageEntry: ['timestamp', 'provider', 'model', 'connectionId', 'apiKey', 'endpoint', 'cost', 'status', 'tokens'],
});
function assertLegacyConsumedFields(value, section) {
  if (Object.keys(value).some(key => !LEGACY_CONSUMED_FIELDS[section].includes(key))) {
    // Fixed owner section only: a field name may itself contain private data.
    // Refusal preserves the original file, not a claim of supported adoption.
    throw Object.assign(importUnavailable(), { legacySection: section });
  }
}
function validateLegacyRepresentability(name, data) {
  assertLegacyConsumedFields(data, name);
  if (name === 'main') {
    for (const key of data.apiKeys ?? []) assertLegacyConsumedFields(key, 'apiKey');
    for (const combo of data.combos ?? []) assertLegacyConsumedFields(combo, 'combo');
  }
  if (name === 'usage') {
    for (const entry of data.history ?? []) assertLegacyConsumedFields(entry, 'usageEntry');
  }
}
function readLegacySnapshot() {
  const snapshot = {};
  for (const [name, file] of Object.entries(LEGACY_FILES)) {
    let bytes;
    try { bytes = fs.readFileSync(file, 'utf8'); }
    catch (error) { if (error?.code === 'ENOENT') { snapshot[name] = { bytes: null, data: null }; continue; } throw importUnavailable(); }
    let data;
    try { data = JSON.parse(bytes); } catch { throw importUnavailable(); }
    if (!record(data)) throw importUnavailable();
    const arrays = name === 'main' ? ['providerConnections', 'providerNodes', 'proxyPools', 'apiKeys', 'combos', 'customModels'] :
      name === 'usage' ? ['history'] : name === 'details' ? ['records'] : [];
    for (const field of arrays) if (Object.hasOwn(data, field) && (!Array.isArray(data[field]) || data[field].some(row => !record(row)))) throw importUnavailable();
    if (name === 'usage' && Object.hasOwn(data, 'totalRequestsLifetime') &&
        (!Number.isSafeInteger(data.totalRequestsLifetime) || data.totalRequestsLifetime < 0)) throw importUnavailable();
    const maps = name === 'main' ? ['settings', 'modelAliases', 'mitmAlias', 'pricing'] :
      name === 'usage' ? ['dailySummary'] : name === 'disabled' ? ['disabled'] : [];
    for (const field of maps) if (Object.hasOwn(data, field) && !record(data[field])) throw importUnavailable();
    if (name === 'main') {
      // SQLite TEXT PRIMARY KEY alone permits NULL. Row counts therefore do
      // not establish that imported application entities have stable IDs.
      for (const field of ['providerConnections', 'providerNodes', 'proxyPools', 'apiKeys', 'combos']) {
        assertDistinctLegacyKeys(data[field] ?? [], row => legacyRecordId(row.id));
      }
      for (const key of data.apiKeys ?? []) legacyKeyAccess(key);
      assertDistinctLegacyKeys(data.customModels ?? [], legacyCustomModelKey);
    }
    validateLegacyRepresentability(name, data);
    validateLegacyMapValues(name, data);
    if (name === 'usage') validateLegacyUsageValues(data);
    if (name === 'details') assertDistinctLegacyKeys(data.records ?? [], row => legacyRecordId(row.id));
    snapshot[name] = { bytes, data };
  }
  return snapshot;
}
function unchangedLegacySnapshot(snapshot) {
  const current = readLegacySnapshot();
  if (Object.keys(snapshot).some(name => snapshot[name].bytes !== current[name].bytes)) throw importUnavailable();
}
function markerExists() {
  try { fs.statSync(MIGRATED_MARKER); return true; }
  catch (error) { if (error?.code === 'ENOENT') return false; throw importUnavailable(); }
}
function pendingTargetsEmpty(adapter) {
  // Fixed trusted TABLES, not caller-supplied table identifiers. Never let a
  // pending retry overwrite data inserted outside this import protocol.
  for (const name of Object.keys(TABLES)) {
    if (name !== '_meta' && adapter.get(`SELECT 1 AS present FROM ${name} LIMIT 1`)) throw importUnavailable();
  }
}

function isFreshDb(adapter) {
  // Expected absence is distinct from an unreadable/corrupt metadata table.
  // Never reinterpret arbitrary SQL failure as permission for legacy import.
  const present = adapter.get(`SELECT name FROM sqlite_schema WHERE name = ?`, ['_meta']);
  if (!present) return true;
  const row = adapter.get(`SELECT COUNT(*) as c FROM _meta`);
  if (!row || !Number.isSafeInteger(row.c) || row.c < 0) throw new Error('Database metadata unavailable');
  return row.c === 0;
}

// ─── Versioned migrations runner (skip-version safe) ─────────────────────
function runVersionedMigrations(adapter) {
  // Bootstrap _meta first so we can read schemaVersion
  adapter.exec(buildCreateTableSql("_meta", TABLES._meta));

  const current = parseInt(getMetaSync(adapter, "schemaVersion", "0"), 10) || 0;
  const target = latestVersion();
  if (current >= target) return { applied: 0, from: current, to: current };

  const pending = MIGRATIONS.filter((m) => m.version > current);
  let lastApplied = current;
  for (const m of pending) {
    adapter.transaction(() => {
      m.up(adapter);
      setMetaSync(adapter, "schemaVersion", m.version);
    });
    lastApplied = m.version;
    console.log(`[DB][migrate] applied #${m.version} ${m.name}`);
  }
  return { applied: pending.length, from: current, to: lastApplied };
}

// ─── Auto-sync (additive only): add missing tables/columns/indexes ───────
function syncSchemaFromTables(adapter) {
  for (const [tableName, def] of Object.entries(TABLES)) {
    // Create table if absent
    adapter.exec(buildCreateTableSql(tableName, def));

    // Diff columns
    const existing = adapter.all(`PRAGMA table_info(${tableName})`);
    const existingNames = new Set(existing.map((r) => r.name));
    for (const [colName, colDef] of Object.entries(def.columns)) {
      if (!existingNames.has(colName)) {
        // SQLite ADD COLUMN restrictions: no PRIMARY KEY / UNIQUE w/o NULL ok.
        // We strip PRIMARY KEY / UNIQUE since those are only valid at create time.
        const safeDef = colDef
          .replace(/PRIMARY KEY( AUTOINCREMENT)?/i, "")
          .replace(/UNIQUE/i, "")
          .trim();
        try {
          adapter.exec(`ALTER TABLE ${tableName} ADD COLUMN ${colName} ${safeDef}`);
          console.log(`[DB][sync] +column ${tableName}.${colName}`);
        } catch (e) {
          console.warn(`[DB][sync] add column ${tableName}.${colName} failed: ${e.message}`);
        }
      }
    }

    // Indexes (idempotent)
    for (const idx of def.indexes || []) {
      try { adapter.exec(idx); } catch {}
    }
  }
}

// ─── Legacy JSON import (one-time) ───────────────────────────────────────
function importLegacyMain(adapter, data) {
  if (!data || typeof data !== "object") return;

  if (data.settings) {
    adapter.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [stringifyJson(data.settings)]);
  }

  importWithAssertion(adapter, "providerConnections", data.providerConnections || [], (c) => {
    const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
    adapter.run(
      `INSERT OR REPLACE INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, provider, authType || "oauth", name ?? null, email ?? null, priority ?? null, isActive === false ? 0 : 1, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
    );
  }, (c) => ({ id: c.id ?? null, provider: c.provider ?? null, name: c.name ?? null }));

  importWithAssertion(adapter, "providerNodes", data.providerNodes || [], (n) => {
    const { id, type, name, createdAt, updatedAt, ...rest } = n;
    adapter.run(
      `INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
      [id, type ?? null, name ?? null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
    );
  }, (n) => ({ id: n.id ?? null, type: n.type ?? null, name: n.name ?? null }));

  importWithAssertion(adapter, "proxyPools", data.proxyPools || [], (p) => {
    const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
    adapter.run(
      `INSERT OR REPLACE INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
      [id, isActive === false ? 0 : 1, Object.hasOwn(p, 'testStatus') ? testStatus ?? null : "unknown", stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
    );
  }, (p) => ({ id: p.id ?? null }));

  importWithAssertion(adapter, "apiKeys", data.apiKeys || [], (k) => {
    const access = legacyKeyAccess(k);
    adapter.run(
      `INSERT OR REPLACE INTO apiKeys(id, key, name, machineId, isActive, createdAt, accessRestricted, accessAllow) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      [k.id, k.key, k.name ?? null, k.machineId ?? null, k.isActive === false ? 0 : 1, k.createdAt || new Date().toISOString(), access.accessRestricted, access.accessAllow]
    );
  }, (k) => ({ id: k.id ?? null, name: k.name ?? null }));

  importWithAssertion(adapter, "combos", data.combos || [], (c) => {
    adapter.run(
      `INSERT OR REPLACE INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
      [c.id, c.name, c.kind || null, stringifyJson(c.models || []), c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()]
    );
  }, (c) => ({ id: c.id ?? null, name: c.name ?? null }));

  for (const [alias, model] of Object.entries(data.modelAliases || {})) {
    adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('modelAliases', ?, ?)`, [alias, stringifyJson(model)]);
  }
  for (const m of data.customModels || []) {
    const k = legacyCustomModelKey(m);
    adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, stringifyJson(m)]);
  }
  for (const [tool, mappings] of Object.entries(data.mitmAlias || {})) {
    adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('mitmAlias', ?, ?)`, [tool, stringifyJson(mappings)]);
  }
  for (const [provider, models] of Object.entries(data.pricing || {})) {
    adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('pricing', ?, ?)`, [provider, stringifyJson(models)]);
  }
}

function importLegacyUsage(adapter, data) {
  if (!data || typeof data !== "object") return;
  for (const e of data.history || []) {
    const t = e.tokens || {};
    adapter.run(
      `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        e.timestamp || new Date().toISOString(),
        e.provider || null, e.model || null, e.connectionId || null, e.apiKey || null, e.endpoint || null,
        t.prompt_tokens || t.input_tokens || 0,
        t.completion_tokens || t.output_tokens || 0,
        e.cost || 0,
        e.status || "ok",
        stringifyJson(t),
        stringifyJson({}),
      ]
    );
  }
  for (const [dateKey, day] of Object.entries(data.dailySummary || {})) {
    adapter.run(`INSERT OR REPLACE INTO usageDaily(dateKey, data) VALUES(?, ?)`, [dateKey, stringifyJson(day)]);
  }
  if (typeof data.totalRequestsLifetime === "number") {
    setMetaSync(adapter, "totalRequestsLifetime", data.totalRequestsLifetime);
  }
}

function importLegacyDisabled(adapter, data) {
  if (!data || typeof data.disabled !== "object") return;
  for (const [provider, ids] of Object.entries(data.disabled)) {
    adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('disabledModels', ?, ?)`, [provider, stringifyJson(ids)]);
  }
}

function importLegacyDetails(adapter, data) {
  if (!data || !Array.isArray(data.records)) return;
  for (const r of data.records) {
    adapter.run(
      `INSERT OR REPLACE INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?)`,
      [r.id, r.timestamp || new Date().toISOString(), r.provider || null, r.model || null, r.connectionId || null, r.status || null, stringifyJson(r)]
    );
  }
}

// ─── Main entry ──────────────────────────────────────────────────────────
export async function runMigrationOnce(adapter) {
  // Sole publication gate. A marked connection gets no bootstrap, sync,
  // backup or import work. The native opener's inventory is not admission.
  let reason = 'unqualified_accounting_state';
  try {
    if (adapter.driver !== 'sql.js') {
      const { isMarkedInstalledNodeConnection } = await import('./adapters/nodeSqliteAdapter.js');
      if (isMarkedInstalledNodeConnection(adapter.raw)) {
        const { auditMarkedNodeStartup } = await import('../accounting/node-existing-audit.js');
        auditMarkedNodeStartup(adapter);
        return;
      }
    }
    reason = 'accounting_markers_or_inventory_failure';
    assertNoAccountingMutation(adapter);
  } catch {
    throw Object.assign(new Error('Accounting database startup unsupported'), {
      status: 503, code: 'api_key_accounting_startup_unavailable', startupReason: reason,
    });
  }
  if (_migratedAdapters.has(adapter)) return;
  // All ordinary migration work below is synchronous, so
  // no concurrent caller can interleave before successful cache publication.

  // Capture freshness BEFORE migrations stamp _meta (otherwise we'd misclassify
  // a brand-new DB as non-fresh once schemaVersion is written).
  const fresh = isFreshDb(adapter);
  // A missing/empty _meta is not permission to overwrite an existing DB.
  // Only a genuinely empty schema establishes a new pending import lineage.
  const objects = adapter.all(`SELECT name FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY name`);
  const clean = fresh && objects.every(row => row.name === '_meta');
  let importState = objects.some(row => row.name === '_meta') ? getMetaSync(adapter, IMPORT_STATE, null) : null;
  if (importState !== null && !IMPORT_STATES.has(importState)) throw importUnavailable();
  if (clean && importState === null) {
    adapter.transaction(() => {
      const observed = adapter.all(`SELECT name FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY name`);
      if (observed.some(row => row.name !== '_meta') || !isFreshDb(adapter)) throw importUnavailable();
      adapter.exec(buildCreateTableSql('_meta', TABLES._meta));
      setMetaSync(adapter, IMPORT_STATE, 'pending-v1');
    });
    importState = 'pending-v1';
  }

  // Prune stale backups every boot so old oversized backups shrink to KEEP.
  pruneOldBackups();

  // Bootstrap _meta so we can read the stored backup schema version below
  // (runVersionedMigrations also ensures this, but we need it earlier here).
  adapter.exec(buildCreateTableSql("_meta", TABLES._meta));

  // Detect a pending schema change via the central SCHEMA_VERSION const.
  // A lightweight backup is taken BEFORE any schema mutation below.
  const storedSchemaVer = parseInt(getMetaSync(adapter, "backupSchemaVersion", "0"), 10) || 0;
  const schemaChanging = !fresh && storedSchemaVer < SCHEMA_VERSION;
  if (schemaChanging) {
    try {
      const backupDir = makeBackupDir(`schema-${storedSchemaVer}-to-${SCHEMA_VERSION}`);
      backupDbLite(adapter, backupDir);
      pruneOldBackups();
      console.log(`[DB][migrate] pre-schema backup ${storedSchemaVer} → ${SCHEMA_VERSION}: ${backupDir}`);
    } catch (e) {
      console.warn(`[DB][migrate] pre-schema backup failed (continuing): ${e.message}`);
    }
  }

  // 1. Always run versioned migrations chain (skip-version safe)
  runVersionedMigrations(adapter);

  // 2. Additive sync (auto add missing columns/indexes declared in TABLES)
  syncSchemaFromTables(adapter);

  // Stamp the schema version we just reached so future boots skip re-backup.
  setMetaSync(adapter, "backupSchemaVersion", SCHEMA_VERSION);

  // 3. Resume only the positively established pending lineage. Nonfresh old
  // DBs without a state keep their ordinary path; never backfill completion.
  const snapshot = importState === 'pending-v1' ? readLegacySnapshot() : null;
  const hasLegacy = snapshot && Object.values(snapshot).some(value => value.bytes !== null);
  if (importState === 'pending-v1') pendingTargetsEmpty(adapter);
  if (hasLegacy && markerExists()) throw importUnavailable();
  if (hasLegacy) {
    const legacyMain = snapshot.main.data;
    const legacyUsage = snapshot.usage.data;
    const legacyDisabled = snapshot.disabled.data;
    const legacyDetails = snapshot.details.data;
    const t0 = Date.now();
    const backupDir = makeBackupDir("migrate-from-json");
    for (const f of Object.values(LEGACY_FILES)) backupFile(f, backupDir);

    unchangedLegacySnapshot(snapshot);
    adapter.transaction(() => {
        pendingTargetsEmpty(adapter);
        importLegacyMain(adapter, legacyMain);
        importLegacyUsage(adapter, legacyUsage);
        importLegacyDisabled(adapter, legacyDisabled);
        importLegacyDetails(adapter, legacyDetails);
        setMetaSync(adapter, "appVersion", getAppVersion());
        setMetaSync(adapter, "backupSchemaVersion", SCHEMA_VERSION);
        setMetaSync(adapter, "migratedAt", new Date().toISOString());
        unchangedLegacySnapshot(snapshot);
        setMetaSync(adapter, IMPORT_STATE, 'imported-v1');
    }); // Assertion/SQL/commit failures escape: never publish/cache as success.

    try { fs.writeFileSync(MIGRATED_MARKER, new Date().toISOString()); } catch {}
    pruneOldBackups();
    console.log(`[DB][migrate] JSON → SQLite in ${Date.now() - t0}ms | legacy JSON kept at DATA_DIR | backup: ${backupDir}`);
    _migratedAdapters.add(adapter);
    return;
  }

  if (importState === 'pending-v1') {
    // No-input is not proof of a completed historical import or restore safety.
    adapter.transaction(() => {
      pendingTargetsEmpty(adapter);
      unchangedLegacySnapshot(snapshot);
      setMetaSync(adapter, IMPORT_STATE, 'no-input-v1');
    });
  }

  // Track app version for informational purposes only. App version bumps no
  // longer trigger a DB backup — only real schema changes (SCHEMA_VERSION) do.
  const newVer = getAppVersion();
  const oldVer = getMetaSync(adapter, "appVersion", null);
  if (oldVer !== newVer) setMetaSync(adapter, "appVersion", newVer);
  _migratedAdapters.add(adapter);
}
