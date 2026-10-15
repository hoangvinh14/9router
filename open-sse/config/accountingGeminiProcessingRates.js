// Explicit operator reference rates for observed loaded tool-prompt tokens.
// Never infer prices from input rates, processing mode, calls or public tables.
export const ACCOUNTING_GEMINI_PROCESSING_MODALITY_PROVENANCE = 'observed_gemini_video_processing_tool_prompt_modalities';
export const ACCOUNTING_GEMINI_PROCESSING_RATE_UNIT = 'USD/1M tokens';
export const ACCOUNTING_GEMINI_PROCESSING_RATES = Object.freeze([
  Object.freeze({ modality: 'TEXT', rate: 'processing_tool_text' }),
  Object.freeze({ modality: 'IMAGE', rate: 'processing_tool_image' }),
  Object.freeze({ modality: 'DOCUMENT', rate: 'processing_tool_document' }),
  Object.freeze({ modality: 'AUDIO', rate: 'processing_tool_audio' }),
  Object.freeze({ modality: 'VIDEO', rate: 'processing_tool_video' }),
]);
export const ACCOUNTING_GEMINI_PROCESSING_RATE_FIELDS = Object.freeze(ACCOUNTING_GEMINI_PROCESSING_RATES.map(({ rate }) => rate));
