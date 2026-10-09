import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { constants as bufferConstants } from 'node:buffer';
import { atomicDurableWrite, fsyncDirectory } from './durableFile.js';
import { backupDbLite } from './backup.js';
import { POLICY_INTENT_FILE } from './offlinePolicyInitialization.js';

const INTENT_LIMIT = 9 * 1024 * 1024;
// Preserve the existing whole-image restore contract. This is the runtime's
// Buffer representability ceiling, not a new 64MiB policy/allocation guarantee.
const IMAGE_LIMIT = bufferConstants.MAX_LENGTH;
const MARKER = '.accounting-backup-bundle.json';
const COVERAGE = '.accounting-coverage.json';
const deny = () => { throw new Error('Managed restore recovery artifacts mismatched; remain in maintenance'); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const exact = (object, fields) => object && !Array.isArray(object) && Object.keys(object).sort().join(',') === [...fields].sort().join(',');
function canonicalDirectory(directory) {
  const absolute = path.resolve(directory);
  if (fs.realpathSync(absolute) !== absolute || !fs.lstatSync(absolute).isDirectory()) deny();
  return absolute;
}
function privateGeneration(directory) {
  const canonical = canonicalDirectory(directory), stat = fs.lstatSync(canonical);
  if (typeof process.geteuid !== 'function' || stat.uid !== process.geteuid() || (stat.mode & 0o077) !== 0) deny();
  return canonical;
}
export function validateRestoreDestination(liveDirectory, backupRoot) {
  const live = canonicalDirectory(liveDirectory), root = path.resolve(backupRoot);
  // Dedicated backup children are supported, including the existing db/backups
  // subtree. Never put archive files at live root or alongside live DB files.
  const relative = path.relative(live, root);
  if (!relative || relative === 'db' || relative.startsWith('db' + path.sep) && relative !== path.join('db', 'backups') && !relative.startsWith(path.join('db', 'backups') + path.sep)) deny();
  let ancestor = root;
  while (!fs.existsSync(ancestor)) {
    try { fs.lstatSync(ancestor); deny(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(ancestor); if (parent === ancestor) deny(); ancestor = parent;
  }
  canonicalDirectory(ancestor);
  if (fs.existsSync(root)) {
    const stat = fs.lstatSync(root);
    if (typeof process.geteuid !== 'function' || stat.uid !== process.geteuid() || (stat.mode & 0o022) !== 0) deny();
  }
  return root;
}
export function readRestoreArtifact(file, limit = IMAGE_LIMIT, protectedFile = false) {
  canonicalDirectory(path.dirname(file));
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size < 1n || before.size > BigInt(limit) || typeof process.geteuid !== 'function' || before.uid !== BigInt(process.geteuid()) || (before.mode & 0o022n) !== 0n || protectedFile && (before.mode & 0o077n) !== 0n) deny();
    const bytes = Buffer.alloc(Number(before.size)); let offset = 0;
    while (offset < bytes.length) { const n = fs.readSync(fd, bytes, offset, bytes.length - offset, offset); if (!n) deny(); offset += n; }
    for (const after of [fs.fstatSync(fd, { bigint: true }), fs.lstatSync(file, { bigint: true })]) {
      if (!after.isFile() || ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(field => before[field] !== after[field])) deny();
    }
    return bytes;
  } catch { deny(); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function entryPresent(file) {
  // existsSync follows links and conflates dangling/unreadable entries with
  // absence. Only an entry-level ENOENT proves explicit absence here.
  try { fs.lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; deny(); }
}
function intent(directory) {
  const file = path.join(directory, POLICY_INTENT_FILE);
  if (!entryPresent(file)) return { present: false };
  const bytes = readRestoreArtifact(file, INTENT_LIMIT, true);
  return { present: true, sha256: hash(bytes), bytes };
}
function sameIntent(a, b) { return a.present === b.present && (!a.present || a.sha256 === b.sha256); }

// Synchronous owned generation capture; no callback/yield admits an interleaved
// mutation. Marker is published last. Partial generations remain as evidence,
// never returned as complete and never overwritten/pruned by this procedure.
export function captureRestoreBundle(db, backupRoot, operationId) {
  if (!db.health().healthy || !db.ownerInstanceId || !db.coverage.status().maintenance) deny();
  const liveDirectory = canonicalDirectory(path.dirname(db.coverage.file));
  const destination = validateRestoreDestination(liveDirectory, backupRoot);
  if (typeof operationId !== 'string' || !operationId) deny();
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  const root = canonicalDirectory(destination);
  const generation = privateGeneration(fs.mkdtempSync(path.join(root, 'accounting-bundle-')));
  fsyncDirectory(root);
  const retained = intent(liveDirectory), coverageBytes = readRestoreArtifact(db.coverage.file, 4 * 1024 * 1024, true);
  const databaseBackup = backupDbLite(db, generation);
  const databaseBackupHash = hash(readRestoreArtifact(databaseBackup));
  const coverageBackup = path.join(generation, COVERAGE);
  const coverageBackupHash = hash(readRestoreArtifact(coverageBackup, 4 * 1024 * 1024, true));
  if (coverageBackupHash !== hash(coverageBytes) || !readRestoreArtifact(db.coverage.file, 4 * 1024 * 1024, true).equals(coverageBytes) || !sameIntent(retained, intent(liveDirectory))) deny();
  const policyInitializationIntent = retained.present
    ? { present: true, sha256: retained.sha256, backup: path.join(generation, POLICY_INTENT_FILE) }
    : { present: false };
  if (retained.present) atomicDurableWrite(policyInitializationIntent.backup, retained.bytes);
  db.coverage.status();
  if (!sameIntent(retained, intent(liveDirectory))) deny();
  const bundleManifest = path.join(generation, MARKER);
  const state = db.coverage.status();
  const marker = { version: 1, operationId, coverageId: state.id, generation: state.generation, databaseHash: databaseBackupHash, coverageHash: coverageBackupHash,
    policyInitializationIntent: retained.present ? { present: true, sha256: retained.sha256 } : { present: false } };
  atomicDurableWrite(bundleManifest, JSON.stringify(marker));
  return { databaseBackup, databaseBackupHash, coverageBackup, coverageBackupHash, bundleManifest,
    bundleManifestHash: hash(readRestoreArtifact(bundleManifest, 16384, true)), policyInitializationIntent };
}

export function validateRestoreBundle(manifest, liveDirectory) {
  const retained = intent(canonicalDirectory(liveDirectory));
  if (manifest.version === 1) {
    // Legacy absence is not permission to retrofit/adopt a retained operation.
    if (retained.present || entryPresent(path.join(path.dirname(manifest.databaseBackup), POLICY_INTENT_FILE))) deny();
    return;
  }
  if (manifest.version !== 2) deny();
  const generation = privateGeneration(path.dirname(manifest.bundleManifest));
  validateRestoreDestination(liveDirectory, path.dirname(generation));
  if (!/^accounting-bundle-[A-Za-z0-9]+$/.test(path.basename(generation)) || manifest.bundleManifest !== path.join(generation, MARKER) || manifest.databaseBackup !== path.join(generation, 'data.sqlite') || manifest.coverageBackup !== path.join(generation, COVERAGE)) deny();
  const markerBytes = readRestoreArtifact(manifest.bundleManifest, 16384, true);
  if (hash(markerBytes) !== manifest.bundleManifestHash) deny();
  let marker; try { marker = JSON.parse(markerBytes); } catch { deny(); }
  if (!exact(marker, ['version', 'operationId', 'coverageId', 'generation', 'databaseHash', 'coverageHash', 'policyInitializationIntent']) || marker.version !== 1 || marker.operationId !== manifest.operationId || marker.coverageId !== manifest.coverageId || marker.generation !== manifest.generation || marker.databaseHash !== manifest.databaseBackupHash || marker.coverageHash !== manifest.coverageBackupHash) deny();
  const archived = manifest.policyInitializationIntent, expected = marker.policyInitializationIntent;
  if (!archived || typeof archived.present !== 'boolean' || !expected || expected.present !== archived.present || retained.present !== archived.present) deny();
  if (archived.present) {
    if (!exact(archived, ['present', 'sha256', 'backup']) || !exact(expected, ['present', 'sha256']) || !/^[a-f0-9]{64}$/.test(archived.sha256) || archived.sha256 !== expected.sha256 || archived.sha256 !== retained.sha256 || archived.backup !== path.join(generation, POLICY_INTENT_FILE) || hash(readRestoreArtifact(archived.backup, INTENT_LIMIT, true)) !== archived.sha256) deny();
  } else if (!exact(archived, ['present']) || !exact(expected, ['present']) || entryPresent(path.join(generation, POLICY_INTENT_FILE))) deny();
  if (hash(readRestoreArtifact(manifest.databaseBackup)) !== manifest.databaseBackupHash || hash(readRestoreArtifact(manifest.coverageBackup, 4 * 1024 * 1024, true)) !== manifest.coverageBackupHash) deny();
}
