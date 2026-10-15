// Explicit internal queued video processing with observed terminal tool-prompt
// zero only. Not full agentic tools/charges/resources or public/sync admission.
export const ACCOUNTED_GEMINI_VIDEO_PROCESSING_JSON_MODE = 'native-gemini-video-processing-json';
export const ACCOUNTED_GEMINI_VIDEO_PROCESSING_SSE_MODE = 'native-gemini-video-processing-sse';
export const ACCOUNTED_GEMINI_VIDEO_PROCESSING_MODES = Object.freeze([ACCOUNTED_GEMINI_VIDEO_PROCESSING_JSON_MODE, ACCOUNTED_GEMINI_VIDEO_PROCESSING_SSE_MODE]);
export const isGeminiVideoProcessingMode = mode => ACCOUNTED_GEMINI_VIDEO_PROCESSING_MODES.includes(mode);
