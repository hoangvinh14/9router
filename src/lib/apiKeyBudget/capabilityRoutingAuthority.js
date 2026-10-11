import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { types } from 'node:util';
import { CATALOG_FILE, getCatalogModalities, getCatalogLimits, invalidateCatalog, isInstalledCatalogSource, runWithCatalogRoutingImage } from '../../../open-sse/providers/catalogOverride.js';
import { ACCOUNTING_GROUP_MAX_BYTES, snapshotAccountingGroup } from '../db/accountingGroupPayload.js';

// Opaque equality identity, not permission or a secret. A local counter can
// alias retained material after a module reload replaces the installed source.
// Fresh module copies deliberately fail closed rather than adopt old authority.
const sourceIds = new WeakMap();
const verifiedImages = new WeakMap();

// Only exact snapshots issued by this bounded reader can scope resolution.
// Arbitrary equal/frozen material cannot inject a reader image.
export function runWithCapabilityRoutingAuthority(authority, resolve) {
  const image = verifiedImages.get(authority);
  if (image === undefined) unavailable();
  return runWithCatalogRoutingImage(image, resolve);
}
const unavailable = () => { throw new Error('Persisted accounting routing graph unavailable'); };

// Server-only dependency of queued routing. No catalog callbacks are invoked
// here, and neither source identity nor catalog presence grants dispatch/schema
// permission. Snapshot fields are internal equality material, never logs/ledger.
export function captureCapabilityRoutingAuthoritySync() {
  const slot = Object.getOwnPropertyDescriptor(globalThis, '__9rCatalogSource');
  if (slot && !Object.hasOwn(slot, 'value')) unavailable();
  const source = slot?.value;
  if (source === undefined || source === null) {
    const authority = Object.freeze({ sourceId: 0, text: null });
    verifiedImages.set(authority, Object.freeze({ models: Object.freeze({}), providers: Object.freeze({}) }));
    return authority;
  }
  if (!isInstalledCatalogSource(source) || types.isProxy(source) || !source || typeof source !== 'object' || Object.getPrototypeOf(source) !== Object.prototype) unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(source);
  if (Reflect.ownKeys(descriptors).length !== 2 ||
      descriptors.getModalities?.value !== getCatalogModalities || descriptors.getLimits?.value !== getCatalogLimits ||
      !descriptors.getModalities.enumerable || !descriptors.getLimits.enumerable) unavailable();
  let sourceId = sourceIds.get(source);
  if (sourceId === undefined) { sourceId = randomUUID(); sourceIds.set(source, sourceId); }
  let fd, text = null;
  let image = Object.freeze({ models: Object.freeze({}), providers: Object.freeze({}) });
  try {
    // Read at most the existing accounting payload ceiling plus one byte; a
    // concurrent file growth cannot turn a stat size check into unbounded read.
    fd = fs.openSync(CATALOG_FILE, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > ACCOUNTING_GROUP_MAX_BYTES) unavailable();
    const buffer = Buffer.alloc(ACCOUNTING_GROUP_MAX_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const read = fs.readSync(fd, buffer, size, buffer.length - size, null);
      if (read === 0) break;
      size += read;
    }
    if (size > ACCOUNTING_GROUP_MAX_BYTES) unavailable();
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size));
    const parsed = snapshotAccountingGroup([{ type: 'capability-catalog', value: JSON.parse(text) }])[0].value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
        !parsed.models || typeof parsed.models !== 'object' || Array.isArray(parsed.models) ||
        !parsed.providers || typeof parsed.providers !== 'object' || Array.isArray(parsed.providers)) unavailable();
    image = parsed;
  } catch (error) {
    // Only an absent file at open is the reader's known empty-catalog state.
    // A failed read after open, symlink, malformed/oversized data never becomes
    // an empty capability permission or last-known-good cache fallback.
    if (fd !== undefined || error.code !== 'ENOENT') unavailable();
  } finally { if (fd !== undefined) fs.closeSync(fd); }
  // The standard reader must not retain old contents merely because mtime is
  // equal. The before/after resolver checks capture full lexical file equality.
  invalidateCatalog();
  const authority = Object.freeze({ sourceId, text });
  verifiedImages.set(authority, image);
  return authority;
}
