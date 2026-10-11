import { snapshotAccountingPreparedData } from '../../../open-sse/config/accountedBaseDispatch.js';
import { snapshotAccountingGroup } from '../db/accountingGroupPayload.js';
import { isModelLockActive } from '../../../open-sse/services/accountFallback.js';

const unavailable = () => { throw new Error('Gemini embedding selection unavailable'); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function parseRecord(value) {
  if (typeof value !== 'string') unavailable();
  let parsed;
  try { parsed = JSON.parse(value); } catch { unavailable(); }
  if (!record(parsed)) unavailable();
  return parsed;
}

// INTERNAL healthy SQL selection prerequisite. No OAuth, rotating selection,
// model resolution, credential/transport, price, own ACK or POST permission.
// Complete candidate pool is retained, never pruned or used as a spend cache.
export function captureGeminiEmbeddingSelectionSync(db, authority) {
  return captureSelection(db, authority, true);
}

// Entry-only resolver over the same bounded SQL pool; not model resolution or
// dispatch permission. Binding must subsequently prove the selected original.
export function resolveGeminiEmbeddingSelectionSync(db, model) {
  const settings = db.get('SELECT data FROM settings WHERE id=1')?.data;
  return captureSelection(db, { provider: 'gemini', model, settings }, false);
}
function captureSelection(db, authority, requireOriginal) {
  try {
    if (!db.health().healthy) unavailable();
    // Native SQL rows may have null prototypes. The existing SQL/group guard
    // accepts these without spreading rows or invoking programmable reads.
    const command = snapshotAccountingGroup([{ type: 'selection', value: { authority,
      candidates: db.all('SELECT * FROM providerConnections WHERE provider = ? AND isActive = ?', ['gemini', 1]) } }])[0];
    if (command.type !== 'selection') unavailable();
    const material = snapshotAccountingPreparedData(command.value);
    authority = material.authority;
    if (authority.provider !== 'gemini' || typeof authority.model !== 'string' || !authority.model ||
        requireOriginal && (typeof authority.connectionId !== 'string' || !authority.connectionId)) unavailable();
    // Encoded JSON must pass the strict key/bounds guard after parsing too,
    // before projection can erase shadow fields or non-selected sibling data.
    const parsedCommand = snapshotAccountingGroup([{ type: 'selection-json', value: { material,
      settings: parseRecord(authority.settings),
      candidates: material.candidates.map(row => parseRecord(row.data)) } }])[0];
    if (parsedCommand.type !== 'selection-json') unavailable();
    const json = parsedCommand.value;
    const parsed = snapshotAccountingPreparedData({ material, settings: json.settings,
      connections: material.candidates.map((row, index) => ({ ...json.candidates[index], id: row.id,
        provider: row.provider, authType: row.authType, priority: row.priority, isActive: row.isActive })) });
    const { settings, connections } = parsed;
    if (settings.providerStrategies !== undefined && !record(settings.providerStrategies)) unavailable();
    const override = settings.providerStrategies?.gemini ?? {};
    if (!record(override) || (override.fallbackStrategy || settings.fallbackStrategy || 'fill-first') !== 'fill-first') unavailable();
    // Same stable priority ordering as connectionsRepo/getProviderCredentials;
    // no synthetic tie-breaking or fallback to another account.
    const ordered = [...connections];
    for (const connection of ordered) {
      if (connection.provider !== 'gemini' || connection.isActive !== 1 ||
          typeof connection.id !== 'string' || !connection.id ||
          connection.priority !== null && !Number.isSafeInteger(connection.priority)) unavailable();
    }
    ordered.sort((a, b) => (a.priority || 999) - (b.priority || 999));
    const selected = ordered.find(connection => !isModelLockActive(connection, authority.model));
    if (!selected || requireOriginal && selected.id !== authority.connectionId) unavailable();
    if (!db.health().healthy || db.coverage.status(authority.apiKeyId ?? null).maintenance) unavailable();
    return requireOriginal ? parsed : snapshotAccountingPreparedData({ ...parsed, selected });
  } catch { unavailable(); } // Fixed error only; SQL candidate records are private.
}
