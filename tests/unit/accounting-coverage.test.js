import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openFixture, addKey } from '../fixtures/accounting/test-database.js';
import { createSqlJsAdapter } from '../../src/lib/db/adapters/sqljsAdapter.js';
import { createNodeSqliteAdapter } from '../../src/lib/db/adapters/nodeSqliteAdapter.js';
import { openAccountingCoverage } from '../../src/lib/db/accounting-coverage.js';
import { verifyAccountingSchema } from '../../src/lib/db/migrations/002-accounting-foundation.js';

let fixture;
afterEach(() => { vi.restoreAllMocks(); if (fixture) { try { fixture.db.close(); } catch {} fs.rmSync(fixture.root, { recursive: true, force: true }); fixture = null; } });
for (const engine of ['node', 'sqljs']) describe(`${engine} coverage and maintenance`, () => {
  it('keeps independent gap ACK, scope, generation CAS and idempotent audited release', async () => {
    fixture = await openFixture(engine); const { db } = fixture; addKey(db);
    const gap = db.coverage.latchGap('key-one', 'storage failure').gaps[0];
    const maintenance = db.coverage.enterMaintenance('restore');
    const operation = { action: 'gap_waiver', gapId: gap.id, apiKeyId: 'key-one', expectedGeneration: gap.generation, operationId: 'gap-op', actor: 'admin', reason: 'explicit waiver', evidence: 'test receipt' };
    const receipt = db.coverage.reconcile(operation);
    expect(db.coverage.reconcile(operation)).toEqual(receipt);
    expect(db.coverage.status().maintenance).toEqual(maintenance.maintenance);
    expect(db.get('SELECT COUNT(*) AS count FROM apiKeyAccountingAudit').count).toBe(1);
    expect(() => db.coverage.reconcile({ ...operation, reason: 'changed' })).toThrow(/conflict/);
    const release = { action: 'maintenance_release', expectedGeneration: maintenance.maintenance.generation, operationId: 'release-op', actor: 'admin', reason: 'verified', evidence: 'receipt' };
    db.coverage.reconcile(release); expect(db.coverage.status().maintenance).toBeNull();
    db.coverage.enterMaintenance('later');
    db.coverage.reconcile(release); expect(db.coverage.status().maintenance.reason).toBe('later');
    expect(() => db.run("DELETE FROM apiKeyAccountingAudit")).toThrow(/append-only/);
  });
  it('leaves a new gap blocked on stale generation or failed DB audit', async () => {
    fixture = await openFixture(engine); const { db } = fixture;
    const old = db.coverage.latchGap(null, 'outage').gaps[0];
    const op = { action: 'gap_waiver', gapId: old.id, apiKeyId: null, expectedGeneration: old.generation, operationId: 'op', actor: 'admin', reason: 'waive', evidence: 'receipt' };
    db.coverage.latchGap(null, 'new outage');
    expect(() => db.coverage.reconcile(op)).toThrow(/conflict/);
    op.expectedGeneration = db.coverage.status().gaps[0].generation;
    vi.spyOn(db, 'durableTransaction').mockImplementationOnce(() => { throw new Error('audit unavailable'); });
    expect(() => db.coverage.reconcile(op)).toThrow('audit unavailable');
    expect(db.coverage.status().gaps[0].resolvedAt).toBeUndefined();
  });
  it('refuses missing/mismatched artifacts before migration or application mutation', async () => {
    fixture = await openFixture(engine); const { file, root, db } = fixture; db.close();
    const sidecar = path.join(root, '.accounting-coverage.json'); fs.unlinkSync(sidecar);
    const before = fs.readFileSync(file);
    const create = engine === 'node' ? createNodeSqliteAdapter : createSqlJsAdapter;
    await expect(create(file)).rejects.toThrow(/coverage/);
    expect(fs.readFileSync(file).equals(before)).toBe(true);
    expect(fs.existsSync(path.join(root, '.gateway-writer.lock'))).toBe(false);
  });
  it('latches independently while DB reads are unavailable and fails closed on sidecar publication failure', async () => {
    fixture = await openFixture(engine); const { db } = fixture;
    vi.spyOn(db, 'health').mockReturnValue({ healthy: false });
    vi.spyOn(db, 'get').mockImplementation(() => { throw new Error('RAM is not durable truth'); });
    expect(db.coverage.latchGap('key-one', 'failed intent').gaps).toHaveLength(1);
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('publication failed'); });
    expect(() => db.coverage.latchGap('key-one', 'new admission')).toThrow('publication failed');
    expect(() => db.coverage.status()).toThrow(/unavailable/);
  });
  it.each(['before publication', 'after publication'])('replays a committed audit when sidecar ACK fails %s', async boundary => {
    fixture = await openFixture(engine); const { db, owner } = fixture;
    const gap = db.coverage.latchGap(null, 'outage').gaps[0];
    const op = { action: 'gap_waiver', gapId: gap.id, apiKeyId: null, expectedGeneration: gap.generation, operationId: 'replay-op', actor: 'admin', reason: 'waive', evidence: 'verified' };
    const rename = fs.renameSync, sidecar = path.join(fixture.root, '.accounting-coverage.json'); let injected = false;
    vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (!injected && destination === sidecar) {
        injected = true;
        if (boundary === 'after publication') rename(source, destination);
        throw new Error('sidecar ACK failed');
      }
      return rename(source, destination);
    });
    expect(() => db.coverage.reconcile(op)).toThrow('sidecar ACK failed');
    expect(injected).toBe(true); expect(db.health().healthy).toBe(true);
    expect(db.get('SELECT COUNT(*) AS count FROM apiKeyAccountingAudit').count).toBe(1);
    expect(() => db.coverage.status()).toThrow(/unavailable/);
    vi.restoreAllMocks(); db.coverage = openAccountingCoverage(db, owner);
    expect(Boolean(db.coverage.status().gaps[0].resolvedAt)).toBe(boundary === 'after publication');
    const receipt = db.coverage.reconcile(op);
    expect(db.coverage.reconcile(op)).toEqual(receipt);
    expect(db.coverage.status().gaps[0].resolvedAt).toBeTruthy();
    expect(db.get('SELECT COUNT(*) AS count FROM apiKeyAccountingAudit').count).toBe(1);
  });
  it('refuses missing or replaced audit protection rather than accepting schema readiness', async () => {
    fixture = await openFixture(engine); const { db } = fixture;
    db.durableTransaction(() => db.exec('DROP TRIGGER accounting_audit_no_update'));
    expect(() => verifyAccountingSchema(db)).toThrow(/audit protection/);
    db.durableTransaction(() => db.exec('CREATE TRIGGER accounting_audit_no_update BEFORE UPDATE ON apiKeyAccountingAudit BEGIN SELECT 1; END'));
    expect(() => verifyAccountingSchema(db)).toThrow(/audit protection/);
  });
  it.each(['malformed', 'binding mismatch', 'insecure permissions'])('refuses %s sidecar before application mutation', async mode => {
    fixture = await openFixture(engine); const { db, file, root } = fixture; db.close();
    const sidecar = path.join(root, '.accounting-coverage.json'), before = fs.readFileSync(file);
    if (mode === 'malformed') fs.writeFileSync(sidecar, '{');
    else if (mode === 'binding mismatch') {
      const state = JSON.parse(fs.readFileSync(sidecar, 'utf8')); state.bindingKey = 'f'.repeat(64); fs.writeFileSync(sidecar, JSON.stringify(state));
    } else fs.chmodSync(sidecar, 0o644);
    await expect((engine === 'node' ? createNodeSqliteAdapter : createSqlJsAdapter)(file)).rejects.toThrow(/coverage/);
    expect(fs.readFileSync(file).equals(before)).toBe(true);
  });
});
