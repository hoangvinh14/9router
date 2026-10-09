import { readAccountingJson } from './readAccountingJson.js';
import { normalizeExactUsage } from './exactUsage.js';
import { FORMATS } from '../translator/formats.js';
import { ACCOUNTED_GEMINI_STANDARD_TIERS } from '../config/accountedGeminiCandidate.js';
import { ACCOUNTING_GEMINI_MESSAGE_FIELDS, ACCOUNTING_GEMINI_CANDIDATE_FIELDS, ACCOUNTING_GEMINI_USAGE_FIELDS,
  ACCOUNTING_GEMINI_FINISH, ACCOUNTING_GEMINI_TEXT_MODALITY } from '../config/accountingGeminiSchema.js';
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const fields = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const count = value => Number.isSafeInteger(value) && value >= 0;
// Optional modality detail still has to prove text-only counters; absence does
// not invent zero for the required primary prompt/candidates/total counters.
function textDetails(value, total) {
  return value === undefined || Array.isArray(value) && value.every(row =>
    fields(row, ['modality', 'tokenCount']) && row.modality === ACCOUNTING_GEMINI_TEXT_MODALITY && count(row.tokenCount)) &&
    value.reduce((sum, row) => sum + BigInt(row.tokenCount), 0n) === BigInt(total);
}
export function inspectRawGeminiAccounting(message, expectedModel) {
  const raw = message?.usageMetadata;
  if (!fields(message, ACCOUNTING_GEMINI_MESSAGE_FIELDS) || message.modelVersion !== expectedModel ||
      message.responseId !== undefined && (typeof message.responseId !== 'string' || !message.responseId) ||
      message.promptFeedback !== undefined && (!fields(message.promptFeedback, ['safetyRatings']) || !Array.isArray(message.promptFeedback.safetyRatings)) ||
      !Array.isArray(message.candidates) || message.candidates.length !== 1) throw new Error('Invalid raw Gemini response');
  const candidate = message.candidates[0];
  if (!fields(candidate, ACCOUNTING_GEMINI_CANDIDATE_FIELDS) || candidate.index !== 0 || !ACCOUNTING_GEMINI_FINISH.includes(candidate.finishReason) ||
      !fields(candidate.content, ['role', 'parts']) || candidate.content.role !== 'model' || !Array.isArray(candidate.content.parts) ||
      !candidate.content.parts.every(part => fields(part, ['text', 'thought']) && typeof part.text === 'string' &&
        (part.thought === undefined || typeof part.thought === 'boolean')) ||
      candidate.safetyRatings !== undefined && !Array.isArray(candidate.safetyRatings) ||
      candidate.avgLogprobs !== undefined && (typeof candidate.avgLogprobs !== 'number' || !Number.isFinite(candidate.avgLogprobs)) ||
      candidate.tokenCount !== undefined && !count(candidate.tokenCount) ||
      !fields(raw, ACCOUNTING_GEMINI_USAGE_FIELDS) || ![raw.promptTokenCount, raw.candidatesTokenCount, raw.totalTokenCount].every(count) ||
      ![raw.cachedContentTokenCount ?? 0, raw.thoughtsTokenCount ?? 0, raw.toolUsePromptTokenCount ?? 0].every(count) ||
      raw.cachedContentTokenCount === null || raw.thoughtsTokenCount === null || raw.toolUsePromptTokenCount === null ||
      (raw.toolUsePromptTokenCount !== undefined && raw.toolUsePromptTokenCount !== 0) ||
      raw.serviceTier !== undefined && !ACCOUNTED_GEMINI_STANDARD_TIERS.includes(raw.serviceTier) ||
      BigInt(raw.promptTokenCount) + BigInt(raw.candidatesTokenCount) + BigInt(raw.thoughtsTokenCount ?? 0) !== BigInt(raw.totalTokenCount) ||
      !textDetails(raw.promptTokensDetails, raw.promptTokenCount) || !textDetails(raw.cacheTokensDetails, raw.cachedContentTokenCount ?? 0) ||
      !textDetails(raw.candidatesTokensDetails, raw.candidatesTokenCount) || !textDetails(raw.toolUsePromptTokensDetails, 0)) {
    throw new Error('Invalid raw Gemini accounting response');
  }
  const usage = normalizeExactUsage(raw, FORMATS.GEMINI);
  if (!usage) throw new Error('Invalid raw Gemini accounting usage');
  return { message, usage };
}
export async function readBufferedGeminiAccounting(response, signal, { expectedModel } = {}) {
  signal?.throwIfAborted();
  if (typeof expectedModel !== 'string' || !expectedModel || !response.ok || response.redirected ||
      response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error('Unsupported raw Gemini accounting response');
  const message = await readAccountingJson(response, signal);
  signal?.throwIfAborted();
  return inspectRawGeminiAccounting(message, expectedModel);
}
