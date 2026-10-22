import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openFixture, addKey, intent } from '../fixtures/accounting/test-database.js';
import { insertAttemptSync } from '../../src/lib/db/repos/api-key-accounting-repo.js';
import { getWriteCoordinator } from '../../src/lib/accounting/write-coordinator.js';

let fixture;
afterEach(() => { vi.restoreAllMocks(); if (fixture) { try { fixture.db.close(); } catch {} fs.rmSync(fixture.root, { recursive: true, force: true }); fixture = null; } });
for (const engine of ['node', 'sqljs']) describe(`${engine} explicit accounting lifetime`, () => {
  it('stops queued work, marks pending unknown and rejects the old engine after clean reopen', async () => {
    fixture = await openFixture(engine); const { db, file } = fixture; addKey(db); insertAttemptSync(db, intent(db));
    const writer = getWriteCoordinator(db, () => { throw new Error('queue must not apply after stop'); });
    const pending = writer.enqueue({ operationId: 'queued' });
    const rejected = expect(pending).rejects.toThrow(/closing/);
    db.close(); await rejected;
    expect(fs.existsSync(path.join(fixture.root, '.gateway-writer.lock'))).toBe(false);
    fixture = await openFixture(engine, file);
    expect(fixture.db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'unresolved', costNanoUsd: null });
    expect(fixture.db.ownerInstanceId).not.toBe(db.ownerInstanceId);
    expect(() => db.get('SELECT 1')).toThrow();
  });
  it('retains ownership when pending recovery fails, then closes safely on a verified retry', async () => {
    fixture = await openFixture(engine); const { db } = fixture; addKey(db); insertAttemptSync(db, intent(db));
    vi.spyOn(db, 'durableTransaction').mockImplementationOnce(() => { throw new Error('close recovery failed'); });
    expect(() => db.close()).toThrow('close recovery failed');
    expect(fs.existsSync(path.join(fixture.root, '.gateway-writer.lock'))).toBe(true);
    expect(db.get('SELECT state FROM apiKeyAccounting').state).toBe('pending');
    db.close(); expect(fs.existsSync(path.join(fixture.root, '.gateway-writer.lock'))).toBe(false);
  });
  it('retries blocked lease release without a second accounting recovery or engine close', async () => {
    fixture = await openFixture(engine); const { db, root } = fixture; addKey(db); insertAttemptSync(db, intent(db));
    const recovery = vi.spyOn(db, 'durableTransaction');
    const gate = path.join(root, '.gateway-writer-acquisition'); fs.mkdirSync(gate);
    expect(() => db.close()).toThrow(/acquisition/); const count = recovery.mock.calls.length;
    fs.rmdirSync(gate); db.close(); expect(recovery.mock.calls.length).toBe(count);
  });
});
