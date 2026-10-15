// Operator reference contracts, not upstream list prices or modality equivalence.
// All selected observed categories require explicit input and cache rates, even 0.
export const ACCOUNTING_GEMINI_MODALITY_PROVENANCE = 'observed_gemini_inline_input_modalities';
export const ACCOUNTING_GEMINI_OWNED_FILE_MODALITY_PROVENANCE = 'observed_gemini_owned_file_input_modalities';
export const ACCOUNTING_GEMINI_MODALITY_RATE_UNIT = 'USD/1M tokens';
export const ACCOUNTING_GEMINI_MODALITY_RATES = Object.freeze([
  Object.freeze({ modality: 'TEXT', input: 'input', cached: 'cached' }),
  Object.freeze({ modality: 'IMAGE', input: 'input_image', cached: 'cached_image' }),
  Object.freeze({ modality: 'DOCUMENT', input: 'input_document', cached: 'cached_document' }),
  Object.freeze({ modality: 'AUDIO', input: 'input_audio', cached: 'cached_audio' }),
  Object.freeze({ modality: 'VIDEO', input: 'input_video', cached: 'cached_video' }),
]);
export const ACCOUNTING_GEMINI_MODALITY_RATE_FIELDS = Object.freeze(ACCOUNTING_GEMINI_MODALITY_RATES
  .filter(item => item.modality !== 'TEXT').flatMap(item => [item.input, item.cached]));
