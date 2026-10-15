// Internal queued observed processing tool-prompt modalities and preserved
// server-side traces. Not a gateway tool executor, resource or public grant.
export const ACCOUNTED_GEMINI_PROCESSING_TOOLS_JSON_MODE = 'native-gemini-processing-tools-json';
export const ACCOUNTED_GEMINI_PROCESSING_TOOLS_SSE_MODE = 'native-gemini-processing-tools-sse';
export const ACCOUNTED_GEMINI_PROCESSING_TOOLS_MODES = Object.freeze([ACCOUNTED_GEMINI_PROCESSING_TOOLS_JSON_MODE, ACCOUNTED_GEMINI_PROCESSING_TOOLS_SSE_MODE]);
export const isGeminiProcessingToolsMode = mode => ACCOUNTED_GEMINI_PROCESSING_TOOLS_MODES.includes(mode);
