import { CLAUDE_BLOCK } from '../translator/schema/blocks.js';

// Explicit buffered Messages protocol candidate; no provider/transport approval.
export const CLAUDE_ACCOUNTING_MESSAGE_TYPE = 'message';
export const CLAUDE_ACCOUNTING_EVENT = Object.freeze({
  START: 'message_start', DELTA: 'message_delta', STOP: 'message_stop',
  BLOCK_START: 'content_block_start', BLOCK_DELTA: 'content_block_delta', BLOCK_STOP: 'content_block_stop', PING: 'ping',
});
export const CLAUDE_ACCOUNTING_USAGE_FIELDS = Object.freeze([
  'input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'cache_creation', 'server_tool_use',
]);
export const CLAUDE_ACCOUNTING_EVENT_FIELDS = Object.freeze({
  message_start: ['type', 'message'], message_delta: ['type', 'delta', 'usage'], message_stop: ['type'], ping: ['type'],
  content_block_start: ['type', 'index', 'content_block'], content_block_delta: ['type', 'index', 'delta'], content_block_stop: ['type', 'index'],
});
export const CLAUDE_ACCOUNTING_MESSAGE_FIELDS = Object.freeze(['id', 'type', 'role', 'model', 'content', 'usage', 'stop_reason', 'stop_sequence']);
export const CLAUDE_ACCOUNTING_MESSAGE_DELTA_FIELDS = Object.freeze(['stop_reason', 'stop_sequence']);
export const CLAUDE_ACCOUNTING_BLOCK_DELTAS = Object.freeze({
  [CLAUDE_BLOCK.TEXT]: Object.freeze({ text_delta: 'text' }),
  [CLAUDE_BLOCK.THINKING]: Object.freeze({ thinking_delta: 'thinking', signature_delta: 'signature' }),
  [CLAUDE_BLOCK.REDACTED_THINKING]: Object.freeze({}),
  [CLAUDE_BLOCK.TOOL_USE]: Object.freeze({ input_json_delta: 'partial_json' }),
});
export const CLAUDE_ACCOUNTING_BLOCK_FIELDS = Object.freeze({
  [CLAUDE_BLOCK.TEXT]: Object.freeze(['type', 'text']),
  [CLAUDE_BLOCK.THINKING]: Object.freeze(['type', 'thinking', 'signature']),
  [CLAUDE_BLOCK.REDACTED_THINKING]: Object.freeze(['type', 'data']),
  [CLAUDE_BLOCK.TOOL_USE]: Object.freeze(['type', 'id', 'name', 'input']),
});
// Bound observations as well as bytes; not a concurrency/dispatch work limit.
export const CLAUDE_ACCOUNTING_MAX_EVENTS = 16_384;
// Live client-tool JSON is retained only for its open block, not the message.
export const CLAUDE_ACCOUNTING_TOOL_INPUT_MAX_BYTES = 20 * 1024 * 1024;
// Retain only an open signature's byte count, not thinking text or a transcript.
export const CLAUDE_ACCOUNTING_SIGNATURE_MAX_BYTES = 128 * 1024;
export const CLAUDE_ACCOUNTING_THINKING_TYPES = Object.freeze(['enabled', 'disabled', 'adaptive']);
export const CLAUDE_ACCOUNTING_THINKING_DISPLAYS = Object.freeze(['summarized', 'omitted']);
export const CLAUDE_ACCOUNTING_EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);
