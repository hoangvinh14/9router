import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createNodeSqliteAdapter } from '../../src/lib/db/adapters/nodeSqliteAdapter.js';
import { wrapNativeAdapter } from '../../src/lib/db/adapters/nativeAdapter.js';
import { acquireWriterOwnership } from '../../src/lib/db/writerOwnership.js';

let dir, file, db;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), '9router-db-durable-')); file = path.join(dir, 'data.sqlite'); });
afterEach(() => { db?.close(); db = null; fs.rmSync(dir, { recursive: true, force: true }); });
describe('actual Node SQLite durable publication', () => {
  async function boot() { db = await createNodeSqliteAdapter(file); db.exec('CREATE TABLE IF NOT EXISTS prices(id TEXT PRIMARY KEY, value TEXT)'); }
  it('verified WAL/FULL ACK reopens and preserves ordinary writes', async () => {
    await boot();
    expect(db.get('PRAGMA journal_mode').journal_mode).toBe('wal');
    expect(db.get('PRAGMA synchronous').synchronous).toBe(2);
    db.run("INSERT INTO prices VALUES ('a','1')");
    db.durableTransaction(() => db.run("INSERT INTO prices VALUES ('b','2')"));
    expect(db.health().healthy).toBe(true);
    expect(db.canMemoizePricing()).toBe(true);
    db.close(); db = await createNodeSqliteAdapter(file);
    expect(db.all('SELECT * FROM prices ORDER BY id').map(row => row.value)).toEqual(['1', '2']);
    expect(db.raw).toBeUndefined();
  });
  it('closed engine retries blocked ownership release without allowing use, then reopens', async () => {
    await boot();
    const gate = path.join(dir, '.gateway-writer-acquisition'); fs.mkdirSync(gate);
    try {
      expect(() => db.close()).toThrow(/acquisition/);
      expect(db.health()).toMatchObject({ closed: true, healthy: false, owned: true });
      expect(() => db.close()).toThrow(/acquisition/);
      expect(() => db.get('SELECT 1')).toThrow();
    } finally { fs.rmdirSync(gate); }
    db.close(); db.close();
    expect(fs.existsSync(path.join(dir, '.gateway-writer.lock'))).toBe(false);
    db = await createNodeSqliteAdapter(file);
    expect(db.all('SELECT * FROM prices')).toEqual([]);
  });
  it('rollback, nested non-durable transaction and outermost ACK restriction', async () => {
    await boot();
    expect(() => db.durableTransaction(() => {
      expect(db.canMemoizePricing()).toBe(false);
      db.transaction(() => db.run("INSERT INTO prices VALUES ('a','1')"));
      expect(() => db.durableTransaction(() => {})).toThrow(/outermost/);
      throw new Error('rollback');
    })).toThrow('rollback');
    expect(db.all('SELECT * FROM prices')).toEqual([]);
    expect(db.health().healthy).toBe(true);
  });
  it('close inside callback cannot release live transaction ownership, caught or uncaught', async () => {
    await boot();
    db.durableTransaction(() => {
      expect(() => db.close()).toThrow(/inside transaction/);
      expect(fs.existsSync(path.join(dir, '.gateway-writer.lock'))).toBe(true);
      db.run("INSERT INTO prices VALUES ('a','1')");
    });
    expect(() => db.transaction(() => { db.run("UPDATE prices SET value='9'"); db.close(); })).toThrow(/inside transaction/);
    expect(db.health().healthy).toBe(true);
    expect(db.get('SELECT value FROM prices').value).toBe('1');
  });
  it('refuses raw transaction controls through all SQL entry points, including comments/multiple statements', async () => {
    await boot();
    for (const method of ['run', 'get', 'all', 'exec']) {
      expect(() => db[method]('/* comment */ BEGIN')).toThrow(/managed/);
      expect(() => db[method]('SELECT 1; -- boundary\nSAVEPOINT other')).toThrow(/managed/);
    }
    // Keywords in quoted string values are not transaction control.
    db.run("INSERT INTO prices VALUES ('a','BEGIN; COMMIT')");
  });
  it('read surfaces reject mutations while legitimate triggers retain managed ACK semantics', async () => {
    await boot();
    for (const method of ['get', 'all']) {
      for (const sql of ["INSERT INTO prices VALUES ('a','9') RETURNING value", 'PRAGMA user_version=7', 'PRAGMA journal_mode(OFF)', "WITH t AS (SELECT 1) DELETE FROM prices RETURNING value", 'SELECT 1; DELETE FROM prices']) {
        expect(() => db[method](sql)).toThrow(/read-only|introspection/);
      }
    }
    db.exec(`CREATE TRIGGER prices_audit AFTER INSERT ON prices BEGIN
      UPDATE prices SET value=CASE WHEN NEW.value='END; BEGIN' THEN '2' ELSE NEW.value END WHERE id=NEW.id;
    END;`);
    db.durableTransaction(() => db.run("INSERT INTO prices VALUES ('a','END; BEGIN')"));
    expect(db.get("SELECT value FROM prices WHERE id='a'").value).toBe('2');
    expect(() => db.exec('CREATE TRIGGER bad AFTER INSERT ON prices BEGIN SELECT 1; END; /* escape */ END TRANSACTION')).toThrow(/managed/);
    expect(db.all('PRAGMA table_info(prices)').length).toBe(2);
  });
  it('checks PRAGMAs before ACK and before release, not merely initialization', async () => {
    await boot();
    db.exec('PRAGMA synchronous=NORMAL');
    expect(() => db.durableTransaction(() => db.run("INSERT INTO prices VALUES ('a','1')"))).toThrow(/FULL/);
    expect(db.all('SELECT * FROM prices')).toEqual([]);
    db.exec('PRAGMA synchronous=FULL');
    db.durableTransaction(() => db.run("INSERT INTO prices VALUES ('a','1')"));
  });
  it('rejects async function before invocation and poisons escaping returned thenable', async () => {
    await boot(); let invoked = false;
    expect(() => db.transaction(async () => { invoked = true; })).toThrow(/synchronous/);
    expect(invoked).toBe(false);
    expect(db.health().healthy).toBe(true);
    expect(() => db.transaction(() => Promise.resolve())).toThrow(/synchronous/);
    await Promise.resolve();
    expect(db.health().poisoned).toBe(true);
    expect(() => db.get('SELECT 1')).toThrow();
  });
});
describe('native engine uncertainty seam (fault engine, not a runtime lane)', () => {
  function policyEngine() {
    return {
      prepare(sql) { return { get: () => sql.includes('journal_mode') ? { journal_mode: 'wal' } : { synchronous: 2 } }; },
      exec() {}, close() { throw new Error('default close must not run'); },
    };
  }
  it('explicit close policy runs once on normal close and repeated close stays idempotent', () => {
    const owner = acquireWriterOwnership(file); let closes = 0;
    db = wrapNativeAdapter(policyEngine(), owner, 'policy-fault-engine', () => { closes++; });
    db.close(); db.close();
    expect(closes).toBe(1);
    const replacement = acquireWriterOwnership(file); replacement.release();
  });
  it('ownership release retry after successful policy close never recloses the engine', () => {
    const owner = acquireWriterOwnership(file); let closes = 0;
    db = wrapNativeAdapter(policyEngine(), owner, 'policy-fault-engine', () => { closes++; });
    const gate = path.join(dir, '.gateway-writer-acquisition'); fs.mkdirSync(gate);
    try {
      expect(() => db.close()).toThrow(/acquisition/);
      expect(() => db.close()).toThrow(/acquisition/);
      expect(closes).toBe(1);
    } finally { fs.rmdirSync(gate); }
    db.close(); db.close();
    expect(closes).toBe(1);
    const replacement = acquireWriterOwnership(file); replacement.release();
  });
  it('explicit close failure retains ownership and poisons until successful retry', () => {
    const owner = acquireWriterOwnership(file); let fail = true, closes = 0;
    db = wrapNativeAdapter(policyEngine(), owner, 'policy-fault-engine', () => {
      closes++; if (fail) throw new Error('strict close failed');
    });
    expect(() => db.close()).toThrow('strict close failed');
    expect(db.health().poisoned).toBe(true);
    expect(() => db.get('SELECT 1')).toThrow();
    expect(() => acquireWriterOwnership(file)).toThrow();
    fail = false; db.close(); db.close();
    expect(closes).toBe(2);
  });
  it('initialization cleanup uses close policy and retains exclusion if closure is uncertain', () => {
    for (const failClose of [false, true]) {
      const target = path.join(dir, String(failClose), 'data.sqlite');
      const owner = acquireWriterOwnership(target); let closes = 0;
      const engine = policyEngine(); engine.exec = () => { throw new Error('init failed'); };
      expect(() => wrapNativeAdapter(engine, owner, 'policy-fault-engine', () => {
        closes++; if (failClose) throw new Error('cleanup close failed');
      })).toThrow(failClose ? 'cleanup close failed' : 'init failed');
      expect(closes).toBe(1);
      if (failClose) {
        expect(() => acquireWriterOwnership(target)).toThrow();
        owner.release(); // fixture-only synthetic engine has no native handle
      } else {
        const replacement = acquireWriterOwnership(target); replacement.release();
      }
    }
  });
  it('close failure alone poisons a previously healthy engine until successful retry-close', () => {
    const owner = acquireWriterOwnership(file); let fail = true;
    const engine = {
      prepare(sql) { return { get: () => sql.includes('journal_mode') ? { journal_mode: 'wal' } : { synchronous: 2 } }; },
      exec() {}, close() { if (fail) throw new Error('close failed'); },
    };
    db = wrapNativeAdapter(engine, owner, 'fault-engine');
    expect(db.health().healthy).toBe(true);
    expect(() => db.close()).toThrow('close failed');
    expect(db.health().poisoned).toBe(true);
    expect(() => db.durableTransaction(() => {})).toThrow();
    expect(() => acquireWriterOwnership(file)).toThrow();
    fail = false; db.close(); db.close();
  });
  it('RELEASE uncertainty poisons, including caught inner failure; close failure retains exclusion', () => {
    const owner = acquireWriterOwnership(file);
    let failClose = true;
    const engine = {
      prepare(sql) { return { get: () => sql.includes('journal_mode') ? { journal_mode: 'wal' } : { synchronous: 2 } }; },
      exec(sql) { if (sql.startsWith('RELEASE')) throw new Error('release failed'); },
      close() { if (failClose) throw new Error('close failed'); },
    };
    db = wrapNativeAdapter(engine, owner, 'fault-engine');
    expect(() => db.durableTransaction(() => {})).toThrow('release failed');
    expect(db.health().poisoned).toBe(true);
    expect(() => db.get('SELECT 1')).toThrow();
    expect(() => db.close()).toThrow('close failed');
    expect(fs.existsSync(path.join(dir, '.gateway-writer.lock'))).toBe(true);
    expect(db.health().healthy).toBe(false);
    expect(() => db.exec('SELECT 1')).toThrow();
    failClose = false; db.close();
    expect(fs.existsSync(path.join(dir, '.gateway-writer.lock'))).toBe(false);
  });
});
