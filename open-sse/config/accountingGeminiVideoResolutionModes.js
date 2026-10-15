// Internal queued video resolution modes, not inherited default/public/sync grants.
export const ACCOUNTED_GEMINI_VIDEO_RESOLUTION_JSON_MODE = 'native-gemini-video-resolution-json';
export const ACCOUNTED_GEMINI_VIDEO_RESOLUTION_SSE_MODE = 'native-gemini-video-resolution-sse';
export const ACCOUNTED_GEMINI_VIDEO_RESOLUTION_MODES = Object.freeze([ACCOUNTED_GEMINI_VIDEO_RESOLUTION_JSON_MODE, ACCOUNTED_GEMINI_VIDEO_RESOLUTION_SSE_MODE]);
export const isGeminiVideoResolutionMode = mode => ACCOUNTED_GEMINI_VIDEO_RESOLUTION_MODES.includes(mode);
