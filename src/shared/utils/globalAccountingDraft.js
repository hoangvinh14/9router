const URLS = { gap: '/api/accounting/gaps', maintenance: '/api/accounting/maintenance/release' };
export const GLOBAL_RECOVERY_STORAGE_KEY = '9router:accounting-global-recovery:v1';
function reject() { throw new Error('Global recovery acknowledgement or retained operation is invalid. Keep the unchanged operation for operator reconciliation.'); }
function text(value, max) { return typeof value === 'string' && Boolean(value.trim()) && value.length <= max; }
export function validateRetainedGlobalRecovery(value) {
  if (!value || Array.isArray(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'url') || !Object.hasOwn(value, 'payload')) reject();
  const kind = value.url === URLS.gap ? 'gap' : value.url === URLS.maintenance ? 'maintenance' : null, p = value.payload;
  const fields = kind === 'gap' ? ['gapId', 'expectedGeneration', 'operationId', 'reason', 'evidence'] : ['expectedGeneration', 'operationId', 'reason', 'evidence'];
  if (!kind || !p || Array.isArray(p) || Object.keys(p).length !== fields.length || Object.keys(p).some(key => !fields.includes(key)) ||
      !Number.isSafeInteger(p.expectedGeneration) || p.expectedGeneration < 1 || !text(p.operationId, 200) || !text(p.reason, 2000) || !text(p.evidence, 4000) || kind === 'gap' && !text(p.gapId, 200) || JSON.stringify(value).length > 16384) reject();
  return Object.freeze({ url: value.url, payload: Object.freeze(structuredClone(p)) });
}
export function globalRecoveryDraft(target, { reason, evidence }, operationId) {
  if (!target || !['gap', 'maintenance'].includes(target.kind) || target.kind === 'gap' && (target.row?.scope !== 'global' || target.row?.resolvedAt)) reject();
  return validateRetainedGlobalRecovery({ url: URLS[target.kind], payload: {
    ...(target.kind === 'gap' ? { gapId: target.row.id } : {}), expectedGeneration: target.row?.generation, operationId, reason, evidence,
  } });
}
export function validateGlobalRecoveryAcknowledgement(result, retained) {
  const checked = validateRetainedGlobalRecovery(retained), p = checked.payload, receipt = result?.recoveryReceipt;
  if (!receipt || receipt.version !== 1 || receipt.operationId !== p.operationId || receipt.generation !== p.expectedGeneration) reject();
  if (checked.url === URLS.gap) {
    const fields = ['version', 'operationId', 'apiKeyId', 'kind', 'targetId', 'action', 'generation'];
    if (Object.keys(receipt).length !== fields.length || Object.keys(receipt).some(key => !fields.includes(key)) || receipt.apiKeyId !== null || receipt.kind !== 'gap' || receipt.targetId !== p.gapId || receipt.action !== 'coverage_waiver') reject();
  } else {
    const fields = ['version', 'kind', 'action', 'operationId', 'generation', 'releasedAt'];
    if (Object.keys(receipt).length !== fields.length || Object.keys(receipt).some(key => !fields.includes(key)) || receipt.kind !== 'maintenance' || receipt.action !== 'maintenance_release' || typeof receipt.releasedAt !== 'string' || !Number.isFinite(Date.parse(receipt.releasedAt)) || new Date(receipt.releasedAt).toISOString() !== receipt.releasedAt) reject();
  }
  // Current global health is deliberately not a receipt predicate: historical
  // ACK may coexist with a newer maintenance/gap which remains visibly blocked.
  return receipt;
}
