import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { snapshotAccountingPreparedData } from '../../../open-sse/config/accountedBaseDispatch.js';
import { captureGeminiUploadedFileMetadata, captureGeminiProcessingFileMetadata, geminiFileTimestampNanos } from '../../../open-sse/config/accountingGeminiFileMetadata.js';
import { captureQueuedRequestAuthoritySync } from './queuedRequestAuthority.js';
import { assertGeminiResourceReceiptSync, retainGeminiResourceReceiptSync } from './geminiResourceLifecycle.js';

// Internal storage prerequisite only. A handle proves that this module issued
// an intent, NOT that supplied File metadata came from an authenticated upload.
// No callers may use these records as dispatch authority until upload transport
// and full original/raw/price/ACK integration establish that separate boundary.
const SCOPE = 'gemini-upload-registry-v1';
const intents = new WeakMap();
const unavailable = () => { throw new Error('Gemini upload registry unavailable'); };
const FIELDS = 'apiKeyId,connectionId,credential,model,provider';
function bindingCapture(value) {
  const b = snapshotAccountingPreparedData(value);
  if (!b || Array.isArray(b) || Object.keys(b).sort().join(',') !== FIELDS || b.provider !== 'gemini' ||
      ['apiKeyId', 'connectionId', 'credential', 'model'].some(k => typeof b[k] !== 'string' || !b[k] || b[k].length > 512)) unavailable();
  return b;
}
function freshBinding(db, binding) {
  const authority = captureQueuedRequestAuthoritySync(db, binding);
  if (!authority.connection || authority.connection.authType !== 'apikey') unavailable();
  let credentials;
  try { credentials = JSON.parse(authority.connection.data); } catch { unavailable(); }
  if (typeof credentials.apiKey !== 'string' || !credentials.apiKey || credentials.apiKey.length > 8192) unavailable();
  const state = db.coverage.status(binding.apiKeyId);
  if (state.maintenance || state.gaps.some(g => !g.resolvedAt)) unavailable();
  // HMAC over a domain-separated SHA256 of bounded detached authority. Only the
  // digest is stored; never credentials, connection JSON or settings material.
  const digest = createHash('sha256').update(JSON.stringify(authority)).digest('hex');
  return { apiKeyId: binding.apiKeyId, connectionId: binding.connectionId, coverageId: state.id,
    generation: state.generation, authorityDigest: db.coverage.fingerprint('gemini-upload-binding/v1\0' + digest) };
}
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function signature(db, payload) {
  return db.coverage.fingerprint('gemini-upload-record/v1\0' + createHash('sha256').update(JSON.stringify(payload)).digest('hex'));
}
function write(db, payload) {
  const value = JSON.stringify({ payload, signature: signature(db, payload) });
  retainGeminiResourceReceiptSync(db, payload.id, value);
  db.run('INSERT INTO kv(scope,key,value) VALUES(?,?,?) ON CONFLICT(scope,key) DO UPDATE SET value=excluded.value', [SCOPE, payload.id, value]);
}
function read(db, id) {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}(?![\s\S])/.test(id) || !db.health().healthy) unavailable();
  const text = db.get('SELECT value FROM kv WHERE scope=? AND key=?', [SCOPE, id])?.value;
  if (typeof text !== 'string' || Buffer.byteLength(text) > 16384) unavailable();
  assertGeminiResourceReceiptSync(db, id, text);
  let row;
  try { row = snapshotAccountingPreparedData(JSON.parse(text)); } catch { unavailable(); }
  if (!row || Object.keys(row).sort().join(',') !== 'payload,signature' || signature(db, row.payload) !== row.signature) unavailable();
  const p = row.payload;
  if (!p || p.id !== id || p.version !== 1 || !['pending', 'processing', 'active', 'revoked'].includes(p.state) ||
      Object.keys(p).sort().join(',') !== 'binding,createdAt,file,id,revokedAt,state,version' ||
      !p.binding || Object.keys(p.binding).sort().join(',') !== 'apiKeyId,authorityDigest,connectionId,coverageId,generation') unavailable();
  geminiFileTimestampNanos(p.createdAt);
  if (p.state === 'pending' && p.file !== null || ['active', 'processing'].includes(p.state) && (p.file === null || p.revokedAt !== null) ||
      p.state !== 'revoked' && p.revokedAt !== null || p.state === 'revoked' && typeof p.revokedAt !== 'string') unavailable();
  if (p.file !== null) {
    if (p.state === 'processing' || p.state === 'revoked' && p.file.state === 'PROCESSING') captureGeminiProcessingFileMetadata(p.file);
    else captureGeminiUploadedFileMetadata(p.file);
  }
  if (p.revokedAt !== null) geminiFileTimestampNanos(p.revokedAt);
  return p;
}
function requireBinding(db, b, row) {
  if (!equal(freshBinding(db, b), row.binding)) unavailable();
}
function visible(row) {
  // Do not expose private binding digests even through this internal result.
  return snapshotAccountingPreparedData({ id: row.id, state: row.state, createdAt: row.createdAt, file: row.file, revokedAt: row.revokedAt });
}
export function beginGeminiUploadIntentSync(db, value, now) {
  const binding = bindingCapture(value); geminiFileTimestampNanos(now);
  const id = randomUUID();
  db.durableTransaction(() => write(db, { version: 1, id, state: 'pending', binding: freshBinding(db, binding), createdAt: now, file: null, revokedAt: null }));
  // Register/return only after this exact pending write has a durable ACK.
  const handle = Object.freeze({ id }); intents.set(handle, { db, binding }); return handle;
}
export function assertGeminiUploadIntentSync(db, handle) {
  const owned = intents.get(handle);
  if (!owned || owned.db !== db) unavailable();
  const row = read(db, handle.id); requireBinding(db, owned.binding, row);
  if (!['pending', 'processing'].includes(row.state)) unavailable();
  return visible(row);
}
export function retainGeminiProcessingIntentSync(db, handle, value, now) {
  return observeUpload(db, handle, captureGeminiProcessingFileMetadata(value), now, 'processing');
}
export function completeGeminiUploadIntentSync(db, handle, value, now) {
  return observeUpload(db, handle, captureGeminiUploadedFileMetadata(value), now, 'active');
}
function observeUpload(db, handle, file, now, state) {
  const owned = intents.get(handle);
  if (!owned || owned.db !== db) unavailable();
  const time = geminiFileTimestampNanos(now);
  return db.durableTransaction(() => {
    const row = read(db, handle.id); requireBinding(db, owned.binding, row);
    if (row.state === 'revoked' || time < geminiFileTimestampNanos(row.createdAt) ||
        geminiFileTimestampNanos(file.createTime) < geminiFileTimestampNanos(row.createdAt) ||
        geminiFileTimestampNanos(file.updateTime) > time || geminiFileTimestampNanos(file.expirationTime) <= time) unavailable();
    if (row.state === 'active') { if (state !== 'active' || !equal(file, row.file)) unavailable(); return visible(row); }
    if (row.state === 'processing') {
      const { state: _oldState, updateTime: previousUpdate, ...before } = row.file;
      const { state: _newState, updateTime: currentUpdate, ...after } = file;
      if (!isDeepStrictEqual(before, after) || geminiFileTimestampNanos(currentUpdate) < geminiFileTimestampNanos(previousUpdate)) unavailable();
      if (isDeepStrictEqual(file, row.file)) return visible(row);
    }
    // Never adopt the same provider resource identity through another intent,
    // even after revocation. Project-wide identity is not tenant ownership.
    const inventory = db.all('SELECT key FROM kv WHERE scope=? LIMIT 10001', [SCOPE]);
    if (inventory.length > 10000) unavailable();
    for (const other of inventory) {
      const prior = read(db, other.key);
      if (prior.id !== row.id && prior.binding.connectionId === row.binding.connectionId && prior.file?.uri === file.uri) unavailable();
    }
    const observed = { ...row, state, file }; write(db, observed); return visible(observed);
  });
}
export function captureGeminiUploadedResourceSync(db, value, id, now) {
  const b = bindingCapture(value), time = geminiFileTimestampNanos(now), row = read(db, id); requireBinding(db, b, row);
  if (row.state !== 'active' || time < geminiFileTimestampNanos(row.createdAt) || geminiFileTimestampNanos(row.file.expirationTime) <= time) unavailable();
  return visible(row);
}
export function revokeGeminiUploadedResourceSync(db, value, id, now) {
  const b = bindingCapture(value), time = geminiFileTimestampNanos(now);
  return db.durableTransaction(() => {
    const row = read(db, id); requireBinding(db, b, row);
    if (time < geminiFileTimestampNanos(row.createdAt)) unavailable();
    if (row.state === 'revoked') return visible(row);
    const revoked = { ...row, state: 'revoked', revokedAt: now }; write(db, revoked); return visible(revoked);
  });
}
