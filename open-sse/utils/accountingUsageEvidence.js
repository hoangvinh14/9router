import { FORMATS } from '../translator/formats.js';

// Diagnostic only: no exact flag, monetary amount, raw payload or recovery authority.
const REASONS = new Set(['missing_terminal', 'interrupted', 'cancelled', 'invalid_stream']);
const COUNTS = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'reasoningIncludedInOutput'];
const FIELDS = ['version', 'kind', 'schema', 'endpoint', 'reason', 'observedCounts'];
export function validateAccountingUsageEvidence(value) {
  const record = object => object && typeof object === 'object' && !Array.isArray(object);
  if (!record(value) || Object.keys(value).length !== FIELDS.length || Object.keys(value).some(key => !FIELDS.includes(key)) ||
      value.version !== 1 || value.kind !== 'raw_usage_observation' || value.schema !== FORMATS.OPENAI || value.endpoint !== 'chat' || !REASONS.has(value.reason)) throw new Error('Invalid accounting usage evidence');
  const counts = value.observedCounts;
  if (!record(counts) || Object.keys(counts).length !== COUNTS.length || Object.keys(counts).some(key => !COUNTS.includes(key)) ||
      counts.reasoningIncludedInOutput !== true || !COUNTS.slice(0, 5).every(key => Number.isSafeInteger(counts[key]) && counts[key] >= 0) ||
      BigInt(counts.cacheRead) + BigInt(counts.cacheWrite) > BigInt(counts.input) || counts.reasoning > counts.output) throw new Error('Invalid accounting usage evidence counts');
  return { version: 1, kind: 'raw_usage_observation', schema: FORMATS.OPENAI, endpoint: 'chat', reason: value.reason,
    observedCounts: Object.fromEntries(COUNTS.map(key => [key, counts[key]])) };
}
export function accountingUsageEvidence(usage, reason) {
  if (!usage) return null;
  return validateAccountingUsageEvidence({ version: 1, kind: 'raw_usage_observation', schema: FORMATS.OPENAI, endpoint: 'chat', reason,
    observedCounts: Object.fromEntries(COUNTS.map(key => [key, usage[key]])) });
}
