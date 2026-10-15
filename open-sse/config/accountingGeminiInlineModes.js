export const ACCOUNTED_GEMINI_INLINE_JSON_MODE = 'native-gemini-inline-json';
export const ACCOUNTED_GEMINI_INLINE_SSE_MODE = 'native-gemini-inline-sse';
export const ACCOUNTED_GEMINI_INLINE_MODES = Object.freeze([ACCOUNTED_GEMINI_INLINE_JSON_MODE, ACCOUNTED_GEMINI_INLINE_SSE_MODE]);
export const isGeminiInlineMode = mode => ACCOUNTED_GEMINI_INLINE_MODES.includes(mode);
