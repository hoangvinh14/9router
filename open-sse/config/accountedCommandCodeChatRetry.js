// Internal request-local opt-in; no application routing/activation permission.
export const ACCOUNTED_COMMANDCODE_CHAT_RETRY_MODE = 'chat-commandcode-ndjson-retry';
export const ACCOUNTED_COMMANDCODE_CHAT_RETRY_LIMIT = 2;
export const ACCOUNTED_COMMANDCODE_CHAT_RETRY_DELAY_MS = 1000;
export const ACCOUNTED_COMMANDCODE_CHAT_RETRY_STATUSES = Object.freeze([502, 503, 504]);
