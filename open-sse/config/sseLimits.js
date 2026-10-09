// Gemini transport framing bounds, in UTF-16 code units after UTF-8 decoding.
// Both a partial line and the accumulated data fields of one event are bounded.
export const SSE_EVENT_MAX_CODE_UNITS = 1024 * 1024;
