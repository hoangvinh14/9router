// Public GenerateContent Part grammar only, not model support, execution,
// processing-call usage, frame extraction or inferred monetary authority.
export const ACCOUNTING_GEMINI_VIDEO_PROCESSING_MODES = Object.freeze([
  'MEDIA_PROCESSING_UNSPECIFIED', 'STATIC', 'AGENTIC',
]);
export const supportsGeminiVideoProcessing = value => typeof value === 'string' && ACCOUNTING_GEMINI_VIDEO_PROCESSING_MODES.includes(value);
