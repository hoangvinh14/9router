import { FORMATS } from "../translator/formats.js";
import { CLAUDE_CACHE_TIER_FIELDS } from '../config/accountingCacheTiers.js';
import { CLAUDE_TOKEN_ONLY_SERVER_TOOL_COUNTERS, COMMANDCODE_TOKEN_ONLY_USAGE_FIELDS, KIRO_TOKEN_ONLY_USAGE_FIELDS,
  GEMINI_EMBEDDING_USAGE_FIELDS, GEMINI_EMBEDDING_DETAIL_FIELDS } from '../config/accountingUsageSchemas.js';
import { ACCOUNTING_GEMINI_TEXT_MODALITY } from '../config/accountingGeminiSchema.js';
import { snapshotAccountingPreparedData } from '../config/accountedBaseDispatch.js';
import { ACCOUNTING_CODE_PROVENANCE, ACCOUNTING_CODE_COUNTER, ACCOUNTING_WEB_FETCH_PROVENANCE, ACCOUNTING_WEB_FETCH_COUNTER, ACCOUNTING_EMBEDDED_TOOL_PROVENANCE, ACCOUNTING_EMBEDDED_TOOL_RATES } from '../config/accountingEmbeddedToolRates.js';
import { CLAUDE_ACCOUNTING_USAGE_FIELDS } from '../config/accountingClaudeSchema.js';

const valid = value => Number.isSafeInteger(value) && value >= 0;
function optional(value) { return value === undefined ? 0 : value; }
// Only RAW provider metadata belongs here, before buffer/estimation/translation.
// Streaming callers must accumulate schema fields until terminal exact counts.
export function normalizeExactUsage(raw, schema, endpoint = "chat", { allowCache1h = false, requireCacheTiers = false, allowWebSearchUsage = false, allowWebFetchUsage = false, allowCodeExecutionUsage = false, allowGeminiProcessingUsage = false } = {}) {
  if (typeof allowGeminiProcessingUsage !== 'boolean' || allowGeminiProcessingUsage && (schema !== FORMATS.GEMINI || endpoint !== 'chat')) return null;
  if (allowGeminiProcessingUsage) {
    try { raw = snapshotAccountingPreparedData(raw); } catch { return null; }
    if (!raw || !Object.hasOwn(raw, 'toolUsePromptTokenCount') || !valid(raw.toolUsePromptTokenCount)) return null;
  }
  if (typeof allowCache1h !== 'boolean' || typeof requireCacheTiers !== 'boolean' || requireCacheTiers && !allowCache1h ||
      typeof allowWebSearchUsage !== 'boolean' || typeof allowWebFetchUsage !== 'boolean' || typeof allowCodeExecutionUsage !== 'boolean' ||
      (allowWebSearchUsage || allowWebFetchUsage || allowCodeExecutionUsage) && (schema !== FORMATS.CLAUDE || endpoint !== 'chat')) return null;
  if (allowWebSearchUsage || allowWebFetchUsage || allowCodeExecutionUsage) {
    // New explicit owners never invoke raw getters/proxies/serialization hooks.
    // Default consumers retain their previous token-only normalization.
    try { raw = snapshotAccountingPreparedData(raw); } catch { return null; }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
        Object.keys(raw).some(field => !CLAUDE_ACCOUNTING_USAGE_FIELDS.includes(field))) return null;
  }
  let cacheTiers = null, toolUses = null, nonBillableToolUses = null, codeToolUses = null;
  if (endpoint === 'embeddings' && [FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.ANTIGRAVITY].includes(schema)) {
    if (schema !== FORMATS.GEMINI) return null;
    // Guard before getters/coercion. Missing metadata remains unknown, not zero.
    try { raw = snapshotAccountingPreparedData(raw); } catch { return null; }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
        Object.keys(raw).some(key => !GEMINI_EMBEDDING_USAGE_FIELDS.includes(key)) ||
        !Object.hasOwn(raw, 'promptTokenCount') || !valid(raw.promptTokenCount)) return null;
    if (Object.hasOwn(raw, 'promptTokenDetails')) {
      const details = raw.promptTokenDetails;
      if (!Array.isArray(details) || details.length !== 1) return null;
      const text = details[0];
      if (!text || typeof text !== 'object' || Array.isArray(text) ||
          Object.keys(text).length !== GEMINI_EMBEDDING_DETAIL_FIELDS.length ||
          !GEMINI_EMBEDDING_DETAIL_FIELDS.every(key => Object.hasOwn(text, key)) ||
          text.modality !== ACCOUNTING_GEMINI_TEXT_MODALITY || !valid(text.tokenCount) ||
          text.tokenCount !== raw.promptTokenCount) return null;
    }
    // The text embedding schema has input tokens only. These zeros describe
    // absent billing categories of this schema, never inferred missing counters.
    return { exact: true, input: raw.promptTokenCount, output: 0, cacheRead: 0, cacheWrite: 0,
      reasoning: 0, reasoningIncludedInOutput: true,
      provenance: { schema, endpoint, inputIncludesCache: true } };
  }
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
    // counters cannot silently become token-only exact usage. A new search-use
    // opt-in retains its typed raw counter; it is not terminal/provider proof.
    if (raw.server_tool_use !== undefined) {
      const tools = raw.server_tool_use;
      if (!tools || typeof tools !== 'object' || Array.isArray(tools)) return null;
      const keys = Object.keys(tools);
      if (!keys.length || keys.some(key => !(CLAUDE_TOKEN_ONLY_SERVER_TOOL_COUNTERS.includes(key) || allowCodeExecutionUsage && key === ACCOUNTING_CODE_COUNTER.rawCounter) || !valid(tools[key]) ||
          tools[key] !== 0 && !(allowWebSearchUsage && ACCOUNTING_EMBEDDED_TOOL_RATES.some(({ rawCounter }) => rawCounter === key) ||
            allowWebFetchUsage && key === ACCOUNTING_WEB_FETCH_COUNTER.rawCounter || allowCodeExecutionUsage && key === ACCOUNTING_CODE_COUNTER.rawCounter))) return null;
      if (allowCodeExecutionUsage) {
        if (!Object.hasOwn(tools, ACCOUNTING_CODE_COUNTER.rawCounter)) return null;
        codeToolUses = { [ACCOUNTING_CODE_COUNTER.count]: tools[ACCOUNTING_CODE_COUNTER.rawCounter] };
      }
      if (allowWebSearchUsage) {
        if (ACCOUNTING_EMBEDDED_TOOL_RATES.some(({ rawCounter }) => !Object.hasOwn(tools, rawCounter))) return null;
        toolUses = Object.fromEntries(ACCOUNTING_EMBEDDED_TOOL_RATES.map(({ count, rawCounter }) => [count, tools[rawCounter]]));
      }
      if (allowWebFetchUsage) {
        if (!Object.hasOwn(tools, ACCOUNTING_WEB_FETCH_COUNTER.rawCounter)) return null;
        nonBillableToolUses = { [ACCOUNTING_WEB_FETCH_COUNTER.count]: tools[ACCOUNTING_WEB_FETCH_COUNTER.rawCounter] };
      }
    } else if (allowWebSearchUsage || allowWebFetchUsage || allowCodeExecutionUsage) return null;
    input = raw.input_tokens; output = raw.output_tokens;
    cacheRead = optional(raw.cache_read_input_tokens); cacheWrite = optional(raw.cache_creation_input_tokens);
    if (requireCacheTiers && raw.cache_creation === undefined) return null;
    if (raw.cache_creation !== undefined) {
      const details = raw.cache_creation;
      if (!details || typeof details !== 'object' || Array.isArray(details) ||
          Object.keys(details).some(key => !CLAUDE_CACHE_TIER_FIELDS.includes(key)) ||
          !valid(raw.cache_creation_input_tokens) || !valid(details.ephemeral_5m_input_tokens) ||
          !valid(details.ephemeral_1h_input_tokens) ||
          BigInt(details.ephemeral_5m_input_tokens) + BigInt(details.ephemeral_1h_input_tokens) !== BigInt(raw.cache_creation_input_tokens)) return null;
      // Existing consumers stay flat-only. Explicit owners retain both observed
      // counters, and money requires the original distinct 1h rate when positive.
      if (details.ephemeral_1h_input_tokens !== 0 && !allowCache1h) return null;
      if (allowCache1h) cacheTiers = { cacheWrite5m: details.ephemeral_5m_input_tokens, cacheWrite1h: details.ephemeral_1h_input_tokens };
    }
    if (!valid(input) || !valid(cacheRead) || !valid(cacheWrite)) return null;
    input += cacheRead + cacheWrite;
    reasoningIncludedInOutput = true;
  } else if (schema === FORMATS.COMMANDCODE) {
    // Deliberately no translator defaults, derived totals or inferred free
    // cache/reasoning. Raw NDJSON owner must separately establish terminal/EOF.
    const keys = Object.keys(raw);
    if (endpoint !== 'chat' || keys.length !== COMMANDCODE_TOKEN_ONLY_USAGE_FIELDS.length ||
        !COMMANDCODE_TOKEN_ONLY_USAGE_FIELDS.every(key => Object.hasOwn(raw, key) && valid(raw[key])) ||
        keys.some(key => !COMMANDCODE_TOKEN_ONLY_USAGE_FIELDS.includes(key)) ||
        raw.cachedInputTokens !== 0 || raw.reasoningTokens !== 0 ||
        BigInt(raw.inputTokens) + BigInt(raw.outputTokens) !== BigInt(raw.totalTokens)) return null;
    input = raw.inputTokens; output = raw.outputTokens;
    reasoningIncludedInOutput = true;
  } else if (schema === FORMATS.KIRO) {
    // Raw metrics only: no envelope unwrap, credits, aliases, converter
    // defaults or derived totals. Binary terminal + clean EOF are separate.
    const keys = Object.keys(raw);
    if (endpoint !== 'chat' || keys.length !== KIRO_TOKEN_ONLY_USAGE_FIELDS.length ||
        !KIRO_TOKEN_ONLY_USAGE_FIELDS.every(key => Object.hasOwn(raw, key) && valid(raw[key])) ||
        keys.some(key => !KIRO_TOKEN_ONLY_USAGE_FIELDS.includes(key)) ||
        raw.cacheReadInputTokens !== 0 || raw.cacheCreationInputTokens !== 0 || raw.reasoningTokens !== 0 ||
        BigInt(raw.inputTokens) + BigInt(raw.outputTokens) !== BigInt(raw.totalTokens)) return null;
    input = raw.inputTokens; output = raw.outputTokens;
    reasoningIncludedInOutput = true;
  } else if ([FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.ANTIGRAVITY].includes(schema)) {
    input = raw.promptTokenCount; output = raw.candidatesTokenCount;
    cacheRead = optional(raw.cachedContentTokenCount); reasoning = optional(raw.thoughtsTokenCount);
    reasoningIncludedInOutput = false;
    if (!allowGeminiProcessingUsage && raw.toolUsePromptTokenCount !== undefined && raw.toolUsePromptTokenCount !== 0) return null;
  } else return null;
  if (![input, output, cacheRead, cacheWrite, reasoning].every(valid) || cacheRead + cacheWrite > input || reasoningIncludedInOutput && reasoning > output) return null;
  return { exact: true, input, output, cacheRead, cacheWrite, ...(cacheTiers || {}), reasoning, reasoningIncludedInOutput,
    ...(allowGeminiProcessingUsage ? { processingToolPromptTokens: raw.toolUsePromptTokenCount } : {}),
    ...(toolUses ? { toolUses } : {}), ...(nonBillableToolUses ? { nonBillableToolUses } : {}), ...(codeToolUses ? { codeToolUses } : {}),
    provenance: { schema, endpoint, inputIncludesCache: true,
      ...(toolUses ? { serverToolUses: ACCOUNTING_EMBEDDED_TOOL_PROVENANCE } : {}),
      ...(nonBillableToolUses ? { nonBillableServerToolUses: ACCOUNTING_WEB_FETCH_PROVENANCE } : {}),
      ...(codeToolUses ? { codeServerToolUses: ACCOUNTING_CODE_PROVENANCE } : {}) } };
}
