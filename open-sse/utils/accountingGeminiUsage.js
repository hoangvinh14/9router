import { assertGeminiOwnedFileRawAuthority, ACCOUNTING_GEMINI_OWNED_FILE_MODALITY_PROVENANCE } from '../config/accountingGeminiOwnedFileRaw.js';
import { readAccountingJson } from './readAccountingJson.js';
import { createGeminiProcessingToolsRawAuthority, assertGeminiProcessingToolsRawAuthority, ACCOUNTING_GEMINI_PROCESSING_MODALITY_PROVENANCE } from '../config/accountingGeminiProcessingToolsRaw.js';
import { ACCOUNTING_GEMINI_PROCESSING_ZERO_PROVENANCE } from '../config/accountingGeminiProcessingEvidence.js';
import { normalizeExactUsage } from './exactUsage.js';
import { FORMATS } from '../translator/formats.js';
import { snapshotAccountingPreparedData } from '../config/accountedBaseDispatch.js';
import { createGeminiClientRawAuthority } from '../config/accountingGeminiClientRaw.js';
import { createGeminiBoundInputModalityAuthority, ACCOUNTING_GEMINI_INLINE_MODALITY_PROVENANCE } from '../config/accountingGeminiInputModalities.js';
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
export function inspectRawGeminiAccounting(message, expectedModel, { clientToolsOriginal = null, inlineMediaOriginal = null, inlineAudioOriginal = null, inlineVideoOriginal = null, videoMetadataOriginal = null, videoResolutionOriginal = null, inlineResolutionOriginal = null, audioResolutionOriginal = null, videoProcessingOriginal = null, processingToolsOriginal = null, processingRawAuthority = null, ownedFileRawAuthority = null } = {}) {
  if (ownedFileRawAuthority !== null && [clientToolsOriginal, inlineMediaOriginal, inlineAudioOriginal, inlineVideoOriginal, videoMetadataOriginal, videoResolutionOriginal, inlineResolutionOriginal, audioResolutionOriginal, videoProcessingOriginal, processingToolsOriginal, processingRawAuthority].some(value => value !== null)) throw new Error('Invalid original Gemini owned file raw authority');
  const modalityAuthority = ownedFileRawAuthority !== null ? assertGeminiOwnedFileRawAuthority(ownedFileRawAuthority) : createGeminiBoundInputModalityAuthority({ inlineMediaOriginal, inlineAudioOriginal, inlineVideoOriginal, clientToolsOriginal, videoMetadataOriginal, videoResolutionOriginal, inlineResolutionOriginal, audioResolutionOriginal, videoProcessingOriginal, processingToolsOriginal });
  let contentValid, clientAuthority = null;
  if (clientToolsOriginal !== null || modalityAuthority) message = snapshotAccountingPreparedData(message);
  if (clientToolsOriginal !== null) {
    clientAuthority = createGeminiClientRawAuthority(clientToolsOriginal, inlineMediaOriginal !== null, inlineAudioOriginal !== null, inlineVideoOriginal !== null, videoMetadataOriginal !== null, videoResolutionOriginal !== null, inlineResolutionOriginal !== null, audioResolutionOriginal !== null, videoProcessingOriginal !== null, processingToolsOriginal !== null && clientToolsOriginal.contents.some(content => content.parts.some(part => Object.hasOwn(part, 'toolCall') || Object.hasOwn(part, 'toolResponse'))));
    if (processingToolsOriginal === null) contentValid = clientAuthority.acceptContent(message.candidates?.[0]?.content);
  }
  if (processingRawAuthority !== null && processingToolsOriginal === null) throw new Error('Invalid raw Gemini processing authority');
  const processingAuthority = processingToolsOriginal === null ? null : processingRawAuthority === null
    ? createGeminiProcessingToolsRawAuthority(processingToolsOriginal, modalityAuthority.allowedInputModalities, clientAuthority)
    : assertGeminiProcessingToolsRawAuthority(processingRawAuthority, processingToolsOriginal, modalityAuthority.allowedInputModalities);
  if (processingAuthority) contentValid = processingAuthority.acceptContent(message.candidates?.[0]?.content, true);
  const raw = message?.usageMetadata;
  if (!fields(message, ACCOUNTING_GEMINI_MESSAGE_FIELDS) || message.modelVersion !== expectedModel ||
      message.responseId !== undefined && (typeof message.responseId !== 'string' || !message.responseId) ||
      message.promptFeedback !== undefined && (!fields(message.promptFeedback, ['safetyRatings']) || !Array.isArray(message.promptFeedback.safetyRatings)) ||
      !Array.isArray(message.candidates) || message.candidates.length !== 1) throw new Error('Invalid raw Gemini response');
  const candidate = message.candidates[0];
  if (!fields(candidate, ACCOUNTING_GEMINI_CANDIDATE_FIELDS) || candidate.index !== 0 || !ACCOUNTING_GEMINI_FINISH.includes(candidate.finishReason) ||
      !(clientToolsOriginal !== null || processingAuthority ? contentValid : fields(candidate.content, ['role', 'parts']) && candidate.content.role === 'model' && Array.isArray(candidate.content.parts) &&
        candidate.content.parts.every(part => fields(part, ['text', 'thought']) && typeof part.text === 'string' &&
          (part.thought === undefined || typeof part.thought === 'boolean'))) ||
      candidate.safetyRatings !== undefined && !Array.isArray(candidate.safetyRatings) ||
      candidate.avgLogprobs !== undefined && (typeof candidate.avgLogprobs !== 'number' || !Number.isFinite(candidate.avgLogprobs)) ||
      candidate.tokenCount !== undefined && !count(candidate.tokenCount) ||
      !fields(raw, ACCOUNTING_GEMINI_USAGE_FIELDS) || ![raw.promptTokenCount, raw.candidatesTokenCount, raw.totalTokenCount].every(count) ||
      ![raw.cachedContentTokenCount ?? 0, raw.thoughtsTokenCount ?? 0, raw.toolUsePromptTokenCount ?? 0].every(count) ||
      raw.cachedContentTokenCount === null || raw.thoughtsTokenCount === null || raw.toolUsePromptTokenCount === null ||
      !processingAuthority && (raw.toolUsePromptTokenCount !== undefined && raw.toolUsePromptTokenCount !== 0) ||
      // Owned-file input is an independent non-processing grant. Explicit zero
      // or empty processing attribution cannot silently widen that grant.
      ownedFileRawAuthority !== null && (Object.hasOwn(raw, 'toolUsePromptTokenCount') || Object.hasOwn(raw, 'toolUsePromptTokensDetails')) ||
      // Processing work needs explicit observed terminal zero for this finite
      // token-only slice. Missing/nonzero tool attribution is not a free default.
      videoProcessingOriginal !== null && !processingAuthority && raw.toolUsePromptTokenCount !== 0 ||
      raw.serviceTier !== undefined && !ACCOUNTED_GEMINI_STANDARD_TIERS.includes(raw.serviceTier) ||
      BigInt(raw.promptTokenCount) + BigInt(raw.candidatesTokenCount) + BigInt(raw.thoughtsTokenCount ?? 0) + BigInt(processingAuthority ? raw.toolUsePromptTokenCount ?? 0 : 0) !== BigInt(raw.totalTokenCount) ||
      !modalityAuthority && (!textDetails(raw.promptTokensDetails, raw.promptTokenCount) || !textDetails(raw.cacheTokensDetails, raw.cachedContentTokenCount ?? 0)) ||
      !textDetails(raw.candidatesTokensDetails, raw.candidatesTokenCount) || !processingAuthority && !textDetails(raw.toolUsePromptTokensDetails, 0)) {
    throw new Error('Invalid raw Gemini accounting response');
  }
  const processingToolModalities = processingAuthority?.inspectUsage(raw, true);
  const usage = normalizeExactUsage(raw, FORMATS.GEMINI, 'chat', { allowGeminiProcessingUsage: processingAuthority !== null });
  if (!usage) throw new Error('Invalid raw Gemini accounting usage');
  const inputModalities = modalityAuthority?.inspect(raw, true);
  return { message, usage: inputModalities ? { ...usage, inputModalities,
    ...(videoProcessingOriginal !== null ? { processingToolPromptTokens: raw.toolUsePromptTokenCount } : {}),
    ...(processingAuthority ? { processingToolModalities } : {}),
    provenance: { ...usage.provenance, inputModalities: ownedFileRawAuthority !== null ? ACCOUNTING_GEMINI_OWNED_FILE_MODALITY_PROVENANCE : ACCOUNTING_GEMINI_INLINE_MODALITY_PROVENANCE,
      ...(videoProcessingOriginal !== null ? { videoProcessingToolPrompt: processingAuthority ? ACCOUNTING_GEMINI_PROCESSING_MODALITY_PROVENANCE : ACCOUNTING_GEMINI_PROCESSING_ZERO_PROVENANCE } : {}) } } : usage };
}
export async function readBufferedGeminiAccounting(response, signal, { expectedModel, clientToolsOriginal = null, inlineMediaOriginal = null, inlineAudioOriginal = null, inlineVideoOriginal = null, videoMetadataOriginal = null, videoResolutionOriginal = null, inlineResolutionOriginal = null, audioResolutionOriginal = null, videoProcessingOriginal = null, processingToolsOriginal = null, ownedFileRawAuthority = null } = {}) {
  signal?.throwIfAborted();
  if (typeof expectedModel !== 'string' || !expectedModel || !response.ok || response.redirected ||
      response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error('Unsupported raw Gemini accounting response');
  const message = await readAccountingJson(response, signal);
  signal?.throwIfAborted();
  return inspectRawGeminiAccounting(message, expectedModel, { clientToolsOriginal, inlineMediaOriginal, inlineAudioOriginal, inlineVideoOriginal, videoMetadataOriginal, videoResolutionOriginal, inlineResolutionOriginal, audioResolutionOriginal, videoProcessingOriginal, processingToolsOriginal, ownedFileRawAuthority });
}
