import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { GEMINI_ROLE } from '../translator/schema/roles.js';
import { supportsGeminiVideoMetadata } from './accountingGeminiVideoMetadata.js';
import { supportsGeminiVideoProcessing } from './accountingGeminiVideoProcessing.js';
import { supportsGeminiVideoPartResolution, supportsGeminiVideoGenerationResolution } from './accountingGeminiVideoResolution.js';

export const ACCOUNTING_GEMINI_INLINE_MIME_TYPES = Object.freeze([
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'image/avif', 'application/pdf',
]);
export const ACCOUNTING_GEMINI_INLINE_AUDIO_MIME_TYPES = Object.freeze([
  'audio/wav', 'audio/mp3', 'audio/aiff', 'audio/aac', 'audio/ogg', 'audio/flac', 'audio/mpeg',
  'audio/m4a', 'audio/l16', 'audio/opus', 'audio/alaw', 'audio/mulaw', 'audio/webm',
]);
export const ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES = Object.freeze([
  'video/mp4', 'video/mpeg', 'video/mov', 'video/avi', 'video/x-flv', 'video/mpg', 'video/webm', 'video/wmv', 'video/3gpp',
]);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
// Canonical encoding only; no image/PDF/audio/video decoding, duration, frames, decompression, page count,
// content sniffing, URL/Files lookup or implied model/price eligibility.
const base64 = value => typeof value === 'string' && value.length > 0 && value.length % 4 === 0 &&
  /^[A-Za-z0-9+/]+={0,2}$/.test(value) && Buffer.from(value, 'base64').toString('base64') === value;
export function supportsGeminiInlineMediaOriginal(value, validateOriginal, allowInlineMedia = true, allowInlineAudio = false, allowInlineVideo = false, allowVideoMetadata = false, allowVideoResolution = false, allowInlineResolution = false, allowAudioResolution = false, allowVideoProcessing = false) {
  if (typeof allowInlineMedia !== 'boolean' || typeof allowInlineAudio !== 'boolean' || typeof allowInlineVideo !== 'boolean' || typeof allowVideoMetadata !== 'boolean' || typeof allowVideoResolution !== 'boolean' || typeof allowInlineResolution !== 'boolean' || typeof allowAudioResolution !== 'boolean' || typeof allowVideoProcessing !== 'boolean') return false;
  const allowed = [
    ...(allowInlineMedia ? ACCOUNTING_GEMINI_INLINE_MIME_TYPES : []),
    ...(allowInlineAudio ? ACCOUNTING_GEMINI_INLINE_AUDIO_MIME_TYPES : []),
    ...(allowInlineVideo ? ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES : []),
  ];
  try {
    const body = snapshotAccountingPreparedData(value);
    if (!object(body) || !Array.isArray(body.contents) || !body.contents.length) return false;
    const contents = []; let videoSource = false, inlineSource = false, audioSource = false;
    for (const content of body.contents) {
      if (!object(content) || !Array.isArray(content.parts) || !content.parts.length) return false;
      const parts = [];
      for (const part of content.parts) {
        if (!object(part)) return false;
        if (!Object.hasOwn(part, 'inlineData')) { parts.push(part); continue; }
        const blob = part.inlineData;
        const metadata = Object.hasOwn(part, 'videoMetadata'), resolution = Object.hasOwn(part, 'mediaResolution'), processing = Object.hasOwn(part, 'mediaProcessing');
        if (![undefined, GEMINI_ROLE.USER].includes(content.role) || Object.keys(part).some(key => !['inlineData', ...(metadata ? ['videoMetadata'] : []), ...(resolution ? ['mediaResolution'] : []), ...(processing ? ['mediaProcessing'] : [])].includes(key)) || !object(blob) ||
            processing && (!allowVideoProcessing || !allowInlineVideo || !ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES.includes(blob.mimeType) || !supportsGeminiVideoProcessing(part.mediaProcessing)) ||
            metadata && (!allowVideoMetadata || !allowInlineVideo || !ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES.includes(blob.mimeType) || !supportsGeminiVideoMetadata(part.videoMetadata)) ||
            resolution && (!(allowVideoResolution && allowInlineVideo && ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES.includes(blob.mimeType) ||
              allowInlineResolution && allowInlineMedia && ACCOUNTING_GEMINI_INLINE_MIME_TYPES.includes(blob.mimeType) ||
              allowAudioResolution && allowInlineAudio && ACCOUNTING_GEMINI_INLINE_AUDIO_MIME_TYPES.includes(blob.mimeType)) || !supportsGeminiVideoPartResolution(part.mediaResolution)) ||
            Object.keys(blob).some(key => !['mimeType', 'data', 'displayName'].includes(key)) ||
            !allowed.includes(blob.mimeType) || !base64(blob.data) ||
            blob.displayName !== undefined && typeof blob.displayName !== 'string') return false;
        if (ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES.includes(blob.mimeType)) videoSource = true;
        if (ACCOUNTING_GEMINI_INLINE_MIME_TYPES.includes(blob.mimeType)) inlineSource = true;
        if (ACCOUNTING_GEMINI_INLINE_AUDIO_MIME_TYPES.includes(blob.mimeType)) audioSource = true;
        // Local grammar validation view only. Dispatch must retain full original
        // media material; this placeholder never substitutes an upstream part.
        parts.push({ text: '[validated original inline media]' });
      }
      contents.push({ ...content, parts });
    }
    const projection = { ...body, contents };
    if (object(body.generationConfig) && Object.hasOwn(body.generationConfig, 'mediaResolution')) {
      if (!(allowVideoResolution && allowInlineVideo && videoSource || allowInlineResolution && allowInlineMedia && inlineSource || allowAudioResolution && allowInlineAudio && audioSource) || !supportsGeminiVideoGenerationResolution(body.generationConfig.mediaResolution)) return false;
      // Local validation projection only, never rewrite or dispatch this view.
      const { mediaResolution: _resolution, ...generationConfig } = body.generationConfig;
      projection.generationConfig = generationConfig;
    }
    return validateOriginal(projection);
  } catch { return false; }
}
