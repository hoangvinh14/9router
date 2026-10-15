import { isDeepStrictEqual } from 'node:util';
import { snapshotAccountingGroup } from '../db/accountingGroupPayload.js';
import { validateQueuedSavedProxyWire } from './queuedSavedProxyWire.js';
import { validateQueuedSelectedPoolWire } from './queuedPoolWire.js';
import { validateAccountingProxyEnvironment } from '../../../open-sse/config/accountedProxyEnvironment.js';
import { validateAccountingGeminiDispatch } from '../../../open-sse/config/accountedGeminiDispatch.js';
import { ACCOUNTED_GEMINI_OWNED_FILES_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_METADATA_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_RESOLUTION_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_COMBINED_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_VIDEO_SSE_MODE } from '../../../open-sse/config/accountingGeminiOwnedFilesModes.js';
import { ACCOUNTED_GEMINI_SSE_MODE } from '../../../open-sse/config/accountedGeminiCandidate.js';
import { ACCOUNTED_GEMINI_CLIENT_SSE_MODE } from '../../../open-sse/config/accountingGeminiClientModes.js';

import { ACCOUNTED_GEMINI_INLINE_SSE_MODE } from '../../../open-sse/config/accountingGeminiInlineModes.js';
import { ACCOUNTED_GEMINI_AUDIO_SSE_MODE } from '../../../open-sse/config/accountingGeminiAudioModes.js';
import { ACCOUNTED_GEMINI_VIDEO_SSE_MODE } from '../../../open-sse/config/accountingGeminiVideoModes.js';
import { ACCOUNTED_GEMINI_VIDEO_METADATA_SSE_MODE } from '../../../open-sse/config/accountingGeminiVideoMetadataModes.js';
import { ACCOUNTED_GEMINI_VIDEO_RESOLUTION_SSE_MODE } from '../../../open-sse/config/accountingGeminiVideoResolutionModes.js';
import { ACCOUNTED_GEMINI_INLINE_RESOLUTION_SSE_MODE } from '../../../open-sse/config/accountingGeminiInlineResolutionModes.js';
import { ACCOUNTED_GEMINI_AUDIO_RESOLUTION_SSE_MODE } from '../../../open-sse/config/accountingGeminiAudioResolutionModes.js';
import { ACCOUNTED_GEMINI_VIDEO_PROCESSING_SSE_MODE } from '../../../open-sse/config/accountingGeminiVideoProcessingModes.js';
import { ACCOUNTED_GEMINI_PROCESSING_TOOLS_SSE_MODE } from '../../../open-sse/config/accountingGeminiProcessingToolsModes.js';
const unavailable = () => { throw new Error('Queued Gemini wire unavailable'); };
const record = value => value && typeof value === 'object' && !Array.isArray(value);
// Original native text-only API-key Gemini wire, not a generic protocol escape.
export function validateQueuedGeminiWire(authority, value) {
  const wire = snapshotAccountingGroup([{ type: 'wire', value }])[0].value;
  const fields = ['protocol', 'url', 'headers', 'credentials', 'providerOverrides', 'proxyOptions', 'proxyEnvironment', 'geminiTransport'];
  if (authority?.provider !== 'gemini' || !authority.connection || !record(wire) || wire.protocol !== 'native-gemini' ||
      Object.keys(wire).length !== fields.length || fields.some(field => !Object.hasOwn(wire, field)) ||
      !record(wire.headers) || !record(wire.credentials) || Object.keys(wire.credentials).length !== 2) unavailable();
  let connection, settings;
  try { connection = JSON.parse(authority.connection.data); settings = JSON.parse(authority.settings); } catch { unavailable(); }
  if (!record(connection) || !record(settings) || typeof connection.apiKey !== 'string' || !connection.apiKey || connection.accessToken ||
      /[\r\n\u0000]/.test(connection.apiKey) || wire.credentials.apiKey !== connection.apiKey || wire.credentials.accessToken !== null) unavailable();
  const overrides = settings.providerOverrides?.gemini ?? null;
  if (!isDeepStrictEqual(wire.providerOverrides, overrides)) unavailable();
  const dispatch = validateAccountingGeminiDispatch(wire.geminiTransport, wire.url);
  if (dispatch.model !== authority.model) unavailable();
  const expected = new Headers({ 'Content-Type': 'application/json', ...(dispatch.baseTransport.headers || {}), 'x-goog-api-key': connection.apiKey });
  // Match DefaultExecutor's original stream overlay before persisted overrides.
  // Missing/wrong stream Accept is not an equal prepared wire.
  if ([ACCOUNTED_GEMINI_SSE_MODE, ACCOUNTED_GEMINI_CLIENT_SSE_MODE, ACCOUNTED_GEMINI_INLINE_SSE_MODE, ACCOUNTED_GEMINI_AUDIO_SSE_MODE, ACCOUNTED_GEMINI_VIDEO_SSE_MODE, ACCOUNTED_GEMINI_VIDEO_METADATA_SSE_MODE, ACCOUNTED_GEMINI_VIDEO_RESOLUTION_SSE_MODE, ACCOUNTED_GEMINI_INLINE_RESOLUTION_SSE_MODE, ACCOUNTED_GEMINI_AUDIO_RESOLUTION_SSE_MODE, ACCOUNTED_GEMINI_VIDEO_PROCESSING_SSE_MODE, ACCOUNTED_GEMINI_PROCESSING_TOOLS_SSE_MODE, ACCOUNTED_GEMINI_OWNED_FILES_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_METADATA_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_RESOLUTION_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_COMBINED_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_VIDEO_SSE_MODE].includes(dispatch.mode)) expected.set('Accept', 'text/event-stream');
  if (overrides?.headers !== undefined) {
    if (!record(overrides.headers)) unavailable();
    const seen = new Set();
    for (const [name, header] of Object.entries(overrides.headers)) {
      if (typeof header !== 'string' || seen.has(name.toLowerCase())) unavailable();
      seen.add(name.toLowerCase()); expected.set(name, header);
    }
  }
  const actual = new Headers(), seen = new Set();
  for (const [name, header] of Object.entries(wire.headers)) {
    if (typeof header !== 'string' || seen.has(name.toLowerCase())) unavailable();
    seen.add(name.toLowerCase()); actual.set(name, header);
  }
  if (!isDeepStrictEqual([...actual], [...expected])) unavailable();
  validateAccountingProxyEnvironment(wire.proxyEnvironment);
  validateQueuedSavedProxyWire(authority, wire.proxyOptions);
  if (authority.proxyPool) validateQueuedSelectedPoolWire(authority, wire.proxyOptions);
  return wire;
}
