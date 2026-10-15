import { FORMATS } from '../translator/formats.js';
import { validateGeminiProcessingEvidence } from './accountingGeminiProcessingEvidence.js';
import { validateGeminiModalityRecoveryUsage } from './accountingGeminiModalityRecovery.js';
import { ACCOUNTING_CODE_PROVENANCE, ACCOUNTING_CODE_COUNTER, ACCOUNTING_WEB_FETCH_PROVENANCE, ACCOUNTING_WEB_FETCH_COUNTER, ACCOUNTING_EMBEDDED_TOOL_PROVENANCE, ACCOUNTING_EMBEDDED_TOOL_RATES } from './accountingEmbeddedToolRates.js';

// Pure schema check for parsed operator JSON, not raw provider/POST authority.
// Server callers must guard programmable objects before invoking this helper.
export function validateEmbeddedRecoveryUsage(usage) {
  validateGeminiProcessingEvidence(usage);
  if (Object.hasOwn(usage, 'inputModalities') || usage.provenance && Object.hasOwn(usage.provenance, 'inputModalities')) {
    validateGeminiModalityRecoveryUsage(usage); return;
  }
  const hasTools = Object.hasOwn(usage, 'toolUses'), hasNonBillable = Object.hasOwn(usage, 'nonBillableToolUses'), hasCode = Object.hasOwn(usage, 'codeToolUses'), hasProvenance = Object.hasOwn(usage, 'provenance');
  if (!hasTools && !hasNonBillable && !hasCode && !hasProvenance) return;
  const record = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
  const tools = usage.toolUses, nonBillable = usage.nonBillableToolUses, code = usage.codeToolUses, provenance = usage.provenance;
  if ((!hasTools && !hasNonBillable && !hasCode) || !hasProvenance || !record(provenance) ||
      hasTools && (!record(tools) || Object.keys(tools).length !== ACCOUNTING_EMBEDDED_TOOL_RATES.length ||
        ACCOUNTING_EMBEDDED_TOOL_RATES.some(({ count }) => !Object.hasOwn(tools, count) || !Number.isSafeInteger(tools[count]) || tools[count] < 0) ||
        provenance.serverToolUses !== ACCOUNTING_EMBEDDED_TOOL_PROVENANCE) ||
      !hasTools && Object.hasOwn(provenance, 'serverToolUses') ||
      hasNonBillable && (!record(nonBillable) || Object.keys(nonBillable).length !== 1 || !Object.hasOwn(nonBillable, ACCOUNTING_WEB_FETCH_COUNTER.count) ||
        !Number.isSafeInteger(nonBillable[ACCOUNTING_WEB_FETCH_COUNTER.count]) || nonBillable[ACCOUNTING_WEB_FETCH_COUNTER.count] < 0 ||
        provenance.nonBillableServerToolUses !== ACCOUNTING_WEB_FETCH_PROVENANCE) ||
      !hasNonBillable && Object.hasOwn(provenance, 'nonBillableServerToolUses') ||
      hasCode && (!record(code) || Object.keys(code).length !== 1 || !Object.hasOwn(code, ACCOUNTING_CODE_COUNTER.count) ||
        !Number.isSafeInteger(code[ACCOUNTING_CODE_COUNTER.count]) || code[ACCOUNTING_CODE_COUNTER.count] < 0 || provenance.codeServerToolUses !== ACCOUNTING_CODE_PROVENANCE) ||
      !hasCode && Object.hasOwn(provenance, 'codeServerToolUses') ||
      Object.keys(provenance).some(key => !['schema', 'endpoint', 'inputIncludesCache', 'serverToolUses', 'nonBillableServerToolUses', 'codeServerToolUses'].includes(key)) ||
      provenance.schema !== undefined && provenance.schema !== FORMATS.CLAUDE ||
      provenance.endpoint !== undefined && provenance.endpoint !== 'chat' ||
      provenance.inputIncludesCache !== undefined && provenance.inputIncludesCache !== true) throw new Error('Invalid exact embedded recovery usage');
}
