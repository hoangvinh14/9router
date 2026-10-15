import { FORMATS } from '../translator/formats.js';
import { isDeepStrictEqual } from 'node:util';
import { ACCOUNTED_GEMINI_OWNED_FILES_MODES, ACCOUNTED_GEMINI_OWNED_FILES_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_METADATA_MODES, ACCOUNTED_GEMINI_OWNED_VIDEO_METADATA_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_RESOLUTION_MODES, ACCOUNTED_GEMINI_OWNED_VIDEO_RESOLUTION_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_COMBINED_MODES, ACCOUNTED_GEMINI_OWNED_VIDEO_COMBINED_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_MODES, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_MODES, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_MODES, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_VIDEO_MODES, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_VIDEO_SSE_MODE, isGeminiOwnedVideoClientInlineAudioVideoMode, isGeminiOwnedVideoClientInlineAudioMode, isGeminiOwnedVideoClientInlineMode, isGeminiOwnedVideoClientMode, isGeminiOwnedFilesMode, isGeminiOwnedVideoMetadataMode, isGeminiOwnedVideoResolutionMode } from './accountingGeminiOwnedFilesModes.js';
import { getGeminiOwnedRequestOwner } from './accountingGeminiOwnedRequestOwner.js';
import { supportsGeminiOwnedFilesOriginal } from './accountingGeminiOwnedFilesOriginal.js';
import { GEMINI_ROLE, ROLE } from '../translator/schema/roles.js';
import { supportsGeminiClientToolsOriginal } from './accountingGeminiClientTools.js';
import { supportsGeminiProcessingTraceOriginal } from './accountingGeminiProcessingTrace.js';
import { supportsGeminiInlineMediaOriginal } from './accountingGeminiInlineMedia.js';
import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { ACCOUNTED_GEMINI_CLIENT_MODES, ACCOUNTED_GEMINI_CLIENT_SSE_MODE, isGeminiClientMode } from './accountingGeminiClientModes.js';
import { ACCOUNTED_GEMINI_INLINE_MODES, ACCOUNTED_GEMINI_INLINE_SSE_MODE, isGeminiInlineMode } from './accountingGeminiInlineModes.js';
import { ACCOUNTED_GEMINI_INLINE_RESOLUTION_MODES, ACCOUNTED_GEMINI_INLINE_RESOLUTION_SSE_MODE, isGeminiInlineResolutionMode } from './accountingGeminiInlineResolutionModes.js';
import { ACCOUNTED_GEMINI_AUDIO_RESOLUTION_MODES, ACCOUNTED_GEMINI_AUDIO_RESOLUTION_SSE_MODE, isGeminiAudioResolutionMode } from './accountingGeminiAudioResolutionModes.js';
import { ACCOUNTED_GEMINI_VIDEO_PROCESSING_MODES, ACCOUNTED_GEMINI_VIDEO_PROCESSING_SSE_MODE, isGeminiVideoProcessingMode } from './accountingGeminiVideoProcessingModes.js';
import { ACCOUNTED_GEMINI_PROCESSING_TOOLS_MODES, ACCOUNTED_GEMINI_PROCESSING_TOOLS_SSE_MODE, isGeminiProcessingToolsMode } from './accountingGeminiProcessingToolsModes.js';

import { ACCOUNTED_GEMINI_AUDIO_MODES, ACCOUNTED_GEMINI_AUDIO_SSE_MODE, isGeminiAudioMode } from './accountingGeminiAudioModes.js';
import { ACCOUNTING_GEMINI_INLINE_MIME_TYPES, ACCOUNTING_GEMINI_INLINE_AUDIO_MIME_TYPES, ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES } from './accountingGeminiInlineMedia.js';
import { ACCOUNTED_GEMINI_VIDEO_MODES, ACCOUNTED_GEMINI_VIDEO_SSE_MODE, isGeminiVideoMode } from './accountingGeminiVideoModes.js';
import { ACCOUNTED_GEMINI_VIDEO_METADATA_MODES, ACCOUNTED_GEMINI_VIDEO_METADATA_SSE_MODE, isGeminiVideoMetadataMode } from './accountingGeminiVideoMetadataModes.js';
import { ACCOUNTED_GEMINI_VIDEO_RESOLUTION_MODES, ACCOUNTED_GEMINI_VIDEO_RESOLUTION_SSE_MODE, isGeminiVideoResolutionMode } from './accountingGeminiVideoResolutionModes.js';
export const ACCOUNTED_GEMINI_MODE = 'native-gemini-json';
export const ACCOUNTED_GEMINI_SSE_MODE = 'native-gemini-sse';
export const ACCOUNTED_GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
export const ACCOUNTED_GEMINI_ACTION = ':generateContent';
export const ACCOUNTED_GEMINI_STREAM_ACTION = ':streamGenerateContent';
export const ACCOUNTED_GEMINI_MODEL = /^[a-zA-Z0-9_.-]+$/;
export const ACCOUNTED_GEMINI_REQUEST_FIELDS = Object.freeze(['contents', 'systemInstruction', 'generationConfig', 'serviceTier']);
export const ACCOUNTED_GEMINI_GENERATION_FIELDS = Object.freeze(['maxOutputTokens', 'temperature', 'topP', 'topK', 'candidateCount', 'thinkingConfig']);
export const ACCOUNTED_GEMINI_STANDARD_TIERS = Object.freeze(['unspecified', 'standard']);
export const ACCOUNTED_GEMINI_HEADER_FIELDS = Object.freeze(['content-type', 'x-goog-api-key', 'accept']);
// Internal provenance only: no body/header flag can manufacture original intent
// or native response authority. Keep one app context, never in executor singleton.
const originals = new WeakMap(), nativeResponses = new WeakSet();
export function bindGeminiOriginal(request, body, model, validRoute, stream = false) {
  originals.set(request, Object.freeze({ body: structuredClone(body), model, validRoute, stream }));
}
export function getGeminiOriginal(request) { const value = originals.get(request); return value ? structuredClone(value) : null; }
export function markGeminiNativeResponse(response) { nativeResponses.add(response); return response; }
export function isGeminiNativeResponse(response) { return nativeResponses.has(response); }
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const fields = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const textParts = parts => Array.isArray(parts) && parts.length > 0 && parts.every(part => fields(part, ['text']) && typeof part.text === 'string');
export function supportsGeminiRequest(body, allowClientTools = false, allowInlineMedia = false, allowInlineAudio = false, allowInlineVideo = false, allowVideoMetadata = false, allowVideoResolution = false, allowInlineResolution = false, allowAudioResolution = false, allowVideoProcessing = false, allowProcessingTrace = false) {
  if (typeof allowClientTools !== 'boolean' || typeof allowInlineMedia !== 'boolean' || typeof allowInlineAudio !== 'boolean' || typeof allowInlineVideo !== 'boolean' || typeof allowVideoMetadata !== 'boolean' || typeof allowVideoResolution !== 'boolean' || typeof allowInlineResolution !== 'boolean' || typeof allowAudioResolution !== 'boolean' || typeof allowVideoProcessing !== 'boolean' || typeof allowProcessingTrace !== 'boolean') return false;
  if (allowProcessingTrace) return allowInlineVideo && allowVideoProcessing && supportsGeminiProcessingTraceOriginal(body, value => supportsGeminiRequest(value, allowClientTools, allowInlineMedia, allowInlineAudio, allowInlineVideo, allowVideoMetadata, allowVideoResolution, allowInlineResolution, allowAudioResolution, allowVideoProcessing));
  if (allowInlineMedia || allowInlineAudio || allowInlineVideo || allowVideoMetadata || allowVideoResolution || allowInlineResolution || allowAudioResolution || allowVideoProcessing) return supportsGeminiInlineMediaOriginal(body, value => supportsGeminiRequest(value, allowClientTools), allowInlineMedia, allowInlineAudio, allowInlineVideo, allowVideoMetadata, allowVideoResolution, allowInlineResolution, allowAudioResolution, allowVideoProcessing);
  if (allowClientTools) return supportsGeminiClientToolsOriginal(body, value => supportsGeminiRequest(value));
  if (!fields(body, ACCOUNTED_GEMINI_REQUEST_FIELDS) ||
      body.serviceTier !== undefined && !ACCOUNTED_GEMINI_STANDARD_TIERS.includes(body.serviceTier) ||
      !Array.isArray(body.contents) || !body.contents.length ||
      !body.contents.every(content => fields(content, ['role', 'parts']) && [undefined, GEMINI_ROLE.USER, GEMINI_ROLE.MODEL].includes(content.role) && textParts(content.parts)) ||
      body.systemInstruction !== undefined && (!fields(body.systemInstruction, ['role', 'parts']) ||
        ![undefined, ROLE.SYSTEM].includes(body.systemInstruction.role) || !textParts(body.systemInstruction.parts))) return false;
  const config = body.generationConfig;
  return config === undefined || fields(config, ACCOUNTED_GEMINI_GENERATION_FIELDS) &&
    (config.candidateCount === undefined || config.candidateCount === 1) &&
    (config.maxOutputTokens === undefined || Number.isSafeInteger(config.maxOutputTokens) && config.maxOutputTokens > 0) &&
    (config.topK === undefined || Number.isSafeInteger(config.topK) && config.topK > 0) &&
    ['temperature', 'topP'].every(key => config[key] === undefined || typeof config[key] === 'number' && Number.isFinite(config[key]) && config[key] >= 0) &&
    (config.thinkingConfig === undefined || fields(config.thinkingConfig, ['thinkingBudget', 'includeThoughts']) &&
      (config.thinkingConfig.thinkingBudget === undefined || Number.isSafeInteger(config.thinkingConfig.thinkingBudget) && config.thinkingConfig.thinkingBudget >= -1) &&
      (config.thinkingConfig.includeThoughts === undefined || typeof config.thinkingConfig.includeThoughts === 'boolean'));
}
export function supportsGeminiInternalRequest(body, model, allowClientTools = false, allowInlineMedia = false, allowInlineAudio = false, allowInlineVideo = false, allowVideoMetadata = false, allowVideoResolution = false, allowInlineResolution = false, allowAudioResolution = false, allowVideoProcessing = false, allowProcessingTrace = false) {
  if (typeof allowClientTools !== 'boolean' || typeof allowInlineMedia !== 'boolean' || typeof allowInlineAudio !== 'boolean' || typeof allowInlineVideo !== 'boolean' || typeof allowVideoMetadata !== 'boolean' || typeof allowVideoResolution !== 'boolean' || typeof allowInlineResolution !== 'boolean' || typeof allowAudioResolution !== 'boolean' || typeof allowVideoProcessing !== 'boolean' || typeof allowProcessingTrace !== 'boolean') return false;
  if (allowClientTools || allowInlineMedia || allowInlineAudio || allowInlineVideo || allowVideoMetadata || allowVideoResolution || allowInlineResolution || allowAudioResolution || allowVideoProcessing || allowProcessingTrace) {
    try { body = snapshotAccountingPreparedData(body); } catch { return false; }
  }
  if (!object(body) || body.model !== model || typeof body.stream !== 'boolean' || !ACCOUNTED_GEMINI_MODEL.test(model)) return false;
  const { model: _model, stream: _stream, ...wire } = body;
  return supportsGeminiRequest(wire, allowClientTools, allowInlineMedia, allowInlineAudio, allowInlineVideo, allowVideoMetadata, allowVideoResolution, allowInlineResolution, allowAudioResolution, allowVideoProcessing, allowProcessingTrace);
}
export function supportsGeminiCandidate(executor, options, url, body, headers) {
  const credentials = options.credentials;
  const ownedVideoMetadata = isGeminiOwnedVideoMetadataMode(options.accountingMode);
  const ownedVideoResolution = isGeminiOwnedVideoResolutionMode(options.accountingMode);
  const ownedFiles = isGeminiOwnedFilesMode(options.accountingMode) || ownedVideoMetadata || ownedVideoResolution;
  let ownedOriginal = false;
  if (ownedFiles) {
    try {
      const owner = getGeminiOwnedRequestOwner(options.accounting);
      const target = { provider: executor.provider, model: options.model, endpoint: 'chat', connectionId: options.connectionId };
      const captured = owner.capture(target, body);
      if (owner.videoMetadata(target, body) !== ownedVideoMetadata || owner.videoResolution(target, body) !== ownedVideoResolution || owner.clientTools(target, body) !== isGeminiOwnedVideoClientMode(options.accountingMode) || owner.inlineMedia(target, body) !== isGeminiOwnedVideoClientInlineMode(options.accountingMode) || owner.inlineAudio(target, body) !== isGeminiOwnedVideoClientInlineAudioMode(options.accountingMode) || owner.inlineVideo(target, body) !== isGeminiOwnedVideoClientInlineAudioVideoMode(options.accountingMode)) return false;
      const internal = snapshotAccountingPreparedData(options.body);
      const { model, stream, ...original } = internal;
      ownedOriginal = model === options.model && stream === options.stream && ACCOUNTED_GEMINI_MODEL.test(model) &&
        isDeepStrictEqual(original, body) && supportsGeminiOwnedFilesOriginal(body, captured.resources, value => supportsGeminiRequest(value, isGeminiOwnedVideoClientMode(options.accountingMode) && Object.hasOwn(value, 'tools'), isGeminiOwnedVideoClientInlineMode(options.accountingMode), isGeminiOwnedVideoClientInlineAudioMode(options.accountingMode), isGeminiOwnedVideoClientInlineAudioVideoMode(options.accountingMode)), ownedVideoMetadata, ownedVideoResolution);
    } catch { return false; }
  }
  const processingTools = isGeminiProcessingToolsMode(options.accountingMode);
  const processing = isGeminiVideoProcessingMode(options.accountingMode) || processingTools;
  const processingTrace = processingTools && options.body.contents?.some(content => content.parts?.some(part => Object.hasOwn(part, 'toolCall') || Object.hasOwn(part, 'toolResponse')));
  const audioResolution = isGeminiAudioResolutionMode(options.accountingMode);
  const inlineResolution = isGeminiInlineResolutionMode(options.accountingMode);
  const resolution = isGeminiVideoResolutionMode(options.accountingMode) || processing && (Object.hasOwn(options.body.generationConfig || {}, 'mediaResolution') || options.body.contents?.some(content => content.parts?.some(part => Object.hasOwn(part, 'mediaResolution') && ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES.includes(part.inlineData?.mimeType))));
  const metadata = isGeminiVideoMetadataMode(options.accountingMode) || !processing && resolution || processing && options.body.contents?.some(content => content.parts?.some(part => Object.hasOwn(part, 'videoMetadata')));
  const video = isGeminiVideoMode(options.accountingMode) || metadata || resolution || processing, audio = isGeminiAudioMode(options.accountingMode) || video || audioResolution, inline = isGeminiInlineMode(options.accountingMode) || audio || inlineResolution;
  const client = isGeminiClientMode(options.accountingMode) || inline && Object.hasOwn(options.body, 'tools');
  const live = [ACCOUNTED_GEMINI_SSE_MODE, ACCOUNTED_GEMINI_CLIENT_SSE_MODE, ACCOUNTED_GEMINI_INLINE_SSE_MODE, ACCOUNTED_GEMINI_AUDIO_SSE_MODE, ACCOUNTED_GEMINI_VIDEO_SSE_MODE, ACCOUNTED_GEMINI_VIDEO_METADATA_SSE_MODE, ACCOUNTED_GEMINI_VIDEO_RESOLUTION_SSE_MODE, ACCOUNTED_GEMINI_INLINE_RESOLUTION_SSE_MODE, ACCOUNTED_GEMINI_AUDIO_RESOLUTION_SSE_MODE, ACCOUNTED_GEMINI_VIDEO_PROCESSING_SSE_MODE, ACCOUNTED_GEMINI_PROCESSING_TOOLS_SSE_MODE, ACCOUNTED_GEMINI_OWNED_FILES_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_METADATA_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_RESOLUTION_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_COMBINED_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_VIDEO_SSE_MODE].includes(options.accountingMode);
  if (executor.provider !== 'gemini' || executor.config?.format !== FORMATS.GEMINI ||
      ![ACCOUNTED_GEMINI_MODE, ACCOUNTED_GEMINI_SSE_MODE, ...ACCOUNTED_GEMINI_CLIENT_MODES, ...ACCOUNTED_GEMINI_INLINE_MODES, ...ACCOUNTED_GEMINI_AUDIO_MODES, ...ACCOUNTED_GEMINI_VIDEO_MODES, ...ACCOUNTED_GEMINI_VIDEO_METADATA_MODES, ...ACCOUNTED_GEMINI_VIDEO_RESOLUTION_MODES, ...ACCOUNTED_GEMINI_INLINE_RESOLUTION_MODES, ...ACCOUNTED_GEMINI_AUDIO_RESOLUTION_MODES, ...ACCOUNTED_GEMINI_VIDEO_PROCESSING_MODES, ...ACCOUNTED_GEMINI_PROCESSING_TOOLS_MODES, ...ACCOUNTED_GEMINI_OWNED_FILES_MODES, ...ACCOUNTED_GEMINI_OWNED_VIDEO_METADATA_MODES, ...ACCOUNTED_GEMINI_OWNED_VIDEO_RESOLUTION_MODES, ...ACCOUNTED_GEMINI_OWNED_VIDEO_COMBINED_MODES, ...ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_MODES, ...ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_MODES, ...ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_MODES, ...ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_VIDEO_MODES].includes(options.accountingMode) || options.stream !== live || options.body?.stream !== live ||
      (ownedFiles || client || inline) && options.accounting?.requiresPreparedBaseWire !== true ||
      (ownedFiles ? !ownedOriginal : !supportsGeminiInternalRequest(options.body, options.model, client, inline, audio, video, metadata, resolution, inlineResolution, audioResolution, processing, processingTrace) || !supportsGeminiRequest(body, client, inline, audio, video, metadata, resolution, inlineResolution, audioResolution, processing, processingTrace)) ||
      processing && !body.contents.some(content => content.parts.some(part => Object.hasOwn(part, 'mediaProcessing') && ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES.includes(part.inlineData?.mimeType))) ||
      audioResolution && (!body.contents.some(content => content.parts.some(part => ACCOUNTING_GEMINI_INLINE_AUDIO_MIME_TYPES.includes(part.inlineData?.mimeType))) ||
        !Object.hasOwn(body.generationConfig || {}, 'mediaResolution') && !body.contents.some(content => content.parts.some(part => Object.hasOwn(part, 'mediaResolution') && ACCOUNTING_GEMINI_INLINE_AUDIO_MIME_TYPES.includes(part.inlineData?.mimeType)))) ||
      inlineResolution && (!body.contents.some(content => content.parts.some(part => ACCOUNTING_GEMINI_INLINE_MIME_TYPES.includes(part.inlineData?.mimeType))) ||
        !Object.hasOwn(body.generationConfig || {}, 'mediaResolution') && !body.contents.some(content => content.parts.some(part => Object.hasOwn(part, 'mediaResolution') && ACCOUNTING_GEMINI_INLINE_MIME_TYPES.includes(part.inlineData?.mimeType)))) ||
      resolution && !Object.hasOwn(body.generationConfig || {}, 'mediaResolution') && !body.contents.some(content => content.parts.some(part => Object.hasOwn(part, 'mediaResolution') && ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES.includes(part.inlineData?.mimeType))) ||
      metadata && !resolution && !body.contents.some(content => content.parts.some(part => Object.hasOwn(part, 'videoMetadata') && ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES.includes(part.inlineData?.mimeType))) ||
      video && !body.contents.some(content => content.parts.some(part => ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES.includes(part.inlineData?.mimeType))) ||
      audio && !video && !body.contents.some(content => content.parts.some(part => ACCOUNTING_GEMINI_INLINE_AUDIO_MIME_TYPES.includes(part.inlineData?.mimeType))) ||
      inline && !body.contents.some(content => content.parts.some(part => Object.hasOwn(part, 'inlineData'))) ||
      url !== `${ACCOUNTED_GEMINI_BASE}/${options.model}${live ? ACCOUNTED_GEMINI_STREAM_ACTION + '?alt=sse' : ACCOUNTED_GEMINI_ACTION}` ||
      credentials?.runtimeTransport || credentials?.accessToken || typeof credentials?.apiKey !== 'string' || !credentials.apiKey ||
      options.proxyOptions?.vercelRelayUrl) return false;
  const normalized = new Headers(headers);
  return [...normalized.keys()].every(key => ACCOUNTED_GEMINI_HEADER_FIELDS.includes(key)) &&
    normalized.get('content-type') === 'application/json' && normalized.get('x-goog-api-key') === credentials.apiKey;
}
