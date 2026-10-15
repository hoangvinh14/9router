import { MAX_NANO_USD } from "../../../open-sse/config/apiKeyBudgetConstants.js";
import { exactCacheWriteTiers } from '../../../open-sse/config/accountingCacheTiers.js';
import { ACCOUNTING_EMBEDDED_TOOL_PROVENANCE, ACCOUNTING_EMBEDDED_TOOL_RATES, snapshotExactEmbeddedToolUsage, snapshotExactNonBillableToolUsage, snapshotExactCodeToolUsage } from '../../../open-sse/config/accountingEmbeddedTools.js';
import { ACCOUNTING_WEB_FETCH_PROVENANCE, ACCOUNTING_CODE_PROVENANCE } from '../../../open-sse/config/accountingEmbeddedToolRates.js';
import { snapshotAccountingPreparedData } from '../../../open-sse/config/accountedBaseDispatch.js';
import { snapshotExactGeminiModalityUsage, validateGeminiModalitySnapshot } from '../../../open-sse/config/accountingGeminiModalityUsage.js';
import { ACCOUNTING_GEMINI_MODALITY_RATES } from '../../../open-sse/config/accountingGeminiModalityRates.js';
import { ACCOUNTING_GEMINI_PROCESSING_MODALITY_PROVENANCE, ACCOUNTING_GEMINI_PROCESSING_RATES } from '../../../open-sse/config/accountingGeminiProcessingRates.js';

import { decimalToNanoUsd } from './decimalMoney.js';
// Preserve existing server/public exports; client drafts import the pure module.
export { decimalToNanoUsd, nanoUsdToDecimal, validateRate } from './decimalMoney.js';

const TOKEN_UNIT = 1_000_000n;
function tokens(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid exact ${field} token count`);
  return BigInt(value);
}
// Original durable attempt snapshot is the sole unit/required-category owner
// for service settlement, audited exact recovery and committed receipts.
export function costFromExactUsageSnapshot(usage, snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !usage || typeof usage !== 'object') throw new Error('Original price snapshot required');
  // Guard original snapshot before reading required semantics or per-use units.
  snapshot = snapshotAccountingPreparedData(snapshot);
  const modalityUsage = validateGeminiModalitySnapshot(usage, snapshot);
  if (modalityUsage) {
    for (const modality of snapshot.usageSemantics.allowedInputModalities) {
      const fields = ACCOUNTING_GEMINI_MODALITY_RATES.find(item => item.modality === modality);
      decimalToNanoUsd(snapshot.rates[fields.input]); decimalToNanoUsd(snapshot.rates[fields.cached]);
    }
    if (modalityUsage.provenance.videoProcessingToolPrompt === ACCOUNTING_GEMINI_PROCESSING_MODALITY_PROVENANCE) {
      for (const modality of snapshot.usageSemantics.allowedProcessingToolModalities) {
        const { rate } = ACCOUNTING_GEMINI_PROCESSING_RATES.find(row => row.modality === modality);
        decimalToNanoUsd(snapshot.rates[rate]);
      }
    }
  }
  const codeMarker = snapshot.usageSemantics?.codeServerToolUses;
  const code = snapshotExactCodeToolUsage(usage);
  if (codeMarker !== undefined && codeMarker !== ACCOUNTING_CODE_PROVENANCE ||
      codeMarker !== undefined && !code || code && codeMarker === undefined) throw new Error('Invalid original included code semantics');
  const nonBillableMarker = snapshot.usageSemantics?.nonBillableServerToolUses;
  const nonBillable = snapshotExactNonBillableToolUsage(usage);
  if (nonBillableMarker !== undefined && nonBillableMarker !== ACCOUNTING_WEB_FETCH_PROVENANCE ||
      nonBillableMarker !== undefined && !nonBillable || nonBillable && nonBillableMarker === undefined) throw new Error('Invalid original nonbillable tool semantics');
  const marker = snapshot.usageSemantics?.serverToolUses;
  const tools = snapshotExactEmbeddedToolUsage(usage);
  if (marker !== undefined && marker !== ACCOUNTING_EMBEDDED_TOOL_PROVENANCE || marker !== undefined && !tools || tools && marker === undefined) throw new Error('Invalid original embedded usage semantics');
  if (marker !== undefined) {
    if (ACCOUNTING_EMBEDDED_TOOL_RATES.some(({ rate, unit }) =>
      !Object.hasOwn(snapshot.rates || {}, rate) || snapshot.rateUnits?.[rate] !== unit)) throw new Error('Original embedded rate/unit authority required');
  }
  return costFromExactUsage(usage, snapshot.rates, { requireCacheTiers: snapshot.usageSemantics?.cacheWriteTiers === 'observed_5m_1h' });
}
export function costFromExactUsage(usage, rates, { requireCacheTiers = false } = {}) {
  if (!usage || typeof usage !== 'object') throw new Error("Exact usage inclusion provenance required");
  const modalityUsage = snapshotExactGeminiModalityUsage(usage);
  if (modalityUsage) { usage = modalityUsage; rates = snapshotAccountingPreparedData(rates); }
  const toolUsage = snapshotExactEmbeddedToolUsage(usage), nonBillableUsage = snapshotExactNonBillableToolUsage(usage), codeUsage = snapshotExactCodeToolUsage(usage);
  if (toolUsage || nonBillableUsage || codeUsage) {
    usage = toolUsage || nonBillableUsage || codeUsage;
    rates = snapshotAccountingPreparedData(rates);
  }
  if (usage.exact !== true || typeof usage.reasoningIncludedInOutput !== "boolean") throw new Error("Exact usage inclusion provenance required");
  const input = tokens(usage.input, "input"), output = tokens(usage.output, "output");
  const read = tokens(usage.cacheRead, "cached read"), write = tokens(usage.cacheWrite, "cache write");
  const reasoning = tokens(usage.reasoning, "reasoning");
  const tiers = exactCacheWriteTiers(usage);
  if (requireCacheTiers && !tiers) throw new Error('Invalid exact cache-write tier provenance');
  if (read + write > input || usage.reasoningIncludedInOutput && reasoning > output) throw new Error("Invalid exact usage subsets");
  const inputRate = BigInt(decimalToNanoUsd(rates.input));
  const outputRate = BigInt(decimalToNanoUsd(rates.output));
  // Explicit documented fallback to normal input/output rates; zero remains zero.
  const readRate = BigInt(decimalToNanoUsd(rates.cached === undefined ? rates.input : rates.cached));
  const writeRate = BigInt(decimalToNanoUsd(rates.cache_creation === undefined ? rates.input : rates.cache_creation));
  const reasoningRate = BigInt(decimalToNanoUsd(rates.reasoning === undefined ? rates.output : rates.reasoning));
  const plainOutput = usage.reasoningIncludedInOutput ? output - reasoning : output;
  // Missing 1h rate never falls back to input/5m or an inferred multiplier.
  // Explicit zero is supported; a zero observed 1h count needs no missing rate.
  const hourRate = rates.cache_creation_1h === undefined && (!tiers || tiers.hour === 0)
    ? 0n : BigInt(decimalToNanoUsd(rates.cache_creation_1h));
  const writeCost = tiers ? BigInt(tiers.five) * writeRate + BigInt(tiers.hour) * hourRate : write * writeRate;
  let inputCost = (input - read - write) * inputRate + read * readRate + writeCost;
  if (modalityUsage) {
    inputCost = 0n;
    for (const [modality, row] of Object.entries(usage.inputModalities)) {
      const fields = ACCOUNTING_GEMINI_MODALITY_RATES.find(item => item.modality === modality);
      // Explicit cache rate is required even for observed 0; no equality assumption.
      const rate = BigInt(decimalToNanoUsd(rates[fields.input])), cached = BigInt(decimalToNanoUsd(rates[fields.cached]));
      inputCost += BigInt(row.input - row.cacheRead) * rate + BigInt(row.cacheRead) * cached;
    }
  }
  let numerator = inputCost + plainOutput * outputRate + reasoning * reasoningRate;
  if (modalityUsage?.provenance.videoProcessingToolPrompt === ACCOUNTING_GEMINI_PROCESSING_MODALITY_PROVENANCE) {
    for (const [modality, quantity] of Object.entries(usage.processingToolModalities)) {
      const { rate } = ACCOUNTING_GEMINI_PROCESSING_RATES.find(row => row.modality === modality);
      // Loaded tool-prompt tokens are a distinct observed category, not initial
      // input/cache or a per-call fee. Combine before the sole attempt rounding.
      numerator += BigInt(quantity) * BigInt(decimalToNanoUsd(rates[rate]));
    }
  }
  if (toolUsage) {
    for (const { count, rate, usesPerUnit } of ACCOUNTING_EMBEDDED_TOOL_RATES) {
      // Convert per-use components to the token denominator before rounding.
      // A declared category requires its explicit rate even when observed zero;
      // absence is not a free-tool assertion or a fallback to a token rate.
      if (TOKEN_UNIT % usesPerUnit !== 0n) throw new Error('Unsupported embedded tool rate unit');
      numerator += BigInt(usage.toolUses[count]) * BigInt(decimalToNanoUsd(rates[rate])) * (TOKEN_UNIT / usesPerUnit);
    }
  }
  const rounded = (numerator + TOKEN_UNIT / 2n) / TOKEN_UNIT;
  if (rounded > MAX_NANO_USD) throw new Error("Attempt cost range exceeded");
  return rounded.toString();
}
