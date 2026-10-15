import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';

// Shared observed detail grammar only: never grants an original input kind or
// computes counts from metadata. Caller owns the independent category grant.
const count = value => Number.isSafeInteger(value) && value >= 0;
const unavailable = () => { throw new Error('Invalid exact Gemini input modality authority'); };
export function createGeminiObservedModalityCounters(categories) {
  const captured = snapshotAccountingPreparedData(categories);
  if (!Array.isArray(captured) || !captured.includes('TEXT') || captured.some(c => !['TEXT', 'IMAGE', 'DOCUMENT', 'AUDIO', 'VIDEO'].includes(c)) || new Set(captured).size !== captured.length) unavailable();
  const allowed = new Set(captured);
  function details(value, total, required) {
    if (value === undefined) { if (required) unavailable(); return null; }
    if (!Array.isArray(value) || !count(total)) unavailable();
    const result = {};
    for (const row of value) {
      if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== 2 ||
          !Object.hasOwn(row, 'modality') || !Object.hasOwn(row, 'tokenCount') || !allowed.has(row.modality) || !count(row.tokenCount) || Object.hasOwn(result, row.modality)) unavailable();
      result[row.modality] = row.tokenCount;
    }
    if (Object.values(result).reduce((sum, value) => sum + BigInt(value), 0n) !== BigInt(total)) unavailable();
    return result;
  }
  return Object.freeze({
    allowedInputModalities: captured,
    inspect(value, terminal = false) {
      const raw = snapshotAccountingPreparedData(value);
      const input = details(raw.promptTokensDetails, raw.promptTokenCount, terminal);
      // Explicit attribution required even for zero cache; no missing-detail
      // fallback. A category present only in cache is never invented in input.
      const cache = details(raw.cacheTokensDetails, raw.cachedContentTokenCount ?? 0, terminal);
      if (input && cache && Object.entries(cache).some(([modality, tokens]) => !Object.hasOwn(input, modality) || tokens > input[modality])) unavailable();
      if (!terminal) return null;
      return Object.fromEntries(Object.entries(input).map(([modality, tokens]) => [modality, { input: tokens, cacheRead: cache[modality] ?? 0 }]));
    },
  });
}
