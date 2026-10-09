// Bounded live raw OpenAI accounting. Not aggregate transport/allocation bounds.
export const ACCOUNTING_SSE_EVENT_MAX_BYTES = 1024 * 1024;
export const ACCOUNTING_SSE_CHUNK_MAX_BYTES = 2 * 1024 * 1024;
export const ACCOUNTING_SSE_TERMINAL_MAX_BYTES = 1024 * 1024;
export const ACCOUNTING_SSE_TERMINAL_MAX_EVENTS = 128;
export const ACCOUNTING_SSE_READY_MAX_EVENTS = 1024;
export const ACCOUNTING_SSE_READY_MAX_BYTES = 2 * 1024 * 1024;
export const ACCOUNTING_SSE_IDLE_MS = 30_000;
export const ACCOUNTING_SSE_POST_DONE_MS = 5_000;
