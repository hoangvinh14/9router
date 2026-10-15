// Internal queued original video modes only, not public/synchronous activation.
export const ACCOUNTED_GEMINI_VIDEO_JSON_MODE = 'native-gemini-video-json';
export const ACCOUNTED_GEMINI_VIDEO_SSE_MODE = 'native-gemini-video-sse';
export const ACCOUNTED_GEMINI_VIDEO_MODES = Object.freeze([ACCOUNTED_GEMINI_VIDEO_JSON_MODE, ACCOUNTED_GEMINI_VIDEO_SSE_MODE]);
export const isGeminiVideoMode = mode => ACCOUNTED_GEMINI_VIDEO_MODES.includes(mode);
