import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNodeSqliteAdapter } from '../../src/lib/db/adapters/nodeSqliteAdapter.js';
import { createSqlJsAdapter } from '../../src/lib/db/adapters/sqljsAdapter.js';
import { installPricingRevision, readPricingRevision, PRICING_REVISION_TRIGGERS } from '../../src/lib/db/pricingRevision.js';
import { resolveReferencePriceSync } from '../../src/lib/pricing/referenceResolver.js';

let roots = [], databases = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of databases) { try { db.close(); } catch { /* uncertain-publication fixture retains exclusion until fixture removal */ } }
  databases = [];
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  roots = [];
});
async function open(factory) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pricing-revision-')); roots.push(root);
  const db = await factory(path.join(root, 'data.sqlite')); databases.push(db);
  db.exec('CREATE TABLE _meta(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE kv(scope TEXT,key TEXT,value TEXT,PRIMARY KEY(scope,key))');
  installPricingRevision(db);
  return db;
}
function override(db, rates) {
  db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','openai',?) ON CONFLICT(scope,key) DO UPDATE SET value=excluded.value", [JSON.stringify({ fixture: rates })]);
}
for (const [label, factory] of [['Node', createNodeSqliteAdapter], ['SQL.js', createSqlJsAdapter]]) {
  describe(`${label} reference revision and frozen snapshots`, () => {
    it('installs verified triggers idempotently and invalidates raw old/new scope transitions', async () => {
      const db = await open(factory);
      expect(readPricingRevision(db)).toBe('0'); installPricingRevision(db);
      expect(readPricingRevision(db)).toBe('0');
      db.durableTransaction(() => override(db, { input: '0', output: '2' }));
      expect(readPricingRevision(db)).toBe('1');
      const first = resolveReferencePriceSync(db, 'openai', 'fixture');
      expect(first.snapshot.rates.input).toBe('0');
      expect(resolveReferencePriceSync(db, 'openai', 'fixture')).toBe(first);
      db.durableTransaction(() => db.run("UPDATE kv SET scope='other' WHERE scope='pricing'"));
      expect(readPricingRevision(db)).toBe('2');
      expect(resolveReferencePriceSync(db, 'openai', 'fixture').status).toBe('unavailable');
      db.durableTransaction(() => db.run("UPDATE kv SET scope='pricing' WHERE scope='other'"));
      expect(readPricingRevision(db)).toBe('3');
      db.durableTransaction(() => override(db, { input: '1.000000001', output: '3', cached: '0' }));
      const next = resolveReferencePriceSync(db, 'openai', 'fixture');
      expect(next.snapshot.rates.input).toBe('1.000000001'); expect(next.snapshot.revision).not.toBe(first.snapshot.revision);
      expect(first.snapshot.rates.input).toBe('0');
      for (const item of [first, first.snapshot, first.snapshot.rates, first.snapshot.mapping, first.snapshot.fallbackSemantics]) expect(Object.isFrozen(item)).toBe(true);
    });
    it('rollback cannot publish memo or reuse a collided revision; status writes do not invalidate', async () => {
      const db = await open(factory);
      db.durableTransaction(() => override(db, { input: '1', output: '2' }));
      const first = resolveReferencePriceSync(db, 'openai', 'fixture');
      expect(() => db.durableTransaction(() => {
        override(db, { input: '9', output: '9' });
        expect(resolveReferencePriceSync(db, 'openai', 'fixture').snapshot.rates.input).toBe('9');
        throw new Error('rollback');
      })).toThrow('rollback');
      expect(readPricingRevision(db)).toBe('1');
      expect(resolveReferencePriceSync(db, 'openai', 'fixture').snapshot.rates.input).toBe('1');
      db.durableTransaction(() => db.run("INSERT INTO kv VALUES('referencePricing','status','{}')"));
      const afterRollback = resolveReferencePriceSync(db, 'openai', 'fixture');
      expect(resolveReferencePriceSync(db, 'openai', 'fixture')).toBe(afterRollback);
      expect(first.snapshot.rates.input).toBe('1');
    });
    it('corrupt/missing/exhausted revisions refuse mutation and warm memo authority', async () => {
      const db = await open(factory);
      db.durableTransaction(() => override(db, { input: '1', output: '2' }));
      resolveReferencePriceSync(db, 'openai', 'fixture');
      for (const bad of ['broken', '-1', '01', '1\n', '9007199254740992']) {
        db.durableTransaction(() => db.run("UPDATE _meta SET value=? WHERE key='referencePricingRevision'", [bad]));
        expect(() => readPricingRevision(db)).toThrow(/revision/);
        expect(() => resolveReferencePriceSync(db, 'openai', 'fixture')).toThrow(/revision/);
        expect(() => db.durableTransaction(() => override(db, { input: '8', output: '8' }))).toThrow(/revision/);
      }
      db.durableTransaction(() => db.run("UPDATE _meta SET value='9007199254740991' WHERE key='referencePricingRevision'"));
      expect(() => db.durableTransaction(() => override(db, { input: '8', output: '8' }))).toThrow(/exhausted/);
      expect(JSON.parse(db.get("SELECT value FROM kv WHERE scope='pricing'").value).fixture.input).toBe('1');
      db.durableTransaction(() => db.run("DELETE FROM _meta WHERE key='referencePricingRevision'"));
      expect(() => installPricingRevision(db)).toThrow(/missing/);
    });
    it('does not silently adopt a same-name altered trigger', async () => {
      const db = await open(factory);
      db.durableTransaction(() => {
        db.exec(`DROP TRIGGER ${PRICING_REVISION_TRIGGERS[0].name}`);
        db.exec(`CREATE TRIGGER ${PRICING_REVISION_TRIGGERS[0].name} AFTER INSERT ON kv BEGIN SELECT 1; END`);
      });
      expect(() => installPricingRevision(db)).toThrow(/mismatch/);
    });
  });
}
describe('SQL.js committed memo boundary', () => {
  it('empty durable transaction publishes previous dirty state; outer nesting cannot act as barrier', async () => {
    const db = await open(createSqlJsAdapter);
    override(db, { input: '2', output: '3' });
    expect(db.canMemoizePricing()).toBe(false);
    expect(() => db.transaction(() => db.durableTransaction(() => {}))).toThrow(/outermost/);
    expect(db.canMemoizePricing()).toBe(false);
    db.durableTransaction(() => {});
    expect(db.canMemoizePricing()).toBe(true);
    const file = path.join(roots[0], 'data.sqlite'); db.close();
    const reopened = await createSqlJsAdapter(file); databases.push(reopened);
    expect(resolveReferencePriceSync(reopened, 'openai', 'fixture').snapshot.rates.input).toBe('2');
  });
  it('failed publication poisons and refuses previously warm snapshot', async () => {
    const db = await open(createSqlJsAdapter);
    db.durableTransaction(() => override(db, { input: '1', output: '2' }));
    const first = resolveReferencePriceSync(db, 'openai', 'fixture');
    override(db, { input: '9', output: '9' });
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('publication injected'); });
    expect(() => db.durableTransaction(() => {})).toThrow(/publication/);
    expect(db.health().healthy).toBe(false);
    expect(() => resolveReferencePriceSync(db, 'openai', 'fixture')).toThrow();
    expect(first.snapshot.rates.input).toBe('1');
  });
});
