// Explicit internal queued image/PDF resolution modes only.
// No inherited default/public/synchronous or audio/video resolution permission.
export const ACCOUNTED_GEMINI_INLINE_RESOLUTION_JSON_MODE = 'native-gemini-inline-resolution-json';
export const ACCOUNTED_GEMINI_INLINE_RESOLUTION_SSE_MODE = 'native-gemini-inline-resolution-sse';
export const ACCOUNTED_GEMINI_INLINE_RESOLUTION_MODES = Object.freeze([ACCOUNTED_GEMINI_INLINE_RESOLUTION_JSON_MODE, ACCOUNTED_GEMINI_INLINE_RESOLUTION_SSE_MODE]);
export const isGeminiInlineResolutionMode = mode => ACCOUNTED_GEMINI_INLINE_RESOLUTION_MODES.includes(mode);
