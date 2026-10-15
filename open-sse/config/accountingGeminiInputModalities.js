import { createGeminiObservedModalityCounters } from './accountingGeminiModalityCounters.js';
import { isDeepStrictEqual } from 'node:util';
import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { supportsGeminiRequest } from './accountedGeminiCandidate.js';
import { ACCOUNTING_GEMINI_INLINE_MIME_TYPES, ACCOUNTING_GEMINI_INLINE_AUDIO_MIME_TYPES, ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES } from './accountingGeminiInlineMedia.js';

export const ACCOUNTING_GEMINI_INLINE_MODALITY_PROVENANCE = 'observed_gemini_inline_input_modalities';
export const ACCOUNTING_GEMINI_IMAGE_MODALITY = 'IMAGE';
export const ACCOUNTING_GEMINI_AUDIO_MODALITY = 'AUDIO';
export const ACCOUNTING_GEMINI_VIDEO_MODALITY = 'VIDEO';
export const ACCOUNTING_GEMINI_DOCUMENT_MODALITY = 'DOCUMENT';
export const ACCOUNTING_GEMINI_TEXT_INPUT_MODALITY = 'TEXT';
const unavailable = () => { throw new Error('Invalid Gemini inline modality authority'); };
// Independent bindings grant independent input kinds, never inspect MIME to
// silently enable a missing audio/image/client permission.
export function createGeminiBoundInputModalityAuthority({ inlineMediaOriginal = null, inlineAudioOriginal = null, inlineVideoOriginal = null, clientToolsOriginal = null, videoMetadataOriginal = null, videoResolutionOriginal = null, inlineResolutionOriginal = null, audioResolutionOriginal = null, videoProcessingOriginal = null, processingToolsOriginal = null } = {}) {
  if (processingToolsOriginal !== null && (inlineVideoOriginal === null || videoProcessingOriginal === null)) unavailable();
  if (audioResolutionOriginal !== null && inlineAudioOriginal === null) unavailable();
  if (inlineResolutionOriginal !== null && inlineMediaOriginal === null) unavailable();
  if ((videoMetadataOriginal !== null || videoResolutionOriginal !== null || videoProcessingOriginal !== null) && inlineVideoOriginal === null) unavailable();
  if (inlineMediaOriginal === null && inlineAudioOriginal === null && inlineVideoOriginal === null) return null;
  const original = snapshotAccountingPreparedData(inlineMediaOriginal ?? inlineAudioOriginal ?? inlineVideoOriginal);
  for (const binding of [inlineMediaOriginal, inlineAudioOriginal, inlineVideoOriginal, clientToolsOriginal, videoMetadataOriginal, videoResolutionOriginal, inlineResolutionOriginal, audioResolutionOriginal, videoProcessingOriginal, processingToolsOriginal]) {
    if (binding !== null && !isDeepStrictEqual(original, snapshotAccountingPreparedData(binding))) unavailable();
  }
  return createGeminiInputModalityAuthority(original, clientToolsOriginal, inlineMediaOriginal !== null, inlineAudioOriginal !== null, inlineVideoOriginal !== null, videoMetadataOriginal !== null, videoResolutionOriginal !== null, inlineResolutionOriginal !== null, audioResolutionOriginal !== null, videoProcessingOriginal !== null, processingToolsOriginal !== null && original.contents.some(content => content.parts.some(part => Object.hasOwn(part, 'toolCall') || Object.hasOwn(part, 'toolResponse'))));
}
export function createGeminiInputModalityAuthority(value, clientOriginal = null, allowInlineMedia = true, allowInlineAudio = false, allowInlineVideo = false, allowVideoMetadata = false, allowVideoResolution = false, allowInlineResolution = false, allowAudioResolution = false, allowVideoProcessing = false, allowProcessingTrace = false) {
  const original = snapshotAccountingPreparedData(value);
  if (typeof allowInlineMedia !== 'boolean' || typeof allowInlineAudio !== 'boolean' || typeof allowInlineVideo !== 'boolean' || typeof allowVideoMetadata !== 'boolean' || typeof allowVideoResolution !== 'boolean' || typeof allowInlineResolution !== 'boolean' || typeof allowAudioResolution !== 'boolean' || typeof allowVideoProcessing !== 'boolean' || typeof allowProcessingTrace !== 'boolean' ||
      clientOriginal !== null && !isDeepStrictEqual(original, snapshotAccountingPreparedData(clientOriginal)) ||
      !supportsGeminiRequest(original, clientOriginal !== null, allowInlineMedia, allowInlineAudio, allowInlineVideo, allowVideoMetadata, allowVideoResolution, allowInlineResolution, allowAudioResolution, allowVideoProcessing, allowProcessingTrace) ||
      allowVideoProcessing && (!allowInlineVideo || !original.contents.some(content => content.parts.some(part =>
        Object.hasOwn(part, 'mediaProcessing') && ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES.includes(part.inlineData?.mimeType)))) ||
      allowAudioResolution && (!allowInlineAudio || !original.contents.some(content => content.parts.some(part =>
        ACCOUNTING_GEMINI_INLINE_AUDIO_MIME_TYPES.includes(part.inlineData?.mimeType))) ||
        !Object.hasOwn(original.generationConfig || {}, 'mediaResolution') && !original.contents.some(content => content.parts.some(part =>
          Object.hasOwn(part, 'mediaResolution') && ACCOUNTING_GEMINI_INLINE_AUDIO_MIME_TYPES.includes(part.inlineData?.mimeType)))) ||
      allowInlineResolution && (!allowInlineMedia || !original.contents.some(content => content.parts.some(part =>
        ACCOUNTING_GEMINI_INLINE_MIME_TYPES.includes(part.inlineData?.mimeType))) ||
        !Object.hasOwn(original.generationConfig || {}, 'mediaResolution') && !original.contents.some(content => content.parts.some(part =>
          Object.hasOwn(part, 'mediaResolution') && ACCOUNTING_GEMINI_INLINE_MIME_TYPES.includes(part.inlineData?.mimeType)))) ||
      allowVideoResolution && (!allowInlineVideo || !original.contents.some(content => content.parts.some(part =>
        ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES.includes(part.inlineData?.mimeType))) ||
        !Object.hasOwn(original.generationConfig || {}, 'mediaResolution') && !original.contents.some(content => content.parts.some(part =>
          Object.hasOwn(part, 'mediaResolution') && ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES.includes(part.inlineData?.mimeType)))) ||
      allowVideoMetadata && (!allowInlineVideo || !original.contents.some(content => content.parts.some(part =>
        Object.hasOwn(part, 'videoMetadata') && ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES.includes(part.inlineData?.mimeType))))) unavailable();
  const allowed = new Set([ACCOUNTING_GEMINI_TEXT_INPUT_MODALITY]); let media = false;
  for (const content of original.contents) for (const part of content.parts) {
    if (part.inlineData) {
      media = true;
      if (ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES.includes(part.inlineData.mimeType)) {
        // Video can report frames/audio or VIDEO. This grants observed detail
        // categories only, never separate original image/audio input permission
        // or estimated counts, flat rates or model-specific equivalence.
        allowed.add(ACCOUNTING_GEMINI_VIDEO_MODALITY); allowed.add(ACCOUNTING_GEMINI_IMAGE_MODALITY); allowed.add(ACCOUNTING_GEMINI_AUDIO_MODALITY);
      } else if (ACCOUNTING_GEMINI_INLINE_AUDIO_MIME_TYPES.includes(part.inlineData.mimeType)) allowed.add(ACCOUNTING_GEMINI_AUDIO_MODALITY);
      else {
        allowed.add(ACCOUNTING_GEMINI_IMAGE_MODALITY);
        if (part.inlineData.mimeType === 'application/pdf') allowed.add(ACCOUNTING_GEMINI_DOCUMENT_MODALITY);
      }
    }
  }
  if (!media) unavailable();
  return createGeminiObservedModalityCounters([...allowed]);
}
