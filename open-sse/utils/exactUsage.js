import { FORMATS } from "../translator/formats.js";
import { CLAUDE_TOKEN_ONLY_SERVER_TOOL_COUNTERS } from '../config/accountingUsageSchemas.js';

const valid = value => Number.isSafeInteger(value) && value >= 0;
function optional(value) { return value === undefined ? 0 : value; }
// Only RAW provider metadata belongs here, before buffer/estimation/translation.
// Streaming callers must accumulate schema fields until terminal exact counts.
export function normalizeExactUsage(raw, schema, endpoint = "chat") {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.estimated || raw.buffered) return null;
  let input, output, cacheRead = 0, cacheWrite = 0, reasoning = 0, reasoningIncludedInOutput;
  if ([FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSE].includes(schema)) {
    const responses = schema !== FORMATS.OPENAI;
    input = responses ? raw.input_tokens : raw.prompt_tokens;
    output = endpoint === "embeddings" ? 0 : responses ? raw.output_tokens : raw.completion_tokens;
    if (endpoint === "embeddings" && (responses || !valid(raw.total_tokens) || raw.total_tokens !== input ||
        raw.completion_tokens !== undefined && raw.completion_tokens !== 0 || raw.output_tokens !== undefined && raw.output_tokens !== 0)) return null;
    cacheRead = optional(responses ? raw.input_tokens_details?.cached_tokens : raw.prompt_tokens_details?.cached_tokens !== undefined ? raw.prompt_tokens_details.cached_tokens : raw.prompt_cache_hit_tokens);
    const inputDetails = responses ? raw.input_tokens_details : raw.prompt_tokens_details;
    cacheWrite = optional(inputDetails?.cache_write_tokens !== undefined ? inputDetails.cache_write_tokens : inputDetails?.cache_creation_tokens);
    const outputDetails = responses ? raw.output_tokens_details : raw.completion_tokens_details;
    if (inputDetails?.audio_tokens !== undefined && inputDetails.audio_tokens !== 0 || outputDetails?.audio_tokens !== undefined && outputDetails.audio_tokens !== 0) return null;
    reasoning = optional(responses ? raw.output_tokens_details?.reasoning_tokens : raw.completion_tokens_details?.reasoning_tokens);
    reasoningIncludedInOutput = true;
    if (raw.prompt_cache_miss_tokens !== undefined && (!valid(raw.prompt_cache_miss_tokens) || raw.prompt_cache_miss_tokens + cacheRead !== input)) return null;
  } else if (schema === FORMATS.CLAUDE) {
    // Absent metadata retains legacy normalization; the eventual POST owner must
    // independently exclude paid server tools. Explicit malformed/unknown/paid
    // counters cannot silently become token-only exact usage.
    if (raw.server_tool_use !== undefined) {
      const tools = raw.server_tool_use;
      if (!tools || typeof tools !== 'object' || Array.isArray(tools)) return null;
      const keys = Object.keys(tools);
      if (!keys.length || keys.some(key => !CLAUDE_TOKEN_ONLY_SERVER_TOOL_COUNTERS.includes(key) || !valid(tools[key]) || tools[key] !== 0)) return null;
    }
    input = raw.input_tokens; output = raw.output_tokens;
    cacheRead = optional(raw.cache_read_input_tokens); cacheWrite = optional(raw.cache_creation_input_tokens);
    if (raw.cache_creation !== undefined) {
      const details = raw.cache_creation;
      if (!details || typeof details !== 'object' || Array.isArray(details) ||
          !valid(raw.cache_creation_input_tokens) || !valid(details.ephemeral_5m_input_tokens) ||
          !valid(details.ephemeral_1h_input_tokens) ||
          BigInt(details.ephemeral_5m_input_tokens) + BigInt(details.ephemeral_1h_input_tokens) !== BigInt(raw.cache_creation_input_tokens)) return null;
      // 1h writes have a distinct rate the flat snapshot cannot represent.
      if (details.ephemeral_1h_input_tokens !== 0) return null;
    }
    if (!valid(input) || !valid(cacheRead) || !valid(cacheWrite)) return null;
    input += cacheRead + cacheWrite;
    reasoningIncludedInOutput = true;
  } else if ([FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.ANTIGRAVITY].includes(schema)) {
    input = raw.promptTokenCount; output = raw.candidatesTokenCount;
    cacheRead = optional(raw.cachedContentTokenCount); reasoning = optional(raw.thoughtsTokenCount);
    reasoningIncludedInOutput = false;
    if (raw.toolUsePromptTokenCount !== undefined && raw.toolUsePromptTokenCount !== 0) return null;
  } else return null;
  if (![input, output, cacheRead, cacheWrite, reasoning].every(valid) || cacheRead + cacheWrite > input || reasoningIncludedInOutput && reasoning > output) return null;
  return { exact: true, input, output, cacheRead, cacheWrite, reasoning, reasoningIncludedInOutput,
    provenance: { schema, endpoint, inputIncludesCache: true } };
}
