// Narrow native Responses JSON token-only contract; not SSE/OAuth approval.
export const ACCOUNTING_RESPONSES_OBJECT = 'response';
export const ACCOUNTING_RESPONSES_COMPLETE = 'completed';
export const ACCOUNTING_RESPONSES_TIER = 'default';
export const ACCOUNTING_RESPONSES_USAGE_FIELDS = Object.freeze([
  'input_tokens', 'output_tokens', 'total_tokens', 'input_tokens_details', 'output_tokens_details',
]);
export const ACCOUNTING_RESPONSES_INPUT_DETAILS = Object.freeze(['cached_tokens']);
export const ACCOUNTING_RESPONSES_OUTPUT_DETAILS = Object.freeze(['reasoning_tokens']);
export const ACCOUNTING_RESPONSES_MESSAGE_FIELDS = Object.freeze(['id', 'type', 'role', 'status', 'content']);
export const ACCOUNTING_RESPONSES_TEXT_FIELDS = Object.freeze(['type', 'text', 'annotations']);
export const ACCOUNTING_RESPONSES_FUNCTION_FIELDS = Object.freeze(['id', 'type', 'status', 'call_id', 'name', 'arguments']);
export const ACCOUNTING_RESPONSES_REASONING_FIELDS = Object.freeze(['id', 'type', 'summary', 'encrypted_content', 'status']);
export const ACCOUNTING_RESPONSES_SUMMARY_FIELDS = Object.freeze(['type', 'text']);
