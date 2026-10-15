import { FORMATS } from '../translator/formats.js';
import { validateGeminiProcessingEvidence } from './accountingGeminiProcessingEvidence.js';
import { ACCOUNTING_GEMINI_OWNED_FILE_MODALITY_PROVENANCE, ACCOUNTING_GEMINI_MODALITY_PROVENANCE, ACCOUNTING_GEMINI_MODALITY_RATES } from './accountingGeminiModalityRates.js';
// Pure parsed-data grammar for client JSON drafts and already-guarded server
// snapshots. Never pass raw programmable provider objects to this function.
export function validateGeminiModalityRecoveryUsage(usage) {
  const record = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
  const count = value => Number.isSafeInteger(value) && value >= 0;
  const reject = () => { throw new Error('Invalid exact Gemini input modality authority'); };
  const parts = usage.inputModalities;
  const owned = usage.provenance?.inputModalities === ACCOUNTING_GEMINI_OWNED_FILE_MODALITY_PROVENANCE;
  if (!record(parts) || !owned && Object.keys(parts).length === 0 ||
      owned && (Object.hasOwn(usage, 'processingToolPromptTokens') || Object.hasOwn(usage, 'processingToolModalities') || Object.hasOwn(usage.provenance, 'videoProcessingToolPrompt')) ||
      usage.exact !== true || usage.reasoningIncludedInOutput !== false || usage.cacheWrite !== 0 ||
      !record(usage.provenance) || usage.provenance.schema !== FORMATS.GEMINI || usage.provenance.endpoint !== 'chat' || usage.provenance.inputIncludesCache !== true ||
      ![ACCOUNTING_GEMINI_MODALITY_PROVENANCE, ACCOUNTING_GEMINI_OWNED_FILE_MODALITY_PROVENANCE].includes(usage.provenance.inputModalities) ||
      Object.keys(usage).some(key => ['toolUses', 'nonBillableToolUses', 'codeToolUses', 'cacheWriteTiers', 'cacheWrite5m', 'cacheWrite1h'].includes(key)) ||
      Object.keys(usage.provenance).some(key => !['schema', 'endpoint', 'inputIncludesCache', 'inputModalities', 'videoProcessingToolPrompt'].includes(key))) reject();
  validateGeminiProcessingEvidence(usage);
  let input = 0n, cache = 0n;
  for (const [modality, row] of Object.entries(parts)) {
    if (!ACCOUNTING_GEMINI_MODALITY_RATES.some(item => item.modality === modality) || !record(row) || Object.keys(row).length !== 2 ||
        !Object.hasOwn(row, 'input') || !Object.hasOwn(row, 'cacheRead') || !count(row.input) || !count(row.cacheRead) || row.cacheRead > row.input) reject();
    input += BigInt(row.input); cache += BigInt(row.cacheRead);
  }
  if (!count(usage.input) || !count(usage.cacheRead) || input !== BigInt(usage.input) || cache !== BigInt(usage.cacheRead) ||
      !count(usage.output) || !count(usage.reasoning)) reject();
}
