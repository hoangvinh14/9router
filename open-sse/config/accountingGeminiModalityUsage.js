import { types } from 'node:util';
import { ACCOUNTING_GEMINI_PROCESSING_ZERO_PROVENANCE, validateGeminiProcessingEvidence } from './accountingGeminiProcessingEvidence.js';
import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { ACCOUNTING_GEMINI_PROCESSING_MODALITY_PROVENANCE, ACCOUNTING_GEMINI_PROCESSING_RATES, ACCOUNTING_GEMINI_PROCESSING_RATE_UNIT } from './accountingGeminiProcessingRates.js';
import { validateGeminiModalityRecoveryUsage } from './accountingGeminiModalityRecovery.js';
import { ACCOUNTING_GEMINI_OWNED_FILE_MODALITY_PROVENANCE, ACCOUNTING_GEMINI_MODALITY_PROVENANCE, ACCOUNTING_GEMINI_MODALITY_RATES, ACCOUNTING_GEMINI_MODALITY_RATE_UNIT } from './accountingGeminiModalityRates.js';
const reject = () => { throw new Error('Invalid exact Gemini input modality authority'); };
export function snapshotExactGeminiModalityUsage(value) {
  if (!recordWithoutReads(value)) reject();
  // A marker without the category and an inherited category are not legacy usage.
  const descriptor = Object.getOwnPropertyDescriptor(value, 'inputModalities');
  if (!descriptor && !('inputModalities' in value)) {
    const provenanceDescriptor = Object.getOwnPropertyDescriptor(value, 'provenance');
    if (provenanceDescriptor && !('value' in provenanceDescriptor)) reject();
    const provenance = provenanceDescriptor?.value;
    if ('processingToolPromptTokens' in value || 'processingToolModalities' in value || provenance && (!recordWithoutReads(provenance) || 'inputModalities' in provenance || 'videoProcessingToolPrompt' in provenance)) reject();
    return null;
  }
  const usage = snapshotAccountingPreparedData(value);
  validateGeminiModalityRecoveryUsage(usage);
  return usage;
}
function recordWithoutReads(value) {
  return !!value && typeof value === 'object' && !types.isProxy(value) && !Array.isArray(value);
}
export function validateGeminiModalitySnapshot(usage, snapshot) {
  const exact = snapshotExactGeminiModalityUsage(usage), marker = snapshot.usageSemantics?.inputModalities;
  const processingMarker = snapshot.usageSemantics?.videoProcessingToolPrompt;
  const processingRequired = snapshot.usageSemantics && Object.hasOwn(snapshot.usageSemantics, 'videoProcessingToolPrompt');
  if (processingRequired && (![ACCOUNTING_GEMINI_PROCESSING_ZERO_PROVENANCE, ACCOUNTING_GEMINI_PROCESSING_MODALITY_PROVENANCE].includes(processingMarker) || !exact || !validateGeminiProcessingEvidence(exact) || exact.provenance.videoProcessingToolPrompt !== processingMarker) ||
      !processingRequired && exact && validateGeminiProcessingEvidence(exact)) reject();
  if (processingMarker === ACCOUNTING_GEMINI_PROCESSING_MODALITY_PROVENANCE) {
    const categories = snapshot.usageSemantics.allowedProcessingToolModalities;
    if (!Array.isArray(categories) || !Array.isArray(snapshot.usageSemantics.allowedInputModalities) || !categories.length || new Set(categories).size !== categories.length ||
        categories.length !== snapshot.usageSemantics.allowedInputModalities.length ||
        categories.some(modality => !ACCOUNTING_GEMINI_PROCESSING_RATES.some(row => row.modality === modality) || !snapshot.usageSemantics.allowedInputModalities?.includes(modality)) ||
        Object.keys(exact.processingToolModalities).some(modality => !categories.includes(modality))) reject();
    for (const modality of categories) {
      const { rate } = ACCOUNTING_GEMINI_PROCESSING_RATES.find(row => row.modality === modality);
      if (!Object.hasOwn(snapshot.rates || {}, rate) || snapshot.rateUnits?.[rate] !== ACCOUNTING_GEMINI_PROCESSING_RATE_UNIT) reject();
    }
  } else if (snapshot.usageSemantics && Object.hasOwn(snapshot.usageSemantics, 'allowedProcessingToolModalities')) reject();
  if (marker === undefined && !exact) return null;
  if (!exact || ![ACCOUNTING_GEMINI_MODALITY_PROVENANCE, ACCOUNTING_GEMINI_OWNED_FILE_MODALITY_PROVENANCE].includes(marker) || marker !== exact.provenance.inputModalities) reject();
  const allowed = validateGeminiInputRateCategories(snapshot);
  if (Object.keys(exact.inputModalities).some(modality => !allowed.includes(modality))) reject();
  return exact;
}
// Original required-category/unit authority only. Never manufactures usage to
// validate prices. Lexical monetary validation remains the shared money owner.
export function validateGeminiInputRateCategories(value) {
  const snapshot = snapshotAccountingPreparedData(value);
  if (![ACCOUNTING_GEMINI_MODALITY_PROVENANCE, ACCOUNTING_GEMINI_OWNED_FILE_MODALITY_PROVENANCE].includes(snapshot.usageSemantics?.inputModalities)) reject();
  const allowed = snapshot.usageSemantics.allowedInputModalities;
  if (!Array.isArray(allowed) || allowed.length === 0 || new Set(allowed).size !== allowed.length ||
      allowed.some(modality => !ACCOUNTING_GEMINI_MODALITY_RATES.some(item => item.modality === modality))) reject();
  for (const modality of allowed) {
    const definition = ACCOUNTING_GEMINI_MODALITY_RATES.find(item => item.modality === modality);
    for (const key of [definition.input, definition.cached]) {
      if (!Object.hasOwn(snapshot.rates || {}, key) || snapshot.rateUnits?.[key] !== ACCOUNTING_GEMINI_MODALITY_RATE_UNIT) reject();
    }
  }
  return allowed;
}
