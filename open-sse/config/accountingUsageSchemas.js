// Explicit raw Claude server-tool counters recognized by token-only accounting.
// Recognition does NOT price these tools: only observed numeric zero is allowed.
// New keys need a schema/pricing review, never an implicit free-tool assumption.
// Initial CommandCode token-only raw slice. All fields must be explicit;
// cache/reasoning recognition permits only zero, not absent/defaulted billing.
export const COMMANDCODE_TOKEN_ONLY_USAGE_FIELDS = Object.freeze([
  'inputTokens', 'outputTokens', 'totalTokens', 'cachedInputTokens', 'reasoningTokens',
]);

// Selected Kiro raw metrics prerequisite, NOT a guarantee of upstream shape.
// Every counter must be explicit; cache/reasoning recognition is zero-only.
export const KIRO_TOKEN_ONLY_USAGE_FIELDS = Object.freeze([
  'inputTokens', 'outputTokens', 'totalTokens', 'cacheReadInputTokens',
  'cacheCreationInputTokens', 'reasoningTokens',
]);

// Gemini embedContent/batchEmbedContents EmbeddingUsageMetadata, not chat
// UsageMetadata. Raw text-only counts; response/EOF/POST authority is separate.
export const GEMINI_EMBEDDING_USAGE_FIELDS = Object.freeze(['promptTokenCount', 'promptTokenDetails']);
export const GEMINI_EMBEDDING_DETAIL_FIELDS = Object.freeze(['modality', 'tokenCount']);

export const CLAUDE_TOKEN_ONLY_SERVER_TOOL_COUNTERS = Object.freeze([
  'web_search_requests',
  'web_fetch_requests',
]);
