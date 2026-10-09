import fs from 'node:fs';
import path from 'node:path';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { acquireWriterOwnership, withOwnershipInspection } from './writerOwnership.js';
import { atomicDurableWrite, fsyncDirectory } from './durableFile.js';
import { fingerprintLogicalSnapshot, LOGICAL_FINGERPRINT_VERSION } from './logicalFingerprint.js';
import { validateExplicitPolicy, POLICY_FORMAT_VERSION } from './explicitPolicy.js';
import { TABLES, buildCreateTableSql, SCHEMA_VERSION } from './schema.js';
import { ACCOUNTING_INVARIANT_TRIGGERS } from './accountingInvariants.js';
import { PRICING_REVISION_TRIGGERS } from './pricingRevision.js';

const OFFLINE_ALLOWED_TRIGGERS = Object.freeze([...ACCOUNTING_INVARIANT_TRIGGERS, ...PRICING_REVISION_TRIGGERS]);

export const POLICY_INTENT_FILE = '.accounting-policy-init-intent.json';
const COVERAGE_FILE = '.accounting-coverage.json';
const IMAGE_LIMIT = 64 * 1024 * 1024, JSON_LIMIT = 9 * 1024 * 1024;
const deny = () => { throw new Error('Offline policy initialization unavailable; retain artifacts for operator inspection'); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function readRegular(file, limit, acknowledge = false) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd, { bigint: true });
    if (!stat.isFile() || stat.size < 1n || stat.size > BigInt(limit)) deny();
    if ([POLICY_INTENT_FILE, COVERAGE_FILE].includes(path.basename(file))) {
      // Protected binding material: POSIX owner/mode only (not an ACL audit).
      if (typeof process.geteuid !== 'function' || stat.uid !== BigInt(process.geteuid()) || (stat.mode & 0o077n) !== 0n) deny();
    }
    const bytes = Buffer.alloc(Number(stat.size)); let offset = 0;
    while (offset < bytes.length) { const n = fs.readSync(fd, bytes, offset, bytes.length - offset, offset); if (!n) deny(); offset += n; }
    checkIdentity(file, fd, stat);
    if (acknowledge) { fs.fsyncSync(fd); checkIdentity(file, fd, stat); fsyncDirectory(path.dirname(file)); checkIdentity(file, fd, stat); }
    return bytes;
  } finally { fs.closeSync(fd); }
}
function checkIdentity(file, fd, before) {
  for (const after of [fs.fstatSync(fd, { bigint: true }), fs.lstatSync(file, { bigint: true })]) {
    if (!after.isFile() || ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(key => before[key] !== after[key])) deny();
  }
}
function assertSidecars(file, engine) {
  if (fs.existsSync(file + '-journal')) deny();
  if (engine === 'sql.js' && (fs.existsSync(file + '-wal') || fs.existsSync(file + '-shm'))) deny();
  if (engine === 'node:sqlite' && fs.existsSync(file + '-wal') && !fs.existsSync(file + '-shm')) deny();
}
function publishNewIntent(file, intent) {
  const bytes = Buffer.from(JSON.stringify(intent)); if (bytes.length > JSON_LIMIT) deny();
  const temporary = `${file}.${randomUUID()}.tmp`; let fd;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    // Atomic no-replace install: an existing intent is never overwritten.
    fs.linkSync(temporary, file); fsyncDirectory(path.dirname(file));
  } finally { if (fd !== undefined) fs.closeSync(fd); if (fs.existsSync(temporary)) { fs.unlinkSync(temporary); fsyncDirectory(path.dirname(file)); } }
}
function payloadValid(payload) {
  if (!exactKeys(payload, ['operationId', 'actor', 'reason', 'timestamp', 'keyIds']) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(payload.operationId) || !iso(payload.timestamp) ||
      ![payload.actor, payload.reason].every(text => typeof text === 'string' && text.trim() === text && text.length > 0 && text.length <= 200) ||
      !Array.isArray(payload.keyIds) || payload.keyIds.length > 10000 || payload.keyIds.some(id => typeof id !== 'string' || !id || id.length > 200) ||
      new Set(payload.keyIds).size !== payload.keyIds.length || JSON.stringify(payload.keyIds) !== JSON.stringify([...payload.keyIds].sort())) deny();
}
function coveragePre(bytes) {
  let value;
  try { value = JSON.parse(bytes); } catch { deny(); }
  if (!exactKeys(value, ['version', 'id', 'bindingKey', 'generation', 'gaps', 'maintenance', 'retiredBindings']) ||
      value.version !== 1 || typeof value.id !== 'string' || !value.id || !/^[a-f0-9]{64}$/.test(value.bindingKey) ||
      value.generation !== 0 || value.maintenance !== null || !Array.isArray(value.gaps) || value.gaps.length ||
      !Array.isArray(value.retiredBindings) || value.retiredBindings.length) deny();
  return value;
}
const postCoverage = pre => Buffer.from(JSON.stringify({ ...pre, policyFormat: POLICY_FORMAT_VERSION, generation: 1 }));
function validateIntent(intent) {
  if (!exactKeys(intent, ['version', 'engine', 'fingerprintVersion', 'payload', 'payloadHash', 'preHash', 'postHash', 'coveragePre', 'coveragePost']) ||
      intent.version !== 1 || !['node:sqlite', 'sql.js'].includes(intent.engine) || intent.fingerprintVersion !== LOGICAL_FINGERPRINT_VERSION ||
      ![intent.payloadHash, intent.preHash, intent.postHash].every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)) || intent.preHash === intent.postHash ||
      ![intent.coveragePre, intent.coveragePost].every(text => typeof text === 'string' && Buffer.byteLength(text) <= 4 * 1024 * 1024)) deny();
  payloadValid(intent.payload);
  if (digest(JSON.stringify(intent.payload)) !== intent.payloadHash || postCoverage(coveragePre(intent.coveragePre)).toString() !== intent.coveragePost) deny();
  return intent;
}
function schemaSupported(reader) {
  // Only the complete exact canonical accounting + pricing revision set may
  // exist. Pricing triggers write only the revision for pricing/catalog kv DML;
  // policy initialization does not mutate kv or invoke them.
  // Do NOT install/repair triggers here: missing/changed/extra definitions deny.
  const triggers = reader.all("SELECT name,tbl_name,sql FROM sqlite_schema WHERE type='trigger'");
  if (triggers.length !== OFFLINE_ALLOWED_TRIGGERS.length || triggers.some(row => {
    const known = OFFLINE_ALLOWED_TRIGGERS.find(trigger => trigger.name === row.name);
    return !known || row.tbl_name !== known.table || row.sql !== known.sql;
  })) deny();
  for (const name of ['_meta', 'apiKeys', 'apiKeyBindings', 'apiKeyBudgetPolicies', 'apiKeyAccounting', 'apiKeyAccountingAudit']) {
    const sql = reader.get('SELECT sql FROM sqlite_schema WHERE type=\'table\' AND name=?', [name])?.sql;
    const expected = buildCreateTableSql(name, TABLES[name]).replace(' IF NOT EXISTS', '');
    if (sql !== expected) deny();
  }
  if (reader.get("SELECT value FROM _meta WHERE key='schemaVersion'")?.value !== String(SCHEMA_VERSION) || reader.get('PRAGMA quick_check')?.quick_check !== 'ok') deny();
}
function eligible(reader, coverage, expectedIds) {
  schemaSupported(reader);
  if (reader.get("SELECT value FROM _meta WHERE key IN ('ledgerStartedAt','accountingPolicyFormat') LIMIT 1") || reader.get('SELECT attemptId FROM apiKeyAccounting LIMIT 1') ||
      reader.get('SELECT id FROM apiKeyAccountingAudit LIMIT 1') || reader.get('SELECT apiKeyId FROM apiKeyBindings WHERE retiredAt IS NOT NULL LIMIT 1') ||
      reader.get("SELECT value FROM _meta WHERE key='accountingCoverageId'")?.value !== coverage.id ||
      reader.get("SELECT value FROM _meta WHERE key='accountingBindingKeyId'")?.value !== digest(coverage.bindingKey)) deny();
  const rows = reader.all('SELECT * FROM apiKeys'); const ids = [], secrets = new Set();
  for (const key of rows) {
    if (typeof key.id !== 'string' || !key.id || key.id.length > 200 || typeof key.key !== 'string' || !key.key || key.key.length > 8192 || secrets.has(key.key)) deny();
    secrets.add(key.key); ids.push(key.id);
    const fingerprint = createHmac('sha256', Buffer.from(coverage.bindingKey, 'hex')).update(key.key).digest('hex');
    const binding = reader.get('SELECT * FROM apiKeyBindings WHERE apiKeyId=?', [key.id]);
    if (!binding || binding.retiredAt !== null || binding.fingerprint !== fingerprint || reader.get('SELECT apiKeyId FROM apiKeyBindings WHERE fingerprint=?', [fingerprint])?.apiKeyId !== key.id) deny();
  }
  for (const row of reader.all('SELECT * FROM apiKeyBudgetPolicies')) validateExplicitPolicy(row);
  const missing = ids.filter(id => !reader.get('SELECT apiKeyId FROM apiKeyBudgetPolicies WHERE apiKeyId=?', [id])).sort();
  if (ids.length > 10000 || new Set(ids).size !== ids.length || expectedIds && JSON.stringify(missing) !== JSON.stringify(expectedIds)) deny();
  return missing;
}
function apply(reader, intent) {
  for (const id of intent.payload.keyIds) reader.run('INSERT INTO apiKeyBudgetPolicies(apiKeyId,weeklyLimitNanoUsd,monthlyLimitNanoUsd,version,updatedAt) VALUES(?,NULL,NULL,0,?)', [id, intent.payload.timestamp]);
  reader.run("INSERT INTO _meta(key,value) VALUES('accountingPolicyFormat',?)", [POLICY_FORMAT_VERSION]);
  // Receipt binds canonical payload, not postHash or intentHash (no hash cycle).
  reader.run('INSERT INTO apiKeyAccountingAudit(id,gapId,operationId,actor,reason,action,beforeJson,afterJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)',
    [intent.payload.operationId, 'global-policy-initialization', intent.payload.operationId, intent.payload.actor, intent.payload.reason, 'policy_initialization', JSON.stringify({ preHash: intent.preHash }), JSON.stringify({ payloadHash: intent.payloadHash }), intent.payload.timestamp]);
}
function receiptMatches(reader, intent) {
  const row = reader.get('SELECT * FROM apiKeyAccountingAudit WHERE operationId=?', [intent.payload.operationId]);
  return row && row.id === intent.payload.operationId && row.attemptId === null && row.apiKeyId === null && row.gapId === 'global-policy-initialization' &&
    row.actor === intent.payload.actor && row.reason === intent.payload.reason && row.action === 'policy_initialization' && row.createdAt === intent.payload.timestamp &&
    row.beforeJson === JSON.stringify({ preHash: intent.preHash }) && row.afterJson === JSON.stringify({ payloadHash: intent.payloadHash });
}
function acknowledgeInstalled(file, engine) {
  assertSidecars(file, engine);
  for (const candidate of [file, ...(engine === 'node:sqlite' && fs.existsSync(file + '-wal') ? [file + '-wal'] : [])]) {
    const fd = fs.openSync(candidate, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try { const stat = fs.fstatSync(fd, { bigint: true }); if (!stat.isFile()) deny(); fs.fsyncSync(fd); checkIdentity(candidate, fd, stat); }
    finally { fs.closeSync(fd); }
  }
  fsyncDirectory(path.dirname(file));
}

// Explicit OFFLINE operation. Acquires a fresh owner; never normal app bootstrap,
// migrations, intent retrofit or ledger activation. Trusted cooperative filesystem:
// not hostile-race/whole-bundle antirollback protection. Retains intent on success.
export async function initializePoliciesOffline({ directory, engine = 'node:sqlite', actor, reason, recover = false }) {
  if (!['node:sqlite', 'sql.js'].includes(engine) || typeof directory !== 'string' || typeof recover !== 'boolean') deny();
  let Database, SQL;
  if (engine === 'node:sqlite') { Database = (await import('node:sqlite')).DatabaseSync; }
  else SQL = await (await import('sql.js')).default();
  const canonical = fs.realpathSync(directory); const file = path.join(canonical, 'db', 'data.sqlite');
  if (fs.realpathSync(path.dirname(file)) !== path.dirname(file)) deny();
  const owner = acquireWriterOwnership(canonical);
  let cleanupUncertain = false;
  try { return withOwnershipInspection(owner, () => {
    const sidecar = path.join(canonical, COVERAGE_FILE), intentFile = path.join(canonical, POLICY_INTENT_FILE);
    assertSidecars(file, engine);
    const coverageBytes = readRegular(sidecar, 4 * 1024 * 1024);
    let intent;
    if (recover) { intent = validateIntent(JSON.parse(readRegular(intentFile, JSON_LIMIT))); if (intent.engine !== engine) deny(); }
    else { if (fs.existsSync(intentFile)) deny(); coveragePre(coverageBytes); }
    // Hold descriptor identity through SQLite's separate pathname open. The
    // owner excludes cooperating writers; hostile replace-and-restore is excluded.
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); let db, transaction = false, failure, result;
    try {
      const initial = fs.fstatSync(fd, { bigint: true }); checkIdentity(file, fd, initial);
      if (!initial.isFile() || initial.size < 1n || initial.size > BigInt(IMAGE_LIMIT)) deny();
      db = engine === 'node:sqlite' ? new Database(file) : new SQL.Database(readRegular(file, IMAGE_LIMIT));
      const reader = { all(sql, params = []) {
        if (engine === 'node:sqlite') return db.prepare(sql).all(...params);
        const statement = db.prepare(sql); try { statement.bind(params); const rows = []; while (statement.step()) rows.push(statement.getAsObject()); return rows; } finally { statement.free(); }
      }, get(sql, params = []) { return this.all(sql, params)[0]; }, run(sql, params = []) { if (engine === 'node:sqlite') db.prepare(sql).run(...params); else db.run(sql, params); }, exec(sql) { db.exec(sql); } };
      if (engine === 'node:sqlite' && reader.get('PRAGMA journal_mode')?.journal_mode !== 'wal') deny();
      reader.exec('PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0; BEGIN IMMEDIATE'); transaction = true;
      if (engine === 'node:sqlite' && reader.get('PRAGMA synchronous')?.synchronous !== 2) deny();
      const hash = () => fingerprintLogicalSnapshot(reader).sha256;
      const currentHash = hash();
      if (!recover) {
        const pre = coveragePre(coverageBytes);
        const payload = { operationId: randomUUID(), actor, reason, timestamp: new Date().toISOString(), keyIds: eligible(reader, pre) }; payloadValid(payload);
        intent = { version: 1, engine, fingerprintVersion: LOGICAL_FINGERPRINT_VERSION, payload, payloadHash: digest(JSON.stringify(payload)), preHash: currentHash, postHash: '', coveragePre: coverageBytes.toString(), coveragePost: postCoverage(pre).toString() };
        reader.exec('SAVEPOINT predict'); apply(reader, intent); intent.postHash = hash(); reader.exec('ROLLBACK TO predict; RELEASE predict');
        if (hash() !== currentHash) deny(); validateIntent(intent); publishNewIntent(intentFile, intent);
      }
      const preSide = coverageBytes.toString() === intent.coveragePre, postSide = coverageBytes.toString() === intent.coveragePost;
      if (currentHash === intent.postHash && postSide && receiptMatches(reader, intent)) {
        schemaSupported(reader);
        if (!readRegular(intentFile, JSON_LIMIT, true).equals(Buffer.from(JSON.stringify(intent)))) deny();
        if (!readRegular(sidecar, 4 * 1024 * 1024, true).equals(coverageBytes)) deny();
        reader.exec('ROLLBACK'); transaction = false;
      } else if (currentHash === intent.preHash && (preSide || postSide)) {
        eligible(reader, coveragePre(intent.coveragePre), intent.payload.keyIds);
        checkIdentity(file, fd, initial);
        if (!readRegular(intentFile, JSON_LIMIT, true).equals(Buffer.from(JSON.stringify(intent)))) deny();
        if (!readRegular(sidecar, 4 * 1024 * 1024).equals(coverageBytes)) deny();
        if (preSide) atomicDurableWrite(sidecar, intent.coveragePost);
        // A previously renamed post-sidecar may have lost its fsync ACK. Sync
        // validated bytes on the same descriptor + directory BEFORE DB writes.
        if (!readRegular(sidecar, 4 * 1024 * 1024, true).equals(Buffer.from(intent.coveragePost))) deny();
        apply(reader, intent); if (hash() !== intent.postHash || !receiptMatches(reader, intent)) deny();
        reader.exec('COMMIT'); transaction = false;
        if (engine === 'sql.js') atomicDurableWrite(file, Buffer.from(db.export()));
      } else deny();
      // Fresh durable ACK for postimage recognition, including a retained WAL;
      // never infer a previous ACK from logical equality alone.
      if (engine === 'node:sqlite') {
        const checkpoint = reader.get('PRAGMA wal_checkpoint(TRUNCATE)');
        if (!checkpoint || checkpoint.busy !== 0 || checkpoint.log !== 0 || checkpoint.checkpointed !== 0) deny();
      }
      acknowledgeInstalled(file, engine); acknowledgeInstalled(sidecar, 'sql.js'); acknowledgeInstalled(intentFile, 'sql.js');
      if (!readRegular(sidecar, 4 * 1024 * 1024).equals(Buffer.from(intent.coveragePost))) deny();
      if (hash() !== intent.postHash) deny();
      // SQL.js RAM equality is not installed-file evidence. Independently reopen
      // the acknowledged image and fingerprint every schema/table/typed row.
      if (engine === 'sql.js') {
        const installed = new SQL.Database(readRegular(file, IMAGE_LIMIT));
        try {
          const persisted = { all(sql) { const statement = installed.prepare(sql); try { const rows = []; while (statement.step()) rows.push(statement.getAsObject()); return rows; } finally { statement.free(); } } };
          if (fingerprintLogicalSnapshot(persisted).sha256 !== intent.postHash) deny();
        } finally { installed.close(); }
      }
      const installedPath = fs.lstatSync(file, { bigint: true });
      // Native writer retains its inode; SQL.js intentionally replaced its image.
      if (!installedPath.isFile() || engine === 'node:sqlite' && (installedPath.dev !== initial.dev || installedPath.ino !== initial.ino)) deny();
      result = Object.freeze({ operationId: intent.payload.operationId, inserted: intent.payload.keyIds.length, engine, recovered: recover, enforcementActive: false });
    } catch (error) { failure = error; }
    finally {
      if (db) { if (transaction) { try { db.exec('ROLLBACK'); } catch (error) { failure ??= error; } } try { db.close(); } catch (error) { cleanupUncertain = true; failure ??= error; } }
      try { fs.closeSync(fd); } catch (error) { cleanupUncertain = true; failure ??= error; }
    }
    if (failure) throw failure;
    return result;
  }); } finally { if (!cleanupUncertain) owner.release(); }
}
