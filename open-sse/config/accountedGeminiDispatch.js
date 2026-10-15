import { ACCOUNTED_GEMINI_OWNED_FILES_MODES, ACCOUNTED_GEMINI_OWNED_FILES_SSE_MODE, isGeminiOwnedFilesMode, ACCOUNTED_GEMINI_OWNED_VIDEO_METADATA_MODES, ACCOUNTED_GEMINI_OWNED_VIDEO_METADATA_SSE_MODE, isGeminiOwnedVideoMetadataMode, ACCOUNTED_GEMINI_OWNED_VIDEO_RESOLUTION_MODES, ACCOUNTED_GEMINI_OWNED_VIDEO_RESOLUTION_SSE_MODE, isGeminiOwnedVideoResolutionMode, ACCOUNTED_GEMINI_OWNED_VIDEO_COMBINED_MODES, ACCOUNTED_GEMINI_OWNED_VIDEO_COMBINED_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_MODES, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_MODES, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_MODES, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_VIDEO_MODES, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_VIDEO_SSE_MODE, isGeminiOwnedVideoClientInlineAudioVideoMode, isGeminiOwnedVideoClientInlineAudioMode, isGeminiOwnedVideoClientInlineMode, isGeminiOwnedVideoClientMode } from './accountingGeminiOwnedFilesModes.js';
import { supportsGeminiOwnedFilesOriginal } from './accountingGeminiOwnedFilesOriginal.js';
import { isDeepStrictEqual } from 'node:util';
import { ACCOUNTED_GEMINI_PROCESSING_TOOLS_MODES, ACCOUNTED_GEMINI_PROCESSING_TOOLS_SSE_MODE, isGeminiProcessingToolsMode } from './accountingGeminiProcessingToolsModes.js';
import { ACCOUNTED_GEMINI_VIDEO_PROCESSING_MODES, ACCOUNTED_GEMINI_VIDEO_PROCESSING_SSE_MODE, isGeminiVideoProcessingMode } from './accountingGeminiVideoProcessingModes.js';
import { ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES } from './accountingGeminiInlineMedia.js';
import { PROVIDERS } from './providers.js';
import { FORMATS } from '../translator/formats.js';
import { captureAccountingBaseTransport } from './accountedBaseTransport.js';
import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { ACCOUNTED_GEMINI_BASE, ACCOUNTED_GEMINI_ACTION, ACCOUNTED_GEMINI_STREAM_ACTION, ACCOUNTED_GEMINI_MODEL, ACCOUNTED_GEMINI_MODE, ACCOUNTED_GEMINI_SSE_MODE, ACCOUNTED_GEMINI_HEADER_FIELDS, supportsGeminiRequest } from './accountedGeminiCandidate.js';

import { ACCOUNTED_GEMINI_CLIENT_MODES, ACCOUNTED_GEMINI_CLIENT_SSE_MODE, isGeminiClientMode } from './accountingGeminiClientModes.js';

import { ACCOUNTED_GEMINI_INLINE_MODES, ACCOUNTED_GEMINI_INLINE_SSE_MODE, isGeminiInlineMode } from './accountingGeminiInlineModes.js';
import { ACCOUNTED_GEMINI_INLINE_RESOLUTION_MODES, ACCOUNTED_GEMINI_INLINE_RESOLUTION_SSE_MODE, isGeminiInlineResolutionMode } from './accountingGeminiInlineResolutionModes.js';
import { ACCOUNTED_GEMINI_AUDIO_RESOLUTION_MODES, ACCOUNTED_GEMINI_AUDIO_RESOLUTION_SSE_MODE, isGeminiAudioResolutionMode } from './accountingGeminiAudioResolutionModes.js';
import { createGeminiInputModalityAuthority, ACCOUNTING_GEMINI_AUDIO_MODALITY, ACCOUNTING_GEMINI_VIDEO_MODALITY } from './accountingGeminiInputModalities.js';
import { ACCOUNTED_GEMINI_AUDIO_MODES, ACCOUNTED_GEMINI_AUDIO_SSE_MODE, isGeminiAudioMode } from './accountingGeminiAudioModes.js';
import { ACCOUNTED_GEMINI_VIDEO_MODES, ACCOUNTED_GEMINI_VIDEO_SSE_MODE, isGeminiVideoMode } from './accountingGeminiVideoModes.js';
import { ACCOUNTED_GEMINI_VIDEO_METADATA_MODES, ACCOUNTED_GEMINI_VIDEO_METADATA_SSE_MODE, isGeminiVideoMetadataMode } from './accountingGeminiVideoMetadataModes.js';
import { ACCOUNTED_GEMINI_VIDEO_RESOLUTION_MODES, ACCOUNTED_GEMINI_VIDEO_RESOLUTION_SSE_MODE, isGeminiVideoResolutionMode } from './accountingGeminiVideoResolutionModes.js';
const unavailable = () => { throw new Error('Accounting Gemini transport unavailable'); };
// Fixed native API-key route only. Registry equality is not permission for a
// custom endpoint, OAuth/envelope or a different request transform.
export function validateAccountingGeminiDispatch(value, url) {
  const evidence = snapshotAccountingPreparedData(value);
  const ownedVideoMetadata = isGeminiOwnedVideoMetadataMode(evidence?.mode);
  const ownedVideoResolution = isGeminiOwnedVideoResolutionMode(evidence?.mode);
  const ownedFiles = isGeminiOwnedFilesMode(evidence?.mode) || ownedVideoMetadata || ownedVideoResolution;
  const processingTools = isGeminiProcessingToolsMode(evidence?.mode);
  const processing = isGeminiVideoProcessingMode(evidence?.mode) || processingTools;
  const processingTrace = processingTools && evidence?.originalBody?.contents?.some(content => content.parts?.some(part => Object.hasOwn(part, 'toolCall') || Object.hasOwn(part, 'toolResponse')));
  const audioResolution = isGeminiAudioResolutionMode(evidence?.mode);
  const inlineResolution = isGeminiInlineResolutionMode(evidence?.mode);
  const resolution = isGeminiVideoResolutionMode(evidence?.mode) || processing && (Object.hasOwn(evidence?.originalBody?.generationConfig || {}, 'mediaResolution') || evidence?.originalBody?.contents?.some(content => content.parts?.some(part => Object.hasOwn(part, 'mediaResolution') && ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES.includes(part.inlineData?.mimeType))));
  const metadata = isGeminiVideoMetadataMode(evidence?.mode);
  const video = isGeminiVideoMode(evidence?.mode) || metadata || resolution || processing, audio = isGeminiAudioMode(evidence?.mode) || video || audioResolution, inline = isGeminiInlineMode(evidence?.mode) || audio || inlineResolution, originalRequired = ownedFiles || inline || isGeminiClientMode(evidence?.mode);
  const client = isGeminiClientMode(evidence?.mode) || inline && Object.hasOwn(evidence?.originalBody || {}, 'tools');
  if (!evidence || Array.isArray(evidence) || Object.keys(evidence).length !== (ownedFiles ? 6 : originalRequired ? 5 : 4) ||
      ownedFiles && !Object.hasOwn(evidence, 'resources') ||
      originalRequired && !Object.hasOwn(evidence, 'originalBody') ||
      !['model', 'mode', 'baseTransport', 'serializedBody'].every(key => Object.hasOwn(evidence, key)) ||
      typeof evidence.model !== 'string' || !ACCOUNTED_GEMINI_MODEL.test(evidence.model) ||
      ![ACCOUNTED_GEMINI_MODE, ACCOUNTED_GEMINI_SSE_MODE, ...ACCOUNTED_GEMINI_CLIENT_MODES, ...ACCOUNTED_GEMINI_INLINE_MODES, ...ACCOUNTED_GEMINI_AUDIO_MODES, ...ACCOUNTED_GEMINI_VIDEO_MODES, ...ACCOUNTED_GEMINI_VIDEO_METADATA_MODES, ...ACCOUNTED_GEMINI_VIDEO_RESOLUTION_MODES, ...ACCOUNTED_GEMINI_INLINE_RESOLUTION_MODES, ...ACCOUNTED_GEMINI_AUDIO_RESOLUTION_MODES, ...ACCOUNTED_GEMINI_VIDEO_PROCESSING_MODES, ...ACCOUNTED_GEMINI_PROCESSING_TOOLS_MODES, ...ACCOUNTED_GEMINI_OWNED_FILES_MODES, ...ACCOUNTED_GEMINI_OWNED_VIDEO_METADATA_MODES, ...ACCOUNTED_GEMINI_OWNED_VIDEO_RESOLUTION_MODES, ...ACCOUNTED_GEMINI_OWNED_VIDEO_COMBINED_MODES, ...ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_MODES, ...ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_MODES, ...ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_MODES, ...ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_VIDEO_MODES].includes(evidence.mode) ||
      !isDeepStrictEqual(evidence.baseTransport, captureAccountingBaseTransport(PROVIDERS.gemini)) || evidence.baseTransport.format !== FORMATS.GEMINI ||
      url !== `${ACCOUNTED_GEMINI_BASE}/${evidence.model}${[ACCOUNTED_GEMINI_SSE_MODE, ACCOUNTED_GEMINI_CLIENT_SSE_MODE, ACCOUNTED_GEMINI_INLINE_SSE_MODE, ACCOUNTED_GEMINI_AUDIO_SSE_MODE, ACCOUNTED_GEMINI_VIDEO_SSE_MODE, ACCOUNTED_GEMINI_VIDEO_METADATA_SSE_MODE, ACCOUNTED_GEMINI_VIDEO_RESOLUTION_SSE_MODE, ACCOUNTED_GEMINI_INLINE_RESOLUTION_SSE_MODE, ACCOUNTED_GEMINI_AUDIO_RESOLUTION_SSE_MODE, ACCOUNTED_GEMINI_VIDEO_PROCESSING_SSE_MODE, ACCOUNTED_GEMINI_PROCESSING_TOOLS_SSE_MODE, ACCOUNTED_GEMINI_OWNED_FILES_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_METADATA_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_RESOLUTION_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_COMBINED_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_VIDEO_SSE_MODE].includes(evidence.mode) ? ACCOUNTED_GEMINI_STREAM_ACTION + '?alt=sse' : ACCOUNTED_GEMINI_ACTION}`) unavailable();
  let body;
  try { body = JSON.parse(evidence.serializedBody); } catch { unavailable(); }
  const originalMetadata = metadata || (resolution || processing) && evidence.originalBody?.contents?.some(content => content.parts?.some(part => Object.hasOwn(part, 'videoMetadata')));
  if (ownedFiles) {
    // Complete original structural inventory only; gateway upload provenance
    // and current tenant/lifecycle require independent app enqueue/dequeue proof.
    if (!supportsGeminiOwnedFilesOriginal(body, evidence.resources, value => supportsGeminiRequest(value, isGeminiOwnedVideoClientMode(evidence.mode) && Object.hasOwn(value, 'tools'), isGeminiOwnedVideoClientInlineMode(evidence.mode), isGeminiOwnedVideoClientInlineAudioMode(evidence.mode), isGeminiOwnedVideoClientInlineAudioVideoMode(evidence.mode)), ownedVideoMetadata, ownedVideoResolution) ||
        !supportsGeminiOwnedFilesOriginal(evidence.originalBody, evidence.resources, value => supportsGeminiRequest(value, isGeminiOwnedVideoClientMode(evidence.mode) && Object.hasOwn(value, 'tools'), isGeminiOwnedVideoClientInlineMode(evidence.mode), isGeminiOwnedVideoClientInlineAudioMode(evidence.mode), isGeminiOwnedVideoClientInlineAudioVideoMode(evidence.mode)), ownedVideoMetadata, ownedVideoResolution) ||
        !isDeepStrictEqual(body, evidence.originalBody)) unavailable();
  } else if (!supportsGeminiRequest(body, client, inline, audio, video, originalMetadata, resolution, inlineResolution, audioResolution, processing, processingTrace) || originalRequired && (!supportsGeminiRequest(evidence.originalBody, client, inline, audio, video, originalMetadata, resolution, inlineResolution, audioResolution, processing, processingTrace) || !isDeepStrictEqual(body, evidence.originalBody))) unavailable();
  if (inline) {
    const authority = createGeminiInputModalityAuthority(evidence.originalBody, client ? evidence.originalBody : null, true, audio, video, originalMetadata, resolution, inlineResolution, audioResolution, processing, processingTrace);
    if (processing && !evidence.originalBody.contents.some(content => content.parts.some(part => Object.hasOwn(part, 'mediaProcessing') && ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES.includes(part.inlineData?.mimeType)))) unavailable();
    if (video && !authority.allowedInputModalities.includes(ACCOUNTING_GEMINI_VIDEO_MODALITY) || audio && !video && !authority.allowedInputModalities.includes(ACCOUNTING_GEMINI_AUDIO_MODALITY)) unavailable();
  }
  return evidence;
}
export function validateAccountingGeminiPost(evidence, url, options) {
  const original = validateAccountingGeminiDispatch(evidence, url), headers = new Headers(options.headers);
  if (options.method !== 'POST' || options.redirect !== 'error' || options.body !== original.serializedBody ||
      [...headers.keys()].some(key => !ACCOUNTED_GEMINI_HEADER_FIELDS.includes(key)) ||
      headers.get('content-type') !== 'application/json' || !headers.get('x-goog-api-key')) unavailable();
  return original;
}
