// Separate internal complete-original wire only. Metadata inventory is not
// gateway tenant/upload/current lifecycle authority or public admission.
export const ACCOUNTED_GEMINI_OWNED_FILES_JSON_MODE = 'native-gemini-owned-files-json';
export const ACCOUNTED_GEMINI_OWNED_FILES_SSE_MODE = 'native-gemini-owned-files-sse';
export const ACCOUNTED_GEMINI_OWNED_FILES_MODES = Object.freeze([ACCOUNTED_GEMINI_OWNED_FILES_JSON_MODE, ACCOUNTED_GEMINI_OWNED_FILES_SSE_MODE]);
export const isGeminiOwnedFilesMode = mode => ACCOUNTED_GEMINI_OWNED_FILES_MODES.includes(mode);
// Independent owned-resource videoMetadata wire grammar. Old source-only and
// plain owned-file modes do not inherit this permission.
export const ACCOUNTED_GEMINI_OWNED_VIDEO_METADATA_JSON_MODE = 'native-gemini-owned-video-metadata-json';
export const ACCOUNTED_GEMINI_OWNED_VIDEO_METADATA_SSE_MODE = 'native-gemini-owned-video-metadata-sse';
export const ACCOUNTED_GEMINI_OWNED_VIDEO_METADATA_MODES = Object.freeze([ACCOUNTED_GEMINI_OWNED_VIDEO_METADATA_JSON_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_METADATA_SSE_MODE]);
export const isGeminiOwnedVideoMetadataMode = mode => ACCOUNTED_GEMINI_OWNED_VIDEO_METADATA_MODES.includes(mode) || isGeminiOwnedVideoCombinedMode(mode) || isGeminiOwnedVideoClientMode(mode);
// Independent resolution-only grammar; this does not grant videoMetadata,
// private resource ownership, usage, pricing or dispatch admission.
export const ACCOUNTED_GEMINI_OWNED_VIDEO_RESOLUTION_JSON_MODE = 'native-gemini-owned-video-resolution-json';
export const ACCOUNTED_GEMINI_OWNED_VIDEO_RESOLUTION_SSE_MODE = 'native-gemini-owned-video-resolution-sse';
export const ACCOUNTED_GEMINI_OWNED_VIDEO_RESOLUTION_MODES = Object.freeze([ACCOUNTED_GEMINI_OWNED_VIDEO_RESOLUTION_JSON_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_RESOLUTION_SSE_MODE]);
export const isGeminiOwnedVideoResolutionMode = mode => ACCOUNTED_GEMINI_OWNED_VIDEO_RESOLUTION_MODES.includes(mode) || isGeminiOwnedVideoCombinedMode(mode) || isGeminiOwnedVideoClientMode(mode);
// Explicit composition requires BOTH independently issued private grants.
// Neither single-control mode inherits the other grant, even without controls.
export const ACCOUNTED_GEMINI_OWNED_VIDEO_COMBINED_JSON_MODE = 'native-gemini-owned-video-metadata-resolution-json';
export const ACCOUNTED_GEMINI_OWNED_VIDEO_COMBINED_SSE_MODE = 'native-gemini-owned-video-metadata-resolution-sse';
export const ACCOUNTED_GEMINI_OWNED_VIDEO_COMBINED_MODES = Object.freeze([ACCOUNTED_GEMINI_OWNED_VIDEO_COMBINED_JSON_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_COMBINED_SSE_MODE]);
export const isGeminiOwnedVideoCombinedMode = mode => ACCOUNTED_GEMINI_OWNED_VIDEO_COMBINED_MODES.includes(mode);
// Explicit client-history composition requires a THIRD independent private grant.
// No prior mode array or combined-controls predicate inherits client permission.
export const ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_JSON_MODE = 'native-gemini-owned-video-client-controls-json';
export const ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_SSE_MODE = 'native-gemini-owned-video-client-controls-sse';
export const ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_MODES = Object.freeze([ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_JSON_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_SSE_MODE]);
export const isGeminiOwnedVideoClientMode = mode => ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_MODES.includes(mode) || isGeminiOwnedVideoClientInlineMode(mode);
// FOUR independent grants, even when inline/client request controls are absent.
// Prior single/client arrays remain unchanged and cannot launder this permission.
export const ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_JSON_MODE = 'native-gemini-owned-video-client-inline-controls-json';
export const ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_SSE_MODE = 'native-gemini-owned-video-client-inline-controls-sse';
export const ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_MODES = Object.freeze([ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_JSON_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_SSE_MODE]);
export const isGeminiOwnedVideoClientInlineMode = mode => ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_MODES.includes(mode) || isGeminiOwnedVideoClientInlineAudioMode(mode);
// FIFTH independent private grant. Owned AUDIO/video resources and inline
// image/PDF permission do not authorize source inline audio, even if absent.
export const ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_JSON_MODE = 'native-gemini-owned-video-client-inline-audio-controls-json';
export const ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_SSE_MODE = 'native-gemini-owned-video-client-inline-audio-controls-sse';
export const ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_MODES = Object.freeze([ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_JSON_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_SSE_MODE]);
export const isGeminiOwnedVideoClientInlineAudioMode = mode => ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_MODES.includes(mode) || isGeminiOwnedVideoClientInlineAudioVideoMode(mode);
// SIXTH independent private grant; owned VIDEO and inline audio do not grant
// source inline video. Existing mode arrays remain unchanged, including absent video.
export const ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_VIDEO_JSON_MODE = 'native-gemini-owned-video-client-inline-audio-video-controls-json';
export const ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_VIDEO_SSE_MODE = 'native-gemini-owned-video-client-inline-audio-video-controls-sse';
export const ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_VIDEO_MODES = Object.freeze([ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_VIDEO_JSON_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_VIDEO_SSE_MODE]);
export const isGeminiOwnedVideoClientInlineAudioVideoMode = mode => ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_VIDEO_MODES.includes(mode);
