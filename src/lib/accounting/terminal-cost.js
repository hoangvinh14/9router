import { snapshotPayload } from './attempt-payload.js';
import { costFromExactUsageSnapshot, validatePriceSnapshot } from './exact-money.js';
import { RATE_UNITS } from '../pricing/constants.js';

// Internal mapper contract, NOT raw provider usage: categories are disjoint
// billed quantities (input excludes cache, output excludes separate reasoning).
// Producer adapters must prove that mapping before invoking this accounting path.
export const EXCLUSIVE_USAGE = 'exclusive-category-counts-v1';

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
  // Round ONCE over the union of valid disjoint components, never each fragment.
  const amountNanoUsd = known.length ? costFromExactUsageSnapshot({ exact: true,
    components: known, provenance: 'provider-reported-disjoint' }, { ...price,
    rateUnits: Object.fromEntries(categories.map(category => [category, RATE_UNITS[category]])),
    usageSemantics: { requiredCategories: known.map(item => item.category) },
  }) : '0';
  return snapshotPayload({ amountNanoUsd, known, unknown,
    provenance: unknown.length ? 'unknown/defaulted' : 'provider-reported' });
}
