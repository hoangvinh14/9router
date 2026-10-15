// Explicit internal queued input-audio resolution modes only.
// No inherited default/public/synchronous or image/video resolution permission.
export const ACCOUNTED_GEMINI_AUDIO_RESOLUTION_JSON_MODE = 'native-gemini-audio-resolution-json';
export const ACCOUNTED_GEMINI_AUDIO_RESOLUTION_SSE_MODE = 'native-gemini-audio-resolution-sse';
export const ACCOUNTED_GEMINI_AUDIO_RESOLUTION_MODES = Object.freeze([ACCOUNTED_GEMINI_AUDIO_RESOLUTION_JSON_MODE, ACCOUNTED_GEMINI_AUDIO_RESOLUTION_SSE_MODE]);
export const isGeminiAudioResolutionMode = mode => ACCOUNTED_GEMINI_AUDIO_RESOLUTION_MODES.includes(mode);
