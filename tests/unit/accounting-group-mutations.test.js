import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { acquireWriterOwnership } from '@/lib/db/writerOwnership.js';
import { createNodeSqliteAdapter } from '@/lib/db/adapters/nodeSqliteAdapter.js';
import { createSqlJsAdapter } from '@/lib/db/adapters/sqljsAdapter.js';
import { runMigrationOnce } from '@/lib/db/migrate.js';
import * as ledger from '@/lib/db/repos/apiKeyAccountingRepo.js';
import { costFromExactUsage } from '@/lib/pricing/money.js';

const timestamp = '2026-10-03T00:00:00.000Z';
const usage = { exact: true, input: 500000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, reasoningIncludedInOutput: true };
const priceSnapshot = { rates: { input: '0.000000001', output: '0' } };
const input = id => ({ attemptId: id, requestId: `request-${id}`, apiKeyId: `key-${id}`, ownerInstanceId: 'fixture-owner', provider: 'fixture', model: 'fixture', endpoint: 'chat', startedAt: timestamp, priceSnapshot });
const insert = id => ({ type: 'insert', input: input(id) });
const terminal = () => ({ state: 'settled', outcome: 'success', finishedAt: timestamp, usage, costNanoUsd: costFromExactUsage(usage, priceSnapshot.rates) });
const finalize = id => ({ type: 'finalize', attemptId: id, terminal: terminal() });

for (const engine of ['node:sqlite', 'sql.js']) {
  describe(`${engine} internal repository group (not queue/admission certification)`, { timeout: 20000 }, () => {
    let db, owner, dir, file;
    const open = () => engine === 'node:sqlite' ? createNodeSqliteAdapter(file, owner) : createSqlJsAdapter(file, owner);
    beforeEach(async () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), '9router-ledger-group-')); fs.mkdirSync(path.join(dir, 'db'));
      file = path.join(dir, 'db/data.sqlite'); owner = acquireWriterOwnership(dir); db = await open(); await runMigrationOnce(db);
    });
    afterEach(() => { vi.restoreAllMocks(); db?.close(); owner?.release(); fs.rmSync(dir, { recursive: true, force: true }); });
    const group = commands => ledger.applyAccountingGroupSync(db, commands);
    it('one durable transaction preserves separate attempt snapshots and rounding, installed after reopen', async () => {
      const durable = vi.spyOn(db, 'durableTransaction'), rename = vi.spyOn(fs, 'renameSync');
      const results = group([insert('a'), insert('b'), finalize('a'), finalize('b')]);
      expect(durable).toHaveBeenCalledTimes(1); expect(results.map(r => r.ok)).toEqual([true, true, true, true]);
      if (engine === 'sql.js') expect(rename.mock.calls.filter(([, to]) => to === file)).toHaveLength(1);
      rename.mockRestore();
      expect(results[2].value).toMatchObject({ attemptId: 'a', state: 'settled', costNanoUsd: '1', priceSnapshot });
      expect(results[3].value).toMatchObject({ attemptId: 'b', state: 'settled', costNanoUsd: '1', priceSnapshot });
      // Two independent half-up operations: each0.5nano rounds1; combined1nano rounds1, not2.
      expect(ledger.sumSpendSync(db, 'key-a', timestamp, '2026-10-04T00:00:00.000Z')).toBe('1');
      durable.mockRestore(); db.close(); db = await open();
      expect(db.all('SELECT costNanoUsd FROM apiKeyAccounting ORDER BY attemptId').map(r => r.costNanoUsd)).toEqual([1, 1]);
      expect(db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined();
    });
    it('duplicate identity/terminal yields original rows and only one debit each', () => {
      const results = group([insert('a'), insert('a'), finalize('a'), finalize('a')]);
      expect(results.every(r => r.ok)).toBe(true); expect(results[0].value).toEqual(results[1].value);
      expect(results[2].value).toEqual(results[3].value); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(1);
      expect(db.all('SELECT * FROM apiKeyAccountingAudit')).toHaveLength(0);
    });
    it('identity conflict is member-local; valid neighbor commits unchanged', () => {
      ledger.insertAttemptSync(db, input('a'));
      const results = group([{ type: 'insert', input: { ...input('a'), model: 'different' } }, insert('b')]);
      expect(results[0]).toMatchObject({ ok: false }); expect(results[0].error.code).toBe('api_key_accounting_conflict');
      expect(results[1]).toMatchObject({ ok: true, value: { attemptId: 'b' } });
      expect(ledger.getAttemptSync(db, 'a').model).toBe('fixture');
    });
    it('conflicting terminal keeps committed observation audit and neighbor ACK without overwriting debit', () => {
      ledger.insertAttemptSync(db, input('a')); ledger.finalizeAttemptSync(db, 'a', terminal());
      const results = group([{ type: 'finalize', attemptId: 'a', terminal: { ...terminal(), costNanoUsd: '2' } }, insert('b')]);
      expect(results[0]).toMatchObject({ ok: false }); expect(results[0].error.code).toBe('api_key_accounting_conflict');
      expect(results[1].ok).toBe(true); expect(ledger.getAttemptSync(db, 'a').costNanoUsd).toBe('1');
      expect(db.all("SELECT action FROM apiKeyAccountingAudit")).toEqual([{ action: 'observation_conflict' }]);
    });
    it('invalid typed commands cannot inject callbacks or mutate unrelated state', () => {
      const callback = vi.fn();
      const results = group([{ type: 'sql', input: 'DELETE FROM apiKeys' }, { ...insert('a'), callback }, insert('b')]);
      expect(results.map(r => r.ok)).toEqual([false, false, true]); expect(callback).not.toHaveBeenCalled();
      expect(ledger.getAttemptSync(db, 'a')).toBeNull();
    });
    it('member mutation exception rolls back that savepoint, preserves neighbor and no false member ACK', () => {
      const run = db.run.bind(db);
      vi.spyOn(db, 'run').mockImplementation((sql, params) => {
        const result = run(sql, params);
        if (sql.includes('INSERT INTO apiKeyAccounting(') && params[0] === 'a') throw new Error('member write fixture');
        return result;
      });
      const results = group([insert('a'), insert('b')]);
      expect(results[0].ok).toBe(false); expect(results[1].ok).toBe(true);
      expect(ledger.getAttemptSync(db, 'a')).toBeNull(); expect(ledger.getAttemptSync(db, 'b').state).toBe('pending');
    });
    it('outer lost ACK rejects every result even if rows later prove installed; never blind replay ACK', () => {
      const durable = db.durableTransaction.bind(db);
      vi.spyOn(db, 'durableTransaction').mockImplementation(fn => { durable(fn); throw new Error('group lost acknowledgement'); });
      expect(() => group([insert('a'), insert('b')])).toThrow('group lost acknowledgement');
      expect(db.all('SELECT attemptId FROM apiKeyAccounting')).toHaveLength(2);
      // Fixture models lost delivery, not native adapter poisoning/fsync proof.
    });
    it('uncertain savepoint rollback refuses entire group and poisons storage, never member-local ACK', () => {
      const run = db.run.bind(db);
      vi.spyOn(db, 'run').mockImplementation((sql, params) => {
        const result = run(sql, params);
        if (sql.includes('INSERT INTO apiKeyAccounting(') && params[0] === 'a') {
          // Deliberately destroy the held savepoints to exercise rollback failure.
          db.exec('COMMIT'); throw new Error('rollback uncertainty fixture');
        }
        return result;
      });
      expect(() => group([insert('a'), insert('b')])).toThrow();
      expect(db.health()).toMatchObject({ healthy: false, poisoned: true });
    });
    it('caught nested uncertainty cannot be acknowledged or persisted by an outer caller', () => {
      expect(() => db.durableTransaction(() => {
        try { db.transaction(() => { db.exec('COMMIT'); throw new Error('nested uncertainty'); }); }
        catch { /* Simulate a caller that wrongly catches the failed member. */ }
        return 'must not be acknowledged';
      })).toThrow();
      expect(db.health()).toMatchObject({ healthy: false, poisoned: true });
    });
    if (engine === 'sql.js') it('real persist failure withholds all ACKs and preserves original installed image', async () => {
      const before = fs.readFileSync(file), rename = fs.renameSync;
      vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (to === file) throw new Error('group image publish failed'); return rename(from, to); });
      expect(() => group([insert('a'), insert('b')])).toThrow('group image publish failed');
      expect(db.health()).toMatchObject({ healthy: false, poisoned: true }); expect(fs.readFileSync(file)).toEqual(before);
      vi.restoreAllMocks(); db.close(); db = await open(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
    });
    it('batch count/payload hard safety bounds refuse before transaction and no iterator/getter callback authority', () => {
      const durable = vi.spyOn(db, 'durableTransaction');
      expect(() => group([])).toThrow(); expect(() => group(Array.from({ length: 33 }, (_, i) => insert(String(i))))).toThrow();
      expect(() => group([{ type: 'insert', input: { ...input('a'), model: 'x'.repeat(262145) } }])).toThrow();
      const getter = vi.fn(() => input('a')); const command = { type: 'insert' }; Object.defineProperty(command, 'input', { enumerable: true, get: getter });
      expect(() => group([command])).toThrow(); expect(getter).not.toHaveBeenCalled();
      expect(durable).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
    });
  });
}
