// Explicit raw Claude server-tool counters recognized by token-only accounting.
// Recognition does NOT price these tools: only observed numeric zero is allowed.
// New keys need a schema/pricing review, never an implicit free-tool assumption.
export const CLAUDE_TOKEN_ONLY_SERVER_TOOL_COUNTERS = Object.freeze([
  'web_search_requests',
  'web_fetch_requests',
]);
