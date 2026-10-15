import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { withOwnershipInspection } from '../db/writerOwnership.js';
import { atomicDurableWrite } from '../db/durableFile.js';
import { assertGeminiOwnedUploadResultSync } from './geminiOwnedUpload.js';
import { snapshotAccountingPreparedData } from '../../../open-sse/config/accountedBaseDispatch.js';

// Protected receipt-before-DB ordering. Detects DB-only/row rollback, NOT a
// rollback of DB + sidecar + protected coverage key together after process death.
const FILE = '.gemini-resource-lifecycle.json';
const SCOPE = 'gemini-upload-registry-v1';
const stores = new WeakMap();
const unavailable = () => { throw new Error('Gemini resource lifecycle unavailable; reconciliation required'); };
const digest = value => createHash('sha256').update(value).digest('hex');
function sign(db, payload) { return db.coverage.fingerprint('gemini-resource-lifecycle/v1\0' + digest(JSON.stringify(payload))); }
export function openGeminiResourceLifecycleSync(db, owner) {
  if (!db.health().healthy) unavailable();
  withOwnershipInspection(owner, () => {
    if (db.ownerInstanceId !== owner.instanceId) unavailable();
    const previous = stores.get(db);
    if (previous && previous.owner !== owner) unavailable();
    if (!previous) stores.set(db, { owner, failed: false, latest: null });
  });
}
function owned(db, fn) {
  const store = stores.get(db);
  if (!store || store.failed || !db.health().healthy) unavailable();
  return withOwnershipInspection(store.owner, directory => fn(store, path.join(directory, FILE)));
}
function load(db, store, file, initialize = false) {
  if (!fs.existsSync(file)) {
    if (!initialize || store.latest || db.get('SELECT key FROM kv WHERE scope=? LIMIT 1', [SCOPE])) unavailable();
    return { version: 1, coverageId: db.coverage.status().id, generation: 0, receipts: [] };
  }
  let envelope;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 262144) unavailable();
    envelope = snapshotAccountingPreparedData(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch { unavailable(); }
  if (!envelope || Object.keys(envelope).sort().join(',') !== 'payload,signature' || envelope.signature !== sign(db, envelope.payload)) unavailable();
  const p = envelope.payload;
  if (!p || Object.keys(p).sort().join(',') !== 'coverageId,generation,receipts,version' || p.version !== 1 ||
      p.coverageId !== db.coverage.status().id || !Number.isSafeInteger(p.generation) || p.generation < 0 ||
      !Array.isArray(p.receipts) || p.receipts.length > 1000) unavailable();
  const ids = new Set();
  for (const r of p.receipts) {
    if (!r || !['digest,id', 'digest,id,originDigest'].includes(Object.keys(r).sort().join(',')) || typeof r.id !== 'string' || !/^[a-f0-9-]{36}(?![\s\S])/.test(r.id) ||
        typeof r.digest !== 'string' || !/^[a-f0-9]{64}(?![\s\S])/.test(r.digest) || ids.has(r.id) || Object.hasOwn(r, 'originDigest') && (typeof r.originDigest !== 'string' || !/^[a-f0-9]{64}(?![\s\S])/.test(r.originDigest))) unavailable();
    ids.add(r.id);
  }
  if (store.latest && (p.generation < store.latest.generation || p.generation === store.latest.generation && JSON.stringify(p) !== JSON.stringify(store.latest))) unavailable();
  store.latest = p;
  return p;
}
export function assertGeminiResourceReceiptSync(db, id, serialized) {
  owned(db, (store, file) => {
    const state = load(db, store, file);
    if (state.receipts.find(r => r.id === id)?.digest !== digest(serialized)) unavailable();
  });
}
// Issuer never accepts a row/URI as network provenance. The upload owner's
// private exact successful result identity must prove origin first.
export function retainGeminiUploadOriginSync(db, binding, result) {
  assertGeminiOwnedUploadResultSync(db, binding, result);
  owned(db, (store, file) => {
    const before = load(db, store, file);
    const serialized = db.get('SELECT value FROM kv WHERE scope=? AND key=?', [SCOPE, result.id])?.value;
    const previous = before.receipts.find(r => r.id === result.id);
    if (!serialized || previous?.digest !== digest(serialized) || before.generation === Number.MAX_SAFE_INTEGER) unavailable();
    if (previous.originDigest) {
      if (previous.originDigest !== digest(serialized)) unavailable();
      return;
    }
    const receipts = before.receipts.map(r => r.id === result.id ? { ...r, originDigest: digest(serialized) } : r);
    const payload = snapshotAccountingPreparedData({ ...before, generation: before.generation + 1, receipts });
    const bytes = JSON.stringify({ payload, signature: sign(db, payload) });
    if (Buffer.byteLength(bytes) > 262144) unavailable();
    try { atomicDurableWrite(file, bytes); } catch (error) { store.failed = true; throw error; }
    store.latest = payload;
  });
}
export function assertGeminiUploadOriginSync(db, id) {
  owned(db, (store, file) => {
    const state = load(db, store, file);
    const serialized = db.get('SELECT value FROM kv WHERE scope=? AND key=?', [SCOPE, id])?.value;
    const receipt = state.receipts.find(r => r.id === id);
    if (!serialized || receipt?.digest !== digest(serialized) || receipt.originDigest !== digest(serialized)) unavailable();
  });
}
export function retainGeminiResourceReceiptSync(db, id, serialized) {
  owned(db, (store, file) => {
    const before = load(db, store, file, true);
    const receipts = before.receipts.filter(r => r.id !== id);
    const stored = db.get('SELECT value FROM kv WHERE scope=? AND key=?', [SCOPE, id])?.value;
    const previous = before.receipts.find(r => r.id === id);
    if (stored !== undefined && previous?.digest !== digest(stored) || stored === undefined && previous) unavailable();
    if (receipts.length >= 1000 || before.generation === Number.MAX_SAFE_INTEGER) unavailable();
    receipts.push({ id, digest: digest(serialized), ...(previous?.originDigest ? { originDigest: previous.originDigest } : {}) });
    const payload = snapshotAccountingPreparedData({ ...before, generation: before.generation + 1, receipts });
    const bytes = JSON.stringify({ payload, signature: sign(db, payload) });
    if (Buffer.byteLength(bytes) > 262144) unavailable();
    try { atomicDurableWrite(file, bytes); } catch (error) { store.failed = true; throw error; }
    store.latest = payload;
  });
}
