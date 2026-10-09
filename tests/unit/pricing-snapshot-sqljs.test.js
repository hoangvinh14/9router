import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqlJsAdapter } from '@/lib/db/adapters/sqljsAdapter.js';
import { runMigrationOnce } from '@/lib/db/migrate.js';
import { resolveReferencePriceSync } from '@/lib/pricing/referenceResolver.js';

let dir, file, db;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), '9router-price-sqljs-')); file = path.join(dir, 'data.sqlite');
  db = await createSqlJsAdapter(file); await runMigrationOnce(db);
  db.durableTransaction(() => db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','fixture',?)", [JSON.stringify({ model: { input: '0', output: '2' } })]));
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const resolve = () => resolveReferencePriceSync(db, 'fixture', 'model');
const write = rate => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='fixture'", [JSON.stringify({ model: { input: rate, output: '2' } })]);
describe('actual SQL.js immutable pricing memo durability', () => {
  it('warm acknowledged image memoizes; dirty and transaction-local reads never publish', () => {
    expect(db.driver).toBe('sql.js');
    const first = resolve(); expect(resolve()).toBe(first);
    write('3');
    const dirty = resolve(); expect(dirty.snapshot.rates.input).toBe('3'); expect(resolve()).not.toBe(dirty);
    db.durableTransaction(() => {});
    const acked = resolve(); expect(resolve()).toBe(acked);
    expect(() => db.durableTransaction(() => { write('9'); expect(resolve().snapshot.rates.input).toBe('9'); throw new Error('rollback'); })).toThrow('rollback');
    db.durableTransaction(() => {});
    expect(resolve().snapshot.rates.input).toBe('3');
    db.durableTransaction(() => write('4'));
    expect(resolve().snapshot.rates.input).toBe('4'); expect(first.snapshot.rates.input).toBe('0');
  });
  for (const failure of ['before-install', 'after-install-before-ack']) {
    it(`failed ${failure} publication poisons memo; reopen reads persisted image without retroactive ACK`, async () => {
      const first = resolve(); const before = fs.readFileSync(file);
      if (failure === 'before-install') {
        const rename = fs.renameSync;
        vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (to === file) throw new Error('fixture rename failure'); return rename(from, to); });
      } else {
        const fsync = fs.fsyncSync; let calls = 0;
        vi.spyOn(fs, 'fsyncSync').mockImplementation(fd => { if (++calls === 2) throw new Error('fixture directory ACK failure'); return fsync(fd); });
      }
      expect(() => db.durableTransaction(() => write('9'))).toThrow();
      expect(db.health().healthy).toBe(false); expect(() => resolve()).toThrow();
      if (failure === 'before-install') expect(fs.readFileSync(file).equals(before)).toBe(true);
      vi.restoreAllMocks(); db.close(); db = await createSqlJsAdapter(file);
      expect(resolve().snapshot.rates.input).toBe(failure === 'before-install' ? '0' : '9');
      expect(resolve()).not.toBe(first); expect(first.snapshot.rates.input).toBe('0');
    });
  }
});
