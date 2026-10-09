import { getAdapter } from '../db/driver.js';
import { recoveryReceiptSync } from './recoveryReceipt.js';
function fail(status, code) { throw Object.assign(new Error(code), { status, code }); }
function ready(db) { if (!db.health().healthy) fail(503, 'api_key_accounting_unavailable'); return db.coverage.status(); }
function projection(state) {
  return { enforcementActive: false, generation: state.generation,
    maintenance: state.maintenance ? { generation: state.maintenance.generation, startedAt: state.maintenance.startedAt } : null,
    gaps: state.gaps.filter(gap => gap.apiKeyId === null).map(gap => ({ id: gap.id, scope: 'global', generation: gap.generation, startedAt: gap.startedAt,
      ...(gap.resolvedAt ? { resolvedAt: gap.resolvedAt, operationId: gap.operationId } : {}) })) };
}
export async function releaseGlobalMaintenanceManagement(input, actor) {
  const fields = ['expectedGeneration', 'operationId', 'reason', 'evidence'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== fields.length || Object.keys(input).some(key => !fields.includes(key)) ||
      !Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 1 ||
      !['operationId', 'reason', 'evidence'].every(key => typeof input[key] === 'string' && input[key].trim() && input[key].length <= (key === 'evidence' ? 4000 : key === 'reason' ? 2000 : 200))) fail(400, 'invalid_maintenance_recovery');
  const db = await getAdapter(); ready(db);
  const operation = { expectedGeneration: input.expectedGeneration, operationId: input.operationId, actor, reason: input.reason, evidence: input.evidence };
  try {
    db.coverage.releaseMaintenance(operation);
    const receipt = db.coverage.maintenanceReceipt(operation);
    if (!receipt) fail(503, 'api_key_accounting_unavailable');
    return { ...projection(ready(db)), recoveryReceipt: receipt };
  } catch (error) { if (error.status === 409) throw error; fail(503, 'api_key_accounting_unavailable'); }
}
export async function getGlobalAccountingManagement() { return projection(ready(await getAdapter())); }
export async function resolveGlobalGapManagement(input, actor) {
  const fields = ['gapId', 'expectedGeneration', 'operationId', 'reason', 'evidence'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== fields.length || Object.keys(input).some(key => !fields.includes(key)) ||
    !Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 1 ||
    !['gapId', 'operationId', 'reason', 'evidence'].every(key => typeof input[key] === 'string' && input[key].trim() && input[key].length <= (key === 'evidence' ? 4000 : key === 'reason' ? 2000 : 200))) fail(400, 'invalid_gap_recovery');
  const db = await getAdapter(); const state = ready(db);
  const gap = state.gaps.find(gap => gap.id === input.gapId && gap.apiKeyId === null);
  if (!gap) fail(404, 'accounting_gap_not_found');
  // Recovery-only exception during maintenance: cannot release maintenance or
  // change a policy/activation. Target-specific sidecar generation remains CAS.
  try { db.coverage.reconcileGap({ ...input, apiKeyId: null, actor }); }
  catch (error) { if (error.status === 409) throw error; fail(503, 'api_key_accounting_unavailable'); }
  return { ...projection(ready(db)), recoveryReceipt: recoveryReceiptSync(db, null, { kind: 'gap', id: input.gapId }, { ...input, apiKeyId: null, actor }) };
}
