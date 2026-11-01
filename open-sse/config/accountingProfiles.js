// Closed protocol identifiers: persisted selection chooses these, never client input.
export const RESPONSES_EXPLICIT_USAGE_PROFILE = 'openai-responses-explicit-details';
export const RESPONSES_ACCOUNTING_REQUEST_FIELDS = Object.freeze(['model','input','instructions','stream','store','tools','tool_choice',
  'parallel_tool_calls','temperature','top_p','max_output_tokens','reasoning','text','metadata','user','safety_identifier','prompt_cache_key']);
export const RESPONSES_ACCOUNTING_USAGE_FIELDS = Object.freeze(['input_tokens','output_tokens','total_tokens','input_tokens_details','output_tokens_details']);
export const RESPONSES_ACCOUNTING_CHAT_FIELDS = Object.freeze(['model','messages','stream','tools','tool_choice','parallel_tool_calls',
  'temperature','top_p','max_tokens','max_completion_tokens','max_output_tokens','reasoning','reasoning_effort','metadata','user','store','prompt_cache_key']);
const nativeBindings = new WeakSet();
export function bindNativeResponsesAccounting(binding) { nativeBindings.add(binding); return binding; }
export const isNativeResponsesAccounting = binding => !!binding && nativeBindings.has(binding);
