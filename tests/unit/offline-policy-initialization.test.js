import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { initializePoliciesOffline, POLICY_INTENT_FILE } from '@/lib/db/offlinePolicyInitialization.js';
import { acquireWriterOwnership } from '@/lib/db/writerOwnership.js';
import { DatabaseSync } from 'node:sqlite';
import initSqlJs from 'sql.js';
let dir, adapter;
const old = process.env.DATA_DIR;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-policy-')); process.env.DATA_DIR = dir; delete global._dbAdapter; vi.resetModules();
  adapter = await (await import('@/lib/db/driver.js')).getAdapter();
  const api = await import('@/lib/db/index.js'); await api.importDb({ apiKeys: [{ id: 'one', key: 'offline-secret-one' }, { id: 'two', key: 'offline-secret-two' }] });
  adapter.durableTransaction(() => adapter.run("INSERT INTO apiKeyBudgetPolicies(apiKeyId,weeklyLimitNanoUsd,monthlyLimitNanoUsd,version,updatedAt) VALUES('two',13,NULL,1,'2026-10-03T00:00:00.000Z')"));
  adapter.close(); adapter = null;
});
afterEach(() => { vi.restoreAllMocks(); adapter?.close(); delete global._dbAdapter; fs.rmSync(dir, { recursive: true, force: true }); if (old === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = old; });
const file = () => path.join(dir, 'db', 'data.sqlite');
const init = engine => initializePoliciesOffline({ directory: dir, engine, actor: 'fixture-operator', reason: 'pristine explicit policies' });
const recover = engine => initializePoliciesOffline({ directory: dir, engine, recover: true });
function inspect(fn) { const db = new DatabaseSync(file(), { readOnly: true }); try { return fn(db); } finally { db.close(); } }
async function inspectEngine(engine, fn) {
  if (engine !== 'sql.js') return inspect(fn);
  const SQL = await initSqlJs();
  // Fresh installed bytes, NOT writer RAM/export. Native read-only queries can
  // create WAL/SHM and would invalidate the standalone-image recovery fixture.
  const db = new SQL.Database(fs.readFileSync(file()));
  try { return fn({ prepare(sql) { return { get() { const statement = db.prepare(sql); try { return statement.step() ? statement.getAsObject() : undefined; } finally { statement.free(); } } }; } }); }
  finally { db.close(); }
}
describe('explicit offline policy transition writer', { timeout: 20000 }, () => {
  it('retired production initializer refuses before any DB interaction', async () => {
    const { initializeExplicitPoliciesSync } = await import('@/lib/db/policyInitialization.js');
    const touched = vi.fn(() => { throw new Error('DB interaction forbidden'); });
    const hostile = new Proxy({}, { get: touched });
    expect(() => initializeExplicitPoliciesSync(hostile)).toThrow('requires explicit offline'); expect(touched).not.toHaveBeenCalled();
  });
  it.each(['node:sqlite', 'sql.js'].flatMap(engine => ['intent-file', 'intent-directory', 'sidecar-file', 'sidecar-directory'].map(stage => [engine, stage])))('%s recovery %s fsync failure stops before DB mutation and preserves operation', async (engine, stage) => {
    const rename = fs.renameSync;
    const stop = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (to === path.join(dir, '.accounting-coverage.json')) throw new Error('prepare intent only'); return rename(from, to); });
    await expect(init(engine)).rejects.toThrow('prepare intent only'); stop.mockRestore();
    const retained = fs.readFileSync(path.join(dir, POLICY_INTENT_FILE)), intent = JSON.parse(retained);
    if (stage.startsWith('sidecar')) fs.writeFileSync(path.join(dir, '.accounting-coverage.json'), intent.coveragePost);
    const before = fs.readFileSync(file()), sidecar = fs.readFileSync(path.join(dir, '.accounting-coverage.json'));
    const sync = fs.fsyncSync; let armed = false, failed = false;
    const fail = vi.spyOn(fs, 'fsyncSync').mockImplementation(fd => {
      const target = fs.readlinkSync(`/proc/self/fd/${fd}`), stat = fs.fstatSync(fd);
      if (target === path.join(dir, POLICY_INTENT_FILE)) armed = stage.startsWith('intent');
      if (target === path.join(dir, '.accounting-coverage.json')) armed = stage.startsWith('sidecar');
      if (!failed && ((stage.endsWith('file') && armed && !stat.isDirectory()) || (stage.endsWith('directory') && armed && stat.isDirectory() && target === dir))) { failed = true; throw new Error('recovery durability fixture'); }
      return sync(fd);
    });
    await expect(recover(engine)).rejects.toThrow('recovery durability fixture'); fail.mockRestore(); expect(failed).toBe(true);
    expect(fs.readFileSync(file())).toEqual(before); expect(fs.readFileSync(path.join(dir, '.accounting-coverage.json'))).toEqual(sidecar); expect(fs.readFileSync(path.join(dir, POLICY_INTENT_FILE))).toEqual(retained);
    expect((await recover(engine)).operationId).toBe(intent.payload.operationId);
  });
  it.each(['node:sqlite', 'sql.js'])('%s uncertain reader cleanup rejects success and retains exclusion until owner death', async engine => {
    if (engine === 'sql.js') {
      // Track the held application descriptor, not an earlier image-reader FD.
      const open = fs.openSync, close = fs.closeSync; let held, failed = false;
      const openSpy = vi.spyOn(fs, 'openSync').mockImplementation((name, ...args) => { const fd = open(name, ...args); if (name === file() && held === undefined) held = fd; return fd; });
      const spy = vi.spyOn(fs, 'closeSync').mockImplementation(fd => { close(fd); if (!failed && fd === held) { failed = true; throw new Error('cleanup fixture'); } });
      await expect(init(engine)).rejects.toThrow('cleanup fixture'); spy.mockRestore(); openSpy.mockRestore();
    } else {
      const close = DatabaseSync.prototype.close; let failed = false;
      const spy = vi.spyOn(DatabaseSync.prototype, 'close').mockImplementation(function () { close.call(this); if (!failed) { failed = true; throw new Error('cleanup fixture'); } });
      await expect(init(engine)).rejects.toThrow('cleanup fixture'); spy.mockRestore();
    }
    expect(fs.existsSync(path.join(dir, '.gateway-writer.lock'))).toBe(true);
    await expect(recover(engine)).rejects.toThrow('writer already active');
    // afterEach removes this test-only directory; never claim same-process repair.
  });
  it.each(['node:sqlite', 'sql.js'])('initializes %s, preserves restrictive policy and replays exact receipt without activation', async engine => {
    const result = await init(engine); expect(result).toMatchObject({ inserted: 1, engine, enforcementActive: false });
    await inspectEngine(engine, db => { expect(db.prepare("SELECT * FROM apiKeyBudgetPolicies WHERE apiKeyId='one'").get()).toMatchObject({ weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null, version: 0 }); expect(db.prepare("SELECT weeklyLimitNanoUsd FROM apiKeyBudgetPolicies WHERE apiKeyId='two'").get().weeklyLimitNanoUsd).toBe(13); expect(db.prepare("SELECT value FROM _meta WHERE key='ledgerStartedAt'").get()).toBeUndefined(); expect(db.prepare('SELECT COUNT(*) AS n FROM apiKeyAccountingAudit').get().n).toBe(1); });
    const receipt = fs.readFileSync(path.join(dir, POLICY_INTENT_FILE));
    expect(await recover(engine)).toMatchObject({ operationId: result.operationId, recovered: true }); expect(fs.readFileSync(path.join(dir, POLICY_INTENT_FILE))).toEqual(receipt);
    await expect(init(engine)).rejects.toThrow('Offline policy initialization unavailable');
  });
  it.each(['node:sqlite', 'sql.js'])('durable intent retained when sidecar installation fails %s; explicit recovery finishes only this operation', async engine => {
    const rename = fs.renameSync; const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (to === path.join(dir, '.accounting-coverage.json')) throw new Error('sidecar publish fixture'); return rename(from, to); });
    await expect(init(engine)).rejects.toThrow('sidecar publish fixture'); spy.mockRestore();
    expect(fs.existsSync(path.join(dir, POLICY_INTENT_FILE))).toBe(true); expect(JSON.parse(fs.readFileSync(path.join(dir, '.accounting-coverage.json'))).generation).toBe(0);
    const result = await recover(engine); expect(result.recovered).toBe(true);
    await inspectEngine(engine, db => expect(db.prepare('SELECT COUNT(*) AS n FROM apiKeyAccountingAudit').get().n).toBe(1));
  });
  it('native DB commit failure retains transitioned sidecar + old DB; explicit recovery applies recorded transaction', async () => {
    const original = DatabaseSync.prototype.exec; let failed = false;
    const spy = vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function(sql) { if (sql === 'COMMIT' && !failed) { failed = true; throw new Error('commit fixture'); } return original.call(this, sql); });
    await expect(init('node:sqlite')).rejects.toThrow('commit fixture'); spy.mockRestore();
    expect(JSON.parse(fs.readFileSync(path.join(dir, '.accounting-coverage.json'))).policyFormat).toBe('1');
    inspect(db => expect(db.prepare("SELECT value FROM _meta WHERE key='accountingPolicyFormat'").get()).toBeUndefined());
    expect((await recover('node:sqlite')).recovered).toBe(true);
  });
  it('SQL.js image replacement failure leaves old installed DB; explicit recovery never trusts prior RAM', async () => {
    const original = fs.renameSync; const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (to === file()) throw new Error('image publish fixture'); return original(from, to); });
    await expect(init('sql.js')).rejects.toThrow('image publish fixture'); spy.mockRestore();
    await inspectEngine('sql.js', db => expect(db.prepare("SELECT value FROM _meta WHERE key='accountingPolicyFormat'").get()).toBeUndefined());
    expect((await recover('sql.js')).recovered).toBe(true);
  });
  it('lost native commit acknowledgement is recognized only with matching retained intent/postimage receipt', async () => {
    const original = DatabaseSync.prototype.exec; let failed = false;
    const spy = vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function(sql) { const value = original.call(this, sql); if (sql === 'COMMIT' && !failed) { failed = true; throw new Error('lost acknowledgement fixture'); } return value; });
    await expect(init('node:sqlite')).rejects.toThrow('lost acknowledgement fixture'); spy.mockRestore();
    expect((await recover('node:sqlite')).recovered).toBe(true); inspect(db => expect(db.prepare('SELECT COUNT(*) AS n FROM apiKeyAccountingAudit').get().n).toBe(1));
  });
  it('rejects live writer ownership and recovery without intent without data writes', async () => {
    const before = fs.readFileSync(file()), coverage = fs.readFileSync(path.join(dir, '.accounting-coverage.json'));
    const owner = acquireWriterOwnership(dir); try { await expect(init('node:sqlite')).rejects.toThrow(); } finally { owner.release(); }
    await expect(recover('node:sqlite')).rejects.toThrow(); expect(fs.readFileSync(file())).toEqual(before); expect(fs.readFileSync(path.join(dir, '.accounting-coverage.json'))).toEqual(coverage); expect(fs.existsSync(path.join(dir, POLICY_INTENT_FILE))).toBe(false);
  });
  it('later legitimate DB change cannot use retained intent to reinitialize', async () => {
    await init('node:sqlite'); const db = new DatabaseSync(file()); try { db.exec("UPDATE apiKeys SET name='new-name' WHERE id='one'"); } finally { db.close(); }
    const before = fs.readFileSync(file()), coverage = fs.readFileSync(path.join(dir, '.accounting-coverage.json'));
    await expect(recover('node:sqlite')).rejects.toThrow('Offline policy initialization unavailable'); expect(fs.readFileSync(file())).toEqual(before); expect(fs.readFileSync(path.join(dir, '.accounting-coverage.json'))).toEqual(coverage);
  });
  it.each(['node:sqlite', 'sql.js'].flatMap(engine => ['missing', 'renamed', 'altered', 'extra'].map(kind => [engine, kind])))('rejects %s %s trigger before intent/sidecar mutation without installer repair', async (engine, kind) => {
    const db = new DatabaseSync(file());
    try {
      if (kind === 'missing') db.exec('DROP TRIGGER accounting_audit_target');
      if (kind === 'renamed') db.exec("DROP TRIGGER accounting_audit_target; CREATE TRIGGER renamed_audit_target BEFORE INSERT ON apiKeyAccountingAudit WHEN NEW.attemptId IS NULL AND NEW.gapId IS NULL BEGIN SELECT RAISE(ABORT, 'accounting audit target required'); END");
      if (kind === 'altered') db.exec("DROP TRIGGER accounting_audit_target; CREATE TRIGGER accounting_audit_target BEFORE INSERT ON apiKeyAccountingAudit BEGIN SELECT RAISE(ABORT, 'changed'); END");
      if (kind === 'extra') db.exec("CREATE TRIGGER extra_policy_effect AFTER INSERT ON apiKeyBudgetPolicies BEGIN UPDATE apiKeys SET name='unexpected'; END");
    } finally { db.close(); }
    const before = fs.readFileSync(file()), coverage = fs.readFileSync(path.join(dir, '.accounting-coverage.json'));
    await expect(init(engine)).rejects.toThrow('Offline policy initialization unavailable');
    expect(fs.readFileSync(file())).toEqual(before); expect(fs.readFileSync(path.join(dir, '.accounting-coverage.json'))).toEqual(coverage); expect(fs.existsSync(path.join(dir, POLICY_INTENT_FILE))).toBe(false);
  });
  it.each(['-wal', '-shm', '-journal'])('SQL.js recovery rejects actual %s sidecar without deleting evidence', async suffix => {
    await init('sql.js'); fs.writeFileSync(file() + suffix, 'sidecar-fixture');
    const before = fs.readFileSync(file()), coverage = fs.readFileSync(path.join(dir, '.accounting-coverage.json')), intent = fs.readFileSync(path.join(dir, POLICY_INTENT_FILE));
    await expect(recover('sql.js')).rejects.toThrow('Offline policy initialization unavailable');
    expect(fs.readFileSync(file())).toEqual(before); expect(fs.readFileSync(path.join(dir, '.accounting-coverage.json'))).toEqual(coverage); expect(fs.readFileSync(path.join(dir, POLICY_INTENT_FILE))).toEqual(intent); expect(fs.readFileSync(file() + suffix, 'utf8')).toBe('sidecar-fixture');
  });
  it('post-DB/pre-sidecar combination and malformed intent deny without repairing artifacts', async () => {
    const preCoverage = fs.readFileSync(path.join(dir, '.accounting-coverage.json')); await init('node:sqlite'); fs.writeFileSync(path.join(dir, '.accounting-coverage.json'), preCoverage);
    const before = fs.readFileSync(file()); await expect(recover('node:sqlite')).rejects.toThrow(); expect(fs.readFileSync(file())).toEqual(before); expect(fs.readFileSync(path.join(dir, '.accounting-coverage.json'))).toEqual(preCoverage);
    fs.writeFileSync(path.join(dir, POLICY_INTENT_FILE), '{"version":1}'); await expect(recover('node:sqlite')).rejects.toThrow(); expect(fs.readFileSync(file())).toEqual(before);
  });
});
