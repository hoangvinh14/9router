import { createHash } from 'node:crypto';

export const MAINTENANCE_RELEASE_MAX_RECEIPTS = 1000;
const FIELDS = ['operationId', 'generation', 'coverageId', 'payloadHash', 'releasedAt'];
export function validateMaintenanceReleaseAcknowledgements(state) {
  if (state.maintenanceReleases === undefined) return [];
  const rows = state.maintenanceReleases;
  if (!Array.isArray(rows) || rows.length > MAINTENANCE_RELEASE_MAX_RECEIPTS) throw new Error('Invalid maintenance acknowledgement history');
  const operations = new Set(), generations = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== FIELDS.length || Object.keys(row).some(key => !FIELDS.includes(key)) ||
        typeof row.operationId !== 'string' || !row.operationId.trim() || row.operationId.length > 200 ||
        !Number.isSafeInteger(row.generation) || row.generation < 1 || row.generation > state.generation ||
        row.coverageId !== state.id || typeof row.payloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.payloadHash) ||
        typeof row.releasedAt !== 'string' || !Number.isFinite(Date.parse(row.releasedAt)) || new Date(row.releasedAt).toISOString() !== row.releasedAt ||
        operations.has(row.operationId) || generations.has(row.generation) || state.maintenance?.generation === row.generation) throw new Error('Invalid maintenance acknowledgement history');
    operations.add(row.operationId); generations.add(row.generation);
  }
  return rows;
}
export function maintenanceReleasePayloadHash(coverageId, payload) {
  return createHash('sha256').update('9router/accounting/maintenance-release/v1\0').update(JSON.stringify([coverageId, payload.expectedGeneration, payload.operationId, payload.actor, payload.reason, payload.evidence])).digest('hex');
}
