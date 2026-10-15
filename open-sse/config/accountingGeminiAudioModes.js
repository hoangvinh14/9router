export const ACCOUNTED_GEMINI_AUDIO_JSON_MODE = 'native-gemini-audio-json';
export const ACCOUNTED_GEMINI_AUDIO_SSE_MODE = 'native-gemini-audio-sse';
export const ACCOUNTED_GEMINI_AUDIO_MODES = Object.freeze([ACCOUNTED_GEMINI_AUDIO_JSON_MODE, ACCOUNTED_GEMINI_AUDIO_SSE_MODE]);
export const isGeminiAudioMode = mode => ACCOUNTED_GEMINI_AUDIO_MODES.includes(mode);
