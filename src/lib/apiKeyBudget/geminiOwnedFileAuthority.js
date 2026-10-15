import { types, isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { snapshotAccountingPreparedData } from '../../../open-sse/config/accountedBaseDispatch.js';
import { supportsGeminiOwnedFilesOriginal } from '../../../open-sse/config/accountingGeminiOwnedFilesOriginal.js';
import { assertGeminiOwnedUploadResultSync } from './geminiOwnedUpload.js';

// Runtime-only original/resource capability. Not a public adoption endpoint,
// durable upload-origin certificate, pricing permission or dispatch grant.
const capabilities = new WeakMap();
const unavailable = () => { throw new Error('Owned Gemini file authority unavailable'); };
function resultReferences(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype || value.length < 1 || value.length > 1000) unavailable();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) unavailable();
  const references = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) unavailable();
    references.push(descriptor.value);
  }
  return Object.freeze(references);
}
export function prepareGeminiOwnedFileAuthoritySync(db, value, original, results, validateOriginal, allowVideoMetadata = false, allowVideoResolution = false, allowClientTools = false, allowInlineMedia = false, allowInlineAudio = false, allowInlineVideo = false) {
  if (typeof allowClientTools !== 'boolean' || typeof allowInlineMedia !== 'boolean' || typeof allowInlineAudio !== 'boolean' || typeof allowInlineVideo !== 'boolean') unavailable();
  const binding = snapshotAccountingPreparedData(value), body = snapshotAccountingPreparedData(original);
  const references = resultReferences(results);
  const resources = references.map(result => {
    const current = assertGeminiOwnedUploadResultSync(db, binding, result);
    return { id: current.id, file: current.file };
  });
  if (!supportsGeminiOwnedFilesOriginal(body, resources, validateOriginal, allowVideoMetadata, allowVideoResolution)) unavailable();
  const captured = snapshotAccountingPreparedData({ original: body, resources });
  // Callback validation is not allowed to issue stale authority after mutating
  // the owned SQL view; prove exact current result bindings once more.
  for (const result of references) assertGeminiOwnedUploadResultSync(db, binding, result);
  const capability = Object.freeze({ id: randomUUID() });
  capabilities.set(capability, { db, binding, references, captured, allowVideoMetadata, allowVideoResolution, allowClientTools, allowInlineMedia, allowInlineAudio, allowInlineVideo });
  return capability;
}
export function assertGeminiOwnedFileAuthoritySync(db, capability, original, expectedModel = null) {
  const owned = capabilities.get(capability);
  if (!owned || owned.db !== db || expectedModel !== null && expectedModel !== owned.binding.model || !isDeepStrictEqual(snapshotAccountingPreparedData(original), owned.captured.original)) unavailable();
  const resources = owned.references.map(result => {
    const current = assertGeminiOwnedUploadResultSync(db, owned.binding, result);
    return { id: current.id, file: current.file };
  });
  if (!isDeepStrictEqual(resources, owned.captured.resources)) unavailable();
  return owned.captured;
}
// Read-only independent grammar grant from an exact current private capability.
// Caller fields cannot mint or replace it; the captured public shape is unchanged.
export function assertGeminiOwnedFileVideoMetadataSync(db, capability, original, expectedModel) {
  assertGeminiOwnedFileAuthoritySync(db, capability, original, expectedModel);
  return capabilities.get(capability).allowVideoMetadata;
}
export function assertGeminiOwnedFileVideoResolutionSync(db, capability, original, expectedModel) {
  assertGeminiOwnedFileAuthoritySync(db, capability, original, expectedModel);
  return capabilities.get(capability).allowVideoResolution;
}
export function assertGeminiOwnedFileClientToolsSync(db, capability, original, expectedModel) {
  assertGeminiOwnedFileAuthoritySync(db, capability, original, expectedModel);
  return capabilities.get(capability).allowClientTools;
}
export function assertGeminiOwnedFileInlineMediaSync(db, capability, original, expectedModel) {
  assertGeminiOwnedFileAuthoritySync(db, capability, original, expectedModel);
  return capabilities.get(capability).allowInlineMedia;
}
export function assertGeminiOwnedFileInlineAudioSync(db, capability, original, expectedModel) {
  assertGeminiOwnedFileAuthoritySync(db, capability, original, expectedModel);
  return capabilities.get(capability).allowInlineAudio;
}
export function assertGeminiOwnedFileInlineVideoSync(db, capability, original, expectedModel) {
  assertGeminiOwnedFileAuthoritySync(db, capability, original, expectedModel);
  return capabilities.get(capability).allowInlineVideo;
}
// Private identity checked against the actual gateway/connection authority,
// never a caller owner claim or merely matching resource metadata.
export function assertGeminiOwnedFileBindingSync(db, capability, value, original) {
  const binding = snapshotAccountingPreparedData(value), owned = capabilities.get(capability);
  if (!owned || !isDeepStrictEqual(binding, owned.binding)) unavailable();
  return assertGeminiOwnedFileAuthoritySync(db, capability, original, binding.model);
}
