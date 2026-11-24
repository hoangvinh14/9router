import { decimalToNanoUsd } from './decimalMoney.js';
import { validatePriceSnapshot } from '../accounting/exact-money.js';
import { BUDGET_REFERENCE_SCOPE } from './constants.js';

export const OPENAI_CATALOG_URL = 'https://models.dev/api.json';
const modelId = /^[a-z0-9][a-z0-9._-]{0,127}$/;
export const openAIReferenceKey = model => typeof model === 'string' && modelId.test(model)
  ? `openai:api/${model}:standard:v1` : null;

function rates(cost) {
  if (!cost || typeof cost.input !== 'number' || typeof cost.output !== 'number' ||
      (cost.cache_read !== undefined && typeof cost.cache_read !== 'number')) throw new Error('Incomplete OpenAI tariff');
  // OpenAI bills 30-minute writes at 1.25x input. This profile admits
  // only the default lifetime and validates the corresponding catalog rate.
  if (cost.cache_write !== undefined && (typeof cost.cache_write !== 'number' || cost.cache_read === undefined ||
      BigInt(decimalToNanoUsd(String(cost.cache_write))) * 4n !== BigInt(decimalToNanoUsd(String(cost.input))) * 5n)) {
    throw new Error('Unsupported OpenAI write price');
  }
  return { ...(cost.cache_write !== undefined ? { cache_creation: String(cost.cache_write) } : {}), input: String(cost.input), output: String(cost.output),
    ...(cost.cache_read !== undefined ? { cached: String(cost.cache_read) } : {}) };
}

export function parseOpenAIStandardReferences(catalog, syncedAt) {
  const provider = catalog?.openai;
  if (provider?.id !== 'openai' || !provider.models || Array.isArray(provider.models) || typeof provider.models !== 'object') throw new Error('Missing OpenAI catalog');
  const prices = {};
  for (const [model, entry] of Object.entries(provider.models)) {
    const revision = openAIReferenceKey(model);
    const cost = entry?.cost;
    if (!revision || entry?.id !== model || !(entry.modalities?.output?.length === 1 && entry.modalities.output[0] === 'text') || !cost) continue;
    if (Object.keys(cost).some(k => !['input', 'output', 'cache_read', 'cache_write', 'tiers', 'context_over_200k'].includes(k))) continue;
    try {
      const price = { currency: 'USD', unit: 'USD/1M tokens', source: OPENAI_CATALOG_URL,
        revision, syncedAt, rates: rates(cost) };
      if (cost.tiers || cost.context_over_200k) {
        const tier = cost.tiers?.[0];
        if (cost.tiers?.length !== 1 || tier?.tier?.type !== 'context' ||
            Object.keys(tier).some(k => !['input', 'output', 'cache_read', 'cache_write', 'tier'].includes(k))) continue;
        price.inputThreshold = tier.tier.size;
        price.aboveThresholdRates = rates(tier);
      }
      prices[revision] = validatePriceSnapshot(price);
    } catch { /* Ignore only the model whose tariff cannot be represented. */ }
  }
  if (!Object.keys(provider.models).length) throw new Error('Empty OpenAI catalog');
  return prices;
}

export async function syncOpenAIStandardReferences(catalog, syncedAt) {
  const prices = parseOpenAIStandardReferences(catalog, syncedAt);
  const { makeKv } = await import('../db/helpers/kvStore.js');
  await makeKv(BUDGET_REFERENCE_SCOPE).setMany(prices, { replacePrefix: 'openai:api/' });
}

export function readOpenAIStandardReference(scope, model) {
  const revision = openAIReferenceKey(model);
  const row = revision && scope.referencePrice([BUDGET_REFERENCE_SCOPE, revision]);
  if (!row) return null;
  const price = validatePriceSnapshot(JSON.parse(row.value));
  if (Object.keys(price).some(k => !['currency', 'unit', 'source', 'revision', 'syncedAt', 'rates',
      'inputThreshold', 'aboveThresholdRates'].includes(k)) || price.revision !== revision || price.source !== OPENAI_CATALOG_URL ||
      !Number.isSafeInteger(price.syncedAt) || price.syncedAt <= 0 ||
      Object.keys(price.rates).some(k => !['input', 'output', 'cached', 'cache_creation'].includes(k))) return null;
  return price;
}
