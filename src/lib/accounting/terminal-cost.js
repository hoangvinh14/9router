import { snapshotPayload } from './attempt-payload.js';
import { costFromExactUsageSnapshot, validatePriceSnapshot } from './exact-money.js';
import { RATE_UNITS } from '../pricing/constants.js';

// Internal mapper contract, NOT raw provider usage: categories are disjoint
// billed quantities (input excludes cache, output excludes separate reasoning).
// Producer adapters must prove that mapping before invoking this accounting path.
export const EXCLUSIVE_USAGE = 'exclusive-category-counts-v1';

// A complete HTTP authentication rejection may carry partial native usage.
// Record all known components, but only a fully priced terminal permits retry.
export function settleOAuthErrorUsage(attempt, price, evidence) {
  if (!evidence.components.length) return null;
  const ack = attempt.settle(evidence);
  const categories = price.usageSemantics?.requiredCategories ?? Object.keys(price.rates);
  return { ...ack, complete: categories.every(category =>
    evidence.components.some(item => item.category === category)) };
}

export function terminalCost(evidence, originalPrice) {
  const price = validatePriceSnapshot(originalPrice);
  const categories = price.usageSemantics?.requiredCategories ?? Object.keys(price.rates);
  if (!Array.isArray(categories) || !categories.length || new Set(categories).size !== categories.length ||
      categories.some(category => !Object.hasOwn(price.rates, category) || !RATE_UNITS[category])) {
    throw new Error('Original category authority required');
  }
  let observed;
  try { observed = snapshotPayload(evidence); } catch { observed = null; }
  const known = [];
  const unknown = [];
  const components = observed?.semantics === EXCLUSIVE_USAGE && Array.isArray(observed.components)
    ? observed.components : [];
  for (const category of categories) {
    const matches = components.filter(item => item && item.category === category);
    const component = matches[0];
    if (matches.length === 1 && Object.keys(component).sort().join(',') === 'category,count,unit' &&
        Number.isSafeInteger(component.count) && component.count >= 0 && component.unit === RATE_UNITS[category]) {
      known.push(component);
    } else {
      unknown.push(category);
    }
  }
  const inputCategories = ['input', 'cached', 'cache_creation', 'cache_creation_1h'];
  const promptTokens = known.filter(item => inputCategories.includes(item.category))
    .reduce((sum, item) => sum + BigInt(item.count), 0n);
  const aboveThreshold = price.inputThreshold !== undefined && promptTokens > BigInt(price.inputThreshold);
  const uncertainBand = price.inputThreshold !== undefined && !aboveThreshold &&
    unknown.some(category => inputCategories.includes(category));
  // Round ONCE over the union of valid disjoint components, never each fragment.
  const amountNanoUsd = known.length ? costFromExactUsageSnapshot({ exact: true,
    components: known, provenance: 'provider-reported-disjoint' }, { ...price,
    rates: aboveThreshold ? price.aboveThresholdRates : price.rates,
    rateUnits: Object.fromEntries(categories.map(category => [category, RATE_UNITS[category]])),
    usageSemantics: { requiredCategories: known.map(item => item.category) },
  }) : '0';
  const estimated = known.map(item => item.category).filter(category =>
    uncertainBand || Array.isArray(observed?.estimated) && observed.estimated.includes(category));
  return snapshotPayload({ amountNanoUsd, known, unknown,
    ...(estimated.length ? { estimated } : {}),
    provenance: estimated.length ? 'estimated' : unknown.length ? 'unknown/defaulted' : 'provider-reported' });
}
