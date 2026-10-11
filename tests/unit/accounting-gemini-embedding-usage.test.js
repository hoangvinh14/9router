import { describe, expect, it } from 'vitest';
import { normalizeExactUsage } from '../../open-sse/utils/exactUsage.js';
import { FORMATS } from '../../open-sse/translator/formats.js';

// Schema reference: https://ai.google.dev/api/embeddings#EmbeddingUsageMetadata
// These are raw metadata controls, not native response/EOF/request/ACK proof.
const normalize = raw => normalizeExactUsage(raw, FORMATS.GEMINI, 'embeddings');
const expected = input => ({ exact: true, input, output: 0, cacheRead: 0, cacheWrite: 0,
  reasoning: 0, reasoningIncludedInOutput: true,
  provenance: { schema: FORMATS.GEMINI, endpoint: 'embeddings', inputIncludesCache: true } });
describe('Gemini raw text embeddings usage, separate from chat metadata', () => {
  it.each([0, 123, Number.MAX_SAFE_INTEGER])('explicit raw prompt count %s, no output tokens', input => {
    expect(normalize({ promptTokenCount: input })).toEqual(expected(input));
  });
  it('optional TEXT-only details must match the raw prompt count', () => {
    expect(normalize({ promptTokenCount: 123, promptTokenDetails: [{ modality: 'TEXT', tokenCount: 123 }] })).toEqual(expected(123));
  });
  it.each([
    undefined, {}, { promptTokenCount: '123' }, { promptTokenCount: -1 }, { promptTokenCount: 1.5 },
    { promptTokenCount: Number.MAX_SAFE_INTEGER + 1 }, { promptTokenCount: 123, candidatesTokenCount: 0 },
    { promptTokenCount: 123, cachedContentTokenCount: 0 }, { promptTokenCount: 123, thoughtsTokenCount: 0 },
    { promptTokenCount: 123, totalTokenCount: 123 }, { promptTokenCount: 123, unknownBilling: 0 },
    { promptTokenCount: 123, promptTokenDetails: [] },
    { promptTokenCount: 123, promptTokenDetails: [{ modality: 'TEXT', tokenCount: 122 }] },
    { promptTokenCount: 123, promptTokenDetails: [{ modality: 'IMAGE', tokenCount: 123 }] },
    { promptTokenCount: 123, promptTokenDetails: [{ modality: 'TEXT', tokenCount: 123, unknown: 0 }] },
    { promptTokenCount: 123, promptTokenDetails: [{ modality: 'TEXT', tokenCount: 123 }, { modality: 'TEXT', tokenCount: 0 }] },
    { prompt_tokens: 123, total_tokens: 123 },
  ])('rejects absent/coerced/chat/multimodal/unknown metadata case %#', raw => {
    expect(normalize({ promptTokenCount: 123 })).toEqual(expected(123));
    expect(normalize(raw)).toBeNull();
  });
  it.each(['getter', 'details-getter', 'proxy', 'cycle', 'oversize'])('bounded descriptor-first guard, %s', fault => {
    expect(normalize({ promptTokenCount: 123 })).toEqual(expected(123));
    let reads = 0; const trap = () => { reads++; throw new Error('Fixture programmable read'); };
    let raw = { promptTokenCount: 123 };
    if (fault === 'getter') Object.defineProperty(raw, 'promptTokenCount', { enumerable: true, get: trap });
    else if (fault === 'details-getter') Object.defineProperty(raw, 'promptTokenDetails', { enumerable: true, get: trap });
    else if (fault === 'proxy') raw = new Proxy(raw, { get: trap, ownKeys: trap, getOwnPropertyDescriptor: trap });
    else if (fault === 'cycle') raw.promptTokenDetails = [raw];
    else raw.unknown = 'x'.repeat(262145);
    expect(normalize(raw)).toBeNull(); expect(reads).toBe(0);
  });
  it('Gemini CLI/Antigravity chat schema is not embeddings schema authority', () => {
    expect(normalize({ promptTokenCount: 123 })).toEqual(expected(123));
    for (const schema of [FORMATS.GEMINI_CLI, FORMATS.ANTIGRAVITY]) {
      expect(normalizeExactUsage({ promptTokenCount: 123, candidatesTokenCount: 0 }, schema, 'embeddings')).toBeNull();
    }
  });
});
