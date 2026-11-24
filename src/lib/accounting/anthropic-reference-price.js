import { readClaudeStandardReference } from '../pricing/claude-standard-reference.js';
import { decimalToNanoUsd, nanoUsdToDecimal } from '../pricing/decimalMoney.js';
import { unavailable } from './attempt-payload.js';

export const ANTHROPIC_REFERENCE_MODEL = 'claude-sonnet-4-6';

// First-party standard Messages token rates documented in the plan's
// anthropic-geo-targeted-followup.md. Values are exact USD per million tokens,
// not an invoice estimate. No workspace-default geo or legacy rate fallback.
const RATES = Object.freeze({
  global: Object.freeze({ input: '3', output: '15', cached: '0.30', cache_creation: '3.75', cache_creation_1h: '6' }),
  us: Object.freeze({ input: '3.30', output: '16.50', cached: '0.33', cache_creation: '4.125', cache_creation_1h: '6.60' }),
});

export function isAnthropicReferenceGeo(geo) {
  return typeof geo === 'string' && Object.hasOwn(RATES, geo);
}

export const ANTHROPIC_PRICE_READS = Object.freeze({
  anthropicManualPrice: Object.freeze({ method: 'get', sql: "SELECT value FROM kv WHERE scope = 'pricing' AND key = 'anthropic'" }),
  referenceCatalogPresent: Object.freeze({ method: 'get', sql: "SELECT 1 AS present FROM kv WHERE scope = 'referencePricing' AND key = 'catalog'" }),
});

export function readAnthropicReferencePrice(scope, model, geo) {
  if (!isAnthropicReferenceGeo(geo)) throw unavailable();
  const synced = readClaudeStandardReference(scope, model) ??
    readClaudeStandardReference(scope, model.replace(/-\d{8}$/, ''));
  if (synced) {
    if (geo === 'global') return synced;
    const version = /^claude-[a-z]+-(\d+)(?:-(\d+))?(?:-|$)/.exec(model);
    if (!version || Number(version[1]) < 4 || Number(version[1]) === 4 && Number(version[2] ?? 0) < 6) return null;
    const usRates = rates => Object.fromEntries(Object.entries(rates).map(([field, rate]) =>
      [field, nanoUsdToDecimal(String(BigInt(decimalToNanoUsd(rate)) * 11n / 10n))]));
    return { ...synced, revision: synced.revision + ':us', rates: usRates(synced.rates),
      ...(synced.aboveThresholdRates && { aboveThresholdRates: usRates(synced.aboveThresholdRates) }) };
  }
  if (model !== ANTHROPIC_REFERENCE_MODEL) return null;
  const manual = scope.anthropicManualPrice();
  if (manual !== null) {
    let models;
    try { models = JSON.parse(manual.value); } catch { throw unavailable(); }
    // Preserve precedence: an explicit override, even invalid/incomplete, must
    // not silently fall through. This candidate cannot qualify legacy rates.
    if (!models || typeof models !== 'object' || Array.isArray(models) || Object.hasOwn(models, model)) return null;
  }
  // Persisted catalog semantics (including whether a row applies to this
  // endpoint and geo) are not yet qualified. Do not read or ignore the catalog.
  if (scope.referenceCatalogPresent() !== null) return null;
  return Object.freeze({ currency: 'USD', unit: 'USD/1M tokens',
    revision: `anthropic-messages-sonnet-4-6-2026-11-16-${geo}-v1`, rates: RATES[geo],
  });
}
