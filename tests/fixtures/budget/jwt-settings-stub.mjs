// Session signing/verification does not use settings. Password authentication
// stays out of this bounded lane; fail if reached rather than import app startup.
export function getSettings(){throw new Error('password/settings outside JWT lane');}

export const pricingMutations = [];
export const getPricing = () => ({});
export const updatePricing = body => { pricingMutations.push(body); return body; };
export const resetPricing = (...target) => { pricingMutations.push(target); };
export const resetAllPricing = () => { pricingMutations.push('all'); };
