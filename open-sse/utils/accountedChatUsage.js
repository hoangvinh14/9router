import { FORMATS } from '../translator/formats.js';
import { normalizeExactUsage } from './exactUsage.js';
import { isAccountedOpenaiChatProvider } from '../config/accountedChatProviders.js';

// Provider-specific validation precedes shared normalization. No defaults for
// DeepSeek's required cache split: absent/contradictory fields are unresolved.
export function normalizeAccountedChatUsage(raw, provider = 'openai') {
  if (!isAccountedOpenaiChatProvider(provider)) return null;
  if (provider === 'deepseek') {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const { prompt_tokens: input, completion_tokens: output, total_tokens: total,
      prompt_cache_hit_tokens: hit, prompt_cache_miss_tokens: miss } = raw;
    if (![input, output, total, hit, miss].every(value => Number.isSafeInteger(value) && value >= 0) ||
        BigInt(hit) + BigInt(miss) !== BigInt(input) || BigInt(input) + BigInt(output) !== BigInt(total) ||
        raw.prompt_tokens_details?.cached_tokens !== undefined && raw.prompt_tokens_details.cached_tokens !== hit) return null;
  }
  return normalizeExactUsage(raw, FORMATS.OPENAI);
}
