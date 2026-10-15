import { types } from 'node:util';
import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';

import { ACCOUNTING_CODE_PROVENANCE, ACCOUNTING_CODE_COUNTER, ACCOUNTING_WEB_FETCH_PROVENANCE, ACCOUNTING_WEB_FETCH_COUNTER, ACCOUNTING_EMBEDDED_TOOL_PROVENANCE, ACCOUNTING_EMBEDDED_TOOL_RATES } from './accountingEmbeddedToolRates.js';
export { ACCOUNTING_EMBEDDED_TOOL_PROVENANCE, ACCOUNTING_EMBEDDED_TOOL_RATES } from './accountingEmbeddedToolRates.js';

export function snapshotExactCodeToolUsage(usage) {
  if (types.isProxy(usage)) throw new Error('Invalid exact included code usage');
  if (!Object.hasOwn(usage, 'codeToolUses')) {
    if ('codeToolUses' in usage) throw new Error('Invalid exact included code usage');
    return null;
  }
  const original = snapshotAccountingPreparedData(usage), tools = original.codeToolUses;
  if (!tools || typeof tools !== 'object' || Array.isArray(tools) || Object.keys(tools).length !== 1 ||
      !Object.hasOwn(tools, ACCOUNTING_CODE_COUNTER.count) || !Number.isSafeInteger(tools[ACCOUNTING_CODE_COUNTER.count]) || tools[ACCOUNTING_CODE_COUNTER.count] < 0 ||
      original.provenance?.codeServerToolUses !== ACCOUNTING_CODE_PROVENANCE) throw new Error('Invalid exact included code usage');
  return original;
}
export function snapshotExactNonBillableToolUsage(usage) {
  if (types.isProxy(usage)) throw new Error('Invalid exact nonbillable tool usage');
  if (!Object.hasOwn(usage, 'nonBillableToolUses')) {
    if ('nonBillableToolUses' in usage) throw new Error('Invalid exact nonbillable tool usage');
    return null;
  }
  const original = snapshotAccountingPreparedData(usage), tools = original.nonBillableToolUses;
  if (!tools || typeof tools !== 'object' || Array.isArray(tools) || Object.keys(tools).length !== 1 ||
      !Object.hasOwn(tools, ACCOUNTING_WEB_FETCH_COUNTER.count) || !Number.isSafeInteger(tools[ACCOUNTING_WEB_FETCH_COUNTER.count]) || tools[ACCOUNTING_WEB_FETCH_COUNTER.count] < 0 ||
      original.provenance?.nonBillableServerToolUses !== ACCOUNTING_WEB_FETCH_PROVENANCE) throw new Error('Invalid exact nonbillable tool usage');
  return original;
}
export function snapshotExactEmbeddedToolUsage(usage) {
  if (types.isProxy(usage)) throw new Error('Invalid exact embedded tool usage');
  if (!Object.hasOwn(usage, 'toolUses')) {
    if ('toolUses' in usage) throw new Error('Invalid exact embedded tool usage');
    return null;
  }
  // Refuse getters/proxies/toJSON before reading counts or inclusion provenance.
  const original = snapshotAccountingPreparedData(usage);
  const tools = original.toolUses;
  if (!tools || typeof tools !== 'object' || Array.isArray(tools) ||
      original.provenance?.serverToolUses !== ACCOUNTING_EMBEDDED_TOOL_PROVENANCE ||
      Object.keys(tools).length !== ACCOUNTING_EMBEDDED_TOOL_RATES.length ||
      ACCOUNTING_EMBEDDED_TOOL_RATES.some(({ count }) => !Object.hasOwn(tools, count) ||
        !Number.isSafeInteger(tools[count]) || tools[count] < 0)) {
    throw new Error('Invalid exact embedded tool usage');
  }
  return original;
}
