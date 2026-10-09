import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createNodeSqliteAdapter } from '@/lib/db/adapters/nodeSqliteAdapter.js';
import { createSqlJsAdapter } from '@/lib/db/adapters/sqljsAdapter.js';
import { acquireWriterOwnership } from '@/lib/db/writerOwnership.js';
import { openAccountingCoverage, COVERAGE_FILE } from '@/lib/db/accountingCoverage.js';
import { runMigrationOnce } from '@/lib/db/migrate.js';
const adapter = vi.hoisted(() => ({ db: null, get: vi.fn() }));
vi.mock('@/lib/db/driver.js', () => ({ getAdapter: () => adapter.get() }));
let db, owner, directory, token;
const originalSecret = process.env.JWT_SECRET;
function request(body, authenticated = true, origin = 'http://localhost:20128', url = 'http://localhost:20128/api/accounting/gaps') {
  return new NextRequest(url, { method: body === undefined ? 'GET' : 'POST', headers: { host: 'localhost:20128', origin, ...(authenticated ? { cookie: `auth_token=${token}` } : { authorization: 'Bearer inference-only' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function operation(id = 'global-recovery') {
  const gap = db.coverage.status().gaps.find(gap => gap.apiKeyId === null && !gap.resolvedAt);
  return { gapId: gap.id, expectedGeneration: gap.generation, operationId: id, reason: 'operator reviewed', evidence: 'explicit global uncertainty waiver' };
}
afterEach(() => { vi.restoreAllMocks(); db?.close(); owner?.release(); if (directory) fs.rmSync(directory, { recursive: true, force: true }); if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret; });
describe.each(['node:sqlite', 'sql.js'])('privileged global gap recovery %s', engine => {
  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-global-management-')); owner = acquireWriterOwnership(directory);
    const file = path.join(directory, 'data.sqlite');
    db = engine === 'node:sqlite' ? await createNodeSqliteAdapter(file, owner) : await createSqlJsAdapter(file, owner);
    await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner); adapter.db = db; adapter.get.mockReset(); adapter.get.mockImplementation(async () => adapter.db);
    process.env.JWT_SECRET = 'disposable-global-management-session'; token = await (await import('@/lib/auth/dashboardSession.js')).createDashboardAuthToken();
    db.coverage.latchGap(null, 'private diagnostic global reason'); db.coverage.latchGap('key-a', 'private key uncertainty');
  });
  it('authorization/CSRF precede DB; observational response is global-only and redacted', async () => {
    const route = await import('@/app/api/accounting/gaps/route.js');
    expect((await route.GET(request(undefined, false))).status).toBe(401); expect(adapter.get).not.toHaveBeenCalled();
    expect((await route.POST(request(operation(), true, 'https://attacker.example'))).status).toBe(403); expect(adapter.get).not.toHaveBeenCalled();
    const bytes = fs.readFileSync(path.join(directory, COVERAGE_FILE));
    const response = await route.GET(request()); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
    const result = await response.json(); expect(result.enforcementActive).toBe(false); expect(result.gaps).toHaveLength(1); expect(result.gaps[0].scope).toBe('global');
    expect(JSON.stringify(result)).not.toMatch(/bindingKey|fingerprint|key-a|private|reason|evidence/); expect(fs.readFileSync(path.join(directory, COVERAGE_FILE))).toEqual(bytes);
    expect(db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined();
  });
  it('global waiver during maintenance is audited/idempotent and cannot clear key scope or maintenance', async () => {
    const route = await import('@/app/api/accounting/gaps/route.js'); db.coverage.enterMaintenance('fixture maintenance');
    const before = db.coverage.status(), input = operation();
    const keyGap = before.gaps.find(gap => gap.apiKeyId === 'key-a');
    expect((await route.POST(request({ ...input, gapId: keyGap.id, expectedGeneration: keyGap.generation }))).status).toBe(404);
    expect((await route.POST(request({ ...input, actor: 'attacker' }))).status).toBe(400);
    let receipt;
    for (let n = 0; n < 2; n++) {
      const response = await route.POST(request(input)); expect(response.status).toBe(200); const result = await response.json();
      expect(result.recoveryReceipt).toEqual({ version: 1, operationId: input.operationId, apiKeyId: null, kind: 'gap', targetId: input.gapId, action: 'coverage_waiver', generation: input.expectedGeneration });
      if (receipt) expect(result.recoveryReceipt).toEqual(receipt); receipt = result.recoveryReceipt;
      expect(result.maintenance.generation).toBe(before.maintenance.generation);
    }
    expect(db.coverage.status().maintenance).toEqual(before.maintenance); expect(db.coverage.status().gaps.find(gap => gap.id === keyGap.id).resolvedAt).toBeUndefined();
    expect(db.get('SELECT COUNT(*) AS n FROM apiKeyAccountingAudit').n).toBe(1); expect(db.get('SELECT actor FROM apiKeyAccountingAudit').actor).toBe('dashboard-session');
    expect((await route.POST(request({ ...input, evidence: 'changed' }))).status).toBe(409);
    expect(db.get('SELECT COUNT(*) AS n FROM apiKeyAccounting').n).toBe(0);
  });
  it('failed sidecar ACK leaves committed intent; same operation after reopen safely completes', async () => {
    const route = await import('@/app/api/accounting/gaps/route.js'); const input = operation();
    const rename = fs.renameSync; vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (to === path.join(directory, COVERAGE_FILE)) throw new Error('fixture sidecar ACK failed'); return rename(from, to); });
    expect((await route.POST(request(input))).status).toBe(503); vi.restoreAllMocks();
    expect(db.get('SELECT COUNT(*) AS n FROM apiKeyAccountingAudit').n).toBe(1);
    db.coverage = openAccountingCoverage(db, owner); expect(db.coverage.status().gaps.find(gap => gap.id === input.gapId).resolvedAt).toBeUndefined();
    const response = await route.POST(request(input)); expect(response.status).toBe(200); expect((await response.json()).recoveryReceipt.operationId).toBe(input.operationId);
    expect(db.get('SELECT COUNT(*) AS n FROM apiKeyAccountingAudit').n).toBe(1);
  });
  it('old committed unacknowledged operation cannot clear newer generation after reopen', async () => {
    const route = await import('@/app/api/accounting/gaps/route.js'); const input = operation();
    const rename = fs.renameSync; vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (to === path.join(directory, COVERAGE_FILE)) throw new Error('fixture sidecar ACK failed'); return rename(from, to); });
    expect((await route.POST(request(input))).status).toBe(503); vi.restoreAllMocks(); db.coverage = openAccountingCoverage(db, owner);
    db.coverage.latchGap(null, 'newer uncertainty'); const bytes = fs.readFileSync(path.join(directory, COVERAGE_FILE));
    expect((await route.POST(request(input))).status).toBe(409); expect(fs.readFileSync(path.join(directory, COVERAGE_FILE))).toEqual(bytes);
    expect((await route.POST(request({ ...operation(), operationId: input.operationId }))).status).toBe(409);
    expect(db.coverage.status().gaps.find(gap => gap.id === input.gapId).resolvedAt).toBeUndefined(); expect(db.get('SELECT COUNT(*) AS n FROM apiKeyAccountingAudit').n).toBe(1);
  });
  it('maintenance release route authorizes before DB, rejects altered intent, and preserves newer maintenance on replay', async () => {
    const route = await import('@/app/api/accounting/maintenance/release/route.js');
    const send = (input, authenticated = true, origin = 'http://localhost:20128') => request(input, authenticated, origin, 'http://localhost:20128/api/accounting/maintenance/release');
    db.coverage.enterMaintenance('operator review');
    const input = { expectedGeneration: db.coverage.status().maintenance.generation, operationId: 'route-maintenance', reason: 'reviewed', evidence: 'all-scope review' };
    expect((await route.POST(send(input, false))).status).toBe(401); expect(adapter.get).not.toHaveBeenCalled();
    expect((await route.POST(send(input, true, 'https://attacker.example'))).status).toBe(403); expect(adapter.get).not.toHaveBeenCalled();
    const bytes = fs.readFileSync(db.coverage.file);
    for (const bad of [{ ...input, actor: 'attacker' }, { ...input, action: 'activate' }, { ...input, expectedGeneration: 0 }, { ...input, evidence: '' }]) expect((await route.POST(send(bad))).status).toBe(400);
    expect(fs.readFileSync(db.coverage.file).equals(bytes)).toBe(true); expect(db.get('SELECT COUNT(*) AS n FROM apiKeyAccountingAudit').n).toBe(0);
    const response = await route.POST(send(input)); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
    const result = await response.json(); expect(result.maintenance).toBeNull(); expect(result.enforcementActive).toBe(false);
    expect(result.recoveryReceipt).toMatchObject({ kind: 'maintenance', operationId: input.operationId, generation: input.expectedGeneration });
    expect(JSON.stringify(result)).not.toMatch(/bindingKey|fingerprint|reason|evidence|actor|key-a/);
    expect(db.coverage.status().gaps.filter(gap => !gap.resolvedAt)).toHaveLength(2);
    expect(db.get("SELECT actor FROM apiKeyAccountingAudit WHERE operationId=?", [input.operationId]).actor).toBe('dashboard-session');
    db.coverage.enterMaintenance('later review'); const latest = db.coverage.status().maintenance, stable = fs.readFileSync(db.coverage.file);
    const replay = await route.POST(send(input)); expect(replay.status).toBe(200); const replayed = await replay.json();
    expect(replayed.recoveryReceipt).toEqual(result.recoveryReceipt); expect(replayed.maintenance.generation).toBe(latest.generation);
    expect((await route.POST(send({ ...input, evidence: 'changed' }))).status).toBe(409);
    expect(fs.readFileSync(db.coverage.file).equals(stable)).toBe(true); expect(db.get('SELECT COUNT(*) AS n FROM apiKeyAccountingAudit').n).toBe(1);
    expect(db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined();
  });
  it.each([false, true])('maintenance release route failed ACK installed=%s returns no success; replay is target-specific', async installed => {
    const route = await import('@/app/api/accounting/maintenance/release/route.js');
    const send = input => request(input, true, 'http://localhost:20128', 'http://localhost:20128/api/accounting/maintenance/release');
    db.coverage.enterMaintenance('review'); const input = { expectedGeneration: db.coverage.status().maintenance.generation, operationId: 'route-ack-failure', reason: 'reviewed', evidence: 'all-scope review' };
    const rename = fs.renameSync, sync = fs.fsyncSync; let renamed = false;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (!installed && to === db.coverage.file) throw new Error('private ACK failure'); const result = rename(from, to); if (to === db.coverage.file) renamed = true; return result; });
    vi.spyOn(fs, 'fsyncSync').mockImplementation(fd => { if (installed && renamed && fs.fstatSync(fd).isDirectory()) throw new Error('private ACK failure'); return sync(fd); });
    const failure = await route.POST(send(input)); expect(failure.status).toBe(503); expect(failure.headers.get('cache-control')).toContain('no-store'); expect(JSON.stringify(await failure.json())).not.toMatch(/private|reason|evidence/);
    vi.restoreAllMocks(); db.coverage = openAccountingCoverage(db, owner);
    if (installed) db.coverage.enterMaintenance('later review');
    const replay = await route.POST(send(input)); expect(replay.status).toBe(200); const result = await replay.json();
    expect(result.recoveryReceipt.operationId).toBe(input.operationId); expect(result.maintenance === null).toBe(!installed);
    expect(db.get('SELECT COUNT(*) AS n FROM apiKeyAccountingAudit').n).toBe(1); expect(db.coverage.status().gaps.filter(gap => !gap.resolvedAt)).toHaveLength(2);
  });
  it('maintenance ACK binds original target and historical replay never clears a newer maintenance', () => {
    db.coverage.enterMaintenance('first');
    const input = { expectedGeneration: db.coverage.status().maintenance.generation, operationId: 'maintenance-a', actor: 'fixture-admin', reason: 'reviewed', evidence: 'all-scope review' };
    db.coverage.releaseMaintenance(input);
    const receipt = db.coverage.maintenanceReceipt(input); expect(receipt).toMatchObject({ kind: 'maintenance', operationId: input.operationId, generation: input.expectedGeneration });
    db.coverage.enterMaintenance('second'); const bytes = fs.readFileSync(db.coverage.file), current = db.coverage.status().maintenance;
    db.coverage.releaseMaintenance(input); expect(db.coverage.maintenanceReceipt(input)).toEqual(receipt);
    expect(db.coverage.status().maintenance).toEqual(current); expect(fs.readFileSync(db.coverage.file)).toEqual(bytes);
    expect(() => db.coverage.releaseMaintenance({ ...input, evidence: 'different' })).toThrow(/conflict/);
    db.coverage = openAccountingCoverage(db, owner); expect(db.coverage.maintenanceReceipt(input)).toEqual(receipt); expect(db.coverage.status().maintenance).toEqual(current);
    expect(db.get("SELECT COUNT(*) AS n FROM apiKeyAccountingAudit WHERE action='maintenance_release'").n).toBe(1);
  });
  it.each([false, true])('maintenance failed acknowledgement installed=%s never infers success from absence', installed => {
    db.coverage.enterMaintenance('original');
    const input = { expectedGeneration: db.coverage.status().maintenance.generation, operationId: 'maintenance-fault', actor: 'fixture-admin', reason: 'reviewed', evidence: 'all-scope review' };
    const rename = fs.renameSync, sync = fs.fsyncSync; let renamed = false;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (!installed && to === db.coverage.file) throw new Error('fixture ACK failure'); const result = rename(from, to); if (to === db.coverage.file) renamed = true; return result; });
    vi.spyOn(fs, 'fsyncSync').mockImplementation(fd => { if (installed && renamed && fs.fstatSync(fd).isDirectory()) throw new Error('fixture installed ACK failure'); return sync(fd); });
    expect(() => db.coverage.releaseMaintenance(input)).toThrow(/ACK failure/); vi.restoreAllMocks();
    expect(() => db.coverage.status()).toThrow(); expect(db.get("SELECT COUNT(*) AS n FROM apiKeyAccountingAudit WHERE operationId=?", [input.operationId]).n).toBe(1);
    db.coverage = openAccountingCoverage(db, owner);
    if (installed) expect(db.coverage.maintenanceReceipt(input)).toBeTruthy();
    else { expect(db.coverage.maintenanceReceipt(input)).toBeNull(); expect(db.coverage.status().maintenance.generation).toBe(input.expectedGeneration); }
    db.coverage.releaseMaintenance(input); expect(db.coverage.maintenanceReceipt(input)).toBeTruthy();
    expect(db.get("SELECT COUNT(*) AS n FROM apiKeyAccountingAudit WHERE operationId=?", [input.operationId]).n).toBe(1);
  });
  it('committed release intent without sidecar ACK cannot release later maintenance', () => {
    db.coverage.enterMaintenance('first');
    const input = { expectedGeneration: db.coverage.status().maintenance.generation, operationId: 'maintenance-stale', actor: 'fixture-admin', reason: 'reviewed', evidence: 'all-scope review' };
    const rename = fs.renameSync; vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (to === db.coverage.file) throw new Error('fixture ACK failure'); return rename(from, to); });
    expect(() => db.coverage.releaseMaintenance(input)).toThrow(); vi.restoreAllMocks(); db.coverage = openAccountingCoverage(db, owner);
    db.coverage.enterMaintenance('later'); const bytes = fs.readFileSync(db.coverage.file);
    expect(() => db.coverage.releaseMaintenance(input)).toThrow(/generation conflict/); expect(fs.readFileSync(db.coverage.file)).toEqual(bytes);
    expect(db.coverage.maintenanceReceipt(input)).toBeNull();
  });
  it('dropped, duplicate or invalid maintenance ACK history denies rather than repairs', () => {
    db.coverage.enterMaintenance('first');
    const input = { expectedGeneration: db.coverage.status().maintenance.generation, operationId: 'maintenance-integrity', actor: 'fixture-admin', reason: 'reviewed', evidence: 'all-scope review' };
    db.coverage.releaseMaintenance(input); const original = JSON.parse(fs.readFileSync(db.coverage.file));
    const missing = structuredClone(original); delete missing.maintenanceReleases; fs.writeFileSync(db.coverage.file, JSON.stringify(missing)); expect(() => db.coverage.status()).toThrow();
    for (const mutate of [s => s.maintenanceReleases.push(s.maintenanceReleases[0]), s => s.maintenanceReleases[0].coverageId = 'foreign', s => s.maintenanceReleases[0].payloadHash = 'bad']) {
      const bad = structuredClone(original); mutate(bad); fs.writeFileSync(db.coverage.file, JSON.stringify(bad)); expect(() => openAccountingCoverage(db, owner)).toThrow();
    }
    fs.writeFileSync(db.coverage.file, JSON.stringify(original));
  });
  it('bounded ACK history denies new intent before audit but permits read-only exact replay at capacity', () => {
    db.coverage.enterMaintenance('first');
    const input = { expectedGeneration: db.coverage.status().maintenance.generation, operationId: 'maintenance-capacity', actor: 'fixture-admin', reason: 'reviewed', evidence: 'all-scope review' };
    db.coverage.releaseMaintenance(input); const receipt = db.coverage.maintenanceReceipt(input);
    const stored = JSON.parse(fs.readFileSync(db.coverage.file)), first = stored.maintenanceReleases[0];
    // Synthetic valid-shape history tests the admission bound, not 1000 real
    // release ACKs or recovery authority for these unrelated filler operations.
    for (let n = 1; n < 1000; n++) stored.maintenanceReleases.push({ ...first, operationId: `capacity-fixture-${n}`, generation: first.generation + n });
    stored.generation = first.generation + 1000;
    stored.maintenance = { generation: stored.generation, reason: 'new maintenance', startedAt: new Date().toISOString() };
    fs.writeFileSync(db.coverage.file, JSON.stringify(stored)); db.coverage = openAccountingCoverage(db, owner);
    const bytes = fs.readFileSync(db.coverage.file), before = db.get('SELECT COUNT(*) AS n FROM apiKeyAccountingAudit').n;
    expect(() => db.coverage.releaseMaintenance({ ...input, operationId: 'new-at-capacity', expectedGeneration: stored.generation })).toThrow(/unavailable/);
    expect(db.get('SELECT COUNT(*) AS n FROM apiKeyAccountingAudit').n).toBe(before); expect(fs.readFileSync(db.coverage.file).equals(bytes)).toBe(true);
    db.coverage.releaseMaintenance(input); expect(db.coverage.maintenanceReceipt(input)).toEqual(receipt);
    expect(fs.readFileSync(db.coverage.file).equals(bytes)).toBe(true); expect(db.coverage.status().maintenance.generation).toBe(stored.generation);
  });
  it('well-shaped ACK without matching committed audit cannot authorize release replay', () => {
    db.coverage.enterMaintenance('first');
    const input = { expectedGeneration: db.coverage.status().maintenance.generation, operationId: 'maintenance-no-audit', actor: 'fixture-admin', reason: 'reviewed', evidence: 'all-scope review' };
    db.coverage.releaseMaintenance(input);
    const stored = JSON.parse(fs.readFileSync(db.coverage.file)); stored.maintenanceReleases[0].operationId = 'forged-operation';
    fs.writeFileSync(db.coverage.file, JSON.stringify(stored)); db.coverage = openAccountingCoverage(db, owner);
    const bytes = fs.readFileSync(db.coverage.file);
    expect(() => db.coverage.releaseMaintenance({ ...input, operationId: 'forged-operation' })).toThrow();
    expect(fs.readFileSync(db.coverage.file)).toEqual(bytes);
  });
  it('successful historical receipt never claims newer global latch is resolved', async () => {
    const route = await import('@/app/api/accounting/gaps/route.js'); const input = operation();
    expect((await route.POST(request(input))).status).toBe(200); db.coverage.latchGap(null, 'later global uncertainty');
    const newer = operation('newer'); const response = await route.POST(request(input)); expect(response.status).toBe(200);
    const result = await response.json(); expect(result.recoveryReceipt.targetId).toBe(input.gapId);
    expect(result.gaps.find(gap => gap.id === newer.gapId)).not.toHaveProperty('resolvedAt');
    expect(db.coverage.status().gaps.find(gap => gap.id === newer.gapId).resolvedAt).toBeUndefined();
  });
});
