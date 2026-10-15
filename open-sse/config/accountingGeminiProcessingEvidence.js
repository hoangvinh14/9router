import { FORMATS } from '../translator/formats.js';
import { ACCOUNTING_GEMINI_MODALITY_PROVENANCE } from './accountingGeminiModalityRates.js';
import { ACCOUNTING_GEMINI_PROCESSING_MODALITY_PROVENANCE, ACCOUNTING_GEMINI_PROCESSING_RATES } from './accountingGeminiProcessingRates.js';
// Pure grammar for parsed/guarded evidence only. This is observed zero tool
// prompt tokens, not a free processing-call/hosted-tool rate contract.
export const ACCOUNTING_GEMINI_PROCESSING_ZERO_PROVENANCE = 'observed_gemini_video_processing_tool_prompt_zero';
export function validateGeminiProcessingEvidence(usage) {
  const count = Object.hasOwn(usage, 'processingToolPromptTokens');
  const marker = usage.provenance && Object.hasOwn(usage.provenance, 'videoProcessingToolPrompt');
  const details = Object.hasOwn(usage, 'processingToolModalities');
  const reject = () => { throw new Error('Invalid exact Gemini processing evidence'); };
  if (!count && !marker && !details) return false;
  if (!count || !marker || !Object.hasOwn(usage, 'inputModalities') || usage.provenance.inputModalities !== ACCOUNTING_GEMINI_MODALITY_PROVENANCE ||
      usage.provenance.schema !== FORMATS.GEMINI || usage.provenance.endpoint !== 'chat') reject();
  if (usage.provenance.videoProcessingToolPrompt === ACCOUNTING_GEMINI_PROCESSING_ZERO_PROVENANCE) {
    if (usage.processingToolPromptTokens !== 0 || details) reject();
    return true;
  }
  if (usage.provenance.videoProcessingToolPrompt !== ACCOUNTING_GEMINI_PROCESSING_MODALITY_PROVENANCE || !details ||
      !Number.isSafeInteger(usage.processingToolPromptTokens) || usage.processingToolPromptTokens < 0 ||
      !usage.processingToolModalities || Array.isArray(usage.processingToolModalities) || Object.getPrototypeOf(usage.processingToolModalities) !== Object.prototype) reject();
  let total = 0n;
  for (const [modality, tokens] of Object.entries(usage.processingToolModalities)) {
    if (!ACCOUNTING_GEMINI_PROCESSING_RATES.some(row => row.modality === modality) || !Number.isSafeInteger(tokens) || tokens < 0) reject();
    total += BigInt(tokens);
  }
  if (total !== BigInt(usage.processingToolPromptTokens)) reject();
  return true;
}
