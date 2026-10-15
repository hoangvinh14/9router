import { types } from 'node:util';
import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { captureGeminiUploadedFileMetadata } from './accountingGeminiFileMetadata.js';
import { GEMINI_ROLE } from '../translator/schema/roles.js';
import { ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES } from './accountingGeminiInlineMedia.js';
import { supportsGeminiVideoMetadata } from './accountingGeminiVideoMetadata.js';
import { supportsGeminiVideoPartResolution, supportsGeminiVideoGenerationResolution } from './accountingGeminiVideoResolution.js';

// Pure complete-original grammar only. A supplied metadata inventory is NOT
// gateway tenant/current resource authority. Caller must independently establish
// current DB lifecycle/provenance before any raw/price/dispatch permission.
export function supportsGeminiOwnedFilesOriginal(value, resources, validateOriginal, allowVideoMetadata = false, allowVideoResolution = false) {
  try {
    if (typeof validateOriginal !== 'function' || typeof allowVideoMetadata !== 'boolean' || typeof allowVideoResolution !== 'boolean') return false;
    const body = snapshotAccountingPreparedData(value), inventory = snapshotAccountingPreparedData(resources);
    if (!body || Array.isArray(body) || !Array.isArray(body.contents) || !body.contents.length ||
        !Array.isArray(inventory) || !inventory.length || inventory.length > 1000) return false;
    const ids = new Set(), byUri = new Map(), used = new Set();
    for (const entry of inventory) {
      if (!entry || Array.isArray(entry) || Object.keys(entry).sort().join(',') !== 'file,id' ||
          typeof entry.id !== 'string' || !entry.id || entry.id.length > 512 || ids.has(entry.id)) return false;
      const file = captureGeminiUploadedFileMetadata(entry.file);
      if (byUri.has(file.uri)) return false;
      ids.add(entry.id); byUri.set(file.uri, file);
    }
    const contents = [];
    let hasOwnedVideo = false;
    for (const content of body.contents) {
      if (!content || Array.isArray(content) || !Array.isArray(content.parts) || !content.parts.length) return false;
      const parts = [];
      for (const part of content.parts) {
        if (!part || Array.isArray(part) || typeof part !== 'object') return false;
        if (!Object.hasOwn(part, 'fileData')) { parts.push(part); continue; }
        const metadata = Object.hasOwn(part, 'videoMetadata'), resolution = Object.hasOwn(part, 'mediaResolution');
        if (![undefined, GEMINI_ROLE.USER].includes(content.role) ||
            Object.keys(part).some(key => key !== 'fileData' && !(allowVideoMetadata && key === 'videoMetadata') &&
              !(allowVideoResolution && key === 'mediaResolution'))) return false;
        const data = part.fileData;
        if (!data || Array.isArray(data) || typeof data !== 'object' ||
            Object.keys(data).some(k => !['fileUri', 'mimeType', 'displayName'].includes(k)) ||
            typeof data.fileUri !== 'string') return false;
        const file = byUri.get(data.fileUri);
        if (!file || Object.hasOwn(data, 'mimeType') && data.mimeType !== file.mimeType ||
            Object.hasOwn(data, 'displayName') && (typeof data.displayName !== 'string' || Array.from(data.displayName).length > 512)) return false;
        // This independent grant validates controls against observed resource
        // type, not a client MIME claim or a token/duration estimate. The full
        // original remains intact; only the local grammar view drops controls.
        const video = ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES.includes(file.mimeType);
        if (metadata && (!allowVideoMetadata || !video || !supportsGeminiVideoMetadata(part.videoMetadata))) return false;
        if (resolution && (!allowVideoResolution || !video || !supportsGeminiVideoPartResolution(part.mediaResolution))) return false;
        hasOwnedVideo ||= video;
        used.add(file.uri);
        // Already validated original fields replaced LOCALLY for grammar only.
        // This view must never become an upstream POST or fabricated inlineData.
        parts.push({ text: '[validated original owned file]' });
      }
      contents.push({ ...content, parts });
    }
    if (used.size !== byUri.size) return false;
    const view = { ...body, contents };
    if (body.generationConfig && Object.hasOwn(body.generationConfig, 'mediaResolution')) {
      if (!allowVideoResolution || !hasOwnedVideo || Array.isArray(body.generationConfig) ||
          !supportsGeminiVideoGenerationResolution(body.generationConfig.mediaResolution)) return false;
      // Validated owned-video generation control is removed from the local
      // text-only grammar view, never from the retained original or wire.
      const { mediaResolution: _resolution, ...generationConfig } = body.generationConfig;
      view.generationConfig = generationConfig;
    }
    const result = validateOriginal(view);
    // Only primitive true is a grammar decision. Do not inspect then on an
    // arbitrary callback result: getters/proxies may mutate current authority.
    // Observe genuine promise rejection without invoking its shadowed then.
    if (types.isPromise(result)) Promise.prototype.then.call(result, undefined, () => {});
    return result === true;
  } catch { return false; }
}
