import { snapshotPayload } from './attempt-payload.js';
import { EXCLUSIVE_USAGE } from './terminal-cost.js';

const validCount = value => Number.isSafeInteger(value) && value >= 0;
const component = (category, count) => ({ category, count, unit: 'USD/1M tokens' });

// Responses input includes cache reads and writes. Output includes reasoning.
// An admitted aggregate write rate requires an explicit write count.
export function responsesTokenUsage(rawUsage, priceCacheWrites = false) {
  const components = [];
  let usage;
  try { usage = snapshotPayload(rawUsage); } catch { usage = null; }
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    return { semantics: EXCLUSIVE_USAGE, components };
  }

  const { input_tokens: input, output_tokens: output, total_tokens: total } = usage;
  const details = usage.input_tokens_details;
  const cached = details?.cached_tokens;
  const written = details?.cache_write_tokens;
  const hasWriteEvidence = written !== undefined || details?.cache_write_tokens_details !== undefined;
  const inconsistentTotal = validCount(total) && validCount(input) && validCount(output) &&
    BigInt(input) + BigInt(output) !== BigInt(total);
  if (!inconsistentTotal) {
    if (validCount(input) && validCount(cached) && cached <= input &&
        (!validCount(written) || written <= input - cached)) {
      components.push(component('cached', cached));
      if (priceCacheWrites === true && validCount(written)) {
        components.push(component('cache_creation', written));
        components.push(component('input', input - cached - written));
      } else if (priceCacheWrites === 'included-in-input' || (!priceCacheWrites && (!hasWriteEvidence || written === 0))) {
        components.push(component('input', input - cached));
      }
    }
    if (validCount(output)) components.push(component('output', output));
  }
  return { semantics: EXCLUSIVE_USAGE, components };
}

// OpenAI Standard uses the native protocol's counters; reasoning is already in output.
// Explicit cache lifetime overrides are refused at admission. A conflicting TTL
// breakdown cannot be billed as default writes.
export function openAIStandardUsage(raw, price, responses) {
  const normalized = {};
  for (const [chat, key] of [['prompt_tokens', 'input_tokens'], ['completion_tokens', 'output_tokens'],
    ['total_tokens', 'total_tokens'], ['prompt_tokens_details', 'input_tokens_details']]) {
    const source = responses ? key : chat;
    if (raw?.[source] !== undefined) normalized[key] = raw[source];
  }
  const details = normalized.input_tokens_details;
  const write = details?.cache_write_tokens;
  const breakdown = details?.cache_write_tokens_details;
  const hasWrite = Object.hasOwn(price.rates, 'cache_creation');
  const hasCache = Object.hasOwn(price.rates, 'cached');
  if (!hasCache && !details?.cached_tokens && !write) {
    // A flat input tariff prices all input alike without a cache breakdown.
    normalized.input_tokens_details = { cached_tokens: 0 };
  } else if (hasWrite && breakdown !== undefined &&
      (!validCount(breakdown?.ttl_30m_tokens) || breakdown.ttl_30m_tokens !== write || breakdown.ttl_12h_tokens !== 0)) {
    normalized.input_tokens_details = { cached_tokens: details.cached_tokens ?? null };
  }
  const evidence = responsesTokenUsage(normalized, hasWrite);
  if (!hasCache) {
    evidence.components = evidence.components.filter(item => item.category === 'output' ||
      (item.category === 'input' && !details?.cached_tokens && !write));
  }
  return evidence;
}

export function estimateMissingCodexUsage(usage, rawUsage, inputEstimate, outputEstimate) {
  const components = [...usage.components];
  const estimated = [];
  if (!components.some(item => item.category === 'input')) {
    const input = rawUsage?.input_tokens;
    const cached = rawUsage?.input_tokens_details?.cached_tokens;
    const usableCache = validCount(cached) && (!validCount(input) || cached <= input);
    const total = validCount(input) ? input : Math.max(inputEstimate, usableCache ? cached : 0);
    if (usableCache && !components.some(item => item.category === 'cached')) {
      components.push(component('cached', cached));
    }
    if (validCount(total) && (total > 0 || validCount(input))) {
      components.push(component('input', total - (usableCache ? cached : 0)));
      estimated.push('input');
    }
  }
  if (validCount(outputEstimate) && outputEstimate > 0 && !components.some(item => item.category === 'output')) {
    components.push(component('output', outputEstimate));
    estimated.push('output');
  }
  return { ...usage, components, estimated };
}
