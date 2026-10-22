import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { openFixture, intent, exactUsage, addKey } from '../fixtures/accounting/test-database.js';
import { insertAttemptSync as insert, finalizeAttemptSync as finish, getAttemptSync as read, resolveAttemptSync as resolve, sumSpendSync } from '../../src/lib/db/repos/api-key-accounting-repo.js';

let fixture;
afterEach(() => { if (fixture) { fixture.db.close(); fs.rmSync(fixture.root, { recursive: true, force: true }); fixture = null; } });
const terminal = state => ({ state, outcome: 'success', finishedAt: '2026-10-22T00:01:00.000Z', ...(state === 'settled' ? { usage: exactUsage() } : {}) });
for (const engine of ['node', 'sqljs']) describe(`${engine} durable ledger`, () => {
  it('deduplicates immutable intent/terminal, preserves original price across changes and reopens exact settlement', async () => {
    fixture = await openFixture(engine); let { db } = fixture; addKey(db);
    const input = intent(db); insert(db, input); expect(insert(db, input).state).toBe('pending');
    expect(() => insert(db, { ...input, priceSnapshot: { ...input.priceSnapshot, rates: { input: '9', output: '9' } } })).toThrow(/conflict/);
    db.durableTransaction(() => db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','openai','{}')"));
    const result = finish(db, input.attemptId, terminal('settled'));
    expect(result.costNanoUsd).toBe('1200000'); expect(finish(db, input.attemptId, terminal('settled')).resolutionVersion).toBe(1);
    expect(() => finish(db, input.attemptId, { ...terminal('settled'), usage: exactUsage(2000) })).toThrow(/conflict/);
    expect(db.get('SELECT COUNT(*) AS count FROM apiKeyAccountingAudit').count).toBe(1);
    db.close(); fixture = await openFixture(engine, fixture.file); db = fixture.db;
    expect(read(db, input.attemptId).costNanoUsd).toBe('1200000');
    expect(sumSpendSync(db, 'key-one', '2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')).toBe('1200000');
    expect(db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined();
  });
  it('keeps unknown null, permits late exact usage and protects audited manual resolution with CAS', async () => {
    fixture = await openFixture(engine); const { db } = fixture; addKey(db);
    insert(db, intent(db)); expect(finish(db, 'attempt-one', terminal('unresolved')).costNanoUsd).toBeNull();
    expect(finish(db, 'attempt-one', terminal('settled')).state).toBe('settled');
    insert(db, intent(db, 'attempt-two')); finish(db, 'attempt-two', terminal('unresolved'));
    const op = { action: 'waive', operationId: 'admin-op', expectedVersion: 1, actor: 'admin', reason: 'explicit waiver', evidence: 'verified unknown' };
    expect(() => resolve(db, 'attempt-two', { ...op, expectedVersion: 0 })).toThrow(/conflict/);
    expect(resolve(db, 'attempt-two', op).costNanoUsd).toBe('0');
    expect(resolve(db, 'attempt-two', op).resolutionVersion).toBe(2);
    expect(() => resolve(db, 'attempt-two', { ...op, reason: 'different' })).toThrow(/conflict/);
    expect(() => finish(db, 'attempt-two', terminal('settled'))).toThrow(/conflict/);
    expect(read(db, 'attempt-two').state).toBe('waived');
    insert(db, intent(db, 'attempt-three'));
    expect(() => finish(db, 'attempt-three', terminal('not_dispatched'))).toThrow(/evidence/);
    expect(finish(db, 'attempt-three', { ...terminal('not_dispatched'), notDispatchedEvidence: 'local refusal before POST' }).costNanoUsd).toBeNull();
  });
});
