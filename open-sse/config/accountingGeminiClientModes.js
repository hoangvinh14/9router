export const ACCOUNTED_GEMINI_CLIENT_JSON_MODE = 'native-gemini-client-json';
export const ACCOUNTED_GEMINI_CLIENT_SSE_MODE = 'native-gemini-client-sse';
export const ACCOUNTED_GEMINI_CLIENT_MODES = Object.freeze([ACCOUNTED_GEMINI_CLIENT_JSON_MODE, ACCOUNTED_GEMINI_CLIENT_SSE_MODE]);
export const isGeminiClientMode = mode => ACCOUNTED_GEMINI_CLIENT_MODES.includes(mode);
