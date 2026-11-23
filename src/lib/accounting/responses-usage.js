import { snapshotPayload } from './attempt-payload.js';
import { EXCLUSIVE_USAGE } from './terminal-cost.js';

const validCount = value => Number.isSafeInteger(value) && value >= 0;
const component = (category, count) => ({ category, count, unit: 'USD/1M tokens' });

// For Responses profiles with input, cached input and output rates only.
// The caller owns terminal finality and any separately priced cache writes.
// Responses input includes cached input. Output already includes reasoning.
export function responsesTokenUsage(rawUsage) {
  const components = [];
  let usage;
  try { usage = snapshotPayload(rawUsage); } catch { usage = null; }
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    return { semantics: EXCLUSIVE_USAGE, components };
  }

  const { input_tokens: input, output_tokens: output, total_tokens: total } = usage;
  const cached = usage.input_tokens_details?.cached_tokens;
  const inconsistentTotal = validCount(total) && validCount(input) && validCount(output) &&
    BigInt(input) + BigInt(output) !== BigInt(total);
  if (!inconsistentTotal) {
    if (validCount(input) && validCount(cached) && cached <= input) {
      components.push(component('input', input - cached));
      components.push(component('cached', cached));
    }
    if (validCount(output)) components.push(component('output', output));
  }
  return { semantics: EXCLUSIVE_USAGE, components };
}
