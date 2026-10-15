// Pure/client-safe typed reference units. No production rates, provider
// admission, raw protocol authority or presumed free-tool category.
export const ACCOUNTING_EMBEDDED_TOOL_PROVENANCE = 'observed_claude_server_tool_use';
export const ACCOUNTING_EMBEDDED_TOOL_RATES = Object.freeze([
  Object.freeze({ count: 'webSearchRequests', rawCounter: 'web_search_requests', rate: 'web_search_per_1000',
    unit: 'USD/1000 uses', usesPerUnit: 1000n }),
]);
// Documented web-fetch operation category: token-only, not a guessed0 rate.
// Original version/protocol owner must opt in before positive counters accepted.
export const ACCOUNTING_WEB_FETCH_PROVENANCE = 'observed_claude_web_fetch_token_only';
export const ACCOUNTING_WEB_FETCH_COUNTER = Object.freeze({ count: 'webFetchRequests', rawCounter: 'web_fetch_requests' });
// Included-code regime must come from validated original versions; request
// quantity never supplies standalone duration or container ownership.
export const ACCOUNTING_CODE_PROVENANCE = 'observed_claude_included_code_token_only';
export const ACCOUNTING_CODE_COUNTER = Object.freeze({ count: 'codeExecutionRequests', rawCounter: 'code_execution_requests' });
export const ACCOUNTING_EMBEDDED_RATE_FIELDS = Object.freeze(ACCOUNTING_EMBEDDED_TOOL_RATES.map(({ rate }) => rate));
