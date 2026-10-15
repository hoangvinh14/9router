// Explicit internal queued legacy Part.videoMetadata modes only.
// Source-only video/default/public/synchronous modes do not inherit this grant.
export const ACCOUNTED_GEMINI_VIDEO_METADATA_JSON_MODE = 'native-gemini-video-metadata-json';
export const ACCOUNTED_GEMINI_VIDEO_METADATA_SSE_MODE = 'native-gemini-video-metadata-sse';
export const ACCOUNTED_GEMINI_VIDEO_METADATA_MODES = Object.freeze([ACCOUNTED_GEMINI_VIDEO_METADATA_JSON_MODE, ACCOUNTED_GEMINI_VIDEO_METADATA_SSE_MODE]);
export const isGeminiVideoMetadataMode = mode => ACCOUNTED_GEMINI_VIDEO_METADATA_MODES.includes(mode);
