import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { openFixture, intent, exactUsage, addKey } from '../fixtures/accounting/test-database.js';
import { insertAttemptSync, finalizeAttemptSync, getAttemptSync, recoverPendingSync, sumSpendSync } from '../../src/lib/db/repos/api-key-accounting-repo.js';

let fixture;
afterEach(() => { if (fixture) { fixture.db.close(); fs.rmSync(fixture.root, { recursive: true, force: true }); fixture = null; } });
for (const engine of ['node', 'sqljs']) describe(`${engine} B1 non-work disposition`, () => {
  it('retains idempotency and original cost period for late evidence after an interrupted absence', async () => {
    fixture = await openFixture(engine); const { db } = fixture; addKey(db);
    insertAttemptSync(db, intent(db));
    const absent = { state: 'unrecorded', outcome: 'stream_unknown', finishedAt: '2026-10-22T00:01:00.000Z', evidence: { kind: 'absent', interrupted: true } };
    expect(finalizeAttemptSync(db, 'attempt-one', absent).costNanoUsd).toBeNull();
    expect(finalizeAttemptSync(db, 'attempt-one', absent).resolutionVersion).toBe(1);
    const late = { state: 'settled', outcome: 'late_usage', finishedAt: '2026-11-10T00:00:00.000Z', usage: exactUsage() };
    finalizeAttemptSync(db, 'attempt-one', late); finalizeAttemptSync(db, 'attempt-one', late);
    expect(sumSpendSync(db, 'key-one', '2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')).toBe('1200000');
    expect(sumSpendSync(db, 'key-one', '2026-11-01T00:00:00.000Z', '2026-12-01T00:00:00.000Z')).toBe('0');
  });
  it('refuses malformed or completed evidence as an unrecorded exemption', async () => {
    fixture = await openFixture(engine); const { db } = fixture; addKey(db); insertAttemptSync(db, intent(db));
    for (const evidence of [{ kind: 'malformed', interrupted: true }, { kind: 'absent', interrupted: false }]) {
      expect(() => finalizeAttemptSync(db, 'attempt-one', { state: 'unrecorded', outcome: 'bad', finishedAt: '2026-10-22T00:01:00.000Z', evidence })).toThrow();
    }
    expect(getAttemptSync(db, 'attempt-one').state).toBe('pending');
  });
  it('does not discard stored usage when recovering a dead-owner pending attempt', async () => {
    fixture = await openFixture(engine); const { db } = fixture; addKey(db);
    insertAttemptSync(db, { ...intent(db), ownerInstanceId: 'verified-dead-owner' });
    db.durableTransaction(() => db.run("UPDATE apiKeyAccounting SET usageJson=? WHERE attemptId='attempt-one'", [JSON.stringify(exactUsage())]));
    recoverPendingSync(db, 'verified-dead-owner');
    expect(getAttemptSync(db, 'attempt-one')).toMatchObject({ state: 'unresolved', usage: exactUsage() });
    const file=fixture.file;db.close();fixture=await openFixture(engine,file);
    expect(getAttemptSync(fixture.db,'attempt-one')).toMatchObject({state:'unresolved',usage:exactUsage()});
  });
  it.each(['recover-first','settle-first'])('serializes recovery and late settlement without a second charge (%s)',async order=>{
    fixture=await openFixture(engine);const {db}=fixture;addKey(db);
    insertAttemptSync(db,{...intent(db),ownerInstanceId:'verified-dead-owner'});
    const settle=()=>finalizeAttemptSync(db,'attempt-one',{state:'settled',outcome:'late',finishedAt:'2026-11-10T00:00:00.000Z',usage:exactUsage()});
    if(order==='recover-first'){recoverPendingSync(db,'verified-dead-owner');settle();}else{settle();recoverPendingSync(db,'verified-dead-owner');}
    settle();expect(getAttemptSync(db,'attempt-one')).toMatchObject({state:'settled',costNanoUsd:'1200000'});
    expect(sumSpendSync(db,'key-one','2026-10-01T00:00:00.000Z','2026-11-01T00:00:00.000Z')).toBe('1200000');
  });
  it('abandons only the selected owner while preserving charges and live intents', async () => {
    fixture = await openFixture(engine); const { db } = fixture; addKey(db);
    insertAttemptSync(db, { ...intent(db), ownerInstanceId: 'verified-dead-owner' });
    insertAttemptSync(db, intent(db, 'live'));
    recoverPendingSync(db, 'verified-dead-owner');
    expect(getAttemptSync(db, 'attempt-one').state).toBe('unrecorded');
    expect(getAttemptSync(db, 'live').state).toBe('pending');
  });
});
