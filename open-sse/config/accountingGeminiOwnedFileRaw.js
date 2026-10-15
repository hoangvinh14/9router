import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { supportsGeminiRequest } from './accountedGeminiCandidate.js';
import { supportsGeminiOwnedFilesOriginal } from './accountingGeminiOwnedFilesOriginal.js';
import { createGeminiObservedModalityCounters } from './accountingGeminiModalityCounters.js';
import { ACCOUNTING_GEMINI_INLINE_MIME_TYPES, ACCOUNTING_GEMINI_INLINE_AUDIO_MIME_TYPES, ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES } from './accountingGeminiInlineMedia.js';
import { ACCOUNTING_GEMINI_TEXT_INPUT_MODALITY, ACCOUNTING_GEMINI_IMAGE_MODALITY, ACCOUNTING_GEMINI_AUDIO_MODALITY, ACCOUNTING_GEMINI_VIDEO_MODALITY, ACCOUNTING_GEMINI_DOCUMENT_MODALITY } from './accountingGeminiInputModalities.js';

export { ACCOUNTING_GEMINI_OWNED_FILE_MODALITY_PROVENANCE } from './accountingGeminiModalityRates.js';
const owners = new WeakMap();
const unavailable = () => { throw new Error('Invalid original Gemini owned file raw authority'); };
// Pure full-original/category binding, NOT gateway ownership. The app wrapper
// must independently prove and recheck current upload/lifecycle capability.
export function createGeminiOwnedFileRawAuthority(value, inventory, allowVideoMetadata = false, allowVideoResolution = false, allowClientTools = false, allowInlineMedia = false, allowInlineAudio = false, allowInlineVideo = false) {
  if (typeof allowClientTools !== 'boolean' || typeof allowInlineMedia !== 'boolean' || typeof allowInlineAudio !== 'boolean' || typeof allowInlineVideo !== 'boolean') unavailable();
  const original = snapshotAccountingPreparedData(value), resources = snapshotAccountingPreparedData(inventory);
  if (!supportsGeminiOwnedFilesOriginal(original, resources, body => supportsGeminiRequest(body, allowClientTools && Object.hasOwn(body, 'tools'), allowInlineMedia, allowInlineAudio, allowInlineVideo), allowVideoMetadata, allowVideoResolution)) unavailable();
  const allowed = new Set([ACCOUNTING_GEMINI_TEXT_INPUT_MODALITY]);
  for (const { file } of resources) {
    if (ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES.includes(file.mimeType)) {
      allowed.add(ACCOUNTING_GEMINI_VIDEO_MODALITY); allowed.add(ACCOUNTING_GEMINI_IMAGE_MODALITY); allowed.add(ACCOUNTING_GEMINI_AUDIO_MODALITY);
    } else if (ACCOUNTING_GEMINI_INLINE_AUDIO_MIME_TYPES.includes(file.mimeType)) allowed.add(ACCOUNTING_GEMINI_AUDIO_MODALITY);
    else {
      allowed.add(ACCOUNTING_GEMINI_IMAGE_MODALITY);
      if (file.mimeType === 'application/pdf') allowed.add(ACCOUNTING_GEMINI_DOCUMENT_MODALITY);
    }
  }
  // Grammar above validates complete inline parts independently. These are
  // permitted observed categories, never counts inferred from MIME or bytes.
  for (const content of original.contents) for (const part of content.parts) {
    if (!Object.hasOwn(part, 'inlineData')) continue;
    if (ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES.includes(part.inlineData.mimeType)) {
      if (!allowInlineVideo) unavailable();
      allowed.add(ACCOUNTING_GEMINI_VIDEO_MODALITY);
      allowed.add(ACCOUNTING_GEMINI_IMAGE_MODALITY);
      allowed.add(ACCOUNTING_GEMINI_AUDIO_MODALITY);
    } else if (ACCOUNTING_GEMINI_INLINE_AUDIO_MIME_TYPES.includes(part.inlineData.mimeType)) {
      if (!allowInlineAudio) unavailable();
      allowed.add(ACCOUNTING_GEMINI_AUDIO_MODALITY);
    } else {
      if (!allowInlineMedia || !ACCOUNTING_GEMINI_INLINE_MIME_TYPES.includes(part.inlineData.mimeType)) unavailable();
      allowed.add(ACCOUNTING_GEMINI_IMAGE_MODALITY);
      if (part.inlineData.mimeType === 'application/pdf') allowed.add(ACCOUNTING_GEMINI_DOCUMENT_MODALITY);
    }
  }
  const authority = Object.freeze({});
  owners.set(authority, createGeminiObservedModalityCounters([...allowed]));
  return authority;
}
export function assertGeminiOwnedFileRawAuthority(authority) {
  const owner = owners.get(authority);
  if (!owner) unavailable();
  return owner;
}
