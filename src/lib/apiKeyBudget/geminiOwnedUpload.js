import { createHash } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';
import { fetch as directFetch } from 'undici';
import { snapshotAccountingPreparedData } from '../../../open-sse/config/accountedBaseDispatch.js';
import { ACCOUNTING_GEMINI_INLINE_MIME_TYPES, ACCOUNTING_GEMINI_INLINE_AUDIO_MIME_TYPES, ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES } from '../../../open-sse/config/accountingGeminiInlineMedia.js';
import { captureGeminiUploadedFileMetadata, captureGeminiProcessingFileMetadata } from '../../../open-sse/config/accountingGeminiFileMetadata.js';
import { captureAccountingProxyEnvironment, validateAccountingProxyEnvironment } from '../../../open-sse/config/accountedProxyEnvironment.js';
import { captureQueuedRequestAuthoritySync } from './queuedRequestAuthority.js';
import { beginGeminiUploadIntentSync, assertGeminiUploadIntentSync, completeGeminiUploadIntentSync, retainGeminiProcessingIntentSync, revokeGeminiUploadedResourceSync, captureGeminiUploadedResourceSync } from './geminiUploadRegistry.js';
import { assertGeminiUploadOriginSync, retainGeminiUploadOriginSync } from './geminiResourceLifecycle.js';
import { GEMINI_UPLOAD_ORIGIN, GEMINI_UPLOAD_PATH, GEMINI_UPLOAD_CAPTURE_MAX_BYTES } from './geminiUploadProtocol.js';

// First bounded direct native upload owner only; never a public adoption API.
// Proxy/pool/OAuth/Vertex/large/chunked/orphan resume remain separate obligations.
const unavailable = () => { throw new Error('Owned Gemini upload unavailable'); };
// Exact runtime output identity; restores require separately protected origin
// receipts plus current registry authority, never copied/seeded metadata.
const uploadedResults = new WeakMap();
export function assertGeminiOwnedUploadResultSync(db, binding, result) {
  const owned = uploadedResults.get(result);
  if (!owned || owned.db !== db || !isDeepStrictEqual(snapshotAccountingPreparedData(binding), owned.binding)) unavailable();
  const current = captureGeminiUploadedResourceSync(db, owned.binding, result.id, new Date().toISOString());
  if (!isDeepStrictEqual(current, result)) unavailable();
  return current;
}
export function restoreGeminiOwnedUploadResultSync(db, value, id) {
  const binding = snapshotAccountingPreparedData(value);
  const resource = captureGeminiUploadedResourceSync(db, binding, id, new Date().toISOString());
  assertGeminiUploadOriginSync(db, resource.id);
  uploadedResults.set(resource, { db, binding });
  return resource;
}
const MIMES = [...ACCOUNTING_GEMINI_INLINE_MIME_TYPES, ...ACCOUNTING_GEMINI_INLINE_AUDIO_MIME_TYPES, ...ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES];
function sourceCapture(value) {
  const s = snapshotAccountingPreparedData(value);
  if (!s || Array.isArray(s) || Object.keys(s).some(k => !['dataBase64', 'mimeType', 'displayName'].includes(k)) ||
      !MIMES.includes(s.mimeType) || typeof s.dataBase64 !== 'string' || !s.dataBase64 ||
      s.dataBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}(?![\s\S])/.test(s.dataBase64) ||
      Object.hasOwn(s, 'displayName') && (typeof s.displayName !== 'string' || Array.from(s.displayName).length > 512)) unavailable();
  const bytes = Buffer.from(s.dataBase64, 'base64');
  if (bytes.toString('base64') !== s.dataBase64 || bytes.length > GEMINI_UPLOAD_CAPTURE_MAX_BYTES) unavailable();
  return { source: s, bytes };
}
function directAuthority(db, binding, env) {
  validateAccountingProxyEnvironment(env);
  // Do not silently bypass ambient/saved proxy configuration. This finite
  // direct owner refuses it until an authenticated proxy transport is integrated.
  if (Object.values(env).some(v => v !== null && v !== '')) unavailable();
  const a = captureQueuedRequestAuthoritySync(db, binding);
  if (!a.connection || a.connection.authType !== 'apikey' || a.proxyPool) unavailable();
  let settings, connection;
  try { settings = JSON.parse(a.settings); connection = JSON.parse(a.connection.data); } catch { unavailable(); }
  if (settings.outboundProxyEnabled === true || settings.providerOverrides?.gemini || connection.accessToken ||
      typeof connection.apiKey !== 'string' || !connection.apiKey || /[\r\n\u0000]/.test(connection.apiKey)) unavailable();
  return a;
}
function sessionUrl(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\s\\#]/.test(value)) unavailable();
  let parsed;
  try { parsed = new URL(value); } catch { unavailable(); }
  if (parsed.origin !== GEMINI_UPLOAD_ORIGIN || parsed.username || parsed.password || parsed.pathname !== GEMINI_UPLOAD_PATH ||
      parsed.href !== value || parsed.searchParams.getAll('upload_id').length !== 1 || !parsed.searchParams.get('upload_id') ||
      [...parsed.searchParams.keys()].some(k => !['upload_id', 'upload_protocol'].includes(k)) ||
      parsed.searchParams.getAll('upload_protocol').length > 1 ||
      parsed.searchParams.has('upload_protocol') && parsed.searchParams.get('upload_protocol') !== 'resumable') unavailable();
  // Retain server query exactly; no normalization/rewrite or cross-origin grant.
  return value;
}
async function boundedJson(response, envelope = true) {
  let reader;
  try {
    if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json' || !response.body) unavailable();
    reader = response.body.getReader(); let size = 0; const chunks = [];
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > GEMINI_UPLOAD_CAPTURE_MAX_BYTES) unavailable(); chunks.push(Buffer.from(value)); }
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    const captured = snapshotAccountingPreparedData(parsed);
    if (!captured || envelope && Object.keys(captured).join(',') !== 'file') unavailable();
    const file = envelope ? captured.file : captured;
    // Guarded capture precedes state selection; never coerce PROCESSING to ACTIVE.
    return file?.state === 'PROCESSING' ? captureGeminiProcessingFileMetadata(file) : captureGeminiUploadedFileMetadata(file);
  } catch { unavailable(); }
  finally {
    try { if (reader) await reader.cancel(); else await response.body?.cancel(); } catch { /* invalid response remains unavailable */ }
    reader?.releaseLock();
  }
}
export async function uploadGeminiOwnedFile(options) {
  try { return await uploadOwned(options); } catch { unavailable(); }
}
async function uploadOwned({ db, binding: value, source: input, signal = null }) {
  if (signal !== null && !(signal instanceof AbortSignal)) unavailable();
  signal?.throwIfAborted();
  // Bound the whole start/finalize/body lifetime; never retries or auto-resumes.
  signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000);
  const binding = snapshotAccountingPreparedData(value), { source, bytes } = sourceCapture(input);
  const env = captureAccountingProxyEnvironment(), original = directAuthority(db, binding, env);
  const recheck = () => {
    signal?.throwIfAborted();
    if (!isDeepStrictEqual(directAuthority(db, binding, env), original)) unavailable();
  };
  let providerKey;
  try { providerKey = JSON.parse(original.connection.data).apiKey; } catch { unavailable(); }
  const intent = beginGeminiUploadIntentSync(db, binding, new Date().toISOString());
  const file = { ...(Object.hasOwn(source, 'displayName') ? { displayName: source.displayName } : {}), mimeType: source.mimeType, sizeBytes: String(bytes.length) };
  recheck(); assertGeminiUploadIntentSync(db, intent);
  const start = await directFetch(GEMINI_UPLOAD_ORIGIN + GEMINI_UPLOAD_PATH, { method: 'POST', redirect: 'manual', signal,
    headers: { 'x-goog-api-key': providerKey, 'Content-Type': 'application/json',
      'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': file.sizeBytes, 'X-Goog-Upload-Header-Content-Type': source.mimeType }, body: JSON.stringify({ file }) });
  let url;
  try { recheck(); if (!start.ok) unavailable(); url = sessionUrl(start.headers.get('x-goog-upload-url')); }
  finally { await start.body?.cancel(); }
  recheck(); assertGeminiUploadIntentSync(db, intent);
  const finalized = await directFetch(url, { method: 'POST', redirect: 'manual', signal,
    headers: { 'Content-Length': file.sizeBytes, 'Content-Type': source.mimeType, 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' }, body: bytes });
  let observed = await boundedJson(finalized); recheck(); assertGeminiUploadIntentSync(db, intent);
  const hash = createHash('sha256').update(bytes).digest('base64');
  const validateSource = () => {
    if (observed.mimeType !== source.mimeType || observed.sizeBytes !== file.sizeBytes || observed.sha256Hash !== hash ||
        Object.hasOwn(source, 'displayName') && observed.displayName !== source.displayName) unavailable();
  };
  validateSource(); let polls = 0;
  while (observed.state === 'PROCESSING') {
    // Exact observed identity is durable before a metadata GET. Never classify
    // an arbitrary caller resource ID through provider credentials.
    retainGeminiProcessingIntentSync(db, intent, observed, new Date().toISOString());
    if (polls++ >= 8) unavailable();
    if (polls > 1) await wait(250, undefined, { signal });
    recheck();
    const retained = assertGeminiUploadIntentSync(db, intent);
    if (retained.state !== 'processing' || !isDeepStrictEqual(retained.file, observed)) unavailable();
    const response = await directFetch(GEMINI_UPLOAD_ORIGIN + '/v1beta/' + retained.file.name, {
      method: 'GET', redirect: 'manual', signal, headers: { 'x-goog-api-key': providerKey } });
    observed = await boundedJson(response, false); recheck(); assertGeminiUploadIntentSync(db, intent); validateSource();
  }
  const resource = completeGeminiUploadIntentSync(db, intent, observed, new Date().toISOString());
  uploadedResults.set(resource, { db, binding });
  try { retainGeminiUploadOriginSync(db, binding, resource); }
  catch (error) { uploadedResults.delete(resource); throw error; }
  return resource;
}

// Revoke local authority BEFORE upstream deletion. A failed/uncertain DELETE
// never restores active state. Retries address only the exact retained resource.
export async function deleteGeminiOwnedFile(options) {
  try { return await deleteOwned(options); }
  catch { throw new Error('Owned Gemini delete unavailable'); }
}
async function deleteOwned({ db, binding: value, resourceId, signal = null }) {
  if (signal !== null && !(signal instanceof AbortSignal)) unavailable();
  signal?.throwIfAborted();
  signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000);
  const binding = snapshotAccountingPreparedData(value);
  const env = captureAccountingProxyEnvironment(), original = directAuthority(db, binding, env);
  const recheck = () => {
    signal?.throwIfAborted();
    if (!isDeepStrictEqual(directAuthority(db, binding, env), original)) unavailable();
  };
  let providerKey;
  try { providerKey = JSON.parse(original.connection.data).apiKey; } catch { unavailable(); }
  const revoked = revokeGeminiUploadedResourceSync(db, binding, resourceId, new Date().toISOString());
  if (!revoked.file) unavailable();
  const file = captureGeminiUploadedFileMetadata(revoked.file);
  // file.name is canonical observed metadata from the registered resource; never
  // a caller-supplied URL, opaque project-visible name or arbitrary adoption GET.
  const url = GEMINI_UPLOAD_ORIGIN + '/v1beta/' + file.name;
  recheck();
  const response = await directFetch(url, { method: 'DELETE', redirect: 'manual', signal, headers: { 'x-goog-api-key': providerKey } });
  let reader;
  try {
    recheck();
    if (!response.ok) unavailable();
    if (response.status !== 204) {
      if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json' || !response.body) unavailable();
      reader = response.body.getReader(); const chunks = []; let size = 0;
      for (;;) { const { value: chunk, done } = await reader.read(); if (done) break; size += chunk.length; if (size > GEMINI_UPLOAD_CAPTURE_MAX_BYTES) unavailable(); chunks.push(Buffer.from(chunk)); }
      let parsed;
      try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); } catch { unavailable(); }
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || Object.keys(parsed).length) unavailable();
    }
    recheck();
    const current = revokeGeminiUploadedResourceSync(db, binding, resourceId, new Date().toISOString());
    if (!isDeepStrictEqual(current, revoked)) unavailable();
    return Object.freeze({ id: revoked.id, state: 'revoked', deleted: true });
  } finally {
    try { if (reader) await reader.cancel(); else await response.body?.cancel(); } catch { /* no response body leaks */ }
    reader?.releaseLock();
  }
}
