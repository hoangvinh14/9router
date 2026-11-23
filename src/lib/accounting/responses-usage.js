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
      if (priceCacheWrites && validCount(written)) {
        components.push(component('cache_creation', written));
        components.push(component('input', input - cached - written));
      } else if (!priceCacheWrites && (!hasWriteEvidence || written === 0)) {
        components.push(component('input', input - cached));
      }
    }
    if (validCount(output)) components.push(component('output', output));
  }
  return { semantics: EXCLUSIVE_USAGE, components };
}
