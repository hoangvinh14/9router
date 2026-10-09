import { describe, expect, it } from "vitest";
import { normalizeExactUsage } from "open-sse/utils/exactUsage.js";
describe("raw usage exactness boundary", () => {
  it("OpenAI cache/reasoning are subsets and zero is exact when explicitly present", () => {
    expect(normalizeExactUsage({ prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 5 } }, "openai")).toMatchObject({ input: 100, output: 20, cacheRead: 40, cacheWrite: 0, reasoning: 5, reasoningIncludedInOutput: true, exact: true });
    expect(normalizeExactUsage({ prompt_tokens: 0, completion_tokens: 0 }, "openai").exact).toBe(true);
    expect(normalizeExactUsage({ prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 40, cache_write_tokens: 10 } }, "openai").cacheWrite).toBe(10);
    expect(normalizeExactUsage({ prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { audio_tokens: 3 } }, "openai")).toBeNull();
  });
  it("Responses details and embedding input-only usage are schema-specific", () => {
    expect(normalizeExactUsage({ input_tokens: 20, output_tokens: 10, input_tokens_details: { cached_tokens: 2 }, output_tokens_details: { reasoning_tokens: 4 } }, "openai-responses")).toMatchObject({ input: 20, output: 10, cacheRead: 2, reasoning: 4 });
    expect(normalizeExactUsage({ prompt_tokens: 12, total_tokens: 12 }, "openai", "embeddings")).toMatchObject({ input: 12, output: 0 });
  });
  it("Claude exclusive uncached input becomes inclusive and retains cache subsets", () => {
    expect(normalizeExactUsage({ input_tokens: 50, output_tokens: 20, cache_read_input_tokens: 40, cache_creation_input_tokens: 10 }, "claude")).toMatchObject({ input: 100, output: 20, cacheRead: 40, cacheWrite: 10, reasoning: 0, reasoningIncludedInOutput: true });
    expect(normalizeExactUsage({ input_tokens: 50, output_tokens: 20, cache_creation: { ephemeral_1h_input_tokens: 2 } }, "claude")).toBeNull();
  });
  it('Claude detailed 5m cache writes agree with aggregate without mutating raw metadata', () => {
    const raw = Object.freeze({ input_tokens: 50, output_tokens: 20, cache_read_input_tokens: 40, cache_creation_input_tokens: 10,
      cache_creation: Object.freeze({ ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 0 }) });
    expect(normalizeExactUsage(raw, 'claude')).toMatchObject({ exact: true, input: 100, output: 20, cacheRead: 40, cacheWrite: 10 });
    expect(raw.input_tokens).toBe(50);
    expect(normalizeExactUsage({ input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } }, 'claude')).toMatchObject({ exact: true, input: 0, cacheWrite: 0 });
  });
  it.each([
    ['aggregate mismatch', 10, { ephemeral_5m_input_tokens: 9, ephemeral_1h_input_tokens: 0 }],
    ['negative 5m', 10, { ephemeral_5m_input_tokens: -1, ephemeral_1h_input_tokens: 0 }],
    ['string 5m', 10, { ephemeral_5m_input_tokens: '10', ephemeral_1h_input_tokens: 0 }],
    ['missing 5m', 10, { ephemeral_1h_input_tokens: 0 }],
    ['missing 1h', 10, { ephemeral_5m_input_tokens: 10 }],
    ['missing aggregate', undefined, { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 0 }],
    ['unsafe 5m', 10, { ephemeral_5m_input_tokens: Number.MAX_SAFE_INTEGER + 1, ephemeral_1h_input_tokens: 0 }],
    ['fractional 5m', 10, { ephemeral_5m_input_tokens: 10.1, ephemeral_1h_input_tokens: 0 }],
    ['null details', 10, null],
    ['array details', 10, []],
    ['string details', 10, 'invalid'],
    ['positive unpriceable 1h', 10, { ephemeral_5m_input_tokens: 5, ephemeral_1h_input_tokens: 5 }],
    ['string 1h', 10, { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: '0' }],
  ])('Claude incomplete/malformed or unpriceable cache split stays unresolved: %s', (_label, aggregate, details) => {
    expect(normalizeExactUsage({ input_tokens: 50, output_tokens: 20, cache_creation_input_tokens: aggregate, cache_creation: details }, 'claude')).toBeNull();
  });
  it('Claude absent server-tool field preserves legacy normalization, not owner billing approval', () => {
    expect(normalizeExactUsage({ input_tokens: 50, output_tokens: 20 }, 'claude')).toMatchObject({ exact: true, input: 50, output: 20 });
  });
  it('Claude explicit zero server-tool counters do not invent an additional charge', () => {
    expect(normalizeExactUsage({ input_tokens: 50, output_tokens: 20,
      server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 } }, 'claude')).toMatchObject({ exact: true, input: 50, output: 20 });
  });
  it.each([
    ['empty details do not establish zero billing', {}],
    ['unknown zero counter is not approved schema', { future_requests: 0 }],
    ['unknown positive counter', { future_requests: 1 }],
    ['paid search', { web_search_requests: 1 }],
    ['other positive counter', { web_fetch_requests: 1 }],
    ['negative counter', { web_search_requests: -1 }],
    ['string zero', { web_search_requests: '0' }],
    ['fractional counter', { web_search_requests: 0.1 }],
    ['unsafe counter', { web_search_requests: Number.MAX_SAFE_INTEGER + 1 }],
    ['null counter', { web_search_requests: null }],
    ['nested counter', { web_search_requests: { count: 0 } }],
    ['null details', null],
    ['array details', []],
    ['string details', 'invalid'],
  ])('Claude unsupported server-tool billing evidence is not token-only exact usage: %s', (_label, serverTools) => {
    expect(normalizeExactUsage({ input_tokens: 50, output_tokens: 20, server_tool_use: serverTools }, 'claude')).toBeNull();
  });
  it("Gemini candidates exclude thoughts and prompt includes cached subset", () => {
    expect(normalizeExactUsage({ promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 5, cachedContentTokenCount: 40 }, "gemini")).toMatchObject({ input: 100, output: 20, reasoning: 5, reasoningIncludedInOutput: false });
    expect(normalizeExactUsage({ promptTokenCount: 100, candidatesTokenCount: 20, toolUsePromptTokenCount: 3 }, "gemini")).toBeNull();
  });
  it("unknown/partial/estimated/invalid usage is never zero debit", () => {
    for (const raw of [null, {}, { prompt_tokens: 1 }, { prompt_tokens: "1", completion_tokens: 2 }, { prompt_tokens: 1, completion_tokens: -1 }, { prompt_tokens: 1, completion_tokens: 2, estimated: true }, { prompt_tokens: 1, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 2 } }, { prompt_tokens: 1.2, completion_tokens: 1 }, { prompt_tokens: 1, completion_tokens: 1, completion_tokens_details: { reasoning_tokens: 2 } }]) expect(normalizeExactUsage(raw, "openai")).toBeNull();
    expect(normalizeExactUsage({ prompt_tokens: 1, completion_tokens: 1 }, "unknown")).toBeNull();
  });
});
